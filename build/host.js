"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getWebUntisHost = void 0;
function getWebUntisHost(value) {
    const input = value.trim();
    const url = new URL(input.includes('://') ? input : `https://${input}`);
    if (url.protocol !== 'https:' || url.username || url.password) {
        throw new Error('Expected an HTTPS WebUntis host');
    }
    return url.host;
}
exports.getWebUntisHost = getWebUntisHost;
//# sourceMappingURL=host.js.map