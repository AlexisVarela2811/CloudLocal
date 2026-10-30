// launcher/test/release-verify-platforms.test.cjs — the macOS and Linux payload
// checks, exercised on any host.
//
// release-verify.cjs only validates the host platform's candidate, so without
// these tests the .app and .desktop checks would never run on a Windows
// development machine. The structural checkers are exported and driven here.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const layout = require('../scripts/release-layout.cjs');
const verify = require('../scripts/release-verify.cjs');

const RESOURCES_DIR = path.join(__dirname, '..', 'resources');

function buildPayload(platformKey) {
  const dir = fs.mkdtempSync(path.join(__dirname, '..', '..', '.cache', 'verify-plat-'));
  const candidateRoot = path.join(dir, 'candidate');
  fs.mkdirSync(candidateRoot, { recursive: true });
  const binarySource = path.join(dir, 'built-binary');
  fs.writeFileSync(binarySource, Buffer.alloc(128 * 1024, 3));
  layout.writePayload({
    layout: layout.layoutFor(platformKey),
    candidateRoot,
    binarySource,
    resourcesDir: RESOURCES_DIR,
    version: '0.1.4',
  });
  // The macOS version check reads the product version from candidate.json.
  fs.writeFileSync(path.join(candidateRoot, 'candidate.json'), JSON.stringify({ productVersion: '0.1.4' }, null, 2) + '\n');
  return { dir, candidateRoot };
}

function withPayload(platformKey, run) {
  const { dir, candidateRoot } = buildPayload(platformKey);
  try {
    run(candidateRoot);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('a well-formed macOS bundle has no structural problems', () => {
  withPayload('darwin', candidateRoot => {
    assert.deepEqual(verify.macBundleProblems(candidateRoot), []);
  });
});

test('macOS bundle reports a wrong CFBundleIconFile and a broken .icns', () => {
  withPayload('darwin', candidateRoot => {
    const plistPath = path.join(candidateRoot, layout.APP_INFO_PLIST);
    fs.writeFileSync(plistPath, fs.readFileSync(plistPath, 'utf8')
      .replace('<string>CloudLocal.icns</string>', '<string>Other.icns</string>')
      .replace('<string>APPL</string>', '<string>APPL</string>'));
    assert.deepEqual(verify.macBundleProblems(candidateRoot), ['CFBundleIconFile must be CloudLocal.icns']);

    fs.writeFileSync(plistPath, layout.infoPlist('0.1.4'));
    const iconPath = path.join(candidateRoot, layout.APP_ICON);
    fs.writeFileSync(iconPath, 'not an icon');
    const problems = verify.macBundleProblems(candidateRoot);
    assert.ok(problems.some(problem => problem.includes('Apple icon image')), problems.join('; '));
  });
});

test('macOS bundle reports a version that disagrees with candidate.json', () => {
  withPayload('darwin', candidateRoot => {
    fs.writeFileSync(path.join(candidateRoot, 'candidate.json'), JSON.stringify({ productVersion: '0.2.0' }) + '\n');
    const problems = verify.macBundleProblems(candidateRoot);
    assert.ok(problems.some(problem => problem.includes('CFBundleShortVersionString')), problems.join('; '));
  });
});

test('a well-formed Linux payload has no structural problems', () => {
  withPayload('linux', candidateRoot => {
    assert.deepEqual(verify.linuxExtrasProblems(candidateRoot), []);
  });
});

test('Linux payload reports a desktop entry, an icon and an installer that do not match', () => {
  withPayload('linux', candidateRoot => {
    const desktopPath = path.join(candidateRoot, layout.LINUX_DESKTOP_ENTRY);
    fs.writeFileSync(desktopPath, fs.readFileSync(desktopPath, 'utf8')
      .replace('Icon=cloudlocal', 'Icon=other')
      .replace('Type=Application', 'Type=Link'));
    assert.deepEqual(verify.linuxExtrasProblems(candidateRoot), [
      'CloudLocal.desktop Type must be Application',
      'CloudLocal.desktop Icon must be cloudlocal',
    ]);
  });

  withPayload('linux', candidateRoot => {
    fs.writeFileSync(path.join(candidateRoot, layout.LINUX_ICON), 'not a png');
    const problems = verify.linuxExtrasProblems(candidateRoot);
    assert.deepEqual(problems, ['cloudlocal.png is not a PNG']);
  });

  withPayload('linux', candidateRoot => {
    const installerPath = path.join(candidateRoot, layout.LINUX_INSTALLER);
    fs.writeFileSync(installerPath, '#!/bin/sh\ninstall_app() { :; }\ninstall_app\n');
    const problems = verify.linuxExtrasProblems(candidateRoot);
    assert.deepEqual(problems, ['install.sh must document its --uninstall mode']);
  });
});

test('scanCandidate reports a symlink or a special file instead of hashing it', () => withPayload('linux', candidateRoot => {
  const linkPath = path.join(candidateRoot, 'linked');
  try {
    fs.symlinkSync(path.join(candidateRoot, layout.LINUX_BINARY), linkPath);
  } catch {
    return; // Windows without symlink privilege: nothing to scan here.
  }
  const scan = verify.scanCandidate(candidateRoot);
  assert.ok(scan.problems.some(problem => problem.startsWith('symlink in payload')), scan.problems.join('; '));
}));

test('readZipEntries normalizes the ./ prefix the Windows archiver writes', () => {
  // Build a tiny zip by hand: one stored entry named "./payload.txt", mode 0755.
  const name = './payload.txt';
  const data = Buffer.from('hello');
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0, 6);
  local.writeUInt16LE(0, 8);
  local.writeUInt32LE(0, 14);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(0x031e, 4); // made by unix
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0, 8);
  central.writeUInt16LE(0, 10);
  central.writeUInt32LE(0, 16);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(name.length, 28);
  central.writeUInt32LE((0o100755 * 0x10000) >>> 0, 38);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  const centralOffset = local.length + name.length + data.length;
  eocd.writeUInt32LE(central.length + name.length, 12);
  eocd.writeUInt32LE(centralOffset, 16);

  const dir = fs.mkdtempSync(path.join(__dirname, '..', '..', '.cache', 'zip-test-'));
  try {
    const zipPath = path.join(dir, 'handmade.zip');
    fs.writeFileSync(zipPath, Buffer.concat([local, Buffer.from(name), data, central, Buffer.from(name), eocd]));
    const entries = verify.readZipEntries(zipPath);
    assert.equal(entries.get('payload.txt').mode, 0o755);
    assert.equal(entries.get('payload.txt').directory, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
