const fs = require('node:fs');
const path = require('node:path');
const { createApp } = require('./app');
const { urlsFor } = require('./network');
const { createSettings } = require('./settings');

function start(options = {}) {
    const stateDirResolved = path.resolve(options.stateDir || path.join(__dirname, '../../.cloudlocal-state'));
    let settings;
    try {
        settings = createSettings(stateDirResolved, options.dataDir || path.join(__dirname, 'upload'));
        let effectiveDataDir = settings.getCurrentUploadDir();
        try {
            const text = fs.readFileSync(path.join(stateDirResolved, 'settings.json'), 'utf8');
            const saved = JSON.parse(text);
            if (saved && saved.folderPath && !process.env.CLOUDLOCAL_DATA_DIR) {
                if (fs.existsSync(saved.folderPath)) {
                    const stat = fs.statSync(saved.folderPath);
                    if (stat.isDirectory()) effectiveDataDir = saved.folderPath;
                }
            }
            settings.setCurrentUploadDir(effectiveDataDir);
        } catch {
            // fall back to configured dataDir
        }
        options = { ...options, settings };
    } catch {
        // settings unavailable; continue without folder persistence
    }
    const app = createApp(options);
    const host = process.env.HOST || '0.0.0.0';
    const preferred = Number(process.env.CLOUDLOCAL_PORT ?? process.env.PORT ?? 5000);
    const fallback = Number(process.env.CLOUDLOCAL_FALLBACK_PORT || 5000);
    if (!Number.isInteger(preferred) || preferred < 0 || preferred > 65535 ||
        !Number.isInteger(fallback) || fallback < 1 || fallback > 65535) throw new Error('Invalid port');
    let server;
    let stopped = false;
    let shutdownCallback = null;
    function announce(port) {
        const urls = urlsFor(port);
        app.locals.urls = urls;
        console.log(`CloudLocal: ${urls.join(', ')} — HTTP on a local network is not encrypted.`);
        if (process.send) process.send({ type: 'ready', port, urls });
        options.onReady?.(port, urls);
    }
    function listen(port, canFallback) {
        server = app.listen(port, host);
        server.once('listening', () => announce(server.address().port));
        server.once('error', error => {
            if (canFallback && preferred !== fallback && (error.code === 'EACCES' || error.code === 'EADDRINUSE')) {
                listen(fallback, false);
            } else {
                const message = `CloudLocal cannot listen: ${error.code || 'unknown error'}`;
                console.error(message);
                if (process.send) process.send({ type: 'error', message });
                if (require.main === module) process.exitCode = 1;
            }
        });
    }
    listen(preferred, true);
    function shutdown(exitCode = 0) {
        if (stopped) return;
        stopped = true;
        console.log('CloudLocal: shutting down...');
        server.close(() => {
            console.log('CloudLocal: stopped');
            if (shutdownCallback) shutdownCallback();
            if (exitCode && require.main === module) process.exit(exitCode);
        });
    }
    app.locals.shutdown = () => {
        if (stopped) return;
        // HTTP shutdown exits only this process, after graceful close or a bounded drain.
        shutdownCallback = () => process.exit(0);
        setTimeout(() => process.exit(0), 3000).unref();
        shutdown();
        // Long-lived UI connections (SSE /api/events, keep-alive) never end on
        // their own, so server.close() would only finish via the drain cap.
        // Close them shortly after the shutdown response is flushed, so the
        // graceful path completes and 'CloudLocal: stopped' is printed.
        setTimeout(() => server.closeAllConnections?.(), 500).unref();
    };
    process.once('SIGTERM', shutdown);
    process.once('disconnect', shutdown);
    return { app, get server() { return server; }, shutdown };
}
if (require.main === module) {
    try {
        require('dotenv').config({ path: process.env.CLOUDLOCAL_ENV_FILE || path.join(__dirname, '../.env') });
        start({ dataDir: process.env.CLOUDLOCAL_DATA_DIR, stateDir: process.env.CLOUDLOCAL_STATE_DIR });
    }
    catch (error) {
        console.error('CloudLocal cannot start:', error.message);
        if (process.send) process.send({ type: 'error', message: error.message });
        process.exitCode = 1;
    }
}
module.exports = { start };
