const os = require('node:os');
const net = require('node:net');

function isLoopback(address) {
    if (typeof address !== 'string') return false;
    return address === '::1' || address === '127.0.0.1' || address.startsWith('127.') && net.isIP(address) === 4 ||
        address.toLowerCase().startsWith('::ffff:') && isLoopback(address.slice(7));
}

function isPrivatePeer(address) {
    if (isLoopback(address)) return true;
    if (typeof address !== 'string') return false;
    if (address.toLowerCase().startsWith('::ffff:')) return isPrivatePeer(address.slice(7));
    if (net.isIP(address) === 6) return /^f[cd][0-9a-f]{2}:/i.test(address) || /^fe[89ab][0-9a-f]:/i.test(address);
    if (net.isIP(address) !== 4) return false;
    const [a, b] = address.split('.').map(Number);
    return a === 10 || a === 172 && b >= 16 && b <= 31 || a === 192 && b === 168 || a === 169 && b === 254;
}

function hostname(host) {
    if (typeof host !== 'string' || !host || /[\s/@\\]/.test(host)) return null;
    const match = /^(\[[0-9a-f:]+\]|[a-z0-9.-]+)(?::(\d{1,5}))?$/i.exec(host);
    if (!match || match[2] && (+match[2] < 1 || +match[2] > 65535)) return null;
    return match[1].toLowerCase();
}
function validHost(host) {
    const name = hostname(host);
    return name === 'localhost' || name === 'cloudlocal.local' || name === '[::1]' ||
        name !== null && net.isIP(name) === 4 && isPrivatePeer(name);
}
function originMatches(origin, host) {
    if (typeof origin !== 'string' || !validHost(host)) return false;
    try {
        const url = new URL(origin);
        return url.protocol === 'http:' && url.host.toLowerCase() === host.toLowerCase() &&
            url.origin === origin && !url.username && !url.password;
    } catch { return false; }
}
function urlsFor(port, addresses = Object.values(os.networkInterfaces()).flat().filter(a => a && !a.internal && a.family === 'IPv4').map(a => a.address)) {
    return [`http://127.0.0.1:${port}`, ...new Set(addresses.filter(a => isPrivatePeer(a) && !isLoopback(a)).map(a => `http://${a}:${port}`))];
}
module.exports = { isLoopback, isPrivatePeer, validHost, originMatches, urlsFor };
