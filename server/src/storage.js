const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const zlib = require('node:zlib');

class StorageError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'StorageError';
    this.status = status;
    this.statusCode = status;
  }
}

const reserved = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
const invalid = /[<>:"\\|?*\x00-\x1f\x7f]/;

function component(value) {
  if (typeof value !== 'string' || !value || value === '.' || value === '..' ||
      value.toLowerCase() === '.cloudlocal' || value.includes('/') || invalid.test(value) ||
      /[. ]$/.test(value) || reserved.test(value) || Buffer.byteLength(value, 'utf8') > 255) {
    throw new StorageError('Invalid storage path');
  }
  return value;
}

function segments(relative, allowRoot = false) {
  if (typeof relative !== 'string' || (!relative && !allowRoot)) {
    throw new StorageError('Invalid storage path');
  }
  return relative === '' ? [] : relative.split('/').map(component);
}

function filesystemError(error) {
  if (error instanceof StorageError) return error;
  if (error.code === 'ENOENT') return new StorageError('File or folder not found', 404);
  if (error.code === 'EEXIST') return new StorageError('File or folder already exists', 409);
  if (error.code === 'ENOTDIR' || error.code === 'ELOOP') return new StorageError('Invalid storage path');
  return error;
}

function ensureDirectorySync(location) {
  try {
    const info = fs.lstatSync(location);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new StorageError('Invalid storage path');
  } catch (error) {
    if (error.code !== 'ENOENT') throw filesystemError(error);
    fs.mkdirSync(location);
  }
}

function createStorage(root) {
  if (typeof root !== 'string' || !root) throw new StorageError('Invalid storage root');
  const directory = path.resolve(root);
  ensureDirectorySync(directory);
  const internal = path.join(directory, '.cloudlocal');
  ensureDirectorySync(internal);
  const tempDir = path.join(internal, 'tmp');
  const trashDir = path.join(internal, 'trash');
  ensureDirectorySync(tempDir);
  ensureDirectorySync(trashDir);

  // Walk with lstat rather than stat: following a symlink at any level would leave the root.
  async function locate(parts, type) {
    let current = directory;
    for (const [index, part] of parts.entries()) {
      current = path.join(current, part);
      const info = await fsp.lstat(current).catch(error => { throw filesystemError(error); });
      if (info.isSymbolicLink()) throw new StorageError('Symbolic links are not allowed');
      if (index < parts.length - 1 && !info.isDirectory()) throw new StorageError('Expected a directory');
    }
    const info = await fsp.lstat(current).catch(error => { throw filesystemError(error); });
    if (type === 'directory' && !info.isDirectory()) throw new StorageError('Expected a directory');
    if (type === 'file' && !info.isFile()) throw new StorageError('Expected a file');
    return { absolute: current, info };
  }

  async function entry(parent, name, info) {
    return {
      name,
      path: [...parent, name].join('/'),
      type: info.isDirectory() ? 'directory' : 'file',
      size: info.isFile() ? info.size : 0,
      modifiedAt: info.mtime.toISOString()
    };
  }

  async function list(folder = '') {
    const parts = segments(folder, true);
    const { absolute } = await locate(parts, 'directory');
    try {
      const names = await fsp.readdir(absolute);
      const result = [];
      for (const name of names.sort()) {
        if (parts.length === 0 && name.toLowerCase() === '.cloudlocal') continue;
        const { info } = await locate([...parts, name]);
        if (!info.isFile() && !info.isDirectory()) throw new StorageError('Unsupported storage entry');
        const item = await entry(parts, name, info);
        if (item.type === 'directory') {
          item.children = await fsp.readdir(path.join(absolute, name))
            .then(names => names.length)
            .catch(() => 0);
        }
        result.push(item);
      }
      return result;
    } catch (error) { throw filesystemError(error); }
  }

  async function mkdir(folder, name) {
    const parts = segments(folder, true);
    component(name);
    const { absolute } = await locate(parts, 'directory');
    const target = path.join(absolute, name);
    try {
      await fsp.mkdir(target);
      const { info } = await locate([...parts, name], 'directory');
      return entry(parts, name, info);
    } catch (error) { throw filesystemError(error); }
  }

  async function resolveFile(relativePath) {
    return (await locate(segments(relativePath), 'file')).absolute;
  }

  async function moveExclusive(source, destination) {
    // Hard links: atomic move with fallback; protects data if unlink fails
    await fsp.link(source, destination);
    try {
      await fsp.unlink(source);
    } catch (error) {
      await fsp.unlink(destination).catch(() => {});
      throw error;
    }
  }

  async function moveIntoTrash(source, destination) {
    const info = await fsp.lstat(source);
    if (info.isDirectory()) await fsp.rename(source, destination);
    else await moveExclusive(source, destination);
  }

  async function renameFile(source, destination) {
    // Simple rename for move API; caller must verify destination does not exist
    await fsp.rename(source, destination);
  }

  async function importFile(tempPath, folder, originalName) {
    // Only files in our upload temp directory are owned by this method for cleanup.
    const owned = typeof tempPath === 'string' && path.dirname(path.resolve(tempPath)) === tempDir;
    try {
      if (!owned) throw new StorageError('Upload must be in the storage temporary directory');
      const parts = segments(folder, true);
      component(originalName);
      const { absolute } = await locate(parts, 'directory');
      const info = await fsp.lstat(tempPath).catch(error => { throw filesystemError(error); });
      if (!info.isFile() || info.isSymbolicLink()) throw new StorageError('Invalid temporary upload');
      await moveExclusive(tempPath, path.join(absolute, originalName));
      return entry(parts, originalName, info);
    } catch (error) { throw filesystemError(error); }
    finally {
      if (owned) await fsp.unlink(tempPath).catch(error => {
        if (error.code !== 'ENOENT') throw error;
      });
    }
  }

  function validId(id) {
    if (typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      throw new StorageError('Invalid trash id');
    }
    return id;
  }

  async function trash(relativePath) {
    const parts = segments(relativePath);
    const { absolute, info } = await locate(parts);
    if (!info.isFile() && !info.isDirectory()) throw new StorageError('Unsupported storage entry');
    const id = randomUUID();
    const record = {
      id,
      name: parts.at(-1),
      path: parts.join('/'),
      type: info.isDirectory() ? 'directory' : 'file',
      deletedAt: new Date().toISOString()
    };
    const meta = path.join(trashDir, `${id}.json`);
    const payload = path.join(trashDir, id);
    try {
      await fsp.writeFile(meta, JSON.stringify(record), { flag: 'wx' });
      try { await moveIntoTrash(absolute, payload); }
      catch (error) { await fsp.unlink(meta); throw error; }
      return record;
    } catch (error) { throw filesystemError(error); }
  }

  async function getTrash(id) {
    validId(id);
    const meta = path.join(trashDir, `${id}.json`);
    const payload = path.join(trashDir, id);
    try {
      const metaInfo = await fsp.lstat(meta);
      const info = await fsp.lstat(payload);
      const payloadValid = (info.isFile() || info.isDirectory()) && !info.isSymbolicLink();
      if (!metaInfo.isFile() || metaInfo.isSymbolicLink() || !payloadValid) {
        throw new StorageError('Invalid trash entry');
      }
      const record = JSON.parse(await fsp.readFile(meta, 'utf8'));
      if (record.id !== id || segments(record.path).join('/') !== record.path ||
          record.name !== record.path.split('/').at(-1)) throw new StorageError('Invalid trash entry');
      return record;
    } catch (error) { throw filesystemError(error); }
  }

  async function listTrash() {
    const names = await fsp.readdir(trashDir);
    const records = [];
    for (const name of names.sort()) {
      if (!name.endsWith('.json')) continue;
      try { records.push(await getTrash(name.slice(0, -5))); }
      catch (error) {
        if (error.status === 404) continue; // metadata may precede the move
        throw error;
      }
    }
    return records;
  }

  async function restore(id) {
    const record = await getTrash(id);
    const parts = segments(record.path);
    const { absolute: parent } = await locate(parts.slice(0, -1), 'directory');
    const target = path.join(parent, parts.at(-1));
    try {
      const payloadPath = path.join(trashDir, id);
      const payloadInfo = await fsp.lstat(payloadPath);
      if (payloadInfo.isDirectory()) await fsp.rename(payloadPath, target);
      else await moveExclusive(payloadPath, target);
      await fsp.unlink(path.join(trashDir, `${id}.json`));
      const { info } = await locate(parts);
      return entry(parts.slice(0, -1), parts.at(-1), info);
    } catch (error) { throw filesystemError(error); }
  }

  async function usage() {
    const { bsize, blocks, bavail } = await fsp.statfs(directory);
    return { total: bsize * blocks, free: bsize * bavail };
  }

  async function move(relativePath, targetFolder, newName) {
    const parts = segments(relativePath);
    let source;
    try {
      const result = await locate(parts, 'file');
      source = result.absolute;
    } catch {
      const result = await locate(parts, 'directory');
      source = result.absolute;
    }
    const targetParts = segments(targetFolder, true);
    const { absolute: targetDir } = await locate(targetParts, 'directory');
    const targetName = newName || parts.at(-1);
    const target = path.join(targetDir, targetName);
    try {
      const targetInfo = await fsp.lstat(target);
      if (targetInfo.isFile()) throw new StorageError('Destination already exists', 409);
      if (targetInfo.isDirectory()) throw new StorageError('Destination is a directory', 400);
    } catch (error) {
      if (error.code !== 'ENOENT') throw filesystemError(error);
    }
    await renameFile(source, target);
    const info = await fsp.lstat(target);
    return entry(targetParts, targetName, info);
  }

  async function moveFolder(relativePath, targetFolder, newName) {
    const parts = segments(relativePath);
    const { absolute: source } = await locate(parts, 'directory');
    const targetParts = segments(targetFolder, true);
    const { absolute: targetDir } = await locate(targetParts, 'directory');
    const targetName = newName || parts.at(-1);
    const target = path.join(targetDir, targetName);
    try {
      const targetInfo = await fsp.lstat(target);
      if (targetInfo.isDirectory()) throw new StorageError('Destination already exists', 409);
    } catch (error) {
      if (error.code !== 'ENOENT') throw filesystemError(error);
    }
    await renameFile(source, target);
    const info = await fsp.lstat(target);
    return entry(targetParts, targetName, info);
  }

  const RESERVED_EXTENSIONS = new Set(['exe', 'bat', 'cmd', 'scr', 'vbs', 'js', 'ps1', 'reg']);

  function validateExtension(name) {
    const ext = path.extname(name).slice(1).toLowerCase();
    if (ext && RESERVED_EXTENSIONS.has(ext)) {
      throw new StorageError('File type not allowed', 400);
    }
  }

  async function copy(relativePath, targetFolder, newName) {
    const parts = segments(relativePath);
    const { absolute: source } = await locate(parts, 'file');
    const targetParts = segments(targetFolder, true);
    const { absolute: targetDir } = await locate(targetParts, 'directory');
    const targetName = newName || parts.at(-1);
    validateExtension(targetName);
    let target = path.join(targetDir, targetName);
    // Handle collision: append (1), (2), etc.
    try {
      const existing = await fsp.lstat(target);
      if (existing.isFile() || existing.isDirectory()) {
        const baseName = path.basename(targetName, path.extname(targetName));
        const ext = path.extname(targetName);
        let counter = 1;
        do {
          target = path.join(targetDir, `${baseName} (${counter})${ext}`);
          counter++;
          await fsp.lstat(target);
        } while (true); // lstat throws on ENOENT, we catch and continue
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw filesystemError(error);
    }
    await fsp.copyFile(source, target);
    const info = await fsp.lstat(target);
    return entry(targetParts, path.basename(target), info);
  }

  async function copyFolder(from, to, newName) {
    const parts = segments(from);
    const { absolute: source } = await locate(parts, 'directory');
    const targetParts = segments(to, true);
    const { absolute: targetDir } = await locate(targetParts, 'directory');
    const targetName = newName || parts.at(-1);
    let target = path.join(targetDir, targetName);
    try {
      const existing = await fsp.lstat(target);
      if (existing.isDirectory()) {
        const baseName = path.basename(targetName, path.extname(targetName));
        const ext = path.extname(targetName);
        let counter = 1;
        do {
          target = path.join(targetDir, `${baseName} (${counter})${ext}`);
          counter++;
          await fsp.lstat(target);
        } while (true);
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw filesystemError(error);
    }
    await fsp.mkdir(target);
    const entries = await fsp.readdir(source);
    for (const name of entries) {
      const src = path.join(source, name);
      const dst = path.join(target, name);
      const info = await fsp.lstat(src);
      if (info.isDirectory()) {
        // Copy subfolder recursively
        await fsp.mkdir(dst);
        await _copyFolderRecursive(src, dst);
      } else {
        validateExtension(name);
        await fsp.copyFile(src, dst);
      }
    }
    const info = await fsp.lstat(target);
    return entry(targetParts, targetName, info);
  }

  async function _copyFolderRecursive(src, dst) {
    const entries = await fsp.readdir(src);
    for (const name of entries) {
      const srcEntry = path.join(src, name);
      const dstEntry = path.join(dst, name);
      const info = await fsp.lstat(srcEntry);
      if (info.isDirectory()) {
        await fsp.mkdir(dstEntry);
        await _copyFolderRecursive(srcEntry, dstEntry);
      } else {
        validateExtension(name);
        await fsp.copyFile(srcEntry, dstEntry);
      }
    }
  }

  async function permanentDelete(id) {
    validId(id);
    const meta = path.join(trashDir, `${id}.json`);
    const payload = path.join(trashDir, id);
    try {
      const info = await fsp.lstat(payload);
      if (info.isDirectory()) await fsp.rm(payload, { recursive: true, force: true });
      else await fsp.unlink(payload);
    } catch (error) {
      if (error.code !== 'ENOENT') throw filesystemError(error);
    }
    try {
      await fsp.unlink(meta);
    } catch (error) {
      if (error.code !== 'ENOENT') throw filesystemError(error);
    }
    return { id };
  }

  async function emptyTrash() {
    const names = await fsp.readdir(trashDir);
    const deletedIds = [];
    for (const name of names) {
      if (name.endsWith('.json')) {
        const id = name.slice(0, -5);
        try {
          const payload = path.join(trashDir, id);
          const payloadInfo = await fsp.lstat(payload).catch(() => null);
          if (payloadInfo?.isDirectory()) await fsp.rm(payload, { recursive: true, force: true });
          else await fsp.unlink(payload);
          await fsp.unlink(path.join(trashDir, name));
          deletedIds.push(id);
        } catch (error) {
          if (error.code !== 'ENOENT') throw filesystemError(error);
        }
      }
    }
    return { deleted: deletedIds.length };
  }

  return { tempDir, list, mkdir, importFile, resolveFile, trash, listTrash, restore, usage,
    move, moveFolder, copy, copyFolder, permanentDelete, emptyTrash, validateExtension };
}

// CRC32 lookup table
const _crcTable = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[i] = c;
  }
  return table;
})();

function crc32(data) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < data.length; i++) {
    crc = _crcTable[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

async function buildZipArchive(files) {
  // files: [{ name: string, data: Buffer }]
  const result = [];
  let fileOffset = 0;
  const centralDirs = [];

  for (const { name, data } of files) {
    const nameBuf = Buffer.from(name, 'utf8');
    const compressed = zlib.deflateSync(data, { level: 9 });
    const crc = crc32(data);

    // Local file header (30 bytes + name)
    const localSize = 30 + nameBuf.length;
    const localHeader = Buffer.alloc(localSize);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(8, 8);
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(0, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(compressed.length, 18);
    localHeader.writeUInt32LE(data.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28);
    nameBuf.copy(localHeader, 30);
    result.push(localHeader, compressed);

    // Central directory entry (46 bytes + name)
    const centralSize = 46 + nameBuf.length;
    const centralHeader = Buffer.alloc(centralSize);
    centralHeader.writeUInt32LE(0x02044b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(8, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(compressed.length, 20);
    centralHeader.writeUInt32LE(data.length, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    // relative offset of local file header from start of archive
    centralHeader.writeUInt32LE(fileOffset, 34);
    nameBuf.copy(centralHeader, 46);
    centralDirs.push(centralHeader);

    fileOffset += localSize + compressed.length;
  }

  const centralDirOffset = fileOffset;
  let centralDirSize = 0;
  for (const h of centralDirs) {
    result.push(h);
    centralDirSize += h.length;
  }

  // End of central directory record (22 bytes)
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(centralDirs.length, 8);
  eocd.writeUInt16LE(centralDirs.length, 10);
  eocd.writeUInt32LE(centralDirSize, 12);
  eocd.writeUInt32LE(centralDirOffset, 16);
  eocd.writeUInt16LE(0, 20);
  result.push(eocd);

  return Buffer.concat(result);
}

module.exports = { createStorage, StorageError, buildZipArchive, crc32 };
