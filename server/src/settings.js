const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

const SETTINGS_FILE = 'settings.json';
const MAX_PATH_LENGTH = 1024;
const RESERVED_DIR_NAMES = new Set(['.cloudlocal-state', '.cloudlocal', 'node_modules']);

class SettingsError extends Error {
  constructor(message, code) { super(message); this.name = 'SettingsError'; this.code = code; }
}

function isOverlap(a, b) {
  const x = process.platform === 'win32' ? a.toLowerCase() : a;
  const y = process.platform === 'win32' ? b.toLowerCase() : b;
  return x === y || x.startsWith(y + path.sep) || y.startsWith(x + path.sep);
}

function createSettings(stateDir, uploadDir) {
  const filePath = path.join(stateDir, SETTINGS_FILE);
  let inMemory = null;
  let currentUploadDir = uploadDir;

  async function load() {
    if (inMemory !== null) return inMemory;
    try {
      const stat = await fsp.stat(filePath);
      if (!stat.isFile()) throw new SettingsError('Invalid settings file', 'INVALID_FILE');
      const text = await fsp.readFile(filePath, 'utf8');
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed === 'object' && parsed.folderPath) {
        inMemory = parsed;
        return parsed;
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw new SettingsError('Settings file corrupted', 'CORRUPT_SETTINGS');
    }
    inMemory = null;
    return null;
  }

  async function save(value) {
    await fsp.mkdir(stateDir, { recursive: true, mode: 0o700 });
    await fsp.writeFile(filePath, JSON.stringify(value), { encoding: 'utf8', mode: 0o600 });
    inMemory = value;
  }

  async function clear() {
    inMemory = null;
    try { await fsp.unlink(filePath); } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }

  function currentSaved() { return inMemory; }
  function getCurrentUploadDir() { return currentUploadDir; }
  function setCurrentUploadDir(dir) { currentUploadDir = dir; }

  async function validateNewPath(newPath) {
    if (!newPath || typeof newPath !== 'string') throw new SettingsError('Invalid path', 'INVALID_PATH');
    if (newPath.length > MAX_PATH_LENGTH) throw new SettingsError('Path too long', 'PATH_TOO_LONG');
    if (!path.isAbsolute(newPath)) throw new SettingsError('Path must be absolute', 'INVALID_PATH');
    for (const seg of newPath.split(path.sep)) {
      if (seg && RESERVED_DIR_NAMES.has(seg.toLowerCase())) throw new SettingsError('Cannot use reserved directory name', 'INVALID_PATH');
    }
    if (isOverlap(newPath, stateDir) || isOverlap(newPath, currentUploadDir)) {
      throw new SettingsError('Storage folder cannot be inside server directories', 'INVALID_PATH');
    }
    const stat = await fsp.stat(newPath).catch(error => {
      if (error.code === 'ENOENT' || error.code === 'EACCES') throw new SettingsError('Directory does not exist or is not accessible', 'NOT_A_DIRECTORY');
      throw error;
    });
    if (!stat.isDirectory()) throw new SettingsError('Path is not a directory', 'NOT_A_DIRECTORY');
    const lstat = await fsp.lstat(newPath);
    if (lstat.isSymbolicLink()) throw new SettingsError('Symbolic links are not allowed', 'INVALID_PATH');
    return true;
  }

  return { load, save, clear, validateNewPath, currentSaved, getCurrentUploadDir, setCurrentUploadDir };
}

module.exports = { createSettings, SettingsError };