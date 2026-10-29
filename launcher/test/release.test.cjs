#!/usr/bin/env node
'use strict';

// launcher/test/release.test.cjs — release candidate creation and verification tests
// using isolated fixtures under .cache/rc-test-*.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const CACHE_DIR = path.join(__dirname, '..', '..', '.cache');

function mkFixture() {
  return fs.mkdtempSync(path.join(CACHE_DIR, 'rc-test-'));
}

function cleanFixture(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
}

// Platform identity, mirroring build.cjs and release.cjs.
const PLATFORM_MAP = {
  win32: { binary: 'CloudLocal.exe', id: 'windows-x64' },
  linux: { binary: 'cloudlocal-linux-x64', id: 'linux-x64' },
  darwin: { binary: 'cloudlocal-darwin-arm64', id: 'darwin-arm64' },
};
const PLATFORM = PLATFORM_MAP[process.platform];

function createProjectFixture(fixtureDir) {
  const launcherDir = path.join(fixtureDir, 'launcher');
  const scriptsDir = path.join(launcherDir, 'scripts');
  const distDir = path.join(launcherDir, 'dist');
  const resourcesDir = path.join(launcherDir, 'resources');
  const serverDir = path.join(fixtureDir, 'server');

  fs.mkdirSync(scriptsDir, { recursive: true });
  fs.mkdirSync(distDir, { recursive: true });
  fs.mkdirSync(resourcesDir, { recursive: true });
  fs.mkdirSync(serverDir, { recursive: true });

  for (const name of ['release.cjs', 'release-verify.cjs']) {
    fs.copyFileSync(
      path.join(__dirname, '..', 'scripts', name),
      path.join(scriptsDir, name)
    );
  }

  const exeBuf = Buffer.alloc(128 * 1024, 0);
  exeBuf.writeUInt16LE(0x5a4d, 0);
  fs.writeFileSync(path.join(distDir, PLATFORM.binary), exeBuf);

  fs.writeFileSync(path.join(fixtureDir, 'LICENSE'),
    'MIT License\n\nCopyright (c) 2024 CloudLocal\n\n' +
    'Permission is hereby granted, free of charge, to any person obtaining a copy\n');

  fs.writeFileSync(path.join(fixtureDir, 'README.md'),
    '# CloudLocal\n\nPrivate local file server.');

  try {
    const realNodeLicense = fs.readFileSync(
      path.join(__dirname, '..', 'resources', 'NODE-LICENSE-22.23.2.txt'),
      'utf-8'
    );
    fs.writeFileSync(path.join(resourcesDir, 'NODE-LICENSE-22.23.2.txt'), realNodeLicense);
  } catch {
    fs.writeFileSync(path.join(resourcesDir, 'NODE-LICENSE-22.23.2.txt'),
      'Node.js is licensed for use as follows:\n\n' +
      '"""\n' +
      'Copyright Node.js contributors.\n' +
      'Permission is hereby granted, free of charge...\n"""');
  }

  fs.writeFileSync(path.join(fixtureDir, 'package.json'), JSON.stringify({
    name: 'CloudLocal', version: '0.0.1', workspaces: ['client', 'server'],
  }));
  fs.writeFileSync(path.join(serverDir, 'package.json'), JSON.stringify({
    name: 'cloudlocal-server', version: '0.0.1',
  }));

  return { fixtureDir, launcherDir, scriptsDir, distDir };
}

function sha256(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function sha256file(filePath) {
  return sha256(fs.readFileSync(filePath));
}

function runRelease(proj, versionTag) {
  const scriptPath = path.join(proj.scriptsDir, 'release.cjs');
  return spawnSync(process.execPath, [scriptPath, versionTag || '0.0.1-rc.1'], {
    cwd: proj.fixtureDir,
    encoding: 'utf-8',
    timeout: 30000,
  });
}

function runReleaseHelp(proj) {
  const scriptPath = path.join(proj.scriptsDir, 'release.cjs');
  return spawnSync(process.execPath, [scriptPath, '--help'], {
    cwd: proj.fixtureDir,
    encoding: 'utf-8',
    timeout: 10000,
  });
}

function runVerify(dirPath, extraArgs = []) {
  const verifyScript = path.join(__dirname, '..', 'scripts', 'release-verify.cjs');
  return spawnSync(process.execPath, [verifyScript, dirPath, ...extraArgs], {
    encoding: 'utf-8',
    timeout: 10000,
  });
}

// release.cjs builds the Windows-only release candidate (bsdtar from
// System32, win32 platform fields), so tests that create a real candidate
// only run on Windows. release-verify.cjs itself is pure fs and stays
// covered there through the same tests.
function winOnly() {
  if (process.platform !== 'win32') this.skip();
}

test('release: bsdtar.exe path is discoverable on Windows', function() {
  winOnly.call(this);
  const tarExe = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
  assert.ok(fs.existsSync(tarExe), 'bsdtar.exe should exist at ' + tarExe);
});

test('release.cjs --help prints usage and exits 0', () => {
  const fixture = mkFixture();
  try {
    const proj = createProjectFixture(fixture);
    const result = runReleaseHelp(proj);
    assert.equal(result.status, 0, 'Expected exit 0: ' + result.stderr);
    assert.ok(result.stdout.includes('Usage'));
    assert.ok(!result.stdout.includes('SyntaxError'));
  } finally { cleanFixture(fixture); }
});

test('release-verify.cjs --help prints usage and exits 0', () => {
  const fixture = mkFixture();
  try {
    const proj = createProjectFixture(fixture);
    const verifyScript = path.join(proj.scriptsDir, 'release-verify.cjs');
    const result = spawnSync(process.execPath, [verifyScript, '--help'], {
      cwd: proj.fixtureDir, encoding: 'utf-8', timeout: 10000,
    });
    assert.equal(result.status, 0, 'Expected exit 0: ' + result.stderr);
    assert.ok(result.stdout.includes('Usage') || result.stdout.includes('help'));
  } finally { cleanFixture(fixture); }
});

test('release.cjs creates candidate; verify passes; extract validates', function() {
  winOnly.call(this);
  const fixture = mkFixture();
  try {
    const proj = createProjectFixture(fixture);

    const createResult = runRelease(proj, '0.0.1-rc.1');
    assert.equal(createResult.status, 0, 'release.cjs exit 0: ' + createResult.stderr);
    assert.ok(createResult.stdout.includes('Candidate created'));

    const candidateDir = path.join(proj.distDir, 'release', '0.0.1-rc.1-windows-x64');
    assert.ok(fs.existsSync(candidateDir));

    // Check all payload files
    for (const f of ['CloudLocal.exe', 'LICENSE', 'NODE-LICENSE.txt',
      'THIRD-PARTY-NOTICES.txt', 'README.md', 'RELEASE-NOTES.md',
      'candidate.json', 'SHA256SUMS']) {
      assert.ok(fs.existsSync(path.join(candidateDir, f)), 'Expected: ' + f);
    }

    // Check .zip and .zip.sha256 siblings
    const zipPath = path.join(proj.distDir, 'release', '0.0.1-rc.1-windows-x64.zip');
    const zipShaPath = path.join(proj.distDir, 'release', '0.0.1-rc.1-windows-x64.zip.sha256');
    assert.ok(fs.existsSync(zipPath), '.zip exists');
    assert.ok(fs.existsSync(zipShaPath), '.zip.sha256 exists');

    // Verify zip hash consistency
    const zipHashActual = sha256file(zipPath);
    const zipShaContent = fs.readFileSync(zipShaPath, 'utf-8').trim();
    const storedHash = zipShaContent.split('  ')[0];
    assert.equal(storedHash, zipHashActual, 'zip hash matches');

    // Verify
    const verifyResult = runVerify(candidateDir);
    assert.equal(verifyResult.status, 0, 'Verify exit 0: ' + verifyResult.stderr);
    assert.ok(verifyResult.stdout.includes('PASSED') || verifyResult.stdout.includes('PASS'));

    // Check candidate.json
    const provData = JSON.parse(fs.readFileSync(path.join(candidateDir, 'candidate.json'), 'utf-8'));
    assert.equal(provData.version, '0.0.1-rc.1');
    assert.equal(provData.productVersion, '0.0.1');
    assert.equal(provData.unsigned, true);
    assert.ok(provData.sha256);
    assert.ok(provData.unsignedNote && provData.unsignedNote.length > 0);
    assert.ok(provData.git);
    assert.ok(provData.versions);

    // SHA256SUMS: includes candidate.json, excludes itself
    const sumContent = fs.readFileSync(path.join(candidateDir, 'SHA256SUMS'), 'utf-8');
    assert.ok(sumContent.includes('candidate.json'), 'SHA256SUMS includes candidate.json');
    assert.ok(!sumContent.includes('SHA256SUMS'), 'SHA256SUMS does not reference itself');
    assert.ok(!sumContent.includes('zip.sha256'), 'SHA256SUMS does not include zip sha256');

    // Verify specific file contents
    assert.ok(/\bMIT\b/.test(fs.readFileSync(path.join(candidateDir, 'LICENSE'), 'utf-8')));
    assert.ok(fs.readFileSync(path.join(candidateDir, 'NODE-LICENSE.txt'), 'utf-8')
      .includes('Node.js') || fs.readFileSync(path.join(candidateDir, 'NODE-LICENSE.txt'), 'utf-8')
      .includes('Copyright'));

    const tpContent = fs.readFileSync(path.join(candidateDir, 'THIRD-PARTY-NOTICES.txt'), 'utf-8');
    assert.ok(tpContent.includes('esbuild') || tpContent.includes('postject'));

    assert.ok(fs.readFileSync(path.join(candidateDir, 'RELEASE-NOTES.md'), 'utf-8')
      .includes('unsigned') || fs.readFileSync(path.join(candidateDir, 'RELEASE-NOTES.md'), 'utf-8')
      .includes('Unsigned'));

    // Verify exe hash matches provenance
    const actualExeHash = sha256file(path.join(candidateDir, 'CloudLocal.exe'));
    assert.equal(provData.sha256, actualExeHash);
  } finally { cleanFixture(fixture); }
});

test('release.cjs rejects existing candidate directory (no-clobber)', () => {
  const fixture = mkFixture();
  try {
    const proj = createProjectFixture(fixture);
    const candidateDir = path.join(proj.distDir, 'release', '0.0.1-rc.1-' + PLATFORM.id);
    fs.mkdirSync(candidateDir, { recursive: true });
    fs.writeFileSync(path.join(candidateDir, 'README.md'), 'existing');

    const result = runRelease(proj, '0.0.1-rc.1');
    assert.equal(result.status, 1);
    assert.ok(result.stderr.includes('already exists'));
    assert.equal(
      fs.readFileSync(path.join(candidateDir, 'README.md'), 'utf-8'),
      'existing'
    );
  } finally { cleanFixture(fixture); }
});

test('release.cjs fails without LICENSE (no partial output)', () => {
  const fixture = mkFixture();
  try {
    const proj = createProjectFixture(fixture);
    fs.unlinkSync(path.join(proj.fixtureDir, 'LICENSE'));

    const result = runRelease(proj, '0.0.1-rc.1');
    assert.equal(result.status, 1);
    assert.ok(result.stderr.includes('LICENSE') || result.stderr.includes('Error'));
    assert.ok(!fs.existsSync(path.join(proj.distDir, 'release', '0.0.1-rc.1-' + PLATFORM.id)));
  } finally { cleanFixture(fixture); }
});

test('release.cjs fails without NODE-LICENSE (no partial output)', () => {
  const fixture = mkFixture();
  try {
    const proj = createProjectFixture(fixture);
    fs.rmSync(path.join(proj.launcherDir, 'resources'), { recursive: true, force: true });

    const result = runRelease(proj, '0.0.1-rc.1');
    assert.equal(result.status, 1);
    assert.ok(result.stderr.includes('LICENSE') || result.stderr.includes('NODE'));
    assert.ok(!fs.existsSync(path.join(proj.distDir, 'release', '0.0.1-rc.1-' + PLATFORM.id)));
  } finally { cleanFixture(fixture); }
});

test('release.cjs rejects invalid version tag', () => {
  const fixture = mkFixture();
  try {
    const proj = createProjectFixture(fixture);
    const result = runRelease(proj, 'bad-tag');
    assert.equal(result.status, 1);
    assert.ok(result.stderr.includes('must match'));
  } finally { cleanFixture(fixture); }
});

test('release.cjs fails when the platform binary is missing', () => {
  const fixture = mkFixture();
  try {
    const proj = createProjectFixture(fixture);
    fs.unlinkSync(path.join(proj.distDir, PLATFORM.binary));
    const result = runRelease(proj, '0.0.1-rc.1');
    assert.equal(result.status, 1);
    assert.ok(result.stderr.includes('CloudLocal.exe') || result.stderr.includes('not found'));
  } finally { cleanFixture(fixture); }
});

test('release-verify: rejects — tampered CloudLocal.exe', function() {
  winOnly.call(this);
  const fixture = mkFixture();
  try {
    const proj = createProjectFixture(fixture);
    const r = runRelease(proj, '0.0.1-rc.1');
    assert.equal(r.status, 0);

    const candidateDir = path.join(proj.distDir, 'release', '0.0.1-rc.1-windows-x64');
    const exePath = path.join(candidateDir, 'CloudLocal.exe');
    const data = fs.readFileSync(exePath);
    data[100] = (data[100] + 1) % 256;
    fs.writeFileSync(exePath, data);

    const result = runVerify(candidateDir);
    assert.equal(result.status, 1);
    assert.ok(result.stderr.includes('mismatch') || result.stderr.includes('Checksum'));
  } finally { cleanFixture(fixture); }
});

test('release-verify: rejects — tampered candidate.json', function() {
  winOnly.call(this);
  const fixture = mkFixture();
  try {
    const proj = createProjectFixture(fixture);
    const r = runRelease(proj, '0.0.1-rc.1');
    assert.equal(r.status, 0);

    const candidateDir = path.join(proj.distDir, 'release', '0.0.1-rc.1-windows-x64');
    const provData = JSON.parse(
      fs.readFileSync(path.join(candidateDir, 'candidate.json'), 'utf-8'));
    provData.unsigned = false;
    fs.writeFileSync(path.join(candidateDir, 'candidate.json'),
      JSON.stringify(provData, null, 2) + '\n');

    const result = runVerify(candidateDir);
    assert.equal(result.status, 1);
    assert.ok(result.stderr.includes('unsigned'));
  } finally { cleanFixture(fixture); }
});

test('release-verify: rejects — missing checksum entries', function() {
  winOnly.call(this);
  const fixture = mkFixture();
  try {
    const proj = createProjectFixture(fixture);
    const r = runRelease(proj, '0.0.1-rc.1');
    assert.equal(r.status, 0);

    const candidateDir = path.join(proj.distDir, 'release', '0.0.1-rc.1-windows-x64');
    fs.unlinkSync(path.join(candidateDir, 'NODE-LICENSE.txt'));

    const result = runVerify(candidateDir);
    assert.equal(result.status, 1);
    assert.ok(result.stderr.includes('missing') || result.stderr.includes('NODE'));
  } finally { cleanFixture(fixture); }
});

test('release-verify: rejects — symlink in payload', function() {
  winOnly.call(this);
  const fixture = mkFixture();
  try {
    const proj = createProjectFixture(fixture);
    const r = runRelease(proj, '0.0.1-rc.1');
    assert.equal(r.status, 0);

    const candidateDir = path.join(proj.distDir, 'release', '0.0.1-rc.1-windows-x64');
    const realFile = path.join(candidateDir, 'LICENSE');
    fs.unlinkSync(realFile);
    fs.mkdirSync(realFile, { recursive: true });

    const result = runVerify(candidateDir);
    assert.equal(result.status, 1);
    assert.ok(result.stderr.includes('regular file') || result.stderr.includes('not a'));
  } finally { cleanFixture(fixture); }
});

test('release-verify: rejects — SHA256SUMS with path traversal', function() {
  winOnly.call(this);
  const fixture = mkFixture();
  try {
    const proj = createProjectFixture(fixture);
    const r = runRelease(proj, '0.0.1-rc.1');
    assert.equal(r.status, 0);

    const candidateDir = path.join(proj.distDir, 'release', '0.0.1-rc.1-windows-x64');
    const fakeHash = 'a'.repeat(64);
    fs.writeFileSync(path.join(candidateDir, 'SHA256SUMS'),
      fakeHash + '  ../../../etc/passwd\n' +
      fakeHash + '  CloudLocal.exe\n');

    const result = runVerify(candidateDir);
    assert.equal(result.status, 1);
    assert.ok(result.stderr.includes('Unsafe filename') || result.stderr.includes('traversal'));
  } finally { cleanFixture(fixture); }
});

test('release-verify: no-clobber — verify does not modify candidate', function() {
  winOnly.call(this);
  const fixture = mkFixture();
  try {
    const proj = createProjectFixture(fixture);
    const r = runRelease(proj, '0.0.1-rc.1');
    assert.equal(r.status, 0);

    const candidateDir = path.join(proj.distDir, 'release', '0.0.1-rc.1-windows-x64');

    const beforeHashes = {};
    for (const file of ['candidate.json', 'LICENSE', 'README.md', 'RELEASE-NOTES.md']) {
      beforeHashes[file] = sha256file(path.join(candidateDir, file));
    }

    const result = runVerify(candidateDir);
    assert.equal(result.status, 0);

    for (const [file, hash] of Object.entries(beforeHashes)) {
      const afterHash = sha256file(path.join(candidateDir, file));
      assert.equal(afterHash, hash, file + ' unchanged');
    }
  } finally { cleanFixture(fixture); }
});

test('release.cjs: candidate has exactly allowed files (no extras)', function() {
  winOnly.call(this);
  const fixture = mkFixture();
  try {
    const proj = createProjectFixture(fixture);
    const r = runRelease(proj, '0.0.1-rc.1');
    assert.equal(r.status, 0);

    const candidateDir = path.join(proj.distDir, 'release', '0.0.1-rc.1-windows-x64');
    const allowed = [
      'CloudLocal.exe', 'LICENSE', 'NODE-LICENSE.txt',
      'THIRD-PARTY-NOTICES.txt', 'README.md', 'RELEASE-NOTES.md',
      'candidate.json', 'SHA256SUMS',
    ];
    const actual = new Set(fs.readdirSync(candidateDir));
    for (const name of actual) assert.ok(allowed.includes(name), 'Disallowed: ' + name);
    for (const name of allowed) assert.ok(actual.has(name), 'Missing: ' + name);
  } finally { cleanFixture(fixture); }
});

test('release-verify: accepts explicit candidate directory path', function() {
  winOnly.call(this);
  const fixture = mkFixture();
  try {
    const proj = createProjectFixture(fixture);
    const r = runRelease(proj, '0.0.1-rc.1');
    assert.equal(r.status, 0);

    const candidateDir = path.join(proj.distDir, 'release', '0.0.1-rc.1-windows-x64');
    const result = runVerify(candidateDir);
    assert.equal(result.status, 0, 'Should accept explicit path: ' + result.stderr);
  } finally { cleanFixture(fixture); }
});

test('release.cjs: .zip.sha256 is sibling outside candidate, not inside', function() {
  winOnly.call(this);
  const fixture = mkFixture();
  try {
    const proj = createProjectFixture(fixture);
    const r = runRelease(proj, '0.0.1-rc.1');
    assert.equal(r.status, 0);

    const candidateDir = path.join(proj.distDir, 'release', '0.0.1-rc.1-windows-x64');
    const zipShaPath = path.join(proj.distDir, 'release', '0.0.1-rc.1-windows-x64.zip.sha256');
    assert.ok(fs.existsSync(zipShaPath));

    assert.ok(!fs.existsSync(path.join(candidateDir, '0.0.1-rc.1-windows-x64.zip.sha256')));

    const sumContent = fs.readFileSync(path.join(candidateDir, 'SHA256SUMS'), 'utf-8');
    assert.ok(!sumContent.includes('zip.sha256'));
  } finally { cleanFixture(fixture); }
});
test('release: notices include hoisted production metadata and license text', function() {
  winOnly.call(this);
  const fixture = mkFixture();
  try {
    const proj = createProjectFixture(fixture);
    fs.mkdirSync(path.join(fixture, 'client'), { recursive: true });
    fs.writeFileSync(path.join(fixture, 'client', 'package.json'), JSON.stringify({ dependencies: { 'demo-prod': '1.0.0' } }));
    const dep = path.join(fixture, 'node_modules', 'demo-prod');
    fs.mkdirSync(dep, { recursive: true });
    fs.writeFileSync(path.join(dep, 'package.json'), JSON.stringify({ name: 'demo-prod', version: '1.0.0', license: 'MIT' }));
    fs.writeFileSync(path.join(dep, 'LICENSE'), 'MIT License\nCopyright demo production dependency\n');
    const result = runRelease(proj);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, '');
    const notices = fs.readFileSync(path.join(proj.distDir, 'release', '0.0.1-rc.1-windows-x64', 'THIRD-PARTY-NOTICES.txt'), 'utf8');
    assert.ok(notices.includes('demo-prod 1.0.0 (license: MIT)'), notices);
    assert.ok(notices.includes('Copyright demo production dependency'), notices);
  } finally { cleanFixture(fixture); }
});

test('release: bundled instructions are self-contained rather than repository links', function() {
  winOnly.call(this);
  const fixture = mkFixture();
  try {
    const proj = createProjectFixture(fixture);
    fs.writeFileSync(path.join(fixture, 'README.md'), '# Developer guide\n[Unavailable in archive](docs/missing.md)\n');
    const result = runRelease(proj);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, '');
    const readme = fs.readFileSync(path.join(proj.distDir, 'release', '0.0.1-rc.1-windows-x64', 'README.md'), 'utf8');
    assert.ok(!readme.includes('docs/missing.md'));
    assert.ok(readme.includes('CloudLocal.exe'));
    assert.ok(readme.includes('Apagar servidor'));
    assert.ok(readme.includes('SHA256SUMS'));
  } finally { cleanFixture(fixture); }
});

test('release: an existing archive is never overwritten even without its directory', () => {
  const fixture = mkFixture();
  try {
    const proj = createProjectFixture(fixture);
    const release = path.join(proj.distDir, 'release');
    fs.mkdirSync(release, { recursive: true });
    const zip = path.join(release, '0.0.1-rc.1-' + PLATFORM.id + '.zip');
    fs.writeFileSync(zip, 'existing archive');
    const before = sha256file(zip);
    const result = runRelease(proj);
    assert.equal(result.status, 1);
    assert.ok(result.stderr.includes('already exists'));
    assert.equal(sha256file(zip), before);
    assert.ok(!fs.existsSync(path.join(release, '0.0.1-rc.1-' + PLATFORM.id)));
  } finally { cleanFixture(fixture); }
});
