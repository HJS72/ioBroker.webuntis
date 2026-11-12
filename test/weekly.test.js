'use strict';

const assert = require('assert').strict;
const fs = require('fs');
const vm = require('vm');
const proxyquire = require('proxyquire').noCallThru();

class FakeAdapter {
    constructor(options) {
        this.config = options.config;
        this.namespace = options.namespace || 'webuntis.0';
        this.states = {};
        this.objects = {};
        this.errors = [];
        this.log = { error: message => this.errors.push(message), debug: () => {}, info: () => {} };
        this.timers = [];
    }
    on() {}
    async setObjectNotExistsAsync(id, object) { this.objects[id] = this.objects[id] || object; }
    async getObjectAsync(id) { return this.objects[id] || null; }
    async getObjectViewAsync(_design, search, options) {
        return { rows: Object.entries(this.objects).filter(([id, object]) =>
            object.type === search && `${this.namespace}.${id}` >= options.startkey && `${this.namespace}.${id}` <= options.endkey,
        ).map(([id, value]) => ({ id: `${this.namespace}.${id}`, value })) };
    }
    async getObjectListAsync(options) {
        return { rows: Object.entries(this.objects).filter(([id]) =>
            `${this.namespace}.${id}` >= options.startkey && `${this.namespace}.${id}` <= options.endkey,
        ).map(([id, value]) => ({ id: `${this.namespace}.${id}`, value })) };
    }
    async delObjectAsync(id, options) {
        for (const key of Object.keys(this.objects)) if (key === id || (options?.recursive && key.startsWith(`${id}.`))) delete this.objects[key];
        for (const key of Object.keys(this.states)) if (key === id || (options?.recursive && key.startsWith(`${id}.`))) delete this.states[key];
    }
    async setStateAsync(id, value) { this.states[id] = value; }
    setTimeout(callback, delay) { this.timers.push({ callback, delay }); return this.timers.length; }
    clearTimeout() {}
}

class FakeUntis {
    constructor(school, username, password, baseUrl) {
        Object.assign(this, { school, username, password, baseUrl });
        this.axios = { defaults: {} };
        FakeUntis.sessions.push(this);
    }
    async login() { if (FakeUntis.failures.has(this.username)) throw new Error('login failed'); return { klasseId: 42 }; }
    async logout() { this.loggedOut = true; }
    async getOwnTimetableFor() { this.legacyRequests = (this.legacyRequests || 0) + 1; return []; }
    async getNewsWidget() { return { messagesOfDay: [] }; }
    async getInbox() { return { incomingMessages: [] }; }
    async getOwnTimetableForRange(start, end) {
        this.range = this.range || [start, end];
        this.ranges = (this.ranges || []).concat([[start, end]]);
        if (FakeUntis.failedWeek === this.ranges.length - 1) throw new Error('timetable unavailable');
        if (FakeUntis.empty.has(this.username)) return [];
        const dateAt = offset => {
            const date = new Date(start);
            date.setDate(date.getDate() + offset);
            return date.getFullYear() * 10000 + (date.getMonth() + 1) * 100 + date.getDate();
        };
        return [
            { date: dateAt(0), startTime: 1000, endTime: 1045, subject: this.username, substText: 'Room change' },
            { date: dateAt(4), startTime: 900, endTime: 945, subject: this.username, code: 'cancelled' },
            { date: dateAt(0), startTime: 800, endTime: 845, subject: this.username,
                su: [{ name: 'Mathe' }, { name: 'Physik' }], ro: [{ name: 'A101' }],
                te: [{ name: 'AB', longname: 'Lehrer Eins' }], code: 'irregular', info: 'Test' },
            { date: dateAt(5), startTime: 800, subject: this.username },
        ];
    }
    async getClasses() { return [{ id: 42, name: '5A' }]; }
    async getExamsForRange(start, end, classId, withGrades) {
        this.examRanges = (this.examRanges || []).concat([[start, end, classId, withGrades]]);
        if (FakeUntis.examFailures.has(this.username)) throw new Error('exam access denied');
        const examDate = start.getFullYear() * 10000 + (start.getMonth() + 1) * 100 + start.getDate();
        if (FakeUntis.examMode === 'invalid') return [{ examDate, startTime: 'invalid', endTime: 845 }];
        return [{ examDate, startTime: 800, endTime: 845, subject: FakeUntis.examMode === 'missingSubject' ? '' : 'Mathe' }];
    }
    async getTimetableForRange(start, end, id, type) {
        this.range = this.range || [start, end, id, type];
        this.ranges = (this.ranges || []).concat([[start, end, id, type]]);
        return [];
    }
}
FakeUntis.sessions = [];
FakeUntis.failures = new Set();
FakeUntis.empty = new Set();
FakeUntis.examFailures = new Set();
FakeUntis.failedWeek = -1;
FakeUntis.examMode = '';
FakeUntis.TYPES = { CLASS: 1 };
FakeUntis.WebUntisAnonymousAuth = class extends FakeUntis {
    constructor(school, baseUrl) { super(school, '', '', baseUrl); }
};

const createAdapter = proxyquire('../build/main', {
    '@iobroker/adapter-core': { Adapter: FakeAdapter },
    webuntis: FakeUntis,
});

describe('weekly timetable polling', () => {
    beforeEach(() => {
        FakeUntis.sessions = []; FakeUntis.failures.clear(); FakeUntis.empty.clear(); FakeUntis.examFailures.clear();
        FakeUntis.failedWeek = -1; FakeUntis.examMode = '';
    });

    it('removes additional-account controls while protecting old credentials', () => {
        const html = fs.readFileSync('admin/index_m.html', 'utf8');
        const metadata = require('../io-package.json');
        assert(!html.includes('accounts_json'));
        assert(!html.includes('add-account'));
        assert(!Object.prototype.hasOwnProperty.call(metadata.native, 'accounts_json'));
        assert(metadata.protectedNative.includes('accounts_json'));
        assert(metadata.encryptedNative.includes('accounts_json'));
    });

    it('loads and saves the instance login in the admin form', () => {
        const html = fs.readFileSync('admin/index_m.html', 'utf8');
        const script = html.match(/<script type="text\/javascript">([\s\S]*?)<\/script>/)[1];
        const fields = Object.fromEntries(['anonymous', 'class', 'username', 'client_secret', 'school', 'baseUrl']
            .map(id => [id, { id, type: id === 'anonymous' ? 'checkbox' : 'text' }]));
        function jquery(selector) {
            if (selector === '.value') return { each(callback) { Object.values(fields).forEach(field => callback.call(field)); } };
            if (selector === '.controller-checkbox') return { change() {}, prop() { return fields.anonymous.checked; } };
            if (typeof selector === 'string') return { each() {} };
            return {
                attr(name) { return selector[name]; },
                val(value) { if (value === undefined) return selector.value; selector.value = value; return this; },
                prop(name, value) { if (value === undefined) return selector[name]; selector[name] = value; return this; },
                on() { return this; },
            };
        }
        const context = { $: jquery, M: { updateTextFields() {} }, supportsFeature: () => true };
        vm.runInNewContext(script, context);
        context.load({ anonymous: false, class: '', username: 'child', client_secret: 'secret',
            school: 'School', baseUrl: 'host', accounts_json: 'legacy' }, () => {});
        let saved;
        context.save(value => { saved = value; });
        assert.equal(saved.username, 'child');
        assert.equal(saved.client_secret, 'secret');
        assert.equal(saved.school, 'School');
        assert(!Object.prototype.hasOwnProperty.call(saved, 'accounts_json'));
    });

    it('can set a timeout on the installed WebUntis client', () => {
        const WebUntis = require('webuntis');
        const client = new WebUntis('school', 'user', 'password', 'example.com');
        client.axios.defaults.timeout = 15000;
        assert.equal(client.axios.defaults.timeout, 15000);
    });

    it('normalizes the primary account URL before legacy and weekly logins', async () => {
        FakeUntis.failures.add('one');
        const adapter = createAdapter({ config: {
            anonymous: false, school: 'School', username: 'one', client_secret: 'secret',
            baseUrl: 'https://hepta.webuntis.com/WebUntis/?school=School',
        } });
        await adapter.onReady();
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(adapter.config.baseUrl, 'hepta.webuntis.com');
        assert.equal(FakeUntis.sessions.length, 2);
        assert(FakeUntis.sessions.every(session => session.baseUrl === 'hepta.webuntis.com'));
    });

    it('removes legacy 0 and 1 datapoints without removing the instance or other objects', async () => {
        const adapter = createAdapter({ namespace: 'webuntis.1', config: { school: '', baseUrl: '' } });
        adapter.objects['0.0.name'] = { type: 'state', native: {} };
        adapter.objects['1.timetable-date'] = { type: 'state', native: {} };
        adapter.objects['timetable.montag.DATUM'] = { type: 'state', native: {} };
        adapter.states['0.0.name'] = 'old';
        adapter.states['1.timetable-date'] = 'old';
        await adapter.onReady();
        assert.equal(adapter.namespace, 'webuntis.1');
        assert.equal(adapter.objects['0.0.name'], undefined);
        assert.equal(adapter.states['1.timetable-date'], undefined);
        assert(adapter.objects['timetable.montag.DATUM']);
    });

    it('does not recreate legacy daily datapoints after startup', async () => {
        const adapter = createAdapter({ config: {
            anonymous: false, school: 'School', username: 'one', client_secret: 'secret', baseUrl: 'host',
        } });
        await adapter.onReady();
        await new Promise(resolve => setImmediate(resolve));
        assert(!Object.keys(adapter.objects).some(id => id.startsWith('0.') || id.startsWith('1.')));
        assert.equal(adapter.states['timetable.this_week.montag.1.FACH'], 'Mathe, Physik');
    });

    it('retries failures and preserves the last successful timetable', async () => {
        const adapter = createAdapter({ config: {
            anonymous: false, username: 'one', client_secret: 'secret1', school: 'School 1', baseUrl: 'one.webuntis.com',
        } });
        FakeUntis.failures.add('one');
        await adapter.pollWeeklyTimetables();
        assert.equal(adapter.states['accounts.primary.connection'], false);
        assert.equal(adapter.timers.length, 1);

        FakeUntis.failures.clear();
        await adapter.pollWeeklyTimetables();
        assert.equal(adapter.states['accounts.primary.connection'], true);
        assert.equal(adapter.states['info.connection'], true);
        const previous = adapter.states['accounts.primary.timetable'];
        const payload = JSON.parse(previous);
        assert.equal(payload.lessons[0].subject, 'one');
        const session = FakeUntis.sessions[1];
        assert.equal(session.range[0].getDay(), 1);
        assert.equal(session.range[1].getDay(), 5);
        assert.equal(session.axios.defaults.timeout, 15000);
        assert.equal(session.loggedOut, true);
        assert.equal(payload.startDate, `${session.range[0].getFullYear()}-${String(session.range[0].getMonth() + 1).padStart(2, '0')}-${String(session.range[0].getDate()).padStart(2, '0')}`);
        assert.equal(payload.lessons.length, 3);
        assert.deepEqual(JSON.parse(adapter.states['accounts.primary.montag']).lessons.map(lesson => lesson.startTime), [800, 1000]);
        assert.equal(JSON.parse(adapter.states['accounts.primary.freitag']).lessons.length, 1);
        assert.equal(JSON.parse(adapter.states['accounts.primary.mittwoch']).lessons.length, 0);
        assert.equal(JSON.parse(adapter.states['accounts.primary.montag']).date, payload.startDate);
        assert.equal(JSON.parse(adapter.states['accounts.primary.freitag']).date, payload.endDate);
        assert.equal(adapter.states['timetable.this_week.montag.1.START'], '08:00');
        assert.equal(adapter.states['timetable.this_week.montag.1.END'], '08:45');
        assert.equal(adapter.states['timetable.this_week.montag.1.FACH'], 'Mathe, Physik');
        assert.equal(adapter.states['timetable.this_week.montag.1.ORT'], 'A101');
        assert.equal(adapter.states['timetable.this_week.montag.1.LEHRER'], 'Lehrer Eins');
        assert.equal(adapter.states['timetable.this_week.montag.1.STATUS'], 'irregular');
        assert.equal(adapter.states['timetable.this_week.montag.1.INFO'], 'Test');
        assert.equal(adapter.states['timetable.this_week.montag.1.CANCELLED'], false);
        assert.equal(adapter.states['timetable.this_week.montag.1.TEST'], true);
        assert.equal(adapter.states['timetable.this_week.montag.1.CHANGES'], true);
        assert.equal(adapter.states['timetable.this_week.montag.2.TEST'], false);
        assert.equal(adapter.states['timetable.this_week.montag.2.CHANGES'], true);
        assert.equal(adapter.states['timetable.this_week.freitag.1.CANCELLED'], true);
        assert.equal(adapter.states['timetable.next_week.montag.1.TEST'], true);
        assert.equal(adapter.states['timetable.this_week.examsAvailable'], true);
        assert.equal(session.examRanges[0][2], 42);
        assert.equal(session.examRanges[0][3], false);
        assert.equal(adapter.states['timetable.this_week.montag.2.FACH'], '');
        assert.equal(adapter.states['timetable.this_week.montag.ANZAHL'], 2);
        assert.equal(adapter.states['timetable.this_week.dienstag.ANZAHL'], 0);
        assert.equal(adapter.states['timetable.next_week.montag.1.FACH'], 'Mathe, Physik');
        assert.equal(session.ranges.length, 2);
        assert.equal(session.ranges[1][0].getDay(), 1);
        assert.equal(session.ranges[1][1].getDay(), 5);
        assert.equal(session.ranges[1][0].getTime(), new Date(session.ranges[0][0].getFullYear(), session.ranges[0][0].getMonth(), session.ranges[0][0].getDate() + 7).getTime());

        const previousMonday = adapter.states['accounts.primary.montag'];
        FakeUntis.failures.add('one');
        await adapter.pollWeeklyTimetables();
        assert.equal(adapter.states['accounts.primary.connection'], false);
        assert.equal(adapter.states['timetable.this_week.connection'], false);
        assert.equal(adapter.states['timetable.next_week.connection'], false);
        assert.equal(adapter.states['accounts.primary.timetable'], previous);
        assert.equal(adapter.states['accounts.primary.montag'], previousMonday);
        assert.equal(adapter.states['timetable.this_week.montag.1.FACH'], 'Mathe, Physik');

        FakeUntis.failures.clear();
        FakeUntis.empty.add('one');
        await adapter.pollWeeklyTimetables();
        assert.deepEqual(JSON.parse(adapter.states['accounts.primary.montag']).lessons, []);
        assert.deepEqual(JSON.parse(adapter.states['accounts.primary.freitag']).lessons, []);
        assert.equal(adapter.states['timetable.this_week.montag.ANZAHL'], 0);
        assert.equal(adapter.states['timetable.this_week.montag.1.FACH'], undefined);
        assert.equal(adapter.objects['timetable.this_week.montag.2'], undefined);
        assert.equal(adapter.states['timetable.next_week.montag.ANZAHL'], 0);
    });

    it('supports an anonymous class', async () => {
        const adapter = createAdapter({ config: {
            anonymous: true, class: '5A', school: 'S', baseUrl: 'host',
        } });
        await adapter.pollWeeklyTimetables();
        assert.equal(adapter.states['accounts.primary.connection'], true);
        assert.deepEqual(FakeUntis.sessions[0].range.slice(2), [42, 1]);
        assert.equal(FakeUntis.sessions[0].range[1].getDay(), 5);
        assert.deepEqual(JSON.parse(adapter.states['accounts.primary.dienstag']).lessons, []);
        assert.equal(FakeUntis.sessions.length, 1);
        assert.equal(adapter.states['timetable.this_week.dienstag.ANZAHL'], 0);
        assert.equal(adapter.states['timetable.next_week.dienstag.ANZAHL'], 0);
    });

    it('marks tests unknown without exam permission and still updates both weeks', async () => {
        const adapter = createAdapter({ config: {
            anonymous: false, school: 'S', baseUrl: 'host', username: 'one', client_secret: 'secret',
        } });
        FakeUntis.examFailures.add('one');
        await adapter.pollWeeklyTimetables();
        assert.equal(adapter.states['timetable.this_week.montag.1.TEST'], null);
        assert.equal(adapter.states['timetable.next_week.montag.1.TEST'], null);
        assert.equal(adapter.states['timetable.this_week.examsAvailable'], false);
        assert.equal(adapter.states['timetable.next_week.examsAvailable'], false);
        assert.equal(adapter.states['timetable.this_week.connection'], true);
        assert.equal(adapter.states['timetable.next_week.connection'], true);
    });

    it('marks ambiguous or malformed exam data unknown', async () => {
        const adapter = createAdapter({ config: {
            anonymous: false, school: 'S', baseUrl: 'host', username: 'one', client_secret: 'secret',
        } });
        FakeUntis.examMode = 'missingSubject';
        await adapter.pollWeeklyTimetables();
        assert.equal(adapter.states['timetable.this_week.montag.1.TEST'], null);
        assert.equal(adapter.states['timetable.this_week.examsAvailable'], true);
        FakeUntis.examMode = 'invalid';
        await adapter.pollWeeklyTimetables();
        assert.equal(adapter.states['timetable.this_week.montag.1.TEST'], null);
        assert.equal(adapter.states['timetable.this_week.examsAvailable'], false);
    });

    it('keeps failed week data while updating the other week', async () => {
        const adapter = createAdapter({ config: {
            anonymous: false, school: 'S', baseUrl: 'host', username: 'one', client_secret: 'secret',
        } });
        await adapter.pollWeeklyTimetables();
        const previousNextWeek = adapter.states['timetable.next_week.montag.1.FACH'];
        FakeUntis.failedWeek = 1;
        FakeUntis.empty.add('one');
        await adapter.pollWeeklyTimetables();
        assert.equal(adapter.states['timetable.this_week.montag.ANZAHL'], 0);
        assert.equal(adapter.states['timetable.this_week.connection'], true);
        assert.equal(adapter.states['timetable.next_week.connection'], false);
        assert.equal(adapter.states['timetable.next_week.montag.1.FACH'], previousNextWeek);
        assert.equal(adapter.states['accounts.primary.connection'], false);
    });

    it('does not let news login mask a failed week', async () => {
        const adapter = createAdapter({ config: {
            anonymous: false, school: 'S', baseUrl: 'host', username: 'one', client_secret: 'secret',
        } });
        FakeUntis.failedWeek = 1;
        await adapter.onReady();
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(adapter.states['timetable.this_week.connection'], true);
        assert.equal(adapter.states['timetable.next_week.connection'], false);
        assert.equal(adapter.states['info.connection'], false);
    });

    it('moves old weekdays only after the current week succeeds', async () => {
        const adapter = createAdapter({ config: {
            anonymous: false, school: 'S', baseUrl: 'host', username: 'one', client_secret: 'secret',
        } });
        adapter.objects.timetable = { type: 'channel', native: { webuntisAccountId: 'primary' } };
        adapter.objects['timetable.montag'] = { type: 'channel', native: { webuntisAccountId: 'primary' } };
        adapter.objects['timetable.montag.1.FACH'] = { type: 'state', native: {} };
        adapter.states['timetable.montag.1.FACH'] = 'old';
        adapter.objects['timetable.dienstag'] = { type: 'channel', native: { owner: 'other' } };
        FakeUntis.failedWeek = 0;
        await adapter.pollWeeklyTimetables();
        assert.equal(adapter.states['timetable.montag.1.FACH'], 'old');
        assert.equal(adapter.states['timetable.next_week.connection'], true);
        FakeUntis.failedWeek = -1;
        await adapter.pollWeeklyTimetables();
        assert.equal(adapter.states['timetable.montag.1.FACH'], undefined);
        assert(adapter.objects['timetable.dienstag']);
        assert.equal(adapter.states['timetable.this_week.montag.1.FACH'], 'Mathe, Physik');
    });

    it('keeps separate instances independent and ignores old additional-account settings', async () => {
        const first = createAdapter({ namespace: 'webuntis.0', config: {
            anonymous: false, school: 'S', baseUrl: 'host', username: 'child.name@example.com', client_secret: 'secret',
            accounts_json: JSON.stringify([{ username: 'old', password: 'secret', school: 'S', baseUrl: 'host' }]),
        } });
        const second = createAdapter({ namespace: 'webuntis.1', config: {
            anonymous: false, school: 'Other', baseUrl: 'other', username: 'two', client_secret: 'secret2',
        } });
        await first.pollWeeklyTimetables();
        await second.pollWeeklyTimetables();
        assert.equal(FakeUntis.sessions.length, 2);
        assert.deepEqual(FakeUntis.sessions.map(session => session.username), ['child.name@example.com', 'two']);
        assert.equal(first.states['timetable.this_week.montag.1.FACH'], 'Mathe, Physik');
        assert.equal(second.states['timetable.this_week.montag.1.FACH'], 'Mathe, Physik');
        assert.equal(first.namespace, 'webuntis.0');
        assert.equal(second.namespace, 'webuntis.1');
        assert.equal(second.states['accounts.primary.connection'], true);
    });

    it('removes only old adapter-owned username timetables after a successful update', async () => {
        const adapter = createAdapter({ config: {
            anonymous: false, school: 'S', baseUrl: 'host', username: 'one', client_secret: 'secret',
        } });
        adapter.objects.one = { type: 'device', native: { webuntisAccountId: 'primary' } };
        adapter.objects['one.timetable'] = { type: 'channel', native: { webuntisAccountId: 'primary' } };
        adapter.objects['one.timetable.montag.1.FACH'] = { type: 'state', native: {} };
        adapter.states['one.timetable.montag.1.FACH'] = 'old';
        adapter.objects['one.custom'] = { type: 'state', native: {} };
        adapter.objects.other = { type: 'device', native: { owner: 'other' } };
        adapter.objects['other.timetable'] = { type: 'channel', native: { owner: 'other' } };
        await adapter.pollWeeklyTimetables();
        assert.equal(adapter.objects['one.timetable'], undefined);
        assert.equal(adapter.states['one.timetable.montag.1.FACH'], undefined);
        assert(adapter.objects.one);
        assert(adapter.objects['one.custom']);
        assert(adapter.objects['other.timetable']);
        assert.equal(adapter.states['timetable.this_week.montag.1.FACH'], 'Mathe, Physik');
    });

    it('keeps old username data on failure and removes an empty old device after success', async () => {
        const adapter = createAdapter({ config: {
            anonymous: false, school: 'S', baseUrl: 'host', username: 'one', client_secret: 'secret',
        } });
        adapter.objects.one = { type: 'device', native: { webuntisAccountId: 'primary' } };
        adapter.objects['one.timetable'] = { type: 'channel', native: { webuntisAccountId: 'primary' } };
        adapter.objects['one.timetable.montag.1.FACH'] = { type: 'state', native: {} };
        adapter.states['one.timetable.montag.1.FACH'] = 'old';
        FakeUntis.failures.add('one');
        await adapter.pollWeeklyTimetables();
        assert.equal(adapter.states['one.timetable.montag.1.FACH'], 'old');
        assert(adapter.objects.one);
        FakeUntis.failures.clear();
        await adapter.pollWeeklyTimetables();
        assert.equal(adapter.objects.one, undefined);
        assert.equal(adapter.objects['one.timetable'], undefined);
        assert.equal(adapter.states['timetable.this_week.montag.1.FACH'], 'Mathe, Physik');
    });

    it('does not overwrite unrelated existing account objects', async () => {
        const adapter = createAdapter({ config: {
            anonymous: false, school: 'S', baseUrl: 'host', username: 'one', client_secret: 'secret',
        } });
        adapter.objects.timetable = { type: 'channel', native: { owner: 'other' } };
        await adapter.pollWeeklyTimetables();
        assert.equal(adapter.objects.timetable.native.owner, 'other');
        assert.equal(adapter.states['timetable.this_week.montag.1.FACH'], undefined);
        assert.equal(adapter.objects['timetable.this_week'], undefined);
        assert.equal(adapter.states['accounts.primary.connection'], false);
    });
});