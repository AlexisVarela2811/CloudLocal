const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { createApp } = require('../src/app');

async function fixture(t) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cloudlocal-api-'));
    const app = createApp({ dataDir: path.join(root, 'files'), stateDir: path.join(root, 'state'), maxUploadBytes: 16 });
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    t.after(async () => {
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
        await fs.rm(root, { recursive: true, force: true });
    });
    let cookie = '';
    async function request(route, options = {}) {
        const response = await fetch(base + route, {
            ...options,
            headers: { ...(cookie ? { Cookie: cookie } : {}), ...options.headers },
        });
        const nextCookie = response.headers.get('set-cookie');
        if (nextCookie) cookie = nextCookie.split(';')[0];
        return response;
    }
    const json = (method, body) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { request, json, root, base, server };
}

test('setup is local-only, access requires a session and foreign origins cannot mutate', async t => {
    const { request, json, base } = await fixture(t);
    assert.equal((await request('/api/files/list')).status, 401);
    assert.equal((await request('/api/session')).status, 200);
    const remoteHostSetup = await new Promise((resolve, reject) => {
        const req = http.request(base + '/api/setup', { method: 'POST', headers: { Host: 'cloudlocal.local', 'Content-Type': 'application/json' } }, res => {
            res.resume(); res.once('end', () => resolve(res.statusCode));
        });
        req.once('error', reject);
        req.end(JSON.stringify({ password: 'correct horse battery' }));
    });
    assert.equal(remoteHostSetup, 403);
    assert.equal((await request('/api/setup', { ...json('POST', { password: 'correct horse battery' }), headers: { 'Content-Type': 'application/json', Origin: 'http://evil.example' } })).status, 403);
    assert.equal((await request('/api/setup', json('POST', { password: 'short' }))).status, 400);
    const setup = await request('/api/setup', json('POST', { password: 'correct horse battery' }));
    assert.equal(setup.status, 201);
    assert.match(setup.headers.get('set-cookie'), /HttpOnly/);
    assert.match(setup.headers.get('set-cookie'), /SameSite=Strict/);
    assert.equal((await request('/api/setup', json('POST', { password: 'another password' }))).status, 409);
    assert.equal((await request('/api/files/list')).status, 200);
    assert.equal((await request('/api/logout', json('POST', {}))).status, 204);
    assert.equal((await request('/api/files/list')).status, 401);
    assert.equal((await request('/api/login', json('POST', { password: 'wrong password' }))).status, 401);
    assert.equal((await request('/api/login', json('POST', { password: 'correct horse battery' }))).status, 200);
    const foreignHost = await new Promise((resolve, reject) => {
        http.get(base + '/api/files/list', { headers: { Host: 'evil.example' } }, res => {
            res.resume(); res.once('end', () => resolve(res.statusCode));
        }).once('error', reject);
    });
    assert.equal(foreignHost, 403);
    assert.equal((await request('/api/files/list', { headers: { Origin: 'http://evil.example' } })).status, 403);
    assert.equal((await request('/api/files/list', { headers: { Origin: base } })).status, 200);
    assert.equal((await request('/api/folders', { method: 'POST', body: JSON.stringify({ folder: '', name: 'wrong-type' }) })).status, 415);
    assert.equal((await request('/api/files?folder=')).status, 200);
});

test('upload, folders, preview, legacy download, trash and restore preserve bytes without overwriting', async t => {
    const { request, json } = await fixture(t);
    await request('/api/setup', json('POST', { password: 'correct horse battery' }));
    async function upload(name, text, folder = '') {
        const form = new FormData();
        form.append('file', new Blob([text]), name);
        return request(`/api/files/upload?folder=${encodeURIComponent(folder)}`, { method: 'POST', body: form });
    }
    assert.equal((await upload('note.txt', 'hello')).status, 201);
    assert.equal((await upload('note.txt', 'changed')).status, 409);
    assert.deepEqual((await (await request('/api/files/list')).json()).files, ['note.txt']);
    const download = await request('/api/files/download/note.txt');
    assert.equal(download.status, 200);
    assert.equal(await download.text(), 'hello');
    assert.match(download.headers.get('content-disposition'), /attachment/);
    assert.equal((await request('/api/folders', json('POST', { folder: '', name: 'Work' }))).status, 201);
    assert.equal((await upload('photo.png', 'image bytes', 'Work')).status, 201);
    const listing = await (await request('/api/files?folder=Work')).json();
    assert.equal(listing.entries[0].path, 'Work/photo.png');
    const preview = await request('/api/files/content?path=Work%2Fphoto.png&inline=1');
    assert.equal(preview.status, 200);
    assert.match(preview.headers.get('content-type'), /image\/png/);
    assert.equal(await preview.text(), 'image bytes');
    assert.equal((await request('/api/files?folder=..%2F')).status, 400);
    assert.equal((await request('/api/files/content?path=.cloudlocal%2Ftmp')).status, 400);
    assert.equal((await request('/api/files/delete/note.txt', { method: 'DELETE' })).status, 200);
    assert.equal((await request('/api/files/download/note.txt')).status, 404);
    const { entries } = await (await request('/api/trash')).json();
    assert.equal(entries.length, 1);
    assert.equal((await request(`/api/trash/${entries[0].id}/restore`, json('POST', {}))).status, 200);
    assert.equal(await (await request('/api/files/download/note.txt')).text(), 'hello');
    assert.equal((await upload('huge.txt', 'x'.repeat(17))).status, 413);
    assert.equal((await request('/api/files/content?path=huge.txt')).status, 404);
    assert.equal((await request('/api/files?folder=Work&q=photo')).status, 200);
    assert.deepEqual((await (await request('/api/files?folder=Work&q=absent')).json()).entries, []);
    const html = await upload('index.html', '<p>x</p>');
    assert.equal(html.status, 201);
    const unsafe = await request('/api/files/content?path=index.html&inline=1');
    assert.match(unsafe.headers.get('content-disposition'), /^attachment/);
    assert.equal((await request('/api/files/delete/..%5Cauth.json', { method: 'DELETE' })).status, 400);
    assert.equal((await request('/api/files/download/note.txt')).status, 200);
    const status = await request('/api/status');
    assert.equal(status.status, 200);
    assert.equal((await status.json()).maxUploadBytes, 16);
});

test('rejected operations leave files unchanged, temporary uploads clear, and ranges preserve bytes', async t => {
    const { request, json, root } = await fixture(t);
    await request('/api/setup', json('POST', { password: 'correct horse battery' }));
    const form = (name, bytes) => {
        const body = new FormData();
        body.append('file', new Blob([bytes]), name);
        return { method: 'POST', body };
    };
    assert.equal((await request('/api/files/upload', form('clip.mp4', '0123456789'))).status, 201);
    assert.equal((await request('/api/files/upload?folder=..', form('bad.txt', 'x'))).status, 400);
    assert.equal((await request('/api/files/upload', form('clip.mp4', 'different'))).status, 409);
    assert.equal((await request('/api/files/upload', form('large.txt', '12345678901234567'))).status, 413);
    assert.equal((await request('/api/files?path=..%2Fclip.mp4', { method: 'DELETE' })).status, 400);
    assert.equal((await request('/api/folders', json('POST', { folder: '', name: '..' }))).status, 400);
    const ranged = await request('/api/files/content?path=clip.mp4&inline=1', { headers: { Range: 'bytes=2-5' } });
    assert.equal(ranged.status, 206);
    assert.equal(ranged.headers.get('content-range'), 'bytes 2-5/10');
    assert.equal(await ranged.text(), '2345');
    assert.match(ranged.headers.get('content-security-policy'), /sandbox/);
    assert.equal(await fs.readFile(path.join(root, 'files', 'clip.mp4'), 'utf8'), '0123456789');
    assert.deepEqual(await fs.readdir(path.join(root, 'files', '.cloudlocal', 'tmp')), []);
    assert.deepEqual((await (await request('/api/trash')).json()).entries, []);
});

test('existing files and password survive app restart without exposing state in storage', async t => {
    const { request, json, root } = await fixture(t);
    await request('/api/setup', json('POST', { password: 'correct horse battery' }));
    await fs.writeFile(path.join(root, 'files', 'existing.txt'), 'original');
    const second = createApp({ dataDir: path.join(root, 'files'), stateDir: path.join(root, 'state') });
    const server = second.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    t.after(() => { server.closeAllConnections(); server.close(); });
    const base = `http://127.0.0.1:${server.address().port}`;
    const login = await fetch(base + '/api/login', json('POST', { password: 'correct horse battery' }));
    assert.equal(login.status, 200);
    const list = await fetch(base + '/api/files/list', { headers: { Cookie: login.headers.get('set-cookie').split(';')[0] } });
    assert.deepEqual((await list.json()).files, ['existing.txt']);
    const state = await fs.readFile(path.join(root, 'state', 'auth.json'), 'utf8');
    assert.equal(state.includes('correct horse battery'), false);
});
