'use strict';

// launcher/scripts/release-layout.cjs — single source of truth for the files a
// release candidate carries on each platform.
//
// build.cjs, release.cjs, release-verify.cjs and smoke.cjs all read these names,
// so a payload file or an asset name cannot drift between the build, the
// checksums, the verification and the published archive.
const fs = require('node:fs');
const path = require('node:path');

// Files every candidate carries, on top of its platform payload.
const COMMON_FILES = [
  'LICENSE',
  'NODE-LICENSE.txt',
  'THIRD-PARTY-NOTICES.txt',
  'README.md',
  'RELEASE-NOTES.md',
  'candidate.json',
  'SHA256SUMS',
];
// SHA256SUMS never lists itself.
const CHECKSUMMED_COMMON_FILES = COMMON_FILES.filter(file => file !== 'SHA256SUMS');

// macOS: the executable lives inside an .app bundle so Finder shows the icon.
const APP_BUNDLE = 'CloudLocal.app';
const APP_EXECUTABLE = APP_BUNDLE + '/Contents/MacOS/cloudlocal';
const APP_INFO_PLIST = APP_BUNDLE + '/Contents/Info.plist';
const APP_ICON = APP_BUNDLE + '/Contents/Resources/CloudLocal.icns';

// Linux: a loose binary plus what a desktop menu entry needs.
const LINUX_BINARY = 'cloudlocal-linux-x64';
const LINUX_DESKTOP_ENTRY = 'CloudLocal.desktop';
const LINUX_ICON = 'cloudlocal.png';
const LINUX_INSTALLER = 'install.sh';

// Host platform → published identity. `binary` is the file build.cjs produces in
// launcher/dist; only the Windows build ships that name as-is.
const PLATFORMS = {
  win32: { id: 'windows-x64', arch: 'x64', kind: 'windows', binary: 'CloudLocal.exe' },
  linux: { id: 'linux-x64', arch: 'x64', kind: 'linux', binary: LINUX_BINARY },
  darwin: { id: 'darwin-arm64', arch: 'arm64', kind: 'macos', binary: 'cloudlocal-darwin-arm64' },
};

// Resource files, taken from launcher/resources, that each kind needs.
const KIND_RESOURCES = {
  windows: [],
  linux: [
    { resource: 'CloudLocal.desktop', target: LINUX_DESKTOP_ENTRY, mode: 0o644 },
    { resource: 'cloudlocal.png', target: LINUX_ICON, mode: 0o644 },
    { resource: 'install.sh', target: LINUX_INSTALLER, mode: 0o755 },
  ],
  macos: [{ resource: 'CloudLocal.icns', target: APP_ICON, mode: 0o644 }],
};

function layoutFor(platformKey) {
  const entry = PLATFORMS[platformKey];
  if (!entry) return null;
  return { ...entry, platformKey };
}

// Every file the candidate carries, in payload order. These are exactly the
// entries SHA256SUMS must cover.
function payloadPaths(layout) {
  if (!layout) return [];
  const payload = layout.kind === 'macos'
    ? [APP_INFO_PLIST, APP_EXECUTABLE, APP_ICON]
    : [layout.binary, ...KIND_RESOURCES[layout.kind].map(resource => resource.target)];
  return [...payload, ...CHECKSUMMED_COMMON_FILES];
}

// Recursive list of regular files under `root`, as posix relative paths.
function collectPayload(root) {
  const files = [];
  function walk(dir) {
    for (const name of fs.readdirSync(dir).sort()) {
      const full = path.join(dir, name);
      const stat = fs.lstatSync(full);
      if (stat.isDirectory()) walk(full);
      else if (stat.isFile()) files.push(path.relative(root, full).split(path.sep).join('/'));
    }
  }
  if (fs.existsSync(root)) walk(root);
  return files.sort();
}

function infoPlist(version) {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    '<dict>',
    '  <key>CFBundleDevelopmentRegion</key>',
    '  <string>es</string>',
    '  <key>CFBundleDisplayName</key>',
    '  <string>CloudLocal</string>',
    '  <key>CFBundleExecutable</key>',
    '  <string>cloudlocal</string>',
    '  <key>CFBundleIconFile</key>',
    '  <string>CloudLocal.icns</string>',
    '  <key>CFBundleIdentifier</key>',
    '  <string>com.cloudlocal.app</string>',
    '  <key>CFBundleInfoDictionaryVersion</key>',
    '  <string>6.0</string>',
    '  <key>CFBundleName</key>',
    '  <string>CloudLocal</string>',
    '  <key>CFBundlePackageType</key>',
    '  <string>APPL</string>',
    '  <key>CFBundleShortVersionString</key>',
    `  <string>${version}</string>`,
    '  <key>CFBundleVersion</key>',
    `  <string>${version}</string>`,
    '  <key>LSMinimumSystemVersion</key>',
    '  <string>11.0</string>',
    '  <key>NSHighResolutionCapable</key>',
    '  <true/>',
    '  <key>NSHumanReadableCopyright</key>',
    '  <string>MIT License</string>',
    '</dict>',
    '</plist>',
    '',
  ].join('\n');
}

function copyWithMode(source, target, mode) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
  // Windows has no unix mode bits; the archive tools used on Linux/macOS keep them.
  if (process.platform !== 'win32') fs.chmodSync(target, mode);
}

// Writes the platform payload into an existing candidate directory. Every input
// is validated before the first write so a failure never leaves a half bundle.
function writePayload({ layout, candidateRoot, binarySource, resourcesDir, version }) {
  if (!layout) throw new Error('Unsupported platform layout');
  if (!fs.existsSync(binarySource)) {
    throw new Error('Built binary not found: ' + binarySource);
  }
  const missing = KIND_RESOURCES[layout.kind]
    .map(resource => path.join(resourcesDir, resource.resource))
    .filter(file => !fs.existsSync(file));
  if (missing.length > 0) {
    throw new Error('Missing packaging resource: ' + missing.join(', '));
  }

  if (layout.kind === 'windows') {
    copyWithMode(binarySource, path.join(candidateRoot, layout.binary), 0o644);
    return;
  }

  if (layout.kind === 'linux') {
    copyWithMode(binarySource, path.join(candidateRoot, LINUX_BINARY), 0o755);
  } else {
    copyWithMode(binarySource, path.join(candidateRoot, APP_EXECUTABLE), 0o755);
    copyWithMode(path.join(resourcesDir, 'CloudLocal.icns'), path.join(candidateRoot, APP_ICON), 0o644);
    const plistPath = path.join(candidateRoot, APP_INFO_PLIST);
    fs.mkdirSync(path.dirname(plistPath), { recursive: true });
    fs.writeFileSync(plistPath, infoPlist(version));
    // Fixed mode: the umask must not decide what release-verify accepts.
    if (process.platform !== 'win32') fs.chmodSync(plistPath, 0o644);
  }
  for (const resource of KIND_RESOURCES[layout.kind]) {
    copyWithMode(path.join(resourcesDir, resource.resource), path.join(candidateRoot, resource.target), resource.mode);
  }
}

module.exports = {
  COMMON_FILES,
  CHECKSUMMED_COMMON_FILES,
  PLATFORMS,
  APP_BUNDLE,
  APP_EXECUTABLE,
  APP_INFO_PLIST,
  APP_ICON,
  LINUX_BINARY,
  LINUX_DESKTOP_ENTRY,
  LINUX_ICON,
  LINUX_INSTALLER,
  layoutFor,
  payloadPaths,
  writePayload,
  collectPayload,
  infoPlist,
};
