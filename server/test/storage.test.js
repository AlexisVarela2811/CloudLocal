const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { createStorage, StorageError } = require('../src/storage');

async function fixture(t) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'cloudlocal-storage-'));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const root = path.join(base, 'uploads');
  await fs.mkdir(root);
  return { base, root, storage: createStorage(root) };
}

async function rejected(promise, status) {
  await assert.rejects(promise, error => error instanceof StorageError && error.status === status);
}

test('lists existing files, folders and their filesystem metadata without exposing internal state', async t => {
  const { root, storage } = await fixture(t);
  await fs.writeFile(path.join(root, 'legacy.txt'), 'old');
  const folder = await storage.mkdir('', 'photos');
  assert.equal(folder.path, 'photos');
  assert.equal(folder.type, 'directory');
  assert.deepEqual(await storage.list('photos'), []);
  const entries = await storage.list();
  assert.deepEqual(entries.map(e => [e.name, e.path, e.type]), [
    ['legacy.txt', 'legacy.txt', 'file'], ['photos', 'photos', 'directory']
  ]);
  assert.equal(entries[0].size, 3);
  assert.ok(!Number.isNaN(Date.parse(entries[0].modifiedAt)));
  assert.equal(entries[1].size, 0);
  assert.equal(await fs.readFile(await storage.resolveFile('legacy.txt'), 'utf8'), 'old');
  await rejected(storage.mkdir('', 'photos'), 409);
  assert.deepEqual((await storage.list()).map(e => e.name), ['legacy.txt', 'photos']);
});

test('imports nested files without overwrite, cleans temporary uploads, and survives recreation', async t => {
  const { root, storage } = await fixture(t);
  await storage.mkdir('', 'work');
  const first = path.join(storage.tempDir, 'first');
  await fs.writeFile(first, 'one');
  const entry = await storage.importFile(first, 'work', 'report.txt');
  assert.deepEqual([entry.name, entry.path, entry.type, entry.size], ['report.txt', 'work/report.txt', 'file', 3]);
  await assert.rejects(fs.stat(first), { code: 'ENOENT' });
  const second = path.join(storage.tempDir, 'second');
  await fs.writeFile(second, 'two');
  await rejected(storage.importFile(second, 'work', 'report.txt'), 409);
  await assert.rejects(fs.stat(second), { code: 'ENOENT' });
  assert.equal(await fs.readFile(path.join(root, 'work', 'report.txt'), 'utf8'), 'one');
  assert.deepEqual((await createStorage(root).list('work')).map(e => e.name), ['report.txt']);
});

test('invalid names, folders and internal paths cannot change stored content', async t => {
  const { root, storage } = await fixture(t);
  await fs.writeFile(path.join(root, 'safe.txt'), 'safe');
  for (const bad of ['../escape', '/absolute', 'a\\b', 'a\u0001b', '.cloudlocal', 'CON.txt', 'name.', 'x'.repeat(256)]) {
    await rejected(storage.mkdir('', bad), 400);
    const temp = path.join(storage.tempDir, `rejected-${Math.random()}`);
    await fs.writeFile(temp, 'bad');
    await rejected(storage.importFile(temp, '', bad), 400);
    await assert.rejects(fs.stat(temp), { code: 'ENOENT' });
    await rejected(storage.resolveFile(bad), 400);
  }
  for (const bad of ['../', '.cloudlocal/tmp', 'safe.txt/sub', 'C:/windows', 'a//b']) {
    await rejected(storage.list(bad), 400);
  }
  await rejected(storage.trash('.cloudlocal/tmp'), 400);
  assert.deepEqual((await storage.list()).map(e => e.name), ['safe.txt']);
  assert.deepEqual(await storage.listTrash(), []);
  assert.equal(await fs.readFile(path.join(root, 'safe.txt'), 'utf8'), 'safe');
});

test('case variants of internal paths are reserved without changing files or trash', async t => {
  const { root, storage } = await fixture(t);
  const variant = path.join(root, '.CLOUDLOCAL');
  await fs.mkdir(path.join(variant, 'trash'), { recursive: true });
  const sentinel = path.join(variant, 'trash', 'sentinel');
  await fs.writeFile(sentinel, 'private');
  await rejected(storage.resolveFile('.CLOUDLOCAL/trash/sentinel'), 400);
  await rejected(storage.list('.CLOUDLOCAL/trash'), 400);
  assert.deepEqual(await storage.list(), []);
  assert.deepEqual(await storage.listTrash(), []);
  assert.equal(await fs.readFile(sentinel, 'utf8'), 'private');
});

test('symlinks cannot be listed, resolved, imported through, or trashed', async t => {
  const { base, root, storage } = await fixture(t);
  const outside = path.join(base, 'outside.txt');
  await fs.writeFile(outside, 'outside');
  try {
    await fs.symlink(outside, path.join(root, 'alias'));
    await fs.symlink(base, path.join(root, 'linked-dir'), 'dir');
  } catch (error) {
    if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) return t.skip('symlinks unavailable');
    throw error;
  }
  await rejected(storage.list(), 400);
  await rejected(storage.resolveFile('alias'), 400);
  await rejected(storage.trash('alias'), 400);
  await rejected(storage.list('linked-dir'), 400);
  await rejected(storage.resolveFile('linked-dir/outside.txt'), 400);
  const temp = path.join(storage.tempDir, 'unsafe');
  await fs.writeFile(temp, 'data');
  await rejected(storage.importFile(temp, 'linked-dir', 'file'), 400);
  await assert.rejects(fs.stat(temp), { code: 'ENOENT' });
  const tempLink = path.join(storage.tempDir, 'linked-upload');
  await fs.symlink(outside, tempLink);
  await rejected(storage.importFile(tempLink, '', 'injected'), 400);
  await assert.rejects(fs.lstat(tempLink), { code: 'ENOENT' });
  assert.equal(await fs.readFile(outside, 'utf8'), 'outside');
  assert.deepEqual(await storage.listTrash(), []);
});

test('trash and restore round-trip persist with collision protection; directories are rejected', async t => {
  const { root, storage } = await fixture(t);
  await storage.mkdir('', 'folder');
  await fs.writeFile(path.join(root, 'folder', 'file.txt'), 'original');
  await rejected(storage.trash('folder'), 400);
  const deleted = await storage.trash('folder/file.txt');
  assert.equal(deleted.name, 'file.txt');
  assert.equal(deleted.path, 'folder/file.txt');
  assert.ok(deleted.id);
  assert.ok(!Number.isNaN(Date.parse(deleted.deletedAt)));
  await assert.rejects(fs.stat(path.join(root, 'folder', 'file.txt')), { code: 'ENOENT' });
  assert.deepEqual(await createStorage(root).listTrash(), [deleted]);
  await fs.writeFile(path.join(root, 'folder', 'file.txt'), 'new');
  await rejected(storage.restore(deleted.id), 409);
  assert.deepEqual(await storage.listTrash(), [deleted]);
  assert.equal(await fs.readFile(path.join(root, 'folder', 'file.txt'), 'utf8'), 'new');
  await fs.unlink(path.join(root, 'folder', 'file.txt'));
  const restored = await storage.restore(deleted.id);
  assert.equal(restored.path, 'folder/file.txt');
  assert.equal(await fs.readFile(path.join(root, 'folder', 'file.txt'), 'utf8'), 'original');
  assert.deepEqual(await storage.listTrash(), []);
});

test('failed imports clean their temporary file without changing storage', async t => {
  const { base, root, storage } = await fixture(t);
  const temp = path.join(storage.tempDir, 'missing-folder');
  await fs.writeFile(temp, 'payload');
  await rejected(storage.importFile(temp, 'not-there', 'file'), 404);
  await assert.rejects(fs.stat(temp), { code: 'ENOENT' });
  const outside = path.join(base, 'outside');
  await fs.writeFile(outside, 'outside');
  await rejected(storage.importFile(outside, '', 'file'), 400);
  assert.equal(await fs.readFile(outside, 'utf8'), 'outside');
  assert.deepEqual(await storage.list(), []);
  assert.deepEqual(await storage.listTrash(), []);
  await rejected(storage.restore('../bad-id'), 400);
});

test('usage reports filesystem bytes, not a fabricated capacity', async t => {
  const { storage } = await fixture(t);
  const { total, free } = await storage.usage();
  assert.ok(Number.isFinite(total) && total > 0);
  assert.ok(Number.isFinite(free) && free >= 0 && free <= total);
});
