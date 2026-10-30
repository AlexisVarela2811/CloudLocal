// launcher/test/version-sync.test.cjs — the product version is one value.
//
// The launcher embeds the root version in the release candidate metadata, so a
// manifest left behind (client was stuck at 0.0.0 until 0.1.4) makes published
// artifacts lie about what they contain. These tests pin the invariant and the
// script that enforces it.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..', '..');
const MANIFESTS = ['package.json', 'launcher/package.json', 'server/package.json', 'client/package.json'];

function readVersion(relative) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relative), 'utf8')).version;
}

test('every manifest shares one product version', () => {
  const versions = MANIFESTS.map(readVersion);
  for (const [index, relative] of MANIFESTS.entries()) {
    assert.equal(versions[index], versions[0], `${relative} version must equal ${MANIFESTS[0]} (${versions[0]})`);
  }
  assert.match(versions[0], /^\d+\.\d+\.\d+$/);
});

test('the newest CHANGELOG entry matches the product version', () => {
  const changelog = fs.readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8');
  const entries = [...changelog.matchAll(/^##\s*\[(\d+\.\d+\.\d+)\]/gm)].map(match => match[1]);
  assert.ok(entries.length > 0, 'CHANGELOG must have at least one versioned entry');
  assert.equal(entries[0], readVersion('package.json'), 'newest CHANGELOG entry must match package.json');
});

function mkFixture() {
  const dir = fs.mkdtempSync(path.join(ROOT, '.cache', 'version-test-'));
  fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'scripts', 'version.cjs'), path.join(dir, 'scripts', 'version.cjs'));
  const fixtures = {
    'package.json': ['0.1.1', 4],
    'launcher/package.json': ['0.1.1', 4],
    'server/package.json': ['0.1.1', 4],
    'client/package.json': ['0.0.0', 2],
  };
  for (const [relative, [version, indent]] of Object.entries(fixtures)) {
    const file = path.join(dir, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ name: relative, version }, null, indent) + '\n');
  }
  return { dir, fixtures };
}

test('set updates every manifest and preserves its existing indentation', () => {
  const { dir, fixtures } = mkFixture();
  try {
    const result = spawnSync(process.execPath, [path.join(dir, 'scripts', 'version.cjs'), 'set', '0.1.4'], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /0\.1\.1 → 0\.1\.4/);
    for (const [relative, [, indent]] of Object.entries(fixtures)) {
      const text = fs.readFileSync(path.join(dir, relative), 'utf8');
      assert.equal(JSON.parse(text).version, '0.1.4', `${relative} version`);
      assert.deepEqual(text, JSON.stringify({ name: relative, version: '0.1.4' }, null, indent) + '\n',
        `${relative} formatting must be preserved`);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('an invalid version leaves every manifest untouched', () => {
  const { dir, fixtures } = mkFixture();
  try {
    const before = Object.fromEntries(Object.keys(fixtures).map(relative => [relative, fs.readFileSync(path.join(dir, relative), 'utf8')]));
    for (const args of [['set', '1.2'], ['set'], ['patchy'], []]) {
      const result = spawnSync(process.execPath, [path.join(dir, 'scripts', 'version.cjs'), ...args], { encoding: 'utf8' });
      assert.equal(result.status, 1, `args ${JSON.stringify(args)} must exit 1`);
      assert.match(result.stderr, /Usage/);
    }
    for (const [relative, text] of Object.entries(before)) {
      assert.equal(fs.readFileSync(path.join(dir, relative), 'utf8'), text, `${relative} must not change`);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
