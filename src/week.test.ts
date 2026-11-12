import { strict as assert } from 'assert';
import { getWeekDates } from './week';

describe('getWeekDates', () => {
    it('returns Monday through Sunday across a year boundary', () => {
        const dates = getWeekDates(new Date(2023, 0, 1, 15));
        assert.deepEqual(dates.map(date => [date.getFullYear(), date.getMonth(), date.getDate()]), [
            [2022, 11, 26], [2022, 11, 27], [2022, 11, 28], [2022, 11, 29],
            [2022, 11, 30], [2022, 11, 31], [2023, 0, 1],
        ]);
        assert(dates.every(date => date.getHours() === 0));
    });

    it('returns a new week on Monday', () => {
        const dates = getWeekDates(new Date(2023, 0, 2));
        assert.equal(dates[0].getDate(), 2);
        assert.equal(dates[6].getDate(), 8);
    });

    it('keeps local midnight across the spring clock change', () => {
        const dates = getWeekDates(new Date(2024, 2, 31, 12));
        assert.deepEqual(dates.map(date => date.getDate()), [25, 26, 27, 28, 29, 30, 31]);
        assert(dates.every(date => date.getHours() === 0));
    });
});