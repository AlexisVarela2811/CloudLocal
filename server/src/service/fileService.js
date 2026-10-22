const path = require('node:path');
const mime = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  gif: 'image/gif', webp: 'image/webp', avif: 'image/avif',
  pdf: 'application/pdf', mp3: 'audio/mpeg', wav: 'audio/wav',
  ogg: 'audio/ogg', mp4: 'video/mp4', webm: 'video/webm'
};

function filename(original) {
    // Windows clients send backslashes even when the server runs on POSIX.
    return path.win32.basename(original);
}
function media(relative) {
    return mime[path.extname(relative).slice(1).toLowerCase()] || 'application/octet-stream';
}
function legacyName(value) {
    if (typeof value !== 'string' || !value || value.includes('/') || value.includes('\\')) {
        throw Object.assign(new Error('Invalid filename'), { status: 400 });
    }
    return value;
}
async function legacyFile(storage, name, caseInsensitive = false) {
    legacyName(name);
    const entries = (await storage.list()).filter(e => e.type === 'file');
    if (!caseInsensitive) return name;
    const exact = entries.find(e => e.name === name);
    if (exact) return exact.name;
    const matches = entries.filter(e => e.name.toLowerCase() === name.toLowerCase());
    if (matches.length > 1) throw Object.assign(new Error('Ambiguous filename'), { status: 409 });
    if (!matches.length) throw Object.assign(new Error('File not found'), { status: 404 });
    return matches[0].name;
}
module.exports = { filename, media, legacyFile };
