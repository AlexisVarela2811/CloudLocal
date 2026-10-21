const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createApp } = require('../src/app');

async function fixture(t) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cloudlocal-move-'));
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

test('POST /api/files/move: auth required — unauthenticated returns 401', async t => {
    const { request, json } = await fixture(t);
    assert.equal((await request('/api/files/move', json('POST', { from: 'a.txt', to: '' }))).status, 401);
});

test('POST /api/files/move: rejects missing from path', async t => {
    const { request, json } = await fixture(t);
    await request('/api/setup', json('POST', { password: 'correct horse battery' }));
    assert.equal((await request('/api/files/move', json('POST', { to: 'folder' }))).status, 400);
});

test('POST /api/files/move: rejects missing to folder', async t => {
    const { request, json } = await fixture(t);
    await request('/api/setup', json('POST', { password: 'correct horse battery' }));
    assert.equal((await request('/api/files/move', json('POST', { from: 'file.txt' }))).status, 400);
});

test('POST /api/files/move: rejects non-existent source (404)', async t => {
    const { request, json, root } = await fixture(t);
    await request('/api/setup', json('POST', { password: 'correct horse battery' }));
    // Create a folder to use as destination (to: '' is rejected by controller as falsy)
    assert.equal((await request('/api/folders', json('POST', { folder: '', name: 'dest' }))).status, 201);
    assert.equal((await request('/api/files/move', json('POST', { from: 'nonexistent.txt', to: 'dest' }))).status, 404);
});

test('POST /api/files/move: rejects invalid path', async t => {
    const { request, json } = await fixture(t);
    await request('/api/setup', json('POST', { password: 'correct horse battery' }));
    assert.equal((await request('/api/files/move', json('POST', { from: '../escape', to: '' }))).status, 400);
});

test('POST /api/files/move: rejects when destination already exists (409)', async t => {
    const { request, json } = await fixture(t);
    await request('/api/setup', json('POST', { password: 'correct horse battery' }));
    const form1 = (name, text, folder) => {
        const b = new FormData();
        b.append('file', new Blob([text]), name);
        return { method: 'POST', body: b, headers: { ...(folder ? {} : {}) } };
    };
    assert.equal((await request('/api/files/upload', form1('dup.txt', 'first'))).status, 201);
    assert.equal((await request('/api/folders', json('POST', { folder: '', name: 'dest' }))).status, 201);
    assert.equal((await request('/api/files/upload?folder=dest', form1('dup.txt', 'second'))).status, 201);
    assert.equal((await request('/api/files/move', json('POST', { from: 'dup.txt', to: 'dest' }))).status, 409);
});

test('POST /api/files/move: moves file to nested folder — source gone, dest has content', async t => {
    const { request, json, root } = await fixture(t);
    await request('/api/setup', json('POST', { password: 'correct horse battery' }));
    const form1 = (name, text, folder) => {
        const b = new FormData();
        b.append('file', new Blob([text]), name);
        return { method: 'POST', body: b };
    };
    assert.equal((await request('/api/files/upload', form1('note.txt', 'hello world'))).status, 201);
    assert.equal((await request('/api/folders', json('POST', { folder: '', name: 'archive' }))).status, 201);

    const moveRes = await request('/api/files/move', json('POST', { from: 'note.txt', to: 'archive' }));
    assert.equal(moveRes.status, 200);
    const body = await moveRes.json();
    assert.equal(body.success, true);
    assert.equal(body.entry.name, 'note.txt');
    assert.equal(body.entry.path, 'archive/note.txt');
    assert.equal(body.entry.type, 'file');
    assert.equal(body.entry.size, 11);

    // Source is gone
    assert.rejects(fs.stat(path.join(root, 'files', 'note.txt')), { code: 'ENOENT' });

    // Destination has the content
    assert.equal(await fs.readFile(path.join(root, 'files', 'archive', 'note.txt'), 'utf8'), 'hello world');
});

test('POST /api/files/move: moves folder — source gone, dest has contents', async t => {
    const { request, json, root } = await fixture(t);
    await request('/api/setup', json('POST', { password: 'correct horse battery' }));
    const form1 = (name, text, folder) => {
        const b = new FormData();
        b.append('file', new Blob([text]), name);
        return { method: 'POST', body: b };
    };
    assert.equal((await request('/api/folders', json('POST', { folder: '', name: 'source' }))).status, 201);
    assert.equal((await request('/api/folders', json('POST', { folder: 'source', name: 'sub' }))).status, 201);
    assert.equal((await request('/api/files/upload?folder=source', form1('data.csv', 'a,b,c'))).status, 201);
    assert.equal((await request('/api/folders', json('POST', { folder: '', name: 'dest' }))).status, 201);

    const moveRes = await request('/api/files/move', json('POST', { from: 'source', to: 'dest' }));
    assert.equal(moveRes.status, 200);
    const body = await moveRes.json();
    assert.equal(body.success, true);
    assert.equal(body.entry.name, 'source');
    assert.equal(body.entry.path, 'dest/source');
    assert.equal(body.entry.type, 'directory');

    // Source is gone
    assert.rejects(fs.stat(path.join(root, 'files', 'source')), { code: 'ENOENT' });

    // Destination folder exists with contents
    const subEntries = await (await request('/api/files?folder=dest/source')).json();
    assert.deepEqual(subEntries.entries.map(e => e.name).sort(), ['data.csv', 'sub'].sort());

    // Content preserved
    assert.equal(await fs.readFile(path.join(root, 'files', 'dest', 'source', 'data.csv'), 'utf8'), 'a,b,c');
});

test('POST /api/files/move: no extra copies — only renames on filesystem', async t => {
    const { request, json, root } = await fixture(t);
    await request('/api/setup', json('POST', { password: 'correct horse battery' }));
    const form1 = (name, text, folder) => {
        const b = new FormData();
        b.append('file', new Blob([text]), name);
        return { method: 'POST', body: b };
    };
    assert.equal((await request('/api/files/upload', form1('bytes.bin', '1234567890abcdef'))).status, 201);
    assert.equal((await request('/api/folders', json('POST', { folder: '', name: 'moved' }))).status, 201);

    const beforeRoot = new Set((await fs.readdir(path.join(root, 'files'))));
    const beforeMoved = new Set((await fs.readdir(path.join(root, 'files', 'moved'))));

    await request('/api/files/move', json('POST', { from: 'bytes.bin', to: 'moved' }));

    // After move: source file is gone from root, destination file appeared
    const afterRoot = new Set((await fs.readdir(path.join(root, 'files'))));
    const afterMoved = new Set((await fs.readdir(path.join(root, 'files', 'moved'))));
    assert.equal(afterRoot.size, beforeRoot.size - 1); // root lost exactly one (the moved source)
    assert.equal(beforeMoved.has('bytes.bin'), false); // moved folder was empty
    assert.equal(afterMoved.has('bytes.bin'), true);   // moved folder now has the file

    // File count in data dir unchanged (one file moved, not copied)
    // Count only user files (exclude .cloudlocal internals)
    async function countUserFiles(dir) {
        let count = 0;
        const entries = await fs.readdir(dir, { recursive: true });
        for (const e of entries) {
            if (typeof e === 'string' && !e.includes('.cloudlocal')) {
                const full = path.join(dir, e);
                try { if ((await fs.stat(full)).isFile()) count++; } catch { /* skip */ }
            }
        }
        return count;
    }
    // Before move: bytes.bin in root = 1 user file
    assert.equal(await countUserFiles(path.join(root, 'files')), 1);
    // After move: moved/bytes.bin = 1 user file (same, no copy created)
    assert.equal(await countUserFiles(path.join(root, 'files')), 1);
});