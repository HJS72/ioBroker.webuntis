import { strict as assert } from 'assert';
import { getWebUntisHost } from './host';

describe('getWebUntisHost', () => {
    it('accepts a hostname or a full WebUntis login URL', () => {
        assert.equal(getWebUntisHost(' hepta.webuntis.com '), 'hepta.webuntis.com');
        assert.equal(getWebUntisHost('https://hepta.webuntis.com/WebUntis/?school=example#/basic/login'), 'hepta.webuntis.com');
    });

    it('rejects insecure URLs and embedded credentials', () => {
        assert.throws(() => getWebUntisHost('http://hepta.webuntis.com'));
        assert.throws(() => getWebUntisHost('https://user:password@hepta.webuntis.com'));
        assert.throws(() => getWebUntisHost(''));
    });
});