export function getWebUntisHost(value: string): string {
    const input = value.trim();
    const url = new URL(input.includes('://') ? input : `https://${input}`);
    if (url.protocol !== 'https:' || url.username || url.password) {
        throw new Error('Expected an HTTPS WebUntis host');
    }
    return url.host;
}