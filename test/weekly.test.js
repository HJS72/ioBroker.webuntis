'use strict';

const assert = require('assert').strict;
const proxyquire = require('proxyquire').noCallThru();

class FakeAdapter {
    constructor(options) {
        this.config = options.config;
        this.namespace = 'webuntis.0';
        this.states = {};
        this.objects = {};
        this.errors = [];
        this.log = { error: message => this.errors.push(message), debug: () => {} };
        this.timers = [];
    }
    on() {}
    async setObjectNotExistsAsync(id, object) { this.objects[id] = this.objects[id] || object; }
    async getObjectAsync(id) { return this.objects[id] || null; }
    async getObjectViewAsync(_design, _search, options) {
        return { rows: Object.entries(this.objects).filter(([id, object]) =>
            object.type === 'channel' && `${this.namespace}.${id}` >= options.startkey && `${this.namespace}.${id}` <= options.endkey,
        ).map(([id, value]) => ({ id: `${this.namespace}.${id}`, value })) };
    }
    async delObjectAsync(id) {
        for (const key of Object.keys(this.objects)) if (key === id || key.startsWith(`${id}.`)) delete this.objects[key];
        for (const key of Object.keys(this.states)) if (key === id || key.startsWith(`${id}.`)) delete this.states[key];
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
    async login() { if (FakeUntis.failures.has(this.username)) throw new Error('login failed'); }
    async logout() { this.loggedOut = true; }
    async getOwnTimetableForRange(start, end) {
        this.range = [start, end];
        if (FakeUntis.empty.has(this.username)) return [];
        const dateAt = offset => {
            const date = new Date(start);
            date.setDate(date.getDate() + offset);
            return date.getFullYear() * 10000 + (date.getMonth() + 1) * 100 + date.getDate();
        };
        return [
            { date: dateAt(0), startTime: 1000, endTime: 1045, subject: this.username },
            { date: dateAt(4), startTime: 900, subject: this.username },
            { date: dateAt(0), startTime: 800, endTime: 845, subject: this.username,
                su: [{ name: 'Mathe' }, { name: 'Physik' }], ro: [{ name: 'A101' }],
                te: [{ name: 'AB', longname: 'Lehrer Eins' }], code: 'irregular', info: 'Test' },
            { date: dateAt(5), startTime: 800, subject: this.username },
        ];
    }
    async getClasses() { return [{ id: 42, name: '5A' }]; }
    async getTimetableForRange(start, end, id, type) {
        this.range = [start, end, id, type];
        return [];
    }
}
FakeUntis.sessions = [];
FakeUntis.failures = new Set();
FakeUntis.empty = new Set();
FakeUntis.TYPES = { CLASS: 1 };
FakeUntis.WebUntisAnonymousAuth = class extends FakeUntis {
    constructor(school, baseUrl) { super(school, '', '', baseUrl); }
};

const createAdapter = proxyquire('../build/main', {
    '@iobroker/adapter-core': { Adapter: FakeAdapter },
    webuntis: FakeUntis,
});

describe('weekly timetable polling', () => {
    beforeEach(() => { FakeUntis.sessions = []; FakeUntis.failures.clear(); FakeUntis.empty.clear(); });

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
            baseUrl: 'https://hepta.webuntis.com/WebUntis/?school=School', accounts_json: '',
        } });
        await adapter.onReady();
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(adapter.config.baseUrl, 'hepta.webuntis.com');
        assert.equal(FakeUntis.sessions.length, 2);
        assert(FakeUntis.sessions.every(session => session.baseUrl === 'hepta.webuntis.com'));
    });

    it('isolates accounts, retries failures, and preserves last successful data', async () => {
        const accounts = [
            { id: 'kid1', username: 'one', password: 'secret1', school: 'School 1', baseUrl: 'one.webuntis.com' },
            { id: 'kid2', username: 'two', password: 'secret2', school: 'School 2', baseUrl: 'https://two.webuntis.com/WebUntis/?school=School%202' },
        ];
        const adapter = createAdapter({ config: { school: '', baseUrl: '', accounts_json: JSON.stringify(accounts) } });
        FakeUntis.failures.add('one');
        await adapter.pollWeeklyTimetables();
        assert.equal(adapter.states['accounts.kid1.connection'], false);
        assert.equal(adapter.states['accounts.kid2.connection'], true);
        assert.equal(adapter.states['info.connection'], false);
        assert.equal(JSON.parse(adapter.states['accounts.kid2.timetable']).lessons[0].subject, 'two');
        assert.equal(FakeUntis.sessions[1].school, 'School 2');
        assert.equal(FakeUntis.sessions[1].baseUrl, 'two.webuntis.com');
        assert.equal(FakeUntis.sessions[1].axios.defaults.timeout, 15000);
        assert.equal(FakeUntis.sessions[1].loggedOut, true);
        assert.equal(adapter.timers.length, 1);

        FakeUntis.failures.clear();
        await adapter.pollWeeklyTimetables();
        assert.equal(adapter.states['info.connection'], true);
        const previous = adapter.states['accounts.kid1.timetable'];
        const payload = JSON.parse(previous);
        assert.equal(payload.lessons[0].subject, 'one');
        const session = FakeUntis.sessions[2];
        assert.equal(session.range[0].getDay(), 1);
        assert.equal(session.range[1].getDay(), 5);
        assert.equal(session.loggedOut, true);
        assert.equal(payload.startDate, `${session.range[0].getFullYear()}-${String(session.range[0].getMonth() + 1).padStart(2, '0')}-${String(session.range[0].getDate()).padStart(2, '0')}`);
        assert.equal(payload.lessons.length, 3);
        assert.deepEqual(JSON.parse(adapter.states['accounts.kid1.montag']).lessons.map(lesson => lesson.startTime), [800, 1000]);
        assert.equal(JSON.parse(adapter.states['accounts.kid1.freitag']).lessons.length, 1);
        assert.equal(JSON.parse(adapter.states['accounts.kid1.mittwoch']).lessons.length, 0);
        assert.equal(JSON.parse(adapter.states['accounts.kid1.montag']).date, payload.startDate);
        assert.equal(JSON.parse(adapter.states['accounts.kid1.freitag']).date, payload.endDate);
        assert.equal(adapter.states['one.timetable.montag.1.START'], '08:00');
        assert.equal(adapter.states['one.timetable.montag.1.END'], '08:45');
        assert.equal(adapter.states['one.timetable.montag.1.FACH'], 'Mathe, Physik');
        assert.equal(adapter.states['one.timetable.montag.1.ORT'], 'A101');
        assert.equal(adapter.states['one.timetable.montag.1.LEHRER'], 'Lehrer Eins');
        assert.equal(adapter.states['one.timetable.montag.1.STATUS'], 'irregular');
        assert.equal(adapter.states['one.timetable.montag.1.INFO'], 'Test');
        assert.equal(adapter.states['one.timetable.montag.2.FACH'], '');
        assert.equal(adapter.states['one.timetable.montag.ANZAHL'], 2);
        assert.equal(adapter.states['one.timetable.dienstag.ANZAHL'], 0);

        const previousMonday = adapter.states['accounts.kid1.montag'];
        FakeUntis.failures.add('one');
        await adapter.pollWeeklyTimetables();
        assert.equal(adapter.states['accounts.kid1.connection'], false);
        assert.equal(adapter.states['accounts.kid1.timetable'], previous);
        assert.equal(adapter.states['accounts.kid1.montag'], previousMonday);
        assert.equal(adapter.states['one.timetable.montag.1.FACH'], 'Mathe, Physik');
        assert.equal(adapter.states['accounts.kid2.connection'], true);

        FakeUntis.failures.clear();
        FakeUntis.empty.add('one');
        await adapter.pollWeeklyTimetables();
        assert.deepEqual(JSON.parse(adapter.states['accounts.kid1.montag']).lessons, []);
        assert.deepEqual(JSON.parse(adapter.states['accounts.kid1.freitag']).lessons, []);
        assert.equal(adapter.states['one.timetable.montag.ANZAHL'], 0);
        assert.equal(adapter.states['one.timetable.montag.1.FACH'], undefined);
        assert.equal(adapter.objects['one.timetable.montag.2'], undefined);
    });

    it('supports anonymous primary classes and ignores invalid or duplicate IDs', async () => {
        const valid = { id: 'child', school: 'S', baseUrl: 'host', username: 'one', password: 'secret' };
        const adapter = createAdapter({ config: {
            anonymous: true, class: '5A', school: 'S', baseUrl: 'host',
            accounts_json: JSON.stringify([valid, valid, { ...valid, id: 'bad.id' }, { ...valid, id: 'primary' }]),
        } });
        await adapter.pollWeeklyTimetables();
        assert.equal(adapter.states['accounts.primary.connection'], true);
        assert.deepEqual(FakeUntis.sessions[0].range.slice(2), [42, 1]);
        assert.equal(FakeUntis.sessions[0].range[1].getDay(), 5);
        assert.deepEqual(JSON.parse(adapter.states['accounts.primary.dienstag']).lessons, []);
        assert.equal(FakeUntis.sessions.length, 2);
        assert.equal(adapter.errors.length, 3);
    });

    it('encodes usernames and does not mix accounts with the same username', async () => {
        const user = { id: 'kid1', school: 'S', baseUrl: 'host', username: 'child.name@example.com', password: 'secret' };
        const adapter = createAdapter({ config: { school: '', baseUrl: '', accounts_json: JSON.stringify([user]) } });
        await adapter.pollWeeklyTimetables();
        assert.equal(adapter.states['child%2Ename%40example%2Ecom.timetable.montag.1.FACH'], 'Mathe, Physik');

        const duplicate = createAdapter({ config: { school: '', baseUrl: '', accounts_json: JSON.stringify([user, { ...user, id: 'kid2' }]) } });
        await duplicate.pollWeeklyTimetables();
        assert.equal(duplicate.states['child%2Ename%40example%2Ecom.timetable.montag.1.FACH'], undefined);
        assert.equal(duplicate.states['child%2Ename%40example%2Ecom%2Dkid1.timetable.montag.1.FACH'], 'Mathe, Physik');
        assert.equal(duplicate.states['child%2Ename%40example%2Ecom%2Dkid2.timetable.montag.1.FACH'], 'Mathe, Physik');
        assert.equal(duplicate.states['accounts.kid1.connection'], true);
        assert.equal(duplicate.states['accounts.kid2.connection'], true);
        assert.equal(duplicate.errors.length, 0);
    });

    it('does not overwrite unrelated existing account objects', async () => {
        const accounts = [
            { id: 'kid1', school: 'S', baseUrl: 'host', username: 'one', password: 'secret' },
            { id: 'kid2', school: 'S', baseUrl: 'host', username: 'two', password: 'secret' },
        ];
        const adapter = createAdapter({ config: { school: '', baseUrl: '', accounts_json: JSON.stringify(accounts) } });
        adapter.objects.one = { type: 'device', native: { owner: 'other' } };
        await adapter.pollWeeklyTimetables();
        assert.equal(adapter.objects.one.native.owner, 'other');
        assert.equal(adapter.states['one.timetable.montag.1.FACH'], undefined);
        assert.equal(adapter.states['accounts.kid1.connection'], false);
        assert.equal(adapter.states['two.timetable.montag.1.FACH'], 'Mathe, Physik');
    });
});