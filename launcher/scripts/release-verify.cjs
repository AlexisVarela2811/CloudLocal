#!/usr/bin/env node
'use strict';

// launcher/scripts/release-verify.cjs — verifies a release candidate directory
// for integrity, provenance, platform layout and file modes.
//
// The payload differs per platform (loose .exe, .app bundle, Linux extras), so
// release-layout.cjs provides both the expected file list and the names checked
// structurally here.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const layout = require('./release-layout.cjs');

const LAYOUT = layout.layoutFor(process.platform);
const PLATFORM_ID = LAYOUT ? LAYOUT.id : 'unsupported (' + process.platform + ')';

// Every file the candidate must carry, SHA256SUMS included.
const ALLOWED_FILES = LAYOUT ? [...layout.payloadPaths(LAYOUT), 'SHA256SUMS'] : [];
const ALLOWED_SET = new Set(ALLOWED_FILES);
// Everything SHA256SUMS has to cover: the payload except SHA256SUMS itself.
const CHECKSUMMED_FILES = ALLOWED_FILES.filter(file => file !== 'SHA256SUMS');
// Directories the payload needs (nested paths only exist in the macOS bundle).
const ALLOWED_DIRS = new Set();
for (const file of ALLOWED_FILES) {
  const parts = file.split('/');
  for (let index = 1; index < parts.length; index++) {
    ALLOWED_DIRS.add(parts.slice(0, index).join('/'));
  }
}

// Unix modes the extracted archive must keep. Windows has no mode bits, so the
// check only applies where the archive tools preserve them.
const EXECUTABLE_MODE = 0o755;
const FILE_MODE = 0o644;
const MODES_MEANINGFUL = process.platform !== 'win32';

const REQUIRED_FIELDS = [
  'name', 'version', 'productVersion', 'platform', 'arch',
  'unsigned', 'unsignedNote', 'sha256', 'git', 'files', 'builtAt',
];

const REQUIRED_GIT_FIELDS = ['commit', 'branch', 'dirty'];

const USAGE = 'Usage: node launcher/scripts/release-verify.cjs <candidate-directory> [--archive <candidate.zip>]';

let _errors = 0;

function sha256file(filePath) {
  const data = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(data).digest('hex');
}

function fail(msg) {
  console.error('FAIL: ' + msg);
  _errors++;
}

function pass(msg) {
  console.log('PASS: ' + msg);
}

function isRegularFile(filePath) {
  try {
    return fs.lstatSync(filePath).isFile();
  } catch {
    return false;
  }
}

function printHelp() {
  console.log(USAGE);
  console.log('       node launcher/scripts/release-verify.cjs --help');
  console.log('');
  console.log('Verify a release candidate directory for integrity, provenance and layout.');
  console.log('Host platform: ' + PLATFORM_ID);
  console.log('');
  console.log('Checks performed:');
  console.log('  - Candidate directory exists and is a directory');
  console.log('  - Payload files exist as regular files (no symlinks, no extra files or directories)');
  console.log('  - SHA256SUMS exists, covers exactly the payload, and every hash matches');
  console.log('  - candidate.json has all required provenance fields and a truthfully unsigned status');
  console.log('  - candidate.json payload list and executable path match the platform layout');
  console.log('  - Executable size floor (>= 64 KB)');
  if (MODES_MEANINGFUL) {
    console.log('  - File modes: ' + EXECUTABLE_MODE.toString(8) + ' for executables and installers,' +
      ' ' + FILE_MODE.toString(8) + ' for the rest');
  } else {
    console.log('  - File modes are not checked on Windows (no unix mode bits)');
  }
  if (LAYOUT && LAYOUT.kind === 'macos') {
    console.log('  - CloudLocal.app/Contents/Info.plist declares the executable, icon and version');
    console.log('  - CloudLocal.app/Contents/Resources/CloudLocal.icns is a valid Apple icon image');
  }
  if (LAYOUT && LAYOUT.kind === 'linux') {
    console.log('  - CloudLocal.desktop is a valid desktop entry (Exec/Icon/Type)');
    console.log('  - cloudlocal.png is a native 256x256 PNG');
    console.log('  - install.sh is a POSIX shell script with an --uninstall mode');
  }
  console.log('  - With --archive: the .zip holds exactly the payload and keeps its modes');
  console.log('');
  console.log('Allowed payload files (' + PLATFORM_ID + '):');
  for (const file of ALLOWED_FILES) console.log('  ' + file);
  console.log('');
  console.log('Path handling:');
  console.log('  Absolute or relative candidate directory paths are accepted.');
  console.log('  Path traversal (..), absolute paths and backslashes in SHA256SUMS are rejected.');
  process.exitCode = 0;
}

// Walks the candidate without following links. A symlink or a special file is a
// payload problem, not a file to hash.
function scanCandidate(root) {
  const files = [];
  const dirs = [];
  const problems = [];
  function walk(dir, prefix) {
    for (const name of fs.readdirSync(dir).sort()) {
      const full = path.join(dir, name);
      const relative = prefix ? prefix + '/' + name : name;
      const stat = fs.lstatSync(full);
      if (stat.isSymbolicLink()) problems.push('symlink in payload: ' + relative);
      else if (stat.isDirectory()) {
        dirs.push(relative);
        walk(full, relative);
      } else if (stat.isFile()) files.push(relative);
      else problems.push('special file in payload: ' + relative);
    }
  }
  walk(root, '');
  return { files, dirs, problems };
}

function checkLayoutFiles(candidateDir) {
  const scan = scanCandidate(candidateDir);
  for (const problem of scan.problems) fail(problem);

  const actualFiles = new Set(scan.files);
  for (const file of scan.files) {
    if (!ALLOWED_SET.has(file)) fail('Disallowed file in candidate: ' + file);
  }
  for (const file of ALLOWED_FILES) {
    if (!actualFiles.has(file)) fail('Missing required allowed file: ' + file);
  }
  for (const dir of scan.dirs) {
    if (!ALLOWED_DIRS.has(dir)) fail('Disallowed directory in candidate: ' + dir);
  }

  const unexpected = scan.files.filter(file => !ALLOWED_SET.has(file)).length
    + ALLOWED_FILES.filter(file => !actualFiles.has(file)).length
    + scan.dirs.filter(dir => !ALLOWED_DIRS.has(dir)).length
    + scan.problems.length;
  if (unexpected === 0) {
    pass('Allowlist complete — all ' + ALLOWED_FILES.length + ' required files present, no extras');
  }
  return scan;
}

// Mode bits of the payload files, as an extracting user would get them.
function checkModes(candidateDir) {
  if (!MODES_MEANINGFUL) {
    pass('File modes not enforced on Windows (the archive stores its own attributes)');
    return;
  }
  const expected = new Map();
  for (const file of CHECKSUMMED_FILES) {
    const executable = file === layout.APP_EXECUTABLE
      || file === layout.LINUX_BINARY
      || file === layout.LINUX_INSTALLER;
    expected.set(file, executable ? EXECUTABLE_MODE : FILE_MODE);
  }
  let allOk = true;
  for (const [file, mode] of expected) {
    const full = path.join(candidateDir, file);
    if (!isRegularFile(full)) continue; // reported by the allowlist check
    const actual = fs.statSync(full).mode & 0o777;
    if (actual !== mode) {
      fail('Wrong mode for ' + file + ': expected ' + mode.toString(8) + ', got ' + actual.toString(8));
      allOk = false;
    }
  }
  if (allOk) pass('File modes verified (0755 executables and installer, 0644 the rest)');
}

function checkChecksums(candidateDir) {
  const sumPath = path.join(candidateDir, 'SHA256SUMS');
  if (!fs.existsSync(sumPath)) {
    fail('SHA256SUMS not found');
    return;
  }
  if (!isRegularFile(sumPath)) {
    fail('SHA256SUMS is not a regular file');
    return;
  }
  const lines = fs.readFileSync(sumPath, 'utf-8').trim().split('\n').filter(line => line.trim().length > 0);
  const checked = new Set();
  let sumOk = true;

  for (const line of lines) {
    const match = /^([0-9a-f]{64})  (.+)$/.exec(line);
    if (!match) {
      fail('Invalid SHA256SUMS line: ' + line);
      sumOk = false;
      continue;
    }
    const [, expectedHash, fileName] = match;

    // Reject unsafe paths: traversal, absolute paths and Windows separators.
    if (fileName.includes('\\') || fileName.startsWith('/') || fileName.split('/').includes('..')) {
      fail('Unsafe filename in SHA256SUMS (path traversal): ' + fileName);
      sumOk = false;
      continue;
    }
    if (!ALLOWED_SET.has(fileName) || fileName === 'SHA256SUMS' || checked.has(fileName)) {
      fail('Unexpected or duplicate SHA256SUMS entry: ' + fileName);
      sumOk = false;
      continue;
    }
    const filePath = path.join(candidateDir, fileName);
    if (!fs.existsSync(filePath)) {
      fail('SHA256SUMS references missing file: ' + fileName);
      sumOk = false;
      continue;
    }
    if (!isRegularFile(filePath)) {
      fail('SHA256SUMS references non-regular file: ' + fileName);
      sumOk = false;
      continue;
    }
    const actualHash = sha256file(filePath);
    if (actualHash !== expectedHash) {
      fail('Checksum mismatch for ' + fileName + ': expected ' + expectedHash + ', got ' + actualHash);
      sumOk = false;
    } else {
      pass('SHA256 verified: ' + fileName);
    }
    checked.add(fileName);
  }

  for (const required of CHECKSUMMED_FILES) {
    if (!checked.has(required)) {
      fail('SHA256SUMS missing entry for required file: ' + required);
      sumOk = false;
    }
  }
  if (sumOk) pass('All SHA256SUMS entries verified and complete');
}

function checkProvenance(candidateDir) {
  const provPath = path.join(candidateDir, 'candidate.json');
  if (!fs.existsSync(provPath)) {
    fail('candidate.json not found');
    return;
  }
  if (!isRegularFile(provPath)) {
    fail('candidate.json is not a regular file');
    return;
  }
  let provData;
  try {
    provData = JSON.parse(fs.readFileSync(provPath, 'utf-8'));
  } catch (err) {
    fail('candidate.json is not valid JSON: ' + err.message);
    return;
  }

  let fieldsOk = true;
  for (const field of REQUIRED_FIELDS) {
    if (!(field in provData)) {
      fail('candidate.json missing required field: ' + field);
      fieldsOk = false;
    }
  }
  if (provData.git) {
    for (const field of REQUIRED_GIT_FIELDS) {
      if (!(field in provData.git)) {
        fail('candidate.json.git missing required field: ' + field);
        fieldsOk = false;
      }
    }
  } else {
    fail('candidate.json missing "git" section');
    fieldsOk = false;
  }
  if (provData.unsigned !== true) {
    fail('candidate.json "unsigned" is not true — expected truthful unsigned status');
    fieldsOk = false;
  }

  const declaredExecutable = typeof provData.files?.executable === 'string' ? provData.files.executable : '';
  const executable = path.join(candidateDir, declaredExecutable);
  if (provData.sha256 && isRegularFile(executable)) {
    const actualHash = sha256file(executable);
    if (provData.sha256 !== actualHash) {
      fail('candidate.json sha256 does not match actual ' + provData.files.executable + ' hash');
      fieldsOk = false;
    } else {
      pass('Provenance SHA-256 matches executable');
    }
  } else {
    fail('candidate.json sha256 has no matching executable to verify');
    fieldsOk = false;
  }

  // The declared executable and payload must be the platform layout's, so an
  // archive cannot claim a bundle or an installer that is not there.
  const expectedExecutable = LAYOUT.kind === 'macos' ? layout.APP_EXECUTABLE : LAYOUT.binary;
  if (provData.files?.executable !== expectedExecutable) {
    fail('candidate.json executable should be ' + expectedExecutable + ', got ' + provData.files?.executable);
    fieldsOk = false;
  }
  if (!Array.isArray(provData.payload)) {
    fail('candidate.json missing "payload" list');
    fieldsOk = false;
  } else {
    const declared = [...provData.payload].sort().join(',');
    const expected = [...CHECKSUMMED_FILES].sort().join(',');
    if (declared !== expected) {
      fail('candidate.json payload does not match the ' + PLATFORM_ID + ' layout');
      fieldsOk = false;
    }
  }

  if (provData.platform !== process.platform || provData.arch !== process.arch) {
    fail('candidate.json platform/arch should be ' + process.platform + '/' + process.arch +
      ', got ' + provData.platform + '/' + provData.arch);
    fieldsOk = false;
  }

  if (fieldsOk) {
    pass('candidate.json has all required provenance fields');
    pass('CloudLocal signing not performed (metadata); Authenticode status is not verified');
  }
}

function checkExecutableSize(candidateDir) {
  const exePath = path.join(candidateDir, LAYOUT.kind === 'macos' ? layout.APP_EXECUTABLE : LAYOUT.binary);
  const name = LAYOUT.kind === 'macos' ? layout.APP_EXECUTABLE : LAYOUT.binary;
  if (!fs.existsSync(exePath)) {
    fail(name + ' not found in candidate directory');
    return;
  }
  if (!isRegularFile(exePath)) {
    fail(name + ' is not a regular file (symlink or special)');
    return;
  }
  const size = fs.statSync(exePath).size;
  if (size < 64 * 1024) {
    fail(name + ' is suspiciously small (' + size + ' bytes) — likely not a valid executable');
    return;
  }
  pass(name + ' exists (' + size + ' bytes)');
}

// Structural problems of a macOS bundle; empty means the bundle is sound.
// Exported so the macOS path is testable on any host, not only on macOS CI.
function macBundleProblems(candidateDir) {
  const plistPath = path.join(candidateDir, layout.APP_INFO_PLIST);
  const plist = fs.readFileSync(plistPath, 'utf8');
  const value = key => (new RegExp('<key>' + key + '</key>\\s*<string>([^<]*)</string>').exec(plist) || [])[1];
  const problems = [];
  if (!/^<\?xml version="1\.0"/.test(plist) || !/<\/plist>\s*$/.test(plist)) {
    problems.push('Info.plist is not an XML property list');
  }
  if (value('CFBundleExecutable') !== path.basename(layout.APP_EXECUTABLE)) {
    problems.push('CFBundleExecutable must be ' + path.basename(layout.APP_EXECUTABLE));
  }
  if (value('CFBundleIconFile') !== path.basename(layout.APP_ICON)) {
    problems.push('CFBundleIconFile must be ' + path.basename(layout.APP_ICON));
  }
  if (value('CFBundlePackageType') !== 'APPL') problems.push('CFBundlePackageType must be APPL');
  if (!value('CFBundleIdentifier')) problems.push('CFBundleIdentifier is missing');
  let version = null;
  try {
    version = JSON.parse(fs.readFileSync(path.join(candidateDir, 'candidate.json'), 'utf8')).productVersion;
  } catch {
    // candidate.json is reported by the provenance check; the bundle is still verifiable.
  }
  if (version && value('CFBundleShortVersionString') !== version) {
    problems.push('CFBundleShortVersionString must be ' + version);
  }

  const icns = fs.readFileSync(path.join(candidateDir, layout.APP_ICON));
  if (icns.toString('ascii', 0, 4) !== 'icns') problems.push('icon is not an Apple icon image (.icns)');
  else if (icns.readUInt32BE(4) !== icns.length) problems.push('icon length header does not match its size');

  return problems;
}

// Structural problems of the Linux extras; empty means the payload is sound.
function linuxExtrasProblems(candidateDir) {
  const problems = [];
  const desktop = fs.readFileSync(path.join(candidateDir, layout.LINUX_DESKTOP_ENTRY), 'utf8');
  const field = key => {
    const match = new RegExp('^' + key + '=(.*)$', 'm').exec(desktop);
    return match ? match[1].trim() : undefined;
  };
  if (!/^\[Desktop Entry\]$/m.test(desktop)) problems.push('CloudLocal.desktop has no [Desktop Entry] group');
  if (field('Type') !== 'Application') problems.push('CloudLocal.desktop Type must be Application');
  if (!field('Exec')) problems.push('CloudLocal.desktop has no Exec line');
  if (field('Icon') !== path.basename(layout.LINUX_ICON, '.png')) {
    problems.push('CloudLocal.desktop Icon must be ' + path.basename(layout.LINUX_ICON, '.png'));
  }

  const png = fs.readFileSync(path.join(candidateDir, layout.LINUX_ICON));
  if (png.toString('hex', 0, 8) !== '89504e470d0a1a0a') problems.push('cloudlocal.png is not a PNG');
  else if (png.readUInt32BE(16) !== 256 || png.readUInt32BE(20) !== 256) {
    problems.push('cloudlocal.png must be 256x256');
  }

  const installer = fs.readFileSync(path.join(candidateDir, layout.LINUX_INSTALLER), 'utf8');
  if (!/^#!\/(usr\/)?bin\/sh/.test(installer) && !/^#!\/bin\/sh/.test(installer)) {
    problems.push('install.sh must be a POSIX shell script');
  }
  if (!/--uninstall/.test(installer)) problems.push('install.sh must document its --uninstall mode');

  return problems;
}

function report(problems, okMessage) {
  if (problems.length > 0) for (const problem of problems) fail(problem);
  else pass(okMessage);
}

// Reads the zip central directory: entry names plus the unix mode each entry
// stores, so the archive itself can be checked instead of trusting the tool.
function readZipEntries(zipPath) {
  const buffer = fs.readFileSync(zipPath);
  let eocd = -1;
  for (let index = buffer.length - 22; index >= 0; index--) {
    if (buffer.readUInt32LE(index) === 0x06054b50) { eocd = index; break; }
  }
  if (eocd < 0) throw new Error('not a zip archive (no end of central directory record)');
  const count = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  const entries = new Map();
  const duplicates = [];
  for (let index = 0; index < count; index++) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error('corrupt zip central directory');
    const crc32 = buffer.readUInt32LE(offset + 16);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const externalAttributes = buffer.readUInt32LE(offset + 38);
    const rawName = buffer.toString('utf8', offset + 46, offset + 46 + nameLength);
    const name = rawName.replace(/^\.\//, '');
    const unixMode = (externalAttributes >>> 16) & 0xffff;
    const fileType = unixMode & 0o170000;
    if (entries.has(name)) duplicates.push(name);
    entries.set(name, {
      mode: unixMode & 0o777,
      // 0o120000 is a symlink; anything that is not a regular file or a
      // directory has no place in a release payload.
      fileType: fileType === 0 ? 0o100000 : fileType,
      directory: rawName.endsWith('/'),
      crc32,
      uncompressedSize,
    });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return { entries, duplicates };
}

function checkArchive(candidateDir, zipPath) {
  let archive;
  try {
    archive = readZipEntries(zipPath);
  } catch (err) {
    fail('Cannot read archive ' + zipPath + ': ' + err.message);
    return;
  }
  const { entries, duplicates } = archive;
  if (duplicates.length > 0) {
    fail('Duplicate entries in archive: ' + duplicates.join(', '));
    return;
  }
  for (const [name, entry] of entries) {
    if (entry.directory) continue;
    if (entry.fileType !== 0o100000) {
      fail('Archive entry is not a regular file: ' + name +
        (entry.fileType === 0o120000 ? ' (symlink)' : ''));
    }
  }

  const files = [...entries].filter(([, entry]) => !entry.directory).map(([name]) => name).sort();
  const expected = [...ALLOWED_FILES].sort();
  if (files.join(',') !== expected.join(',')) {
    fail('Archive entries do not match the payload: expected ' + expected.length + ', got ' + files.length);
    return;
  }
  pass('Archive contains exactly the ' + expected.length + ' payload files');

  // Compare content, not just names: the stored CRC-32 must match the bytes on
  // disk, so a truncated or replaced member cannot slip through.
  let contentOk = true;
  for (const file of expected) {
    const disk = fs.readFileSync(path.join(candidateDir, file));
    const entry = entries.get(file);
    if (disk.length !== entry.uncompressedSize) {
      fail('Archive size mismatch for ' + file + ': ' + entry.uncompressedSize + ' instead of ' + disk.length);
      contentOk = false;
    } else if (zlib.crc32(disk) !== entry.crc32) {
      fail('Archive content mismatch for ' + file + ' (CRC-32 differs)');
      contentOk = false;
    }
  }
  if (contentOk) pass('Archive content matches the candidate byte for byte (CRC-32)');

  if (!MODES_MEANINGFUL) {
    pass('Archive modes not enforced on Windows (bsdtar stores its own attributes)');
    return;
  }
  let allOk = true;
  for (const file of expected) {
    const diskMode = fs.statSync(path.join(candidateDir, file)).mode & 0o777;
    const zipMode = entries.get(file).mode;
    if (zipMode !== diskMode) {
      fail('Archive lost the mode of ' + file + ': ' + zipMode.toString(8) + ' instead of ' + diskMode.toString(8));
      allOk = false;
    }
  }
  if (allOk) pass('Archive preserved the 0755/0644 modes of the payload');
}

function main() {
  const args = process.argv.slice(2);

  if (args.includes('--help')) {
    printHelp();
    return;
  }

  const archiveIndex = args.indexOf('--archive');
  let archivePath = null;
  if (archiveIndex >= 0) {
    archivePath = args[archiveIndex + 1];
    args.splice(archiveIndex, archivePath ? 2 : 1);
    if (!archivePath) {
      console.error(USAGE);
      process.exitCode = 1;
      return;
    }
  }

  const arg = args[0];
  if (!arg) {
    console.error(USAGE);
    console.error('       node launcher/scripts/release-verify.cjs --help');
    process.exitCode = 1;
    return;
  }
  if (!LAYOUT) {
    fail('Unsupported platform for verification: ' + process.platform);
    process.exitCode = 1;
    return;
  }

  let candidateDir;
  try {
    candidateDir = path.resolve(arg);
  } catch {
    fail('Invalid candidate path: ' + arg);
    process.exitCode = 1;
    return;
  }
  if (!fs.existsSync(candidateDir)) {
    fail('Candidate directory does not exist: ' + candidateDir);
    process.exitCode = 1;
    return;
  }
  if (!fs.lstatSync(candidateDir).isDirectory()) {
    fail('Path is not a directory: ' + candidateDir);
    process.exitCode = 1;
    return;
  }

  checkLayoutFiles(candidateDir);
  checkExecutableSize(candidateDir);
  checkChecksums(candidateDir);
  checkProvenance(candidateDir);
  checkModes(candidateDir);
  if (LAYOUT.kind === 'macos') report(macBundleProblems(candidateDir), 'CloudLocal.app metadata and .icns icon verified');
  if (LAYOUT.kind === 'linux') report(linuxExtrasProblems(candidateDir), 'Linux desktop entry, PNG icon and install.sh verified');
  if (archivePath) checkArchive(candidateDir, path.resolve(archivePath));

  console.log('');
  console.log('--- Verification Summary ---');
  if (_errors === 0) {
    pass('Candidate verification PASSED');
  } else {
    process.exitCode = 1;
    console.error('Candidate verification FAILED (' + _errors + ' check(s) failed)');
  }
}

if (require.main === module) main();

// Host-independent pieces, so the macOS and Linux payload checks can be tested
// on any machine instead of only on their own CI runner.
module.exports = { macBundleProblems, linuxExtrasProblems, readZipEntries, scanCandidate };
