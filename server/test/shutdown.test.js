const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { createApp } = require('../src/app');

const cache = path.resolve(__dirname, '../../.cache');
const json = (body = {}) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
function deadline(promise, ms, label) {
    let timer;
    return Promise.race([promise, new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(label)), ms);
    })]).finally(() => clearTimeout(timer));
}

async function launch(t, root, args = [path.resolve(__dirname, '../src/server.js')]) {
    const child = spawn(process.execPath, args, {
        env: { ...process.env, HOST: '127.0.0.1', PORT: '0', CLOUDLOCAL_PORT: '0',
            CLOUDLOCAL_ENV_FILE: path.join(root, 'absent.env'),
            CLOUDLOCAL_DATA_DIR: path.join(root, 'files'), CLOUDLOCAL_STATE_DIR: path.join(root, 'state') },
        stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true
    });
    let stdout = '', stderr = '';
    let ready;
    const started = new Promise(resolve => { ready = resolve; });
    child.stdout.on('data', bytes => {
        stdout += bytes;
        const match = /http:\/\/127\.0\.0\.1:(\d+)/.exec(stdout);
        if (match) ready(`http://127.0.0.1:${match[1]}`);
    });
    child.stderr.on('data', bytes => { stderr += bytes; });
    const exit = new Promise((resolve, reject) => {
        child.once('error', reject);
        child.once('close', (code, signal) => resolve({ code, signal }));
    });
    t.after(async () => {
        if (child.exitCode === null && child.signalCode === null) child.kill();
        await deadline(exit, 5000, 'Isolated child cleanup timed out');
    });
    const base = await deadline(Promise.race([started, exit.then(result => {
        throw new Error(`Exited before ready: ${JSON.stringify(result)}; ${stderr}`);
    })]), 10000, 'Isolated server startup timed out');
    return { base, exit, output: () => ({ stdout, stderr }) };
}

test('authenticated HTTP shutdown exits only its server, releases the port and preserves files across restart', async t => {
    await fs.mkdir(cache, { recursive: true });
    const root = await fs.mkdtemp(path.join(cache, 'shutdown-test-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const first = await launch(t, root);
    const request = (route, options = {}) => fetch(first.base + route, { signal: AbortSignal.timeout(3000), ...options });
    let response = await request('/api/setup', json({ password: 'shutdown test password' }));
    assert.equal(response.status, 201);
    const cookie = response.headers.get('set-cookie').split(';')[0];
    const authorized = options => ({ ...options, headers: { ...options?.headers, Cookie: cookie } });
    const body = new FormData();
    body.append('file', new Blob(['preserved bytes']), 'keep.txt');
    assert.equal((await request('/api/files/upload', authorized({ method: 'POST', body }))).status, 201);
    const before = await (await request('/api/files?folder=', authorized({}))).json();
    const trashBefore = await (await request('/api/trash', authorized({}))).json();

    for (const [label, options, status, message] of [
        ['no session', json(), 401, 'Authentication required'],
        ['wrong content type', authorized({ method: 'POST', body: '{}' }), 415, 'JSON required'],
        ['foreign origin', authorized({ ...json(), headers: { ...json().headers, Origin: 'http://evil.example' } }), 403, 'Local origin required']
    ]) {
        await t.test(`reject ${label} without stopping or changing data`, async () => {
            const rejected = await request('/api/shutdown', options);
            assert.equal(rejected.status, status);
            assert.deepEqual(await rejected.json(), { message });
            assert.equal((await request('/api/session')).status, 200);
            assert.deepEqual(await (await request('/api/files?folder=', authorized({}))).json(), before);
            assert.deepEqual(await (await request('/api/trash', authorized({}))).json(), trashBefore);
            assert.equal(await (await request('/api/files/content?path=keep.txt', authorized({}))).text(), 'preserved bytes');
        });
    }
    response = await request('/api/shutdown', authorized(json()));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { message: 'Server shutting down...' });
    const result = await deadline(first.exit, 6000, 'HTTP shutdown did not exit');
    assert.deepEqual(result, { code: 0, signal: null }, JSON.stringify(first.output()));
    assert.equal(first.output().stderr, '');
    assert.deepEqual(first.output().stdout.trim().split(/\r?\n/).slice(-2), ['CloudLocal: shutting down...', 'CloudLocal: stopped']);
    await assert.rejects(fetch(first.base + '/api/session', { signal: AbortSignal.timeout(1000) }));

    const second = await launch(t, root);
    response = await fetch(second.base + '/api/login', json({ password: 'shutdown test password' }));
    assert.equal(response.status, 200);
    const nextCookie = response.headers.get('set-cookie').split(';')[0];
    assert.equal(await (await fetch(second.base + '/api/files/content?path=keep.txt', { headers: { Cookie: nextCookie } })).text(), 'preserved bytes');
    response = await fetch(second.base + '/api/shutdown', { ...json(), headers: { ...json().headers, Cookie: nextCookie } });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { message: 'Server shutting down...' });
    assert.deepEqual(await deadline(second.exit, 6000, 'Restarted server did not exit'), { code: 0, signal: null });
    assert.equal(second.output().stderr, '');
});

test('programmatic shutdown remains idempotent and does not exit its caller', async t => {
    await fs.mkdir(cache, { recursive: true });
    const root = await fs.mkdtemp(path.join(cache, 'shutdown-programmatic-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const entry = path.resolve(__dirname, '../src/server.js');
    const source = `
        const { start } = require(${JSON.stringify(entry)});
        const instance = start({ dataDir: process.env.CLOUDLOCAL_DATA_DIR, stateDir: process.env.CLOUDLOCAL_STATE_DIR,
            onReady() {
                instance.shutdown();
                instance.shutdown();
                setImmediate(() => console.log('Programmatic caller still running'));
            }
        });
    `;
    const child = await launch(t, root, ['-e', source]);
    assert.deepEqual(await deadline(child.exit, 5000, 'Programmatic shutdown did not drain'), { code: 0, signal: null });
    assert.equal(child.output().stderr, '');
    assert.deepEqual(child.output().stdout.trim().split(/\r?\n/).slice(1), [
        'CloudLocal: shutting down...', 'CloudLocal: stopped', 'Programmatic caller still running'
    ]);
});

test('standalone app refuses shutdown when no server lifecycle is attached', async t => {
    await fs.mkdir(cache, { recursive: true });
    const root = await fs.mkdtemp(path.join(cache, 'shutdown-unbound-'));
    const app = createApp({ dataDir: path.join(root, 'files'), stateDir: path.join(root, 'state') });
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    t.after(async () => {
        app.locals.closeDeviceHub();
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
        await fs.rm(root, { recursive: true, force: true });
    });
    const base = `http://127.0.0.1:${server.address().port}`;
    const setup = await fetch(base + '/api/setup', json({ password: 'shutdown test password' }));
    const cookie = setup.headers.get('set-cookie').split(';')[0];
    const response = await fetch(base + '/api/shutdown', { ...json(), headers: { ...json().headers, Cookie: cookie } });
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { message: 'Shutdown unavailable' });
    assert.equal((await fetch(base + '/api/session')).status, 200);
});
