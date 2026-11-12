'use strict';

const assert = require('assert').strict;
const proxyquire = require('proxyquire').noCallThru();

class FakeAdapter {
    constructor(options) {
        this.config = options.config;
        this.states = {};
        this.errors = [];
        this.log = { error: message => this.errors.push(message), debug: () => {} };
        this.timers = [];
    }
    on() {}
    async setObjectNotExistsAsync() {}
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
        return [{ date: 20261112, startTime: 800, subject: this.username }];
    }
    async getClasses() { return [{ id: 42, name: '5A' }]; }
    async getTimetableForRange(start, end, id, type) {
        this.range = [start, end, id, type];
        return [];
    }
}
FakeUntis.sessions = [];
FakeUntis.failures = new Set();
FakeUntis.TYPES = { CLASS: 1 };
FakeUntis.WebUntisAnonymousAuth = class extends FakeUntis {
    constructor(school, baseUrl) { super(school, '', '', baseUrl); }
};

const createAdapter = proxyquire('../build/main', {
    '@iobroker/adapter-core': { Adapter: FakeAdapter },
    webuntis: FakeUntis,
});

describe('weekly timetable polling', () => {
    beforeEach(() => { FakeUntis.sessions = []; FakeUntis.failures.clear(); });

    it('can set a timeout on the installed WebUntis client', () => {
        const WebUntis = require('webuntis');
        const client = new WebUntis('school', 'user', 'password', 'example.com');
        client.axios.defaults.timeout = 15000;
        assert.equal(client.axios.defaults.timeout, 15000);
    });

    it('isolates accounts, retries failures, and preserves last successful data', async () => {
        const accounts = [
            { id: 'kid1', username: 'one', password: 'secret1', school: 'School 1', baseUrl: 'one.webuntis.com' },
            { id: 'kid2', username: 'two', password: 'secret2', school: 'School 2', baseUrl: 'two.webuntis.com' },
        ];
        const adapter = createAdapter({ config: { school: '', baseUrl: '', accounts_json: JSON.stringify(accounts) } });
        FakeUntis.failures.add('one');
        await adapter.pollWeeklyTimetables();
        assert.equal(adapter.states['accounts.kid1.connection'], false);
        assert.equal(adapter.states['accounts.kid2.connection'], true);
        assert.equal(adapter.states['info.connection'], false);
        assert.equal(JSON.parse(adapter.states['accounts.kid2.timetable']).lessons[0].subject, 'two');
        assert.equal(FakeUntis.sessions[1].school, 'School 2');
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
        assert.equal(session.range[1].getDay(), 0);
        assert.equal(session.loggedOut, true);
        assert.equal(payload.startDate, `${session.range[0].getFullYear()}-${String(session.range[0].getMonth() + 1).padStart(2, '0')}-${String(session.range[0].getDate()).padStart(2, '0')}`);

        FakeUntis.failures.add('one');
        await adapter.pollWeeklyTimetables();
        assert.equal(adapter.states['accounts.kid1.connection'], false);
        assert.equal(adapter.states['accounts.kid1.timetable'], previous);
        assert.equal(adapter.states['accounts.kid2.connection'], true);
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
        assert.equal(FakeUntis.sessions.length, 2);
        assert.equal(adapter.errors.length, 3);
    });
});