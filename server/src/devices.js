const express = require('express');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { randomBytes, randomUUID, createHash, timingSafeEqual } = require('node:crypto');
const { pipeline } = require('node:stream/promises');
const { Transform } = require('node:stream');

const problem = (status, message) => Object.assign(new Error(message), { status });
const invalid = /[<>:"\\|?*\x00-\x1f\x7f]/;
function relative(value, root = false) {
  if (typeof value !== 'string' || (!root && !value)) throw problem(400, 'Invalid path');
  if (value === '') return value;
  for (const part of value.split('/')) {
    if (!part || part === '.' || part === '..' || part.toLowerCase() === '.cloudlocal' ||
        invalid.test(part) || /[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part) || Buffer.byteLength(part) > 255) throw problem(400, 'Invalid path');
  }
  return value;
}
function shareId(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(value)) throw problem(400, 'Invalid share');
  return value;
}
function createDeviceHub({ storage, stateDir, isAdmin, now = Date.now, timeout = 30000, maxRelayBytes = 512 * 1024 * 1024 }) {
  if (!Number.isSafeInteger(maxRelayBytes) || maxRelayBytes < 1) throw new Error('Invalid relay limit');
  if (!storage || !stateDir || typeof isAdmin !== 'function') throw new Error('Invalid device hub configuration');
  const file = path.join(stateDir, 'devices.json');
  fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  let state = { version: 1, devices: [], offers: [] };
  if (fs.existsSync(file)) {
    try {
      const stat = fs.lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink()) throw Error();
      state = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (state.version !== 1 || !Array.isArray(state.devices) || !Array.isArray(state.offers) ||
          state.devices.some(d => typeof d.id !== 'string' || typeof d.name !== 'string' || !/^[a-f0-9]{64}$/.test(d.hash) ||
            !Array.isArray(d.shares) || d.shares.some(s => !shareId(s.id) || typeof s.label !== 'string' || s.label.length > 128)) ||
          state.offers.some(o => typeof o.id !== 'string' || typeof o.deviceId !== 'string' || typeof o.path !== 'string' || typeof o.status !== 'string')) throw Error();
    } catch { throw new Error('Invalid device state'); }
  }
  function save() {
    const tmp = `${file}.${randomUUID()}.tmp`;
    try { fs.writeFileSync(tmp, JSON.stringify(state), { flag: 'wx', mode: 0o600 }); fs.renameSync(tmp, file); }
    catch (e) { try { fs.unlinkSync(tmp); } catch {} throw e; }
  }
  const router = express.Router();
  const json = express.json({ limit: '16kb', type: 'application/json' });
  const jobs = new Map(), listeners = new Map(), seen = new Map(), attempts = new Map();
  const MAX_DEVICES = 128, MAX_ATTEMPTS_PEERS = 1024;
  let code = null, generations = [];
  const guarded = fn => async (req, res) => {
    try { await fn(req, res); }
    catch (e) { if (!res.headersSent) res.status(e.status || 500).json({ message: e.status ? e.message : 'Device error' }); else res.destroy(); }
  };
  function device(req) {
    const token = /^Bearer ([a-f0-9]{64})$/.exec(req.headers.authorization || '')?.[1];
    if (!token) throw problem(401, 'Device authentication required');
    const hash = createHash('sha256').update(token).digest();
    const found = state.devices.find(d => timingSafeEqual(Buffer.from(d.hash, 'hex'), hash));
    if (!found) throw problem(401, 'Device authentication required');
    return found;
  }
  function admin(req) { if (!isAdmin(req)) throw problem(401, 'Authentication required'); }
  function owned(req) { admin(req); const d = state.devices.find(x => x.id === req.params.id); if (!d) throw problem(404, 'Device not found'); return d; }
  function notify(id) { const waiters = listeners.get(id); if (waiters) for (const cb of waiters) cb(); }
  function finish(job, abort = false) { jobs.delete(job.id); clearTimeout(job.timer); if (abort) job.upload?.destroy(); }
  function cancel(job, status = 504) {
    if (!jobs.has(job.id)) return;
    finish(job, true);
    if (!job.res.headersSent) job.res.status(status).json({ message: 'Device unavailable' }); else job.res.destroy();
  }
  function queue(req, res, type) {
    const d = owned(req), share = shareId(req.query.share), value = relative(req.query.path, type === 'list');
    if (!d.shares.some(s => s.id === share)) throw problem(404, 'Share not found');
    if (jobs.size >= 128 || [...jobs.values()].filter(j => j.deviceId === d.id).length >= 8) throw problem(429, 'Device busy');
    const job = { id: randomUUID(), type, share, path: value, deviceId: d.id, res };
    job.timer = setTimeout(() => cancel(job), timeout); job.timer.unref();
    jobs.set(job.id, job); notify(d.id);
    res.once('close', () => { if (!res.writableEnded) cancel(job); });
  }
  router.post('/pair-code', json, guarded((req, res) => {
    admin(req); generations = generations.filter(t => t > now() - 60000);
    if (generations.length >= 5) throw problem(429, 'Too many codes');
    generations.push(now()); code = { value: String(randomBytes(4).readUInt32BE() % 100000000).padStart(8, '0'), expiresAt: now() + 120000 };
    res.json({ code: code.value, expiresAt: new Date(code.expiresAt).toISOString() });
  }));
  router.post('/pair', json, guarded((req, res) => {
    const peer = req.socket.remoteAddress || 'unknown', record = attempts.get(peer) || { count: 0, until: now() + 60000 };
    if (record.until <= now()) { record.count = 0; record.until = now() + 60000; }
    for (const [key, value] of attempts) if (value.until <= now()) attempts.delete(key);
    if (!attempts.has(peer) && attempts.size >= MAX_ATTEMPTS_PEERS) throw problem(429, 'Too many attempts');
    if (record.count >= 8) throw problem(429, 'Too many attempts');
    if (!code || code.expiresAt <= now() || req.body?.code !== code.value) { record.count++; attempts.set(peer, record); throw problem(401, 'Invalid code'); }
    const { name, shares } = req.body;
    if (typeof name !== 'string' || !name.trim() || name.length > 128 || !Array.isArray(shares) || shares.length > 16 ||
        shares.some(s => !s || typeof s.label !== 'string' || !s.label.trim() || s.label.length > 128 || !/^[a-zA-Z0-9_-]{1,64}$/.test(s.id)) || new Set(shares.map(s => s.id)).size !== shares.length) throw problem(400, 'Invalid device');
    if (state.devices.length >= MAX_DEVICES) throw problem(429, 'Too many devices');
    code = null; attempts.delete(peer);
    const token = randomBytes(32).toString('hex'), id = randomUUID();
    state.devices.push({ id, name, shares: shares.map(({ id, label }) => ({ id, label })), hash: createHash('sha256').update(token).digest('hex') }); save();
    res.json({ deviceId: id, token });
  }));
  router.get('/', guarded((req, res) => { admin(req); res.json({ devices: state.devices.map(({ id, name, shares }) => ({ id, name, shares, online: now() - (seen.get(id) || 0) < 60000, lastSeen: seen.get(id) ? new Date(seen.get(id)).toISOString() : null })) }); }));
  router.get('/offers', guarded((req, res) => { admin(req); res.json({ offers: state.offers.map(({ path: _path, ...o }) => o) }); }));
  router.delete('/:id', guarded((req, res) => { owned(req); state.devices = state.devices.filter(d => d.id !== req.params.id); state.offers = state.offers.filter(o => o.deviceId !== req.params.id); seen.delete(req.params.id); notify(req.params.id); save(); for (const job of jobs.values()) if (job.deviceId === req.params.id) cancel(job, 404); res.json({ revoked: true }); }));
  router.get('/:id/entries', guarded((req, res) => queue(req, res, 'list')));
  router.get('/:id/content', guarded((req, res) => queue(req, res, 'read')));
  router.post('/:id/offers', json, guarded(async (req, res) => {
    const d = owned(req), value = relative(req.body?.path);
    const absolute = await storage.resolveFile(value), info = await fsp.stat(absolute);
    withinRelayLimit(info.size);
    state.offers = state.offers.filter(o => Date.parse(o.expiresAt) > now());
    if (state.offers.length >= 256) throw problem(429, 'Too many offers');
    const offer = { id: randomUUID(), deviceId: d.id, path: value, name: path.basename(value), size: info.size, status: 'pending', expiresAt: new Date(now() + 3600000).toISOString() };
    state.offers.push(offer); save(); notify(d.id);
    const { path: _path, ...publicOffer } = offer; res.json({ offer: publicOffer });
  }));
  router.get('/agent/poll', guarded(async (req, res) => {
    const d = device(req); seen.set(d.id, now());
    const result = () => ({ jobs: [...jobs.values()].filter(j => j.deviceId === d.id && !j.claimed).map(j => { j.claimed = true; return { id: j.id, type: j.type, share: j.share, path: j.path }; }), offers: state.offers.filter(o => o.deviceId === d.id && o.status === 'pending' && Date.parse(o.expiresAt) > now()).map(({ id, name, size }) => ({ id, name, size })) });
    let data = result();
    if (!data.jobs.length && !data.offers.length) {
      await new Promise(resolve => {
        const waiters = listeners.get(d.id) || new Set(); listeners.set(d.id, waiters);
        const done = () => { clearTimeout(timer); waiters.delete(done); if (!waiters.size) listeners.delete(d.id); resolve(); };
        const timer = setTimeout(done, Math.min(timeout, 1000)); timer.unref();
        waiters.add(done); res.once('close', done);
      });
      if (res.destroyed) return;
      if (!state.devices.some(x => x.id === d.id)) throw problem(401, 'Device authentication required');
      data = result();
    }
    res.json(data);
  }));
  function claim(req, type) { const d = device(req), job = jobs.get(req.params.id); if (!job || job.deviceId !== d.id || job.type !== type || !job.claimed || job.done) throw problem(404, 'Job not found'); job.done = true; return job; }
  router.post('/agent/jobs/:id/result', json, guarded((req, res) => {
    const job = claim(req, 'list');
    const entries = req.body?.entries;
    const valid = e => {
      try { return e && typeof e.name === 'string' && relative(e.name) === e.name && !e.name.includes('/') &&
        ['file', 'directory'].includes(e.type) && Number.isSafeInteger(e.size) && e.size >= 0 &&
        typeof e.modifiedAt === 'string' && relative(e.path) === (job.path ? job.path + '/' : '') + e.name; }
      catch { return false; }
    };
    if (!Array.isArray(entries) || entries.length > 10000 || !entries.every(valid)) { finish(job); job.res.status(502).json({ message: 'Invalid device result' }); throw problem(400, 'Invalid result'); }
    finish(job); job.res.json({ entries }); res.json({ received: true });
  }));
  router.post('/agent/jobs/:id/content', guarded(async (req, res) => {
    const job = claim(req, 'read');
    job.upload = req;
    job.res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(job.path.split('/').at(-1))}`);
    job.res.setHeader('Content-Type', 'application/octet-stream');
    let bytes = 0;
    const { Transform } = require('node:stream');
    const limited = new Transform({ transform(chunk, _, cb) {
      bytes += chunk.length;
      cb(bytes > maxRelayBytes ? problem(413, 'Relay byte limit exceeded') : null, bytes > maxRelayBytes ? undefined : chunk);
    } });
    try { await pipeline(req, limited, job.res); finish(job); res.json({ received: true }); }
    catch (error) {
      if (jobs.has(job.id)) { jobs.delete(job.id); clearTimeout(job.timer); if (!job.res.destroyed) job.res.destroy(); }
      if (!res.headersSent && !res.destroyed) res.status(error.status || 502).json({ message: error.status ? error.message : 'Relay interrupted' });
    }
  }));
  function offer(req) { const d = device(req), o = state.offers.find(x => x.id === req.params.id && x.deviceId === d.id); if (!o || Date.parse(o.expiresAt) <= now()) throw problem(404, 'Offer not found'); return o; }
  function withinRelayLimit(size) { if (size > maxRelayBytes) throw problem(413, 'Relay byte limit exceeded'); }
  router.post('/agent/offers/:id/decision', json, guarded((req, res) => { const o = offer(req); if (o.status !== 'pending' || typeof req.body?.accept !== 'boolean') throw problem(409, 'Offer unavailable'); o.status = req.body.accept ? 'accepted' : 'declined'; save(); res.json(req.body.accept ? { content: `/api/devices/agent/offers/${o.id}/content` } : { status: 'declined' }); }));
  router.get('/agent/offers/:id/content', guarded(async (req, res) => {
    const o = offer(req);
    if (o.status !== 'accepted') throw problem(403, 'Offer not accepted');
    const location = await storage.resolveFile(o.path);
    const checked = await fsp.lstat(location);
    if (!checked.isFile() || checked.isSymbolicLink()) throw problem(400, 'Invalid file');
    const handle = await fsp.open(location, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    try {
      const info = await handle.stat();
      if (!info.isFile() || info.dev !== checked.dev || info.ino !== checked.ino) throw problem(400, 'Invalid file');
      if (info.size > maxRelayBytes) { o.status = 'failed'; save(); withinRelayLimit(info.size); }
      let bytes = 0;
      const limited = new Transform({ transform(chunk, _, cb) {
        bytes += chunk.length;
        cb(bytes > maxRelayBytes ? problem(413, 'Relay byte limit exceeded') : null, bytes > maxRelayBytes ? undefined : chunk);
      } });
      res.type('application/octet-stream');
      res.setHeader('Content-Disposition', 'attachment; filename="download"');
      try { await pipeline(handle.createReadStream(), limited, res); }
      catch (error) {
        if (error.status === 413) { o.status = 'failed'; save(); }
        throw error;
      }
    } finally { await handle.close().catch(() => {}); }
  }));
  router.post('/agent/offers/:id/complete', json, guarded((req, res) => { const o = offer(req); if (o.status !== 'accepted' || typeof req.body?.success !== 'boolean') throw problem(409, 'Offer unavailable'); o.status = req.body.success ? 'delivered' : 'failed'; save(); res.json({ status: o.status }); }));
  return { router, close() { for (const job of jobs.values()) cancel(job); for (const waiters of listeners.values()) for (const wake of waiters) wake(); listeners.clear(); } };
}
module.exports = { createDeviceHub, relative, shareId };
