#!/usr/bin/env node
'use strict';

// launcher/scripts/release-verify.cjs — verifies a release candidate directory
// for integrity, provenance, and allowed content.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

// Binary name inside a candidate depends on the host platform (build.cjs).
const BINARY_NAMES = {
  win32: 'CloudLocal.exe',
  linux: 'cloudlocal-linux-x64',
  darwin: 'cloudlocal-darwin-arm64',
};
const BINARY_NAME = BINARY_NAMES[process.platform] || 'CloudLocal.exe';

function printHelp() {
  console.log('Usage: node launcher/scripts/release-verify.cjs <candidate-directory>');
  console.log('       node launcher/scripts/release-verify.cjs --help');
  console.log('');
  console.log('Verify a release candidate directory for integrity and allowed content.');
  console.log('');
  console.log('Checks performed:');
  console.log('  - Candidate directory exists and is a directory');
  console.log('  - ' + BINARY_NAME + ' exists as a regular file (>= 64 KB)');
  console.log('  - SHA256SUMS exists, all entries match actual file hashes');
  console.log('  - candidate.json has all required provenance fields');
  console.log('  - Only allowed files present (explicit allowlist, no extras)');
  console.log('  - candidate.json unsigned flag is true (truthful)');
  console.log('  - No symlinks or directories in payload (regular files only)');
  console.log('  - SHA256SUMS entries exactly match allowed files (complete match)');
  console.log('');
  console.log('Allowed files:');
  console.log('  ' + BINARY_NAME + ', LICENSE, NODE-LICENSE.txt, THIRD-PARTY-NOTICES.txt,');
  console.log('  README.md, RELEASE-NOTES.md, candidate.json, SHA256SUMS');
  console.log('');
  console.log('Path handling:');
  console.log('  Accepts absolute or relative candidate directory paths.');
  console.log('  Path traversal (..) in file entries within SHA256SUMS is rejected.');
  process.exitCode = 0;
}

const ALLOWED_FILES = [
  BINARY_NAME,
  'LICENSE',
  'NODE-LICENSE.txt',
  'THIRD-PARTY-NOTICES.txt',
  'README.md',
  'RELEASE-NOTES.md',
  'candidate.json',
  'SHA256SUMS',
];

const ALLOWED_SET = new Set(ALLOWED_FILES);

const REQUIRED_FIELDS = [
  'name', 'version', 'productVersion', 'platform', 'arch',
  'unsigned', 'unsignedNote', 'sha256', 'git', 'files', 'builtAt',
];

const REQUIRED_GIT_FIELDS = ['commit', 'branch', 'dirty'];

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

// Check if a path is a regular file (not symlink, not dir) using lstat
function isRegularFile(filePath) {
  try {
    const st = fs.lstatSync(filePath);
    return st.isFile();
  } catch {
    return false;
  }
}

function main() {
  const args = process.argv.slice(2);

  if (args.includes('--help')) {
    printHelp();
    return;
  }

  const arg = args[0];

  if (!arg) {
    console.error('Usage: node scripts/release-verify.cjs <candidate-directory>');
    console.error('       node scripts/release-verify.cjs --help');
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

  let stat;
  try {
    stat = fs.lstatSync(candidateDir);
  } catch {
    fail('Cannot stat candidate directory: ' + candidateDir);
    process.exitCode = 1;
    return;
  }

  if (!stat.isDirectory()) {
    fail('Path is not a directory: ' + candidateDir);
    process.exitCode = 1;
    return;
  }

  let checks = 0;

  checks++;
  const exePath = path.join(candidateDir, BINARY_NAME);
  if (!fs.existsSync(exePath)) {
    fail(BINARY_NAME + ' not found in candidate directory');
  } else if (!isRegularFile(exePath)) {
    fail(BINARY_NAME + ' is not a regular file (symlink or special)');
  } else {
    const exeStat = fs.statSync(exePath);
    if (exeStat.size < 64 * 1024) {
      fail(BINARY_NAME + ' is suspiciously small (' + exeStat.size + ' bytes) — likely not a valid executable');
    } else {
      pass(BINARY_NAME + ' exists (' + exeStat.size + ' bytes)');
    }
  }

  checks++;
  const sumPath = path.join(candidateDir, 'SHA256SUMS');
  if (!fs.existsSync(sumPath)) {
    fail('SHA256SUMS not found');
  } else if (!isRegularFile(sumPath)) {
    fail('SHA256SUMS is not a regular file');
  } else {
    const sumContent = fs.readFileSync(sumPath, 'utf-8');
    const lines = sumContent.trim().split('\n').filter(l => l.trim().length > 0);
    let sumOk = true;
    const checkedFiles = new Set();

    for (const line of lines) {
      const match = /^([0-9a-f]{64})  (.+)$/.exec(line);
      if (!match) {
        fail('Invalid SHA256SUMS line: ' + line);
        sumOk = false;
        continue;
      }
      const expectedHash = match[1];
      const fileName = match[2];

      // Reject unsafe filenames (path traversal)
      if (fileName.includes('..') || fileName.includes('/') || fileName.includes('\\')) {
        fail('Unsafe filename in SHA256SUMS (path traversal): ' + fileName);
        sumOk = false;
        continue;
      }

      if (!ALLOWED_SET.has(fileName) || fileName === 'SHA256SUMS' || checkedFiles.has(fileName)) {
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

      // Check it's a regular file (not symlink, not dir)
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
      checkedFiles.add(fileName);
    }

    // Verify completeness: all allowed files must be in SHA256SUMS
    for (const allowed of ALLOWED_FILES) {
      if (allowed === 'SHA256SUMS') continue; // SHA256SUMS excludes itself
      if (!checkedFiles.has(allowed)) {
        fail('SHA256SUMS missing entry for required file: ' + allowed);
        sumOk = false;
      }
    }

    if (sumOk) {
      pass('All SHA256SUMS entries verified and complete');
    }
  }

  checks++;
  const provPath = path.join(candidateDir, 'candidate.json');
  if (!fs.existsSync(provPath)) {
    fail('candidate.json not found');
  } else if (!isRegularFile(provPath)) {
    fail('candidate.json is not a regular file');
  } else {
    let provData;
    try {
      provData = JSON.parse(fs.readFileSync(provPath, 'utf-8'));
    } catch (err) {
      fail('candidate.json is not valid JSON: ' + err.message);
      provData = null;
    }

    if (provData) {
      // Check required fields
      let fieldsOk = true;
      for (const field of REQUIRED_FIELDS) {
        if (!(field in provData)) {
          fail('candidate.json missing required field: ' + field);
          fieldsOk = false;
        }
      }

      // Check git sub-fields
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

      // Check unsigned flag is true (truthful)
      if (provData.unsigned !== true) {
        fail('candidate.json "unsigned" is not true — expected truthful unsigned status');
        fieldsOk = false;
      }

      // Verify sha256 matches actual executable if exe exists
      if (provData.sha256 && isRegularFile(exePath)) {
        const actualHash = sha256file(exePath);
        if (provData.sha256 !== actualHash) {
          fail('candidate.json sha256 does not match actual ' + BINARY_NAME + ' hash');
          fieldsOk = false;
        } else {
          pass('Provenance SHA-256 matches executable');
        }
      }

      // Check platform/arch
      if (provData.platform !== 'win32' || provData.arch !== 'x64') {
        fail('candidate.json platform/arch should be win32/x64, got ' + provData.platform + '/' + provData.arch);
        fieldsOk = false;
      }

      if (fieldsOk) {
        pass('candidate.json has all required provenance fields');
        pass('CloudLocal signing not performed (metadata); Authenticode status is not verified');
      }
    }
  }

  checks++;
  const actualFiles = new Set();
  try {
    for (const name of fs.readdirSync(candidateDir)) {
      actualFiles.add(name);
    }
  } catch {
    fail('Cannot read candidate directory: ' + candidateDir);
  }

  // Check for disallowed files
  let allowlistOk = true;
  for (const file of actualFiles) {
    if (!ALLOWED_SET.has(file)) {
      fail('Disallowed file in candidate: ' + file);
      allowlistOk = false;
    }
  }

  // Check all allowed files are present
  for (const allowed of ALLOWED_FILES) {
    if (!actualFiles.has(allowed)) {
      fail('Missing required allowed file: ' + allowed);
      allowlistOk = false;
    }
  }

  if (allowlistOk) {
    pass('Allowlist complete — all ' + ALLOWED_FILES.length + ' required files present, no extras');
  }

  checks++;
  let allRegular = true;
  for (const file of ALLOWED_FILES) {
    const fpath = path.join(candidateDir, file);
    if (fs.existsSync(fpath) && !isRegularFile(fpath)) {
      fail('Payload file is not a regular file (symlink/reparse/dir): ' + file);
      allRegular = false;
    }
  }
  if (allRegular) {
    pass('All payload files are regular files (no symlinks or directories)');
  }

  if (isRegularFile(path.join(candidateDir, 'README.md'))) {
    pass('README.md present');
  } else {
    fail('README.md missing or not a regular file');
  }

  if (isRegularFile(path.join(candidateDir, 'LICENSE'))) {
    pass('LICENSE present');
    const lic = fs.readFileSync(path.join(candidateDir, 'LICENSE'), 'utf-8');
    // Check for "MIT" as a word (not as substring of words like "PERMITTED")
    if (/\bMIT\b/.test(lic)) {
      pass('LICENSE is MIT');
    } else {
      fail('LICENSE does not contain MIT');
    }
  } else {
    fail('LICENSE missing or not a regular file');
  }

  // Check NODE-LICENSE.txt
  if (isRegularFile(path.join(candidateDir, 'NODE-LICENSE.txt'))) {
    pass('NODE-LICENSE.txt present');
  } else {
    fail('NODE-LICENSE.txt missing or not a regular file');
  }

  // Check THIRD-PARTY-NOTICES.txt
  if (isRegularFile(path.join(candidateDir, 'THIRD-PARTY-NOTICES.txt'))) {
    pass('THIRD-PARTY-NOTICES.txt present');
  } else {
    fail('THIRD-PARTY-NOTICES.txt missing or not a regular file');
  }

  console.log('');
  console.log('--- Verification Summary ---');
  if (_errors === 0) {
    pass('Candidate verification PASSED (' + checks + ' checks)');
  } else {
    process.exitCode = 1;
    console.error('Candidate verification FAILED (' + _errors + ' check(s) failed)');
  }
}

main();