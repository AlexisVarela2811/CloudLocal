const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const zlib = require('node:zlib');
const { createApp } = require('../src/app');
const { buildZipArchive, crc32 } = require('../src/storage');

async function fixture(t) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cloudlocal-copy-'));
    const app = createApp({ dataDir: path.join(root, 'files'), stateDir: path.join(root, 'state'), maxUploadBytes: 16 * 1024 * 1024 });
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
    return { request, root, base, server };
}

function jsonBody(method, body) {
    return { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}
function form(name, text, folder) {
    const b = new FormData();
    b.append('file', new Blob([text]), name);
    return { method: 'POST', body: b };
}

async function setup(request) {
    await request('/api/setup', jsonBody('POST', { password: 'correct horse battery' }));
}

async function uploadFile(request, name, text, folder) {
    return request('/api/files/upload' + (folder ? `?folder=${encodeURIComponent(folder)}` : ''), form(name, text, folder));
}

// ---- COPY ----

test('POST /api/files/copy: auth required — unauthenticated returns 401', async t => {
    const { request } = await fixture(t);
    assert.equal((await request('/api/files/copy', jsonBody('POST', { from: 'a.txt', to: '' }))).status, 401);
});

test('POST /api/files/copy: rejects missing from path', async t => {
    const { request } = await fixture(t);
    await setup(request);
    assert.equal((await request('/api/files/copy', jsonBody('POST', { to: 'folder' }))).status, 400);
});

test('POST /api/files/copy: rejects missing to folder', async t => {
    const { request } = await fixture(t);
    await setup(request);
    assert.equal((await request('/api/files/copy', jsonBody('POST', { from: 'file.txt' }))).status, 400);
});

test('POST /api/files/copy: copies file — source preserved, dest created', async t => {
    const { request, root } = await fixture(t);
    await setup(request);
    await uploadFile(request, 'original.txt', 'hello world');
    assert.equal((await request('/api/folders', jsonBody('POST', { folder: '', name: 'archive' }))).status, 201);

    const copyRes = await request('/api/files/copy', jsonBody('POST', { from: 'original.txt', to: 'archive' }));
    assert.equal(copyRes.status, 200);
    const body = await copyRes.json();
    assert.equal(body.success, true);
    assert.equal(body.entry.name, 'original.txt');
    assert.equal(body.entry.path, 'archive/original.txt');
    assert.equal(body.entry.type, 'file');

    assert.equal(await fs.readFile(path.join(root, 'files', 'original.txt'), 'utf8'), 'hello world');
    assert.equal(await fs.readFile(path.join(root, 'files', 'archive', 'original.txt'), 'utf8'), 'hello world');
});

test('POST /api/files/copy: collision auto-rename with (1), (2) suffixes', async t => {
    const { request, root } = await fixture(t);
    await setup(request);
    await uploadFile(request, 'dup.txt', 'first');
    assert.equal((await request('/api/folders', jsonBody('POST', { folder: '', name: 'dest' }))).status, 201);
    await uploadFile(request, 'dup.txt', 'second', 'dest');

    const r1 = await request('/api/files/copy', jsonBody('POST', { from: 'dup.txt', to: 'dest' }));
    assert.equal(r1.status, 200);
    const b1 = await r1.json();
    assert.equal(b1.entry.path, 'dest/dup (1).txt');
    assert.equal(await fs.readFile(path.join(root, 'files', 'dest', 'dup (1).txt'), 'utf8'), 'first');

    const r2 = await request('/api/files/copy', jsonBody('POST', { from: 'dup.txt', to: 'dest' }));
    assert.equal(r2.status, 200);
    const b2 = await r2.json();
    assert.equal(b2.entry.path, 'dest/dup (2).txt');
    assert.equal(await fs.readFile(path.join(root, 'files', 'dest', 'dup (2).txt'), 'utf8'), 'first');
});

test('POST /api/files/copy: to non-existent folder returns 404', async t => {
    const { request } = await fixture(t);
    await setup(request);
    await uploadFile(request, 'f.txt', 'data');
    assert.equal((await request('/api/files/copy', jsonBody('POST', { from: 'f.txt', to: 'nonexistent' }))).status, 404);
});

test('POST /api/files/copy: rejects forbidden extension (.exe)', async t => {
    const { request } = await fixture(t);
    await setup(request);
    await uploadFile(request, 'ok.txt', 'data');
    assert.equal((await request('/api/folders', jsonBody('POST', { folder: '', name: 'folder' }))).status, 201);
    assert.equal((await request('/api/files/copy', jsonBody('POST', { from: 'ok.txt', to: 'folder', newName: 'bad.exe' }))).status, 400);
});

// ---- PASTE (folder copy) ----

test('POST /api/files/paste: copies folder with contents', async t => {
    const { request, root } = await fixture(t);
    await setup(request);
    assert.equal((await request('/api/folders', jsonBody('POST', { folder: '', name: 'src' }))).status, 201);
    assert.equal((await request('/api/folders', jsonBody('POST', { folder: 'src', name: 'sub' }))).status, 201);
    await uploadFile(request, 'a.txt', 'aaa', 'src');
    await uploadFile(request, 'b.txt', 'bbb', 'src/sub');
    assert.equal((await request('/api/folders', jsonBody('POST', { folder: '', name: 'dst' }))).status, 201);

    const pasteRes = await request('/api/files/paste', jsonBody('POST', { from: 'src', to: 'dst', type: 'folder' }));
    assert.equal(pasteRes.status, 200);
    const body = await pasteRes.json();
    assert.equal(body.success, true);
    assert.equal(body.entry.name, 'src');
    assert.equal(body.entry.path, 'dst/src');

    assert.equal(await fs.readFile(path.join(root, 'files', 'src', 'a.txt'), 'utf8'), 'aaa');
    assert.equal(await fs.readFile(path.join(root, 'files', 'dst', 'src', 'a.txt'), 'utf8'), 'aaa');
    assert.equal(await fs.readFile(path.join(root, 'files', 'dst', 'src', 'sub', 'b.txt'), 'utf8'), 'bbb');
});

test('POST /api/files/paste: folder collision auto-renames', async t => {
    const { request, root } = await fixture(t);
    await setup(request);
    assert.equal((await request('/api/folders', jsonBody('POST', { folder: '', name: 'dup' }))).status, 201);
    await uploadFile(request, 'f.txt', 'data', 'dup');
    // dup/ exists; create dup2 and paste into dup to get dup/dup (1)
    assert.equal((await request('/api/folders', jsonBody('POST', { folder: '', name: 'dup2' }))).status, 201);

    // Copy dup2 folder into dup — dup/dup2
    const r1 = await request('/api/files/paste', jsonBody('POST', { from: 'dup2', to: 'dup', type: 'folder' }));
    assert.equal(r1.status, 200);
    const b1 = await r1.json();
    assert.ok(b1.entry.path.includes('dup2') || b1.entry.path.includes('dup (1)'));
});

test('POST /api/files/paste: rejects missing type', async t => {
    const { request } = await fixture(t);
    await setup(request);
    assert.equal((await request('/api/files/paste', jsonBody('POST', { from: 'a', to: 'b' }))).status, 400);
});

// ---- PERMANENT DELETE ----

test('POST /api/files/permanent: rejects invalid id', async t => {
    const { request } = await fixture(t);
    await setup(request);
    assert.equal((await request('/api/files/permanent', jsonBody('POST', { id: 'not-a-uuid' }))).status, 400);
});

test('POST /api/files/permanent: deletes trash entry permanently', async t => {
    const { request } = await fixture(t);
    await setup(request);
    await uploadFile(request, 'trash_me.txt', 'bye');

    // Trash via DELETE /api/files/?path=...
    const trashResp = await request('/api/files/?path=trash_me.txt', { method: 'DELETE' });
    assert.equal(trashResp.status, 200);
    const trashBody = await trashResp.json();
    assert.ok(trashBody.entry.id);

    let listTrash = await request('/api/trash');
    assert.equal((await listTrash.json()).entries.length, 1);

    const permResp = await request('/api/files/permanent', jsonBody('POST', { id: trashBody.entry.id }));
    assert.equal(permResp.status, 200);
    const permBody = await permResp.json();
    assert.equal(permBody.success, true);

    listTrash = await request('/api/trash');
    assert.equal((await listTrash.json()).entries.length, 0);
});

test('POST /api/trash/empty: removes all trash entries', async t => {
    const { request } = await fixture(t);
    await setup(request);
    await uploadFile(request, 'x1.txt', 'one');
    await uploadFile(request, 'x2.txt', 'two');
    assert.equal((await request('/api/files/?path=x1.txt', { method: 'DELETE' })).status, 200);
    assert.equal((await request('/api/files/?path=x2.txt', { method: 'DELETE' })).status, 200);
    assert.equal((await (await request('/api/trash')).json()).entries.length, 2);

    const emptyResp = await request('/api/trash/empty', jsonBody('POST', {}));
    assert.equal(emptyResp.status, 200);
    const emptyBody = await emptyResp.json();
    assert.equal(emptyBody.success, true);
    assert.equal(emptyBody.deleted, 2);

    assert.equal((await (await request('/api/trash')).json()).entries.length, 0);
});

test('POST /api/trash/empty: auth required', async t => {
    const { request } = await fixture(t);
    assert.equal((await request('/api/trash/empty', jsonBody('POST', {}))).status, 401);
});

// ---- ZIP DOWNLOAD ----

test('GET /api/files/zip: auth required', async t => {
    const { request } = await fixture(t);
    assert.equal((await request('/api/files/zip')).status, 401);
});

test('GET /api/files/zip: rejects missing paths', async t => {
    const { request } = await fixture(t);
    await setup(request);
    assert.equal((await request('/api/files/zip')).status, 400);
});

test('GET /api/files/zip: generates valid zip with multiple files', async t => {
    const { request, root } = await fixture(t);
    await setup(request);
    await uploadFile(request, 'one.txt', 'first content');
    await uploadFile(request, 'two.txt', 'second content');

    const zipResp = await request('/api/files/zip?paths[]=one.txt&paths[]=two.txt');
    assert.equal(zipResp.status, 200);
    assert.equal(zipResp.headers.get('content-type'), 'application/zip');
    const zipData = Buffer.from(await zipResp.arrayBuffer());

    // Verify ZIP magic number
    assert.equal(zipData.readUInt32LE(0), 0x04034b50, 'ZIP magic number mismatch');
    // Verify EOCD
    const eocdOffset = zipData.length - 22;
    assert.equal(zipData.readUInt32LE(eocdOffset), 0x06054b50, 'EOCD signature mismatch');

    // Unzip first file
    const name1Len = zipData.readUInt16LE(26);
    const data1Start = 30 + name1Len;
    const compressed1Size = zipData.readUInt32LE(18);
    const compressed1 = zipData.slice(data1Start, data1Start + compressed1Size);
    const decompressed1 = zlib.inflateSync(compressed1);
    assert.equal(decompressed1.toString('utf8'), 'first content');
});

test('GET /api/files/zip: empty paths returns 404', async t => {
    const { request } = await fixture(t);
    await setup(request);
    assert.equal((await request('/api/files/zip?paths[]=nonexistent.txt')).status, 404);
});

// ---- IMAGE PREVIEW ----

test('GET /api/files/preview/*: auth required', async t => {
    const { request } = await fixture(t);
    assert.equal((await request('/api/files/preview/test.png')).status, 401);
});

test('GET /api/files/preview/*: serves image with correct content-type', async t => {
    const { request, root } = await fixture(t);
    await setup(request);
    // Minimal 1x1 red PNG
    const png = Buffer.from(
        '89504e470d0a1a0a0000000d4948445200000001000000010802000000907753de0000000c49444152000000' +
        '00cbaf20e40000000049454e44ae426082', 'hex');
    const fileDir = path.join(root, 'files');
    await fs.mkdir(path.join(fileDir, 'images'), { recursive: true });
    await fs.writeFile(path.join(fileDir, 'images', 'test.png'), png);

    const resp = await request('/api/files/preview/images/test.png');
    assert.equal(resp.status, 200);
    assert.equal(resp.headers.get('content-type'), 'image/png');
    const body = Buffer.from(await resp.arrayBuffer());
    assert.equal(body.toString('hex'), png.toString('hex'));
});

test('GET /api/files/preview/*: rejects non-image files', async t => {
    const { request } = await fixture(t);
    await setup(request);
    await uploadFile(request, 'data.txt', 'text data');
    assert.equal((await request('/api/files/preview/data.txt')).status, 400);
});

test('GET /api/files/preview/*: missing file returns 404', async t => {
    const { request } = await fixture(t);
    await setup(request);
    assert.equal((await request('/api/files/preview/nonexistent.png')).status, 404);
});

// ---- UPLOAD VALIDATION ----

test('POST /api/files/upload: rejects .exe files', async t => {
    const { request } = await fixture(t);
    await setup(request);
    assert.equal((await request('/api/files/upload', form('malware.exe', 'bad'))).status, 400);
});

test('POST /api/files/upload: rejects .bat files', async t => {
    const { request } = await fixture(t);
    await setup(request);
    assert.equal((await request('/api/files/upload', form('run.bat', '@echo off'))).status, 400);
});

test('POST /api/files/upload: rejects .ps1 files', async t => {
    const { request } = await fixture(t);
    await setup(request);
    assert.equal((await request('/api/files/upload', form('script.ps1', 'Get-Process'))).status, 400);
});

test('POST /api/files/upload: accepts normal file extensions', async t => {
    const { request } = await fixture(t);
    await setup(request);
    assert.equal((await request('/api/files/upload', form('image.png', 'img'))).status, 201);
    assert.equal((await request('/api/files/upload', form('doc.pdf', 'pdf'))).status, 201);
    assert.equal((await request('/api/files/upload', form('music.mp3', 'mp3'))).status, 201);
});

// ---- STORAGE SAFETY S1: destination names must not become addresses ----

async function exists(target) {
    try {
        await fs.stat(target);
        return true;
    } catch {
        return false;
    }
}

// Everything the user can see; .cloudlocal is server internals.
function userEntries(names) {
    return names.filter(name => name !== '.cloudlocal').sort();
}

async function makeFolder(request, folder, name) {
    assert.equal((await request('/api/folders', jsonBody('POST', { folder, name }))).status, 201);
}

test('POST /api/files/copy: a destination name that is a path is rejected and writes nothing', async t => {
    const { request, root } = await fixture(t);
    await setup(request);
    await uploadFile(request, 'note.txt', 'payload');
    await makeFolder(request, '', 'keep');
    const files = path.join(root, 'files');

    for (const newName of ['../escaped.txt', '..\\escaped.txt', 'nested/evil.txt', '../../escaped.txt',
        '/absolute/evil.txt', '../.cloudlocal/trash/evil.txt']) {
        const res = await request('/api/files/copy', jsonBody('POST', { from: 'note.txt', to: 'keep', newName }));
        assert.equal(res.status, 400, `${newName} is rejected instead of resolved`);
    }

    assert.deepEqual(await fs.readdir(path.join(files, 'keep')), [], 'a rejected name still wrote into the folder');
    assert.deepEqual(userEntries(await fs.readdir(files)), ['keep', 'note.txt']);
    assert.deepEqual(await fs.readdir(path.join(files, '.cloudlocal', 'trash')), [], 'a rejected name reached internal storage');
    assert.equal(await exists(path.join(root, 'escaped.txt')), false);
    assert.equal(await exists(path.join(files, 'escaped.txt')), false);
    assert.equal(await fs.readFile(path.join(files, 'note.txt'), 'utf8'), 'payload');

    // A plain destination name is still accepted after the rejections.
    assert.equal((await request('/api/files/copy', jsonBody('POST', { from: 'note.txt', to: 'keep', newName: 'copy.txt' }))).status, 200);
    assert.deepEqual(userEntries(await fs.readdir(path.join(files, 'keep'))), ['copy.txt']);
});

test('POST /api/files/copy: a destination folder outside storage is rejected', async t => {
    const { request, root } = await fixture(t);
    await setup(request);
    await uploadFile(request, 'note.txt', 'payload');
    await makeFolder(request, '', 'keep');
    const files = path.join(root, 'files');

    for (const to of ['../escaped', 'keep/../../escaped', './keep', '..\\keep', '/tmp/evil']) {
        assert.equal((await request('/api/files/copy', jsonBody('POST', { from: 'note.txt', to }))).status, 400, `${to} is not a storage folder`);
    }

    assert.deepEqual(userEntries(await fs.readdir(files)), ['keep', 'note.txt']);
    assert.deepEqual(userEntries(await fs.readdir(root)), ['files', 'state']);
    assert.equal(await exists(path.join(root, 'escaped')), false);
});

test('POST /api/folders: a created name cannot become a path', async t => {
    const { request, root } = await fixture(t);
    await setup(request);
    const files = path.join(root, 'files');

    for (const body of [{ folder: '', name: '../escaped' }, { folder: '', name: '..\\escaped' },
        { folder: '', name: 'a/b' }, { folder: '../', name: 'evil' }, { folder: 'keep/..', name: 'evil' }]) {
        assert.equal((await request('/api/folders', jsonBody('POST', body))).status, 400, `${JSON.stringify(body)} is rejected`);
    }

    assert.deepEqual(userEntries(await fs.readdir(files)), []);
    assert.deepEqual(userEntries(await fs.readdir(root)), ['files', 'state']);
    await makeFolder(request, '', 'ok');
});

test('POST /api/files/paste: destination folder traversal leaves the source untouched', async t => {
    const { request, root } = await fixture(t);
    await setup(request);
    await makeFolder(request, '', 'src');
    await uploadFile(request, 'data.txt', 'payload', 'src');
    await uploadFile(request, 'note.txt', 'payload');
    const files = path.join(root, 'files');

    assert.equal((await request('/api/files/paste', jsonBody('POST', { from: 'src', to: '../escaped', type: 'folder' }))).status, 400);
    assert.equal((await request('/api/files/paste', jsonBody('POST', { from: 'src', to: 'src/../../escaped', type: 'folder' }))).status, 400);
    assert.equal((await request('/api/files/paste', jsonBody('POST', { from: 'note.txt', to: '../escaped', type: 'file' }))).status, 400);

    assert.deepEqual(userEntries(await fs.readdir(files)), ['note.txt', 'src']);
    assert.deepEqual(userEntries(await fs.readdir(path.join(files, 'src'))), ['data.txt']);
    assert.equal(await exists(path.join(root, 'escaped')), false);
});

test('POST /api/files/move: a rename destination cannot escape its folder', async t => {
    const { request, root } = await fixture(t);
    await setup(request);
    await uploadFile(request, 'old.txt', 'legacy');
    await makeFolder(request, '', 'keep');
    await uploadFile(request, 'inside.txt', 'kept', 'keep');
    const files = path.join(root, 'files');

    for (const to of ['../../escaped.txt', 'keep/../../escaped.txt', '..\\escaped.txt']) {
        assert.equal((await request('/api/files/move', jsonBody('POST', { from: 'old.txt', to }))).status, 400, `${to} does not rename across folders`);
    }
    assert.equal((await request('/api/files/move', jsonBody('POST', { from: 'old.txt', to: 'keep/../..', mode: 'into' }))).status, 400);

    assert.equal(await fs.readFile(path.join(files, 'old.txt'), 'utf8'), 'legacy');
    assert.equal(await fs.readFile(path.join(files, 'keep', 'inside.txt'), 'utf8'), 'kept');
    assert.equal(await exists(path.join(root, 'escaped.txt')), false);
    assert.equal(await exists(path.join(files, 'escaped.txt')), false);
});

test('POST /api/files/upload: the folder query and the uploaded name stay inside storage', async t => {
    const { request, root } = await fixture(t);
    await setup(request);
    await makeFolder(request, '', 'keep');
    const files = path.join(root, 'files');

    for (const folder of ['../escape', 'keep/../../escape', './keep']) {
        assert.equal((await uploadFile(request, 'note.txt', 'payload', folder)).status, 400, `folder=${folder} is rejected`);
    }

    // A client that sends a path as the file name gets a name, not an address.
    const escaped = await uploadFile(request, '../escaped.txt', 'name path');
    assert.equal(escaped.status, 201);
    assert.equal((await escaped.json()).file.path, 'escaped.txt');

    assert.deepEqual(userEntries(await fs.readdir(files)), ['escaped.txt', 'keep']);
    assert.equal(await exists(path.join(root, 'escape')), false);
    assert.equal(await exists(path.join(root, 'escaped.txt')), false);
});

// ---- STORAGE SAFETY S2: two mutations competing for the same place ----

test('POST /api/files/copy: concurrent copies into one destination reserve distinct names', async t => {
    const { request, root } = await fixture(t);
    await setup(request);
    await makeFolder(request, '', 'left');
    await makeFolder(request, '', 'right');
    await makeFolder(request, '', 'dest');
    await uploadFile(request, 'same.txt', 'first', 'left');
    await uploadFile(request, 'same.txt', 'second', 'right');
    const files = path.join(root, 'files');

    const [a, b] = await Promise.all([
        request('/api/files/copy', jsonBody('POST', { from: 'left/same.txt', to: 'dest' })),
        request('/api/files/copy', jsonBody('POST', { from: 'right/same.txt', to: 'dest' })),
    ]);
    assert.equal(a.status, 200);
    assert.equal(b.status, 200);
    const paths = [(await a.json()).entry.path, (await b.json()).entry.path];
    assert.equal(new Set(paths).size, 2, 'both copies claim the same destination');
    assert.deepEqual(userEntries(await fs.readdir(path.join(files, 'dest'))), ['same (1).txt', 'same.txt']);

    const contents = [];
    for (const item of paths) contents.push(await fs.readFile(path.join(files, ...item.split('/')), 'utf8'));
    assert.deepEqual(contents.sort(), ['first', 'second'], 'a concurrent copy overwrote another file');
    assert.equal(await fs.readFile(path.join(files, 'left', 'same.txt'), 'utf8'), 'first');
    assert.equal(await fs.readFile(path.join(files, 'right', 'same.txt'), 'utf8'), 'second');
});

test('POST /api/files/paste: concurrent folder copies reserve distinct destinations', async t => {
    const { request, root } = await fixture(t);
    await setup(request);
    await makeFolder(request, '', 'src');
    await uploadFile(request, 'data.txt', 'payload', 'src');
    await makeFolder(request, '', 'dest');
    const files = path.join(root, 'files');

    const [a, b] = await Promise.all([
        request('/api/files/paste', jsonBody('POST', { from: 'src', to: 'dest', type: 'folder' })),
        request('/api/files/paste', jsonBody('POST', { from: 'src', to: 'dest', type: 'folder' })),
    ]);
    assert.equal(a.status, 200);
    assert.equal(b.status, 200);
    const paths = [(await a.json()).entry.path, (await b.json()).entry.path];
    assert.equal(new Set(paths).size, 2, 'both folder copies landed on the same destination');
    assert.deepEqual(userEntries(await fs.readdir(path.join(files, 'dest'))), ['src', 'src (1)']);

    for (const item of paths) {
        assert.equal(await fs.readFile(path.join(files, ...item.split('/'), 'data.txt'), 'utf8'), 'payload');
    }
    assert.equal(await fs.readFile(path.join(files, 'src', 'data.txt'), 'utf8'), 'payload');
});

test('POST /api/files/move: concurrent moves to one destination keep one winner and both sources', async t => {
    const { request, root } = await fixture(t);
    await setup(request);
    await makeFolder(request, '', 'left');
    await makeFolder(request, '', 'right');
    await makeFolder(request, '', 'dest');
    await uploadFile(request, 'same.txt', 'first', 'left');
    await uploadFile(request, 'same.txt', 'second', 'right');
    const files = path.join(root, 'files');

    const [a, b] = await Promise.all([
        request('/api/files/move', jsonBody('POST', { from: 'left/same.txt', to: 'dest' })),
        request('/api/files/move', jsonBody('POST', { from: 'right/same.txt', to: 'dest' })),
    ]);
    assert.deepEqual([a.status, b.status].sort(), [200, 409], 'two moves wrote the same destination');
    const winner = a.status === 200 ? 'left/same.txt' : 'right/same.txt';
    const loser = a.status === 200 ? 'right/same.txt' : 'left/same.txt';
    await Promise.all([a.json(), b.json()]);

    const contents = await Promise.all([
        fs.readFile(path.join(files, 'dest', 'same.txt'), 'utf8'),
        fs.readFile(path.join(files, ...loser.split('/')), 'utf8'),
    ]);
    assert.deepEqual(contents.sort(), ['first', 'second'], 'the losing move lost its bytes');
    assert.equal(await exists(path.join(files, ...winner.split('/'))), false);
});

test('DELETE /api/files: concurrent trashes of one path move the file once', async t => {
    const { request, root } = await fixture(t);
    await setup(request);
    await uploadFile(request, 'gone.txt', 'bytes');
    const files = path.join(root, 'files');

    const [a, b] = await Promise.all([
        request('/api/files/?path=gone.txt', { method: 'DELETE' }),
        request('/api/files/?path=gone.txt', { method: 'DELETE' }),
    ]);
    assert.deepEqual([a.status, b.status].sort(), [200, 404], 'one file was trashed twice');
    await Promise.all([a.json(), b.json()]);

    const trash = (await (await request('/api/trash')).json()).entries;
    assert.deepEqual(trash.map(entry => entry.path), ['gone.txt']);
    assert.deepEqual(userEntries(await fs.readdir(files)), []);
});

test('POST /api/files/copy racing DELETE /api/files keeps the bytes reachable', async t => {
    const { request, root } = await fixture(t);
    await setup(request);
    await uploadFile(request, 'same.txt', 'payload');
    await makeFolder(request, '', 'dest');
    const files = path.join(root, 'files');

    const [copy, trash] = await Promise.all([
        request('/api/files/copy', jsonBody('POST', { from: 'same.txt', to: 'dest' })),
        request('/api/files/?path=same.txt', { method: 'DELETE' }),
    ]);
    const copyBody = await copy.json();
    const trashBody = await trash.json();
    assert.equal(trash.status, 200, 'the source was neither copied out nor trashed');
    assert.ok([200, 404].includes(copy.status), `unexpected copy status ${copy.status}`);
    assert.equal(await exists(path.join(files, 'same.txt')), false);

    if (copy.status === 200) {
        assert.equal(copyBody.entry.path, 'dest/same.txt');
        assert.equal(await fs.readFile(path.join(files, 'dest', 'same.txt'), 'utf8'), 'payload');
    } else {
        assert.deepEqual(await fs.readdir(path.join(files, 'dest')), []);
    }

    // The original is still recoverable from trash either way.
    const restored = await request(`/api/trash/${trashBody.entry.id}/restore`, jsonBody('POST', {}));
    assert.equal(restored.status, 200);
    assert.equal((await restored.json()).entry.path, 'same.txt');
    assert.equal(await fs.readFile(path.join(files, 'same.txt'), 'utf8'), 'payload');
});

test('POST /api/folders racing POST /api/files/moveFolder for one name resolves to one winner', async t => {
    const { request, root } = await fixture(t);
    await setup(request);
    await makeFolder(request, '', 'source');
    await makeFolder(request, 'source', 'same');
    await uploadFile(request, 'data.txt', 'data', 'source/same');
    await makeFolder(request, '', 'dest');
    const files = path.join(root, 'files');

    const [created, moved] = await Promise.all([
        request('/api/folders', jsonBody('POST', { folder: 'dest', name: 'same' })),
        request('/api/files/moveFolder', jsonBody('POST', { from: 'source/same', to: 'dest' })),
    ]);
    const createdBody = await created.json();
    const movedBody = await moved.json();

    if (created.status === 201) {
        assert.equal(moved.status, 409, 'a move replaced a folder created at the same name');
        assert.deepEqual(await fs.readdir(path.join(files, 'dest', 'same')), []);
        assert.equal(await fs.readFile(path.join(files, 'source', 'same', 'data.txt'), 'utf8'), 'data');
    } else {
        assert.equal(created.status, 409);
        assert.equal(moved.status, 200);
        assert.equal(movedBody.entry.path, 'dest/same');
        assert.equal(await fs.readFile(path.join(files, 'dest', 'same', 'data.txt'), 'utf8'), 'data');
        assert.equal(await exists(path.join(files, 'source', 'same')), false);
    }
});

// ---- buildZipArchive unit tests ----

test('buildZipArchive: creates valid zip with one file', async t => {
    const data = Buffer.from('hello');
    const zip = await buildZipArchive([{ name: 'hello.txt', data }]);
    assert.ok(zip.length > 0);
    assert.equal(zip.readUInt32LE(0), 0x04034b50); // local file header signature
    const eocdOff = zip.length - 22;
    assert.equal(zip.readUInt32LE(eocdOff), 0x06054b50); // EOCD signature

    // Decompress and verify
    const nameLen = zip.readUInt16LE(26);
    const dataStart = 30 + nameLen;
    const compLen = zip.readUInt32LE(18);
    const decompressed = zlib.inflateSync(zip.slice(dataStart, dataStart + compLen));
    assert.equal(decompressed.toString('utf8'), 'hello');
});

test('buildZipArchive: creates valid zip with multiple files', async t => {
    const zip = await buildZipArchive([
        { name: 'a.txt', data: Buffer.from('A') },
        { name: 'b.txt', data: Buffer.from('B') },
        { name: 'c.txt', data: Buffer.from('C') },
    ]);
    assert.ok(zip.length > 0);

    // Verify EOCD
    const eocdOff = zip.length - 22;
    assert.equal(zip.readUInt32LE(eocdOff), 0x06054b50);

    // Verify first file can be decompressed
    const nameLen1 = zip.readUInt16LE(26);
    const compLen1 = zip.readUInt32LE(18);
    const d1 = zlib.inflateSync(zip.slice(30 + nameLen1, 30 + nameLen1 + compLen1));
    assert.equal(d1.toString('utf8'), 'A');
});

test('buildZipArchive: crc32 is correct for known content', async t => {
    const c = crc32(Buffer.from('hello'));
    assert.ok(Number.isSafeInteger(c) && c >= 0);
    assert.equal(c, 907060870);
});