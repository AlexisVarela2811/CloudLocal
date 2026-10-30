const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createStorage } = require('../src/storage');

async function fixture(t) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'cloudlocal-safety-'));
  const root = path.join(base, 'files');
  await fs.mkdir(root);
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  return { base, root, storage: createStorage(root) };
}

test('copy rejects traversal in a destination name without changing files', async t => {
  const { base, root, storage } = await fixture(t);
  await fs.mkdir(path.join(root, 'dest'));
  await fs.writeFile(path.join(root, 'source.txt'), 'source');
  await assert.rejects(storage.copy('source.txt', 'dest', '../../escape.txt'), { status: 400 });
  await assert.rejects(fs.stat(path.join(base, 'escape.txt')), { code: 'ENOENT' });
  assert.equal(await fs.readFile(path.join(root, 'source.txt'), 'utf8'), 'source');
  assert.deepEqual(await fs.readdir(path.join(root, 'dest')), []);
});

test('concurrent copies preserve both sources and reserve distinct destinations', async t => {
  const { root, storage } = await fixture(t);
  await fs.mkdir(path.join(root, 'dest'));
  await fs.mkdir(path.join(root, 'other'));
  await fs.writeFile(path.join(root, 'same.txt'), 'first');
  await fs.writeFile(path.join(root, 'other', 'same.txt'), 'second');
  const copies = await Promise.all([storage.copy('same.txt', 'dest'), storage.copy('other/same.txt', 'dest')]);
  assert.equal(new Set(copies.map(copy => copy.name)).size, 2);
  const contents = await Promise.all(copies.map(copy => fs.readFile(path.join(root, 'dest', copy.name), 'utf8')));
  assert.deepEqual(contents.sort(), ['first', 'second']);
  assert.equal(await fs.readFile(path.join(root, 'same.txt'), 'utf8'), 'first');
  assert.equal(await fs.readFile(path.join(root, 'other', 'same.txt'), 'utf8'), 'second');
});

test('concurrent file moves never overwrite either source', async t => {
  const { root, storage } = await fixture(t);
  await fs.mkdir(path.join(root, 'dest'));
  await fs.mkdir(path.join(root, 'other'));
  await fs.writeFile(path.join(root, 'same.txt'), 'first');
  await fs.writeFile(path.join(root, 'other', 'same.txt'), 'second');
  const results = await Promise.allSettled([storage.move('same.txt', 'dest'), storage.move('other/same.txt', 'dest')]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter(result => result.status === 'rejected').length, 1);
  const destination = await fs.readFile(path.join(root, 'dest', 'same.txt'), 'utf8');
  const remaining = await Promise.all(['same.txt', 'other/same.txt'].map(name => fs.readFile(path.join(root, name), 'utf8').catch(error => error.code === 'ENOENT' ? null : Promise.reject(error))));
  assert.deepEqual([destination, ...remaining.filter(Boolean)].sort(), ['first', 'second']);
});

test('concurrent folder moves preserve both folders', async t => {
  const { root, storage } = await fixture(t);
  await fs.mkdir(path.join(root, 'dest'));
  await fs.mkdir(path.join(root, 'other', 'same'), { recursive: true });
  await fs.mkdir(path.join(root, 'same'));
  await fs.writeFile(path.join(root, 'same', 'one.txt'), 'first');
  await fs.writeFile(path.join(root, 'other', 'same', 'two.txt'), 'second');
  const results = await Promise.allSettled([storage.moveFolder('same', 'dest'), storage.moveFolder('other/same', 'dest')]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter(result => result.status === 'rejected').length, 1);
  const first = await fs.readFile(path.join(root, 'dest', 'same', 'one.txt'), 'utf8').catch(() => fs.readFile(path.join(root, 'same', 'one.txt'), 'utf8'));
  const second = await fs.readFile(path.join(root, 'dest', 'same', 'two.txt'), 'utf8').catch(() => fs.readFile(path.join(root, 'other', 'same', 'two.txt'), 'utf8'));
  assert.equal(first, 'first');
  assert.equal(second, 'second');
});

test('restoring a folder rejects an existing empty folder and preserves trash', async t => {
  const { root, storage } = await fixture(t);
  await fs.mkdir(path.join(root, 'folder'));
  await fs.writeFile(path.join(root, 'folder', 'data.txt'), 'original');
  const deleted = await storage.trash('folder');
  await fs.mkdir(path.join(root, 'folder'));
  await assert.rejects(storage.restore(deleted.id), { status: 409 });
  assert.deepEqual(await fs.readdir(path.join(root, 'folder')), []);
  assert.deepEqual((await storage.listTrash()).map(entry => entry.id), [deleted.id]);
});

test('failed folder copy leaves the queue available for a later mutation', async t => {
  const { root, storage } = await fixture(t);
  await fs.mkdir(path.join(root, 'source'));
  await fs.mkdir(path.join(root, 'dest'));
  await fs.writeFile(path.join(root, 'source', 'blocked.exe'), 'data');
  const failed = storage.copyFolder('source', 'dest');
  const next = storage.mkdir('dest', 'after');
  await assert.rejects(failed, { status: 400 });
  assert.equal((await next).path, 'dest/after');
  assert.deepEqual(await fs.readdir(path.join(root, 'dest')), ['after']);
  assert.equal(await fs.readFile(path.join(root, 'source', 'blocked.exe'), 'utf8'), 'data');
});

test('concurrent folder creation and move do not replace the created folder', async t => {
  const { root, storage } = await fixture(t);
  await fs.mkdir(path.join(root, 'source', 'same'), { recursive: true });
  await fs.mkdir(path.join(root, 'dest'));
  await fs.writeFile(path.join(root, 'source', 'same', 'data.txt'), 'data');
  const created = storage.mkdir('dest', 'same');
  const moved = storage.moveFolder('source/same', 'dest');
  assert.equal((await created).path, 'dest/same');
  await assert.rejects(moved, { status: 409 });
  assert.deepEqual(await fs.readdir(path.join(root, 'dest', 'same')), []);
  assert.equal(await fs.readFile(path.join(root, 'source', 'same', 'data.txt'), 'utf8'), 'data');
});

test('folder copy rejects nested symbolic links and leaves no partial destination', async t => {
  const { base, root, storage } = await fixture(t);
  await fs.mkdir(path.join(root, 'source', 'nested'), { recursive: true });
  await fs.mkdir(path.join(root, 'dest'));
  await fs.writeFile(path.join(base, 'outside.txt'), 'outside');
  try { await fs.symlink(path.join(base, 'outside.txt'), path.join(root, 'source', 'nested', 'link.txt')); }
  catch (error) { if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) return t.skip('symlinks unavailable'); throw error; }
  await assert.rejects(storage.copyFolder('source', 'dest'), { status: 400 });
  assert.deepEqual(await fs.readdir(path.join(root, 'dest')), []);
  assert.equal(await fs.readFile(path.join(base, 'outside.txt'), 'utf8'), 'outside');
});
