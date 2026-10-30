// launcher/test/release-layout.test.cjs — the per-platform payload layout.
//
// Only Windows got an icon and a single loose executable; macOS and Linux now
// ship more than one file (an .app bundle, a .desktop entry, an icon and an
// optional installer). These tests pin the layout and the file modes that make
// the extracted archive usable, on every host OS.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const layout = require('../scripts/release-layout.cjs');

const RESOURCES_DIR = path.join(__dirname, '..', 'resources');

function mkFixture() {
  const dir = fs.mkdtempSync(path.join(__dirname, '..', '..', '.cache', 'layout-test-'));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function fakeBinary(dir) {
  const file = path.join(dir, 'built-binary');
  // 128 KiB of deterministic bytes: enough for the size floor release-verify applies.
  fs.writeFileSync(file, Buffer.alloc(128 * 1024, 7));
  return file;
}

function writeCandidate(platformKey) {
  const dir = mkFixture();
  const candidateRoot = path.join(dir, 'candidate');
  fs.mkdirSync(candidateRoot, { recursive: true });
  const descriptor = layout.layoutFor(platformKey);
  layout.writePayload({
    layout: descriptor,
    candidateRoot,
    binarySource: fakeBinary(dir),
    resourcesDir: RESOURCES_DIR,
    version: '0.1.4',
  });
  return { dir, candidateRoot, descriptor };
}

test('exactly three platforms: windows-x64, linux-x64 and darwin-arm64', () => {
  assert.deepEqual(Object.keys(layout.PLATFORMS).sort(), ['darwin', 'linux', 'win32']);
  assert.equal(layout.PLATFORMS.win32.id, 'windows-x64');
  assert.equal(layout.PLATFORMS.linux.id, 'linux-x64');
  assert.equal(layout.PLATFORMS.darwin.id, 'darwin-arm64');
  assert.equal(layout.PLATFORMS.linux.arch, 'x64');
  assert.equal(layout.PLATFORMS.darwin.arch, 'arm64');
  assert.equal(layout.PLATFORMS.win32.arch, 'x64');
  assert.equal(layout.layoutFor('freebsd'), null);
});

test('payload paths are the checksummed files of each platform layout', () => {
  const common = ['LICENSE', 'NODE-LICENSE.txt', 'THIRD-PARTY-NOTICES.txt', 'README.md', 'RELEASE-NOTES.md', 'candidate.json'];

  assert.deepEqual(layout.payloadPaths(layout.layoutFor('win32')),
    ['CloudLocal.exe', ...common]);
  assert.deepEqual(layout.payloadPaths(layout.layoutFor('linux')),
    ['cloudlocal-linux-x64', 'CloudLocal.desktop', 'cloudlocal.png', 'install.sh', ...common]);
  assert.deepEqual(layout.payloadPaths(layout.layoutFor('darwin')),
    ['CloudLocal.app/Contents/Info.plist', 'CloudLocal.app/Contents/MacOS/cloudlocal',
      'CloudLocal.app/Contents/Resources/CloudLocal.icns', ...common]);

  for (const key of ['win32', 'linux', 'darwin']) {
    assert.ok(!layout.payloadPaths(layout.layoutFor(key)).includes('SHA256SUMS'),
      'SHA256SUMS never lists itself');
  }
});

test('Windows payload stays a single loose executable', () => {
  const { dir, candidateRoot } = writeCandidate('win32');
  try {
    assert.deepEqual(layout.collectPayload(candidateRoot), ['CloudLocal.exe']);
    assert.equal(fs.readFileSync(path.join(candidateRoot, 'CloudLocal.exe')).length, 128 * 1024);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function plistValues(text) {
  const values = {};
  const re = /<key>([^<]+)<\/key>\s*(?:<string>([^<]*)<\/string>|<true\/>|<false\/>)/g;
  let match;
  while ((match = re.exec(text))) {
    values[match[1]] = match[2] !== undefined ? match[2] : /<true\/>$/.test(match[0]);
  }
  return values;
}

test('macOS payload is an .app bundle with a runnable binary and the .icns icon', () => {
  const { dir, candidateRoot } = writeCandidate('darwin');
  try {
    const files = layout.collectPayload(candidateRoot);
    assert.deepEqual(files, [
      'CloudLocal.app/Contents/Info.plist',
      'CloudLocal.app/Contents/MacOS/cloudlocal',
      'CloudLocal.app/Contents/Resources/CloudLocal.icns',
    ]);

    const executable = path.join(candidateRoot, 'CloudLocal.app', 'Contents', 'MacOS', 'cloudlocal');
    assert.equal(fs.readFileSync(executable).length, 128 * 1024, 'binary is copied into the bundle');
    if (process.platform !== 'win32') {
      assert.equal(fs.statSync(executable).mode & 0o777, 0o755, 'bundle executable is 0755');
    }

    const plistText = fs.readFileSync(path.join(candidateRoot, 'CloudLocal.app', 'Contents', 'Info.plist'), 'utf8');
    assert.match(plistText, /^<\?xml version="1\.0"/, 'a real XML property list');
    assert.match(plistText, /<\/plist>\s*$/);
    const info = plistValues(plistText);
    assert.equal(info.CFBundleExecutable, 'cloudlocal');
    assert.equal(info.CFBundleIconFile, 'CloudLocal.icns');
    assert.equal(info.CFBundleIdentifier, 'com.cloudlocal.app');
    assert.equal(info.CFBundlePackageType, 'APPL');
    assert.equal(info.CFBundleShortVersionString, '0.1.4');
    assert.equal(info.CFBundleVersion, '0.1.4');
    assert.ok(info.CFBundleName && info.CFBundleDisplayName, 'names Finder shows');
    assert.equal(info.NSHighResolutionCapable, true);

    const icns = fs.readFileSync(path.join(candidateRoot, 'CloudLocal.app', 'Contents', 'Resources', 'CloudLocal.icns'));
    assert.equal(icns.toString('ascii', 0, 4), 'icns');
    assert.equal(icns.readUInt32BE(4), icns.length, 'icns declares its own size');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('Linux payload adds a desktop entry, an icon and a rootless installer', () => {
  const { dir, candidateRoot } = writeCandidate('linux');
  try {
    assert.deepEqual(layout.collectPayload(candidateRoot),
      ['CloudLocal.desktop', 'cloudlocal-linux-x64', 'cloudlocal.png', 'install.sh']);

    const binary = path.join(candidateRoot, 'cloudlocal-linux-x64');
    assert.equal(fs.readFileSync(binary).length, 128 * 1024);
    const installer = path.join(candidateRoot, 'install.sh');
    if (process.platform !== 'win32') {
      assert.equal(fs.statSync(binary).mode & 0o777, 0o755, 'linux binary is 0755');
      assert.equal(fs.statSync(installer).mode & 0o777, 0o755, 'install.sh is 0755');
    }

    const desktop = fs.readFileSync(path.join(candidateRoot, 'CloudLocal.desktop'), 'utf8');
    assert.match(desktop, /^\[Desktop Entry\]$/m);
    assert.match(desktop, /^Type=Application$/m);
    assert.match(desktop, /^Name=CloudLocal$/m);
    assert.match(desktop, /^Exec=cloudlocal$/m);
    assert.match(desktop, /^Icon=cloudlocal$/m, 'Icon matches cloudlocal.png');
    assert.match(desktop, /^Categories=.*Utility/m);
    assert.match(desktop, /^Terminal=false$/m);

    const png = fs.readFileSync(path.join(candidateRoot, 'cloudlocal.png'));
    assert.equal(png.toString('hex', 0, 8), '89504e470d0a1a0a', 'native png, not a renamed icon');
    assert.equal(png.readUInt32BE(16), 256, 'width');
    assert.equal(png.readUInt32BE(20), 256, 'height');

    const script = fs.readFileSync(installer, 'utf8');
    assert.match(script, /^set -eu$/m, 'installer fails fast');
    assert.match(script, /\$HOME|\$\\{HOME\\}/, 'installs under the user home');
    assert.doesNotMatch(script, /\bsudo\b/, 'never requires root');
    assert.match(script, /--uninstall/, 'installer can remove what it installed');
    assert.match(script, /share\/applications/, 'registers the desktop entry');
    assert.match(script, /share\/icons/, 'installs the icon');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a missing built binary is rejected instead of producing a partial bundle', () => {
  const dir = mkFixture();
  try {
    const candidateRoot = path.join(dir, 'candidate');
    fs.mkdirSync(candidateRoot, { recursive: true });
    assert.throws(() => layout.writePayload({
      layout: layout.layoutFor('darwin'),
      candidateRoot,
      binarySource: path.join(dir, 'missing-binary'),
      resourcesDir: RESOURCES_DIR,
      version: '0.1.4',
    }), /missing-binary|not found|no such file/i);
    assert.deepEqual(layout.collectPayload(candidateRoot), [], 'nothing is written on failure');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
