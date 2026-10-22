const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const { createStorage } = require('./storage');
const { createAuth } = require('./auth');
const { createDeviceHub } = require('./devices');
const { fileRouter } = require('./routers/fileRouter');
const { controllers, handle } = require('./controller/fileController');
const { isLoopback, isPrivatePeer, validHost, originMatches } = require('./network');
const { createSettingsRouter } = require('./routers/settingsRouter');

const HOURS_12 = 12 * 60 * 60;
function canonical(location) {
    const absolute = path.resolve(location);
    let current = absolute;
    const suffix = [];
    while (!fs.existsSync(current)) {
        suffix.unshift(path.basename(current));
        const parent = path.dirname(current);
        if (parent === current) break;
        current = parent;
    }
    return path.join(fs.realpathSync(current), ...suffix);
}
function overlap(a, b) {
    const x = process.platform === 'win32' ? a.toLowerCase() : a;
    const y = process.platform === 'win32' ? b.toLowerCase() : b;
    return x === y || x.startsWith(y + path.sep) || y.startsWith(x + path.sep);
}
function createApp({ dataDir = path.join(__dirname, 'upload'), stateDir = path.join(__dirname, '../../.cloudlocal-state'), clientDir = path.resolve(__dirname, '../../client/dist'), maxUploadBytes = 512 * 1024 * 1024, settings } = {}) {
    if (!Number.isSafeInteger(maxUploadBytes) || maxUploadBytes < 1) throw new Error('Invalid upload limit');
    if (overlap(canonical(dataDir), canonical(stateDir))) throw new Error('Storage and authentication state must be separate');
    fs.mkdirSync(dataDir, { recursive: true });
    const storage = createStorage(dataDir);
    const auth = createAuth(stateDir);
    const app = express();
    app.disable('x-powered-by');
    app.locals.maxUploadBytes = maxUploadBytes;
    app.locals.urls = [];
    app.use((req, res, next) => {
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('X-Frame-Options', 'DENY');
        res.setHeader('Content-Security-Policy', "default-src 'self'; object-src 'none'; frame-ancestors 'none'");
        res.setHeader('Referrer-Policy', 'no-referrer');
        next();
    });
    app.use((req, res, next) => {
        if (!isPrivatePeer(req.socket.remoteAddress) || !validHost(req.headers.host) ||
            req.headers.origin && !originMatches(req.headers.origin, req.headers.host)) {
            return res.status(403).json({ message: 'Local origin required' });
        }
        next();
    });
    function token(req) {
        const match = /(?:^|;\s*)cloudlocal_session=([0-9a-f]{64})(?:;|$)/.exec(req.headers.cookie || '');
        return match && match[1];
    }
    function cookie(res, value, clear = false) {
        res.setHeader('Set-Cookie', `cloudlocal_session=${value}; HttpOnly; SameSite=Strict; Path=/api; Max-Age=${clear ? 0 : HOURS_12}`);
    }
    const json = express.json({ limit: '16kb', type: 'application/json' });
    function jsonBody(req, res, next) {
        if (!req.is('application/json')) return res.status(415).json({ message: 'JSON required' });
        json(req, res, next);
    }
    app.get('/api/session', (req, res) => res.json({ configured: auth.configured(), authenticated: auth.valid(token(req)),
        localSetup: isLoopback(req.socket.remoteAddress) && /^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(req.headers.host) }));
    app.post('/api/setup', jsonBody, handle(async (req, res) => {
        if (!isLoopback(req.socket.remoteAddress) || !/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(req.headers.host)) {
            return res.status(403).json({ message: 'Setup requires localhost' });
        }
        await auth.setup(req.body?.password);
        const session = await auth.login(req.body.password, req.socket.remoteAddress);
        cookie(res, session);
        res.status(201).json({ configured: true });
    }));
    app.post('/api/login', jsonBody, handle(async (req, res) => {
        const session = await auth.login(req.body?.password, req.socket.remoteAddress);
        cookie(res, session);
        res.json({ authenticated: true });
    }));
    app.post('/api/logout', jsonBody, (req, res) => {
        auth.logout(token(req));
        cookie(res, '', true);
        res.status(204).end();
    });
    const deviceHub = createDeviceHub({ storage, stateDir, isAdmin: req => auth.valid(token(req)) });
    app.locals.closeDeviceHub = () => deviceHub.close();
    app.use('/api/devices', deviceHub.router);
    app.use('/api', (req, res, next) => auth.valid(token(req)) ? next() : res.status(401).json({ message: 'Authentication required' }));
    app.use('/api/settings', createSettingsRouter(settings, dataDir));
    const actions = controllers(storage);
    app.post('/api/folders', jsonBody, actions.folders);
    app.use('/api/files', fileRouter(storage, maxUploadBytes));
    app.get('/api/trash', actions.listTrash);
    app.post('/api/trash/empty', jsonBody, actions.emptyTrash);
    app.post('/api/trash/:id/restore', jsonBody, actions.restore);
    app.get('/api/status', actions.status);
    app.post('/api/shutdown', jsonBody, handle(async (req, res) => {
        if (!auth.valid(token(req))) return res.status(401).json({ message: 'Authentication required' });
        // Respond first, then shutdown
        res.json({ message: 'Server shutting down...' });
        setTimeout(() => {
            console.log('CloudLocal: shutting down...');
            app.locals.closeDeviceHub();
            server.close(() => {
                console.log('CloudLocal: stopped');
                process.exit(0);
            });
            // Force exit after 3s in case close hangs
            setTimeout(() => process.exit(0), 3000).unref();
        }, 500);
    }));
    const dist = clientDir;
    if (fs.existsSync(path.join(dist, 'index.html'))) {
        app.use(express.static(dist, { index: false }));
        app.get('*', (req, res) => req.accepts('html') ? res.sendFile(path.join(dist, 'index.html')) : res.status(404).end());
    }
    app.use((error, req, res, next) => {
        if (res.headersSent) return next(error);
        const status = error.code === 'LIMIT_FILE_SIZE' ? 413 : error.status >= 400 && error.status < 500 ? error.status : 500;
        res.status(status).json({ message: status === 500 ? 'Internal server error' : status === 413 ? 'File too large' : error.message || 'Invalid request' });
    });
    // Catch-all 404 must be last
    app.use('/api', (req, res) => res.status(404).json({ message: 'Not found' }));
    return app;
}
module.exports = { createApp };
