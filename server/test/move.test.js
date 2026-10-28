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

test('moving a file and a folder to Inicio preserves their contents', async t => {
    const { request, json } = await fixture(t);
    await request('/api/setup', json('POST', { password: 'correct horse battery' }));
    assert.equal((await request('/api/folders', json('POST', { folder: '', name: 'source' }))).status, 201);
    assert.equal((await request('/api/folders', json('POST', { folder: 'source', name: 'nested' }))).status, 201);
    const form = new FormData();
    form.append('file', new Blob(['hello']), 'note.txt');
    assert.equal((await request('/api/files/upload?folder=source', { method: 'POST', body: form })).status, 201);
    const file = await request('/api/files/move', json('POST', { from: 'source/note.txt', to: '' }));
    assert.equal(file.status, 200);
    assert.equal((await file.json()).entry.path, 'note.txt');
    const folder = await request('/api/files/moveFolder', json('POST', { from: 'source/nested', to: '' }));
    assert.equal(folder.status, 200);
    assert.equal((await folder.json()).entry.path, 'nested');
    assert.equal(await (await request('/api/files/content?path=note.txt')).text(), 'hello');
    assert.deepEqual((await (await request('/api/files?folder=source')).json()).entries, []);
});

test('POST /api/files/move: rejects non-existent source (404)', async t => {
    const { request, json, root } = await fixture(t);
    await request('/api/setup', json('POST', { password: 'correct horse battery' }));
    // Create a folder to use as destination.
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

test('POST /api/files/move: renames file within same folder', async t => {
    const { request, json, root } = await fixture(t);
    await request('/api/setup', json('POST', { password: 'correct horse battery' }));
    const form1 = (name, text) => {
        const b = new FormData();
        b.append('file', new Blob([text]), name);
        return { method: 'POST', body: b };
    };
    assert.equal((await request('/api/files/upload', form1('old-name.txt', 'rename test'))).status, 201);

    const moveRes = await request('/api/files/move', json('POST', { from: 'old-name.txt', to: 'new-name.txt' }));
    assert.equal(moveRes.status, 200);
    const body = await moveRes.json();
    assert.equal(body.success, true);
    assert.equal(body.entry.name, 'new-name.txt');
    assert.equal(body.entry.path, 'new-name.txt');
    assert.equal(body.entry.type, 'file');

    // Source gone
    assert.rejects(fs.stat(path.join(root, 'files', 'old-name.txt')), { code: 'ENOENT' });
    // Dest has content
    assert.equal(await fs.readFile(path.join(root, 'files', 'new-name.txt'), 'utf8'), 'rename test');
});

test('POST /api/files/move: renames file inside subfolder', async t => {
    const { request, json, root } = await fixture(t);
    await request('/api/setup', json('POST', { password: 'correct horse battery' }));
    const form1 = (name, text, folder) => {
        const b = new FormData();
        b.append('file', new Blob([text]), name);
        return { method: 'POST', body: b };
    };
    assert.equal((await request('/api/folders', json('POST', { folder: '', name: 'sub' }))).status, 201);
    assert.equal((await request('/api/files/upload?folder=sub', form1('old.txt', 'sub rename'))).status, 201);

    const moveRes = await request('/api/files/move', json('POST', { from: 'sub/old.txt', to: 'sub/new.txt' }));
    assert.equal(moveRes.status, 200);
    const body = await moveRes.json();
    assert.equal(body.success, true);
    assert.equal(body.entry.name, 'new.txt');
    assert.equal(body.entry.path, 'sub/new.txt');

    assert.rejects(fs.stat(path.join(root, 'files', 'sub', 'old.txt')), { code: 'ENOENT' });
    assert.equal(await fs.readFile(path.join(root, 'files', 'sub', 'new.txt'), 'utf8'), 'sub rename');
});

test('POST /api/files/move: renames folder within same parent', async t => {
    const { request, json, root } = await fixture(t);
    await request('/api/setup', json('POST', { password: 'correct horse battery' }));
    assert.equal((await request('/api/folders', json('POST', { folder: '', name: 'old-folder' }))).status, 201);
    assert.equal((await request('/api/files/upload?folder=old-folder', {
        method: 'POST',
        body: (() => {
            const b = new FormData();
            b.append('file', new Blob(['data']), 'f.txt');
            return b;
        })()
    })).status, 201);

    const moveRes = await request('/api/files/move', json('POST', { from: 'old-folder', to: 'new-folder' }));
    assert.equal(moveRes.status, 200);
    const body = await moveRes.json();
    assert.equal(body.success, true);
    assert.equal(body.entry.name, 'new-folder');
    assert.equal(body.entry.path, 'new-folder');
    assert.equal(body.entry.type, 'directory');

    assert.rejects(fs.stat(path.join(root, 'files', 'old-folder')), { code: 'ENOENT' });

    // Contents preserved
    const entries = await (await request('/api/files?folder=new-folder')).json();
    assert.ok(entries.entries.some(e => e.name === 'f.txt'));
});
// The move dialog sends mode: 'into': the destination is always a folder and the
// server must never fall back to renaming the source when that folder is gone.

function upload(name, text) {
    const body = new FormData();
    body.append('file', new Blob([text]), name);
    return { method: 'POST', body };
}

function userEntries(names) {
    return names.filter(name => name !== '.cloudlocal');
}

test('POST /api/files/move: explicit destination mode rejects a missing folder and keeps the source bytes', async t => {
    const { request, json, root } = await fixture(t);
    await request('/api/setup', json('POST', { password: 'correct horse battery' }));
    assert.equal((await request('/api/files/upload', upload('notas.txt', 'contenido ok'))).status, 201);

    const res = await request('/api/files/move', json('POST', { from: 'notas.txt', to: 'Destino', mode: 'into' }));
    assert.equal(res.status, 404, 'la carpeta inexistente no se convierte en el nuevo nombre del archivo');
    assert.deepEqual(userEntries(await fs.readdir(path.join(root, 'files'))), ['notas.txt']);
    assert.equal(await fs.readFile(path.join(root, 'files', 'notas.txt'), 'utf8'), 'contenido ok');
});

test('POST /api/files/move: explicit destination mode rejects a missing nested folder and keeps the source bytes', async t => {
    const { request, json, root } = await fixture(t);
    await request('/api/setup', json('POST', { password: 'correct horse battery' }));
    assert.equal((await request('/api/folders', json('POST', { folder: '', name: 'Archivo' }))).status, 201);
    assert.equal((await request('/api/files/upload', upload('notas.txt', 'sin tocar'))).status, 201);

    const res = await request('/api/files/move', json('POST', { from: 'notas.txt', to: 'Archivo/Falta', mode: 'into' }));
    assert.equal(res.status, 404);
    assert.deepEqual(userEntries(await fs.readdir(path.join(root, 'files'))).sort(), ['Archivo', 'notas.txt']);
    assert.deepEqual(await fs.readdir(path.join(root, 'files', 'Archivo')), []);
    assert.equal(await fs.readFile(path.join(root, 'files', 'notas.txt'), 'utf8'), 'sin tocar');
});

test('POST /api/files/move: explicit destination mode moves a file to Inicio', async t => {
    const { request, json, root } = await fixture(t);
    await request('/api/setup', json('POST', { password: 'correct horse battery' }));
    assert.equal((await request('/api/folders', json('POST', { folder: '', name: 'source' }))).status, 201);
    assert.equal((await request('/api/files/upload?folder=source', upload('notas.txt', 'hola'))).status, 201);

    const res = await request('/api/files/move', json('POST', { from: 'source/notas.txt', to: '', mode: 'into' }));
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.entry.path, 'notas.txt');
    assert.equal(await fs.readFile(path.join(root, 'files', 'notas.txt'), 'utf8'), 'hola');
    assert.deepEqual(await fs.readdir(path.join(root, 'files', 'source')), []);
});

test('POST /api/files/move: explicit destination mode moves a file into a nested folder', async t => {
    const { request, json, root } = await fixture(t);
    await request('/api/setup', json('POST', { password: 'correct horse battery' }));
    assert.equal((await request('/api/folders', json('POST', { folder: '', name: 'Archivo' }))).status, 201);
    assert.equal((await request('/api/folders', json('POST', { folder: 'Archivo', name: '2024' }))).status, 201);
    assert.equal((await request('/api/files/upload', upload('notas.txt', 'nested bytes'))).status, 201);

    const res = await request('/api/files/move', json('POST', { from: 'notas.txt', to: 'Archivo/2024', mode: 'into' }));
    assert.equal(res.status, 200);
    assert.equal((await res.json()).entry.path, 'Archivo/2024/notas.txt');
    assert.equal(await fs.readFile(path.join(root, 'files', 'Archivo', '2024', 'notas.txt'), 'utf8'), 'nested bytes');
    assert.equal(userEntries(await fs.readdir(path.join(root, 'files'))).includes('notas.txt'), false);
});

test('POST /api/files/move: clients without a mode keep the legacy rename behaviour', async t => {
    const { request, json, root } = await fixture(t);
    await request('/api/setup', json('POST', { password: 'correct horse battery' }));
    assert.equal((await request('/api/files/upload', upload('viejo.txt', 'legacy'))).status, 201);

    const res = await request('/api/files/move', json('POST', { from: 'viejo.txt', to: 'renombrado.txt' }));
    assert.equal(res.status, 200);
    assert.equal((await res.json()).entry.path, 'renombrado.txt');
    assert.equal(await fs.readFile(path.join(root, 'files', 'renombrado.txt'), 'utf8'), 'legacy');
    assert.equal(userEntries(await fs.readdir(path.join(root, 'files'))).includes('viejo.txt'), false);
});

test('POST /api/files/move: rejects an unknown mode and keeps the source bytes', async t => {
    const { request, json, root } = await fixture(t);
    await request('/api/setup', json('POST', { password: 'correct horse battery' }));
    assert.equal((await request('/api/files/upload', upload('notas.txt', 'intacto'))).status, 201);

    assert.equal((await request('/api/files/move', json('POST', { from: 'notas.txt', to: 'Destino', mode: 'intoFolder' }))).status, 400);
    assert.equal(await fs.readFile(path.join(root, 'files', 'notas.txt'), 'utf8'), 'intacto');
});

test('POST /api/files/move: explicit destination mode still requires a destination field', async t => {
    const { request, json } = await fixture(t);
    await request('/api/setup', json('POST', { password: 'correct horse battery' }));
    assert.equal((await request('/api/files/move', json('POST', { from: 'file.txt', mode: 'into' }))).status, 400);
});

test('POST /api/files/moveFolder: explicit destination mode rejects a missing folder and keeps the folder contents', async t => {
    const { request, json, root } = await fixture(t);
    await request('/api/setup', json('POST', { password: 'correct horse battery' }));
    assert.equal((await request('/api/folders', json('POST', { folder: '', name: 'origen' }))).status, 201);
    assert.equal((await request('/api/files/upload?folder=origen', upload('dato.txt', 'conservar'))).status, 201);

    const res = await request('/api/files/moveFolder', json('POST', { from: 'origen', to: 'Destino', mode: 'into' }));
    assert.equal(res.status, 404);
    assert.deepEqual(userEntries(await fs.readdir(path.join(root, 'files'))), ['origen']);
    assert.equal(await fs.readFile(path.join(root, 'files', 'origen', 'dato.txt'), 'utf8'), 'conservar');
});
