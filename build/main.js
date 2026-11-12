"use strict";
/*
 * Created with @iobroker/create-adapter v2.0.2
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    Object.defineProperty(o, k2, { enumerable: true, get: function() { return m[k]; } });
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// The adapter-core module gives you access to the core ioBroker functions
// you need to create an adapter
const utils = __importStar(require("@iobroker/adapter-core"));
const webuntis_1 = __importDefault(require("webuntis"));
const week_1 = require("./week");
const host_1 = require("./host");
const weekDayNames = ['montag', 'dienstag', 'mittwoch', 'donnerstag', 'freitag'];
// Load your modules here, e.g.:
// import * as fs from "fs";
class Webuntis extends utils.Adapter {
    constructor(options = {}) {
        super({
            ...options,
            name: 'webuntis',
        });
        this.stopped = false;
        this.on('ready', this.onReady.bind(this));
        this.on('unload', this.onUnload.bind(this));
        this.class_id = 0;
    }
    /**
     * Is called when databases are connected and adapter received configuration.
     */
    async onReady() {
        try {
            await this.delObjectAsync('0', { recursive: true });
            await this.delObjectAsync('1', { recursive: true });
        }
        catch (_error) {
            this.log.error('Unable to remove legacy daily timetable objects');
        }
        if (this.config.baseUrl) {
            try {
                this.config.baseUrl = (0, host_1.getWebUntisHost)(this.config.baseUrl);
            }
            catch (_error) {
                this.log.error('Invalid school base URL: enter a hostname or HTTPS URL');
                this.config.baseUrl = '';
            }
        }
        void this.pollWeeklyTimetables();
        if (this.config.baseUrl == '') {
            this.log.error('No baseUrl set');
        }
        else if (this.config.school == '') {
            this.log.error('No school set');
        }
        else {
            if (this.config.anonymous) {
                if (this.config.class == '') {
                    this.log.error('No class set');
                }
                else {
                    //Anonymous login startet
                    const untis = new webuntis_1.default.WebUntisAnonymousAuth(this.config.school, this.config.baseUrl);
                    untis.login().then(async () => {
                        this.log.debug('Anonymous Login sucessfully');
                        //search class id
                        await untis.getClasses().then((classes) => {
                            for (const objClass of classes) {
                                if (objClass.name == this.config.class) {
                                    this.log.debug('Class found with id:' + objClass.id);
                                    this.class_id = objClass.id;
                                }
                            }
                        }).catch(async (error) => {
                            this.log.error(error);
                            this.log.error('Login WebUntis failed');
                        });
                        if (this.class_id > 0) {
                            // Now we can start
                            this.readDataFromWebUntis();
                        }
                        else {
                            this.log.error('Class not found');
                        }
                    }).catch(err => {
                        this.log.error(err);
                    });
                }
            }
            else {
                // Testen ob der Login funktioniert
                if (this.config.username == '') {
                    this.log.error('No username set');
                }
                else if (this.config.client_secret == '') {
                    this.log.error('No password set');
                }
                else {
                    this.log.debug('Api login started');
                    // Test to login to WebUntis
                    const untis = new webuntis_1.default(this.config.school, this.config.username, this.config.client_secret, this.config.baseUrl);
                    untis.login().then(async () => {
                        this.log.debug('WebUntis Login erfolgreich');
                        // Now we can start
                        this.readDataFromWebUntis();
                    }).catch(async (error) => {
                        this.log.error(error);
                        this.log.error('Login WebUntis failed');
                    });
                }
            }
        }
    }
    /**
     * Is called when adapter shuts down - callback has to be called under any circumstances!
     */
    onUnload(callback) {
        try {
            this.stopped = true;
            this.clearTimeout(this.weeklyTimeout);
            callback();
            this.clearTimeout(this.startHourScheduleTimeout);
        }
        catch (e) {
            callback();
        }
    }
    async pollWeeklyTimetables() {
        try {
            if (this.config.school && this.config.baseUrl &&
                (this.config.anonymous ? this.config.class : this.config.username && this.config.client_secret)) {
                await this.updateWeeklyTimetable();
            }
        }
        catch (_error) {
            this.log.error('Unable to update weekly timetables');
        }
        finally {
            if (!this.stopped) {
                this.weeklyTimeout = this.setTimeout(() => void this.pollWeeklyTimetables(), this.getMillisecondsToNextFullHour());
            }
        }
    }
    async updateWeeklyTimetable() {
        var _a, _b;
        const prefix = 'accounts.primary';
        for (const [name, type, role] of [
            ['timetable', 'string', 'json'],
            ['connection', 'boolean', 'indicator.connected'],
            ['lastUpdated', 'number', 'value.time'],
            ...weekDayNames.map(name => [name, 'string', 'json']),
        ]) {
            await this.setObjectNotExistsAsync(`${prefix}.${name}`, {
                type: 'state', common: { name, type, role, read: true, write: false }, native: {},
            });
        }
        let untis;
        let loggedIn = false;
        try {
            const baseUrl = (0, host_1.getWebUntisHost)(this.config.baseUrl);
            untis = this.config.anonymous
                ? new webuntis_1.default.WebUntisAnonymousAuth(this.config.school, baseUrl)
                : new webuntis_1.default(this.config.school, this.config.username, this.config.client_secret, baseUrl);
            untis.axios.defaults.timeout = 15000;
            const session = await untis.login();
            loggedIn = true;
            let classId = (session === null || session === void 0 ? void 0 : session.klasseId) || -1;
            if (this.config.anonymous) {
                const classes = await untis.getClasses();
                const schoolClass = classes.find(item => item.name === this.config.class);
                if (!schoolClass)
                    throw new Error('Class not found');
                classId = schoolClass.id;
            }
            const formatDate = (date) => [date.getFullYear(),
                String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
            const existing = await this.getObjectAsync('timetable');
            if (existing && existing.native.webuntisAccountId !== 'primary') {
                throw new Error('Timetable object already exists');
            }
            await this.setObjectNotExistsAsync('timetable', {
                type: 'channel', common: { name: 'Timetable' }, native: { webuntisAccountId: 'primary' },
            });
            const referenceDate = new Date();
            let allWeeksUpdated = true;
            for (const [weekOffset, weekName] of ['this_week', 'next_week'].entries()) {
                const weekPrefix = `timetable.${weekName}`;
                await this.setObjectNotExistsAsync(weekPrefix, {
                    type: 'channel', common: { name: weekName }, native: { webuntisAccountId: 'primary' },
                });
                for (const [name, type, role] of [
                    ['connection', 'boolean', 'indicator.connected'], ['lastUpdated', 'number', 'value.time'],
                    ['examsAvailable', 'boolean', 'indicator'],
                ]) {
                    await this.setObjectNotExistsAsync(`${weekPrefix}.${name}`, {
                        type: 'state', common: { name, type, role, read: true, write: false }, native: {},
                    });
                }
                try {
                    const dates = (0, week_1.getWeekDates)(referenceDate, weekOffset);
                    const lessons = this.config.anonymous
                        ? await untis.getTimetableForRange(dates[0], dates[4], classId, webuntis_1.default.TYPES.CLASS)
                        : await untis.getOwnTimetableForRange(dates[0], dates[4]);
                    let exams = null;
                    try {
                        const result = await untis.getExamsForRange(dates[0], dates[4], classId, false);
                        if (!Array.isArray(result) || result.some(exam => !exam || !Number.isInteger(exam.examDate) ||
                            !Number.isInteger(exam.startTime) || !Number.isInteger(exam.endTime) || exam.startTime < 0 ||
                            exam.endTime > 2359 || exam.startTime % 100 >= 60 || exam.endTime % 100 >= 60 || exam.startTime >= exam.endTime)) {
                            throw new Error('Invalid exam data');
                        }
                        exams = result;
                    }
                    catch (_error) {
                        this.log.info(`Exam data unavailable for ${weekName}`);
                    }
                    const days = dates.map(date => {
                        const untisDate = date.getFullYear() * 10000 + (date.getMonth() + 1) * 100 + date.getDate();
                        return {
                            date: formatDate(date),
                            lessons: lessons.filter(lesson => lesson.date === untisDate).sort((first, second) => first.startTime - second.startTime),
                        };
                    });
                    await this.writeLessonStates(weekName, days, exams);
                    if (weekOffset === 0) {
                        await this.setStateAsync(`${prefix}.timetable`, JSON.stringify({
                            startDate: formatDate(dates[0]), endDate: formatDate(dates[4]),
                            lessons: days.reduce((all, day) => all.concat(day.lessons), []),
                        }), true);
                        for (const [index, day] of days.entries()) {
                            await this.setStateAsync(`${prefix}.${weekDayNames[index]}`, JSON.stringify(day), true);
                        }
                        for (const dayName of weekDayNames) {
                            const oldPath = `timetable.${dayName}`;
                            const oldObject = await this.getObjectAsync(oldPath);
                            if (((_a = oldObject === null || oldObject === void 0 ? void 0 : oldObject.native) === null || _a === void 0 ? void 0 : _a.webuntisAccountId) === 'primary') {
                                await this.delObjectAsync(oldPath, { recursive: true });
                            }
                        }
                        await this.removeLegacyAccountTimetables();
                    }
                    await this.setStateAsync(`${weekPrefix}.lastUpdated`, Date.now(), true);
                    await this.setStateAsync(`${weekPrefix}.examsAvailable`, exams !== null, true);
                    await this.setStateAsync(`${weekPrefix}.connection`, true, true);
                }
                catch (_error) {
                    allWeeksUpdated = false;
                    this.log.error(`Unable to update timetable ${weekName}`);
                    await this.setStateAsync(`${weekPrefix}.connection`, false, true);
                }
            }
            if (allWeeksUpdated)
                await this.setStateAsync(`${prefix}.lastUpdated`, Date.now(), true);
            await this.setStateAsync(`${prefix}.connection`, allWeeksUpdated, true);
            await this.setStateAsync('info.connection', allWeeksUpdated, true);
            return allWeeksUpdated;
        }
        catch (_error) {
            this.log.error('Unable to update weekly timetable');
            for (const weekName of ['this_week', 'next_week']) {
                const week = await this.getObjectAsync(`timetable.${weekName}`);
                if (((_b = week === null || week === void 0 ? void 0 : week.native) === null || _b === void 0 ? void 0 : _b.webuntisAccountId) === 'primary') {
                    await this.setStateAsync(`timetable.${weekName}.connection`, false, true);
                }
            }
            await this.setStateAsync(`${prefix}.connection`, false, true);
            await this.setStateAsync('info.connection', false, true);
            return false;
        }
        finally {
            if (loggedIn && untis) {
                await untis.logout().catch(() => this.log.debug('Unable to close weekly timetable session'));
            }
        }
    }
    async removeLegacyAccountTimetables() {
        var _a, _b, _c;
        const namespacePrefix = `${this.namespace}.`;
        const devices = await this.getObjectViewAsync('system', 'device', {
            startkey: namespacePrefix, endkey: `${namespacePrefix}\u9999`,
        });
        for (const row of devices.rows) {
            const accountId = (_b = (_a = row.value) === null || _a === void 0 ? void 0 : _a.native) === null || _b === void 0 ? void 0 : _b.webuntisAccountId;
            const root = row.id.slice(namespacePrefix.length);
            if (typeof accountId !== 'string' || !root || root.includes('.'))
                continue;
            const oldTimetable = `${root}.timetable`;
            const channel = await this.getObjectAsync(oldTimetable);
            if (((_c = channel === null || channel === void 0 ? void 0 : channel.native) === null || _c === void 0 ? void 0 : _c.webuntisAccountId) !== accountId)
                continue;
            await this.delObjectAsync(oldTimetable, { recursive: true });
            if (root !== 'timetable') {
                const startkey = `${row.id}.`;
                const remaining = await this.getObjectListAsync({ startkey, endkey: `${startkey}\u9999` });
                if (!remaining.rows.length)
                    await this.delObjectAsync(root);
            }
        }
    }
    async writeLessonStates(weekName, days, exams) {
        var _a, _b, _c;
        for (const [dayIndex, day] of days.entries()) {
            const dayPrefix = `timetable.${weekName}.${weekDayNames[dayIndex]}`;
            await this.setObjectNotExistsAsync(dayPrefix, {
                type: 'channel', common: { name: weekDayNames[dayIndex] }, native: { webuntisAccountId: 'primary' },
            });
            for (const [index, lesson] of day.lessons.entries()) {
                const lessonPrefix = `${dayPrefix}.${index + 1}`;
                await this.setObjectNotExistsAsync(lessonPrefix, {
                    type: 'channel', common: { name: `Lesson ${index + 1}` }, native: { webuntisAccountId: 'primary' },
                });
                const formatTime = (time) => Number.isInteger(time) && time >= 0 && time <= 2359 && time % 100 < 60
                    ? `${String(Math.floor(time / 100)).padStart(2, '0')}:${String(time % 100).padStart(2, '0')}` : '';
                const values = {
                    START: formatTime(lesson.startTime), END: formatTime(lesson.endTime),
                    FACH: (lesson.su || []).map(subject => subject.name).filter(Boolean).join(', '),
                    ORT: (lesson.ro || []).map(room => room.name).filter(Boolean).join(', '),
                    LEHRER: (lesson.te || []).map(teacher => teacher.longname || teacher.name).filter(Boolean).join(', '),
                    STATUS: lesson.code || 'regular', INFO: lesson.info || '', VERTRETUNG: lesson.substText || '',
                };
                for (const [name, value] of Object.entries(values)) {
                    await this.setObjectNotExistsAsync(`${lessonPrefix}.${name}`, {
                        type: 'state', common: { name, type: 'string', role: 'text', read: true, write: false }, native: {},
                    });
                    await this.setStateAsync(`${lessonPrefix}.${name}`, value, true);
                }
                const matchingExams = exams === null || exams === void 0 ? void 0 : exams.filter(exam => exam.examDate === lesson.date &&
                    exam.startTime < lesson.endTime && exam.endTime > lesson.startTime);
                const subjects = (lesson.su || []).reduce((names, subject) => names.concat([subject.name, subject.longname]), [])
                    .filter((name) => typeof name === 'string' && !!name.trim())
                    .map(name => name.trim().toLowerCase());
                const validLessonTime = Number.isInteger(lesson.startTime) && Number.isInteger(lesson.endTime) &&
                    lesson.startTime >= 0 && lesson.endTime <= 2359 && lesson.startTime % 100 < 60 &&
                    lesson.endTime % 100 < 60 && lesson.startTime < lesson.endTime;
                const isTest = matchingExams === null || matchingExams === void 0 ? void 0 : matchingExams.some(exam => typeof exam.subject === 'string' &&
                    subjects.includes(exam.subject.trim().toLowerCase()));
                const uncertainTest = matchingExams === null || matchingExams === void 0 ? void 0 : matchingExams.some(exam => !subjects.length ||
                    typeof exam.subject !== 'string' || !exam.subject.trim());
                const flags = {
                    CANCELLED: lesson.code === 'cancelled',
                    TEST: exams === null || !validLessonTime ? null : isTest ? true : uncertainTest ? null : false,
                    CHANGES: lesson.code === 'irregular' || !!((_a = lesson.substText) === null || _a === void 0 ? void 0 : _a.trim()),
                };
                for (const [name, value] of Object.entries(flags)) {
                    await this.setObjectNotExistsAsync(`${lessonPrefix}.${name}`, {
                        type: 'state', common: { name, type: 'boolean', role: 'indicator', read: true, write: false }, native: {},
                    });
                    await this.setStateAsync(`${lessonPrefix}.${name}`, value, true);
                }
            }
            const startkey = `${this.namespace}.${dayPrefix}.`;
            const objects = await this.getObjectViewAsync('system', 'channel', { startkey, endkey: `${startkey}\u9999` });
            for (const row of objects.rows) {
                const suffix = row.id.slice(startkey.length);
                if (/^[1-9]\d*$/.test(suffix) && Number(suffix) > day.lessons.length && ((_c = (_b = row.value) === null || _b === void 0 ? void 0 : _b.native) === null || _c === void 0 ? void 0 : _c.webuntisAccountId) === 'primary') {
                    await this.delObjectAsync(`${dayPrefix}.${suffix}`, { recursive: true });
                }
            }
            for (const [name, value, type] of [['DATUM', day.date, 'string'], ['ANZAHL', day.lessons.length, 'number']]) {
                await this.setObjectNotExistsAsync(`${dayPrefix}.${name}`, {
                    type: 'state', common: { name, type, role: type === 'number' ? 'value' : 'text', read: true, write: false }, native: {},
                });
                await this.setStateAsync(`${dayPrefix}.${name}`, value, true);
            }
        }
    }
    startHourSchedule() {
        if (this.startHourScheduleTimeout) {
            this.log.debug('clearing old refresh timeout');
            this.clearTimeout(this.startHourScheduleTimeout);
        }
        this.startHourScheduleTimeout = this.setTimeout(() => {
            this.log.debug('Read new data from WebUntis');
            this.startHourScheduleTimeout = null;
            this.readDataFromWebUntis();
        }, this.getMillisecondsToNextFullHour());
    }
    readDataFromWebUntis() {
        if (!this.config.anonymous) {
            const untis = new webuntis_1.default(this.config.school, this.config.username, this.config.client_secret, this.config.baseUrl);
            untis.login().then(async () => {
                this.log.debug('WebUntis Login erfolgreich');
                this.log.debug('Load Message center');
                //get Messages from Center
                untis.getNewsWidget(new Date()).then((newsFeed) => {
                    this.log.debug('Get news feed from API');
                    this.log.debug(JSON.stringify(newsFeed));
                    this.setNewsFeed(newsFeed);
                }).catch(async (error) => {
                    this.log.info('Cannot read Message Center - possible block by scool');
                    this.log.debug(error);
                });
                untis.getInbox().then((messages) => {
                    this.log.debug('Get inbox from API');
                    this.log.debug(JSON.stringify(messages));
                    this.setInbox(messages);
                }).catch(async (error) => {
                    this.log.info('Cannot read Inbox - possible block by scool');
                    this.log.debug(error);
                });
            }).catch(async (error) => {
                this.log.error(error);
                this.log.error('Login WebUntis failed');
            });
        }
        // Next round in one Hour
        this.startHourSchedule();
    }
    //FUnktion for Inbox Data
    async setInbox(messages) {
        await this.setObjectNotExistsAsync('inbox.inbox-date', {
            type: 'state',
            common: {
                name: 'inbox-date',
                role: 'value',
                type: 'string',
                write: false,
                read: true,
            },
            native: {},
        }).catch((error) => {
            this.log.error(error);
        });
        await this.setStateAsync('inbox.inbox-date', new Date().toString(), true);
        let index = 0;
        for (const message of messages.incomingMessages) {
            await this.setObjectNotExistsAsync('inbox.' + index + '.subject', {
                type: 'state',
                common: {
                    name: 'subject',
                    role: 'value',
                    type: 'string',
                    write: false,
                    read: true,
                },
                native: {},
            }).catch((error) => {
                this.log.error(error);
            });
            await this.setStateAsync('inbox.' + index + '.subject', message.subject, true);
            await this.setObjectNotExistsAsync('inbox.' + index + '.contentPreview', {
                type: 'state',
                common: {
                    name: 'contentPreview',
                    role: 'value',
                    type: 'string',
                    write: false,
                    read: true,
                },
                native: {},
            }).catch((error) => {
                this.log.error(error);
            });
            await this.setStateAsync('inbox.' + index + '.contentPreview', message.contentPreview, true);
            //Count Element
            index = index + 1;
        }
        this.deleteOldInboxObject(index);
    }
    //Function for Newsfeed
    async setNewsFeed(newsFeed) {
        await this.setObjectNotExistsAsync('newsfeed.newsfeed-date', {
            type: 'state',
            common: {
                name: 'newsfeed-date',
                role: 'value',
                type: 'string',
                write: false,
                read: true,
            },
            native: {},
        }).catch((error) => {
            this.log.error(error);
        });
        await this.setStateAsync('newsfeed.newsfeed-date', new Date().toString(), true);
        let index = 0;
        for (const feed of newsFeed.messagesOfDay) {
            await this.setObjectNotExistsAsync('newsfeed.' + index + '.subject', {
                type: 'state',
                common: {
                    name: 'subject',
                    role: 'value',
                    type: 'string',
                    write: false,
                    read: true,
                },
                native: {},
            }).catch((error) => {
                this.log.error(error);
            });
            await this.setStateAsync('newsfeed.' + index + '.subject', feed.subject, true);
            await this.setObjectNotExistsAsync('newsfeed.' + index + '.text', {
                type: 'state',
                common: {
                    name: 'text',
                    role: 'value',
                    type: 'string',
                    write: false,
                    read: true,
                },
                native: {},
            }).catch((error) => {
                this.log.error(error);
            });
            await this.setStateAsync('newsfeed.' + index + '.text', feed.text, true);
            //Count Element
            index = index + 1;
        }
        this.deleteOldNewsFeedObject(index);
    }
    //Helpfunction
    async deleteOldInboxObject(index) {
        const delObject = await this.getObjectAsync('inbox.' + index + '.subject');
        if (delObject) {
            this.log.debug('Object zum löschen gefunden - ' + index.toString());
            await this.delObjectAsync(index.toString(), { recursive: true });
            // Have one delted, next round
            await this.deleteOldInboxObject(index + 1);
        }
    }
    async deleteOldNewsFeedObject(index) {
        const delObject = await this.getObjectAsync('newsfeed.' + index + '.text');
        if (delObject) {
            this.log.debug('Object zum löschen gefunden - ' + index.toString());
            await this.delObjectAsync(index.toString(), { recursive: true });
            // Have one delted, next round
            await this.deleteOldNewsFeedObject(index + 1);
        }
    }
    //thanks to klein0r
    getMillisecondsToNextFullHour() {
        const now = new Date();
        const nextHour = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours() + 1, 0, 5, 0); // add 5 seconds to ensure we are in the next hour
        return nextHour.getTime() - now.getTime();
    }
}
if (require.main !== module) {
    // Export the constructor in compact mode
    module.exports = (options) => new Webuntis(options);
}
else {
    // otherwise start the instance directly
    (() => new Webuntis())();
}
//# sourceMappingURL=main.js.map