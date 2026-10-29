const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const esbuild = require('esbuild');
const { inject } = require('postject');

// Host platform → Node binary package, executable name and platform id.
// npm installs only the matching optionalDependency on each OS, so builds
// always target the host (no cross-compilation): each OS builds its own
// release asset.
const PLATFORMS = {
  win32: { pkg: 'node-win-x64', bin: 'bin/node.exe', exe: 'CloudLocal.exe', id: 'windows-x64' },
  linux: { pkg: 'node-linux-x64', bin: 'bin/node', exe: 'cloudlocal-linux-x64', id: 'linux-x64' },
  darwin: { pkg: 'node-darwin-arm64', bin: 'bin/node', exe: 'cloudlocal-darwin-arm64', id: 'darwin-arm64' },
};

async function main() {
  const platform = PLATFORMS[process.platform];
  if (!platform) throw new Error('Unsupported platform: ' + process.platform);
  const root = path.resolve(__dirname, '../..');
  const dist = path.join(root, 'client', 'dist');
  const output = path.join(__dirname, '../dist');

  let nodeExe;
  try {
    nodeExe = path.join(path.dirname(require.resolve(platform.pkg + '/package.json')), platform.bin);
  } catch {
    throw new Error(platform.pkg + ' is not installed — npm only installs the optional dependency matching the host platform, so this build must run on ' + platform.id);
  }

  const assets = {};
  function collect(dir, base) {
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, item.name);
      if (item.isDirectory()) collect(file, base);
      else if (item.isFile()) assets[path.relative(base, file).split(path.sep).join('/')] = file;
    }
  }
  if (!fs.existsSync(path.join(dist, 'index.html'))) {
    throw new Error('Build client/dist first');
  }
  collect(dist, dist);

  fs.mkdirSync(output, { recursive: true });
  const bundle = path.join(output, 'server.cjs');
  await esbuild.build({
    entryPoints: [path.join(root, 'launcher/src/main.cjs')],
    outfile: bundle,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    define: { CLOUDLOCAL_ASSETS: JSON.stringify(Object.keys(assets)) }
  });

  const seaConfig = path.join(output, 'sea.json');
  const seaBlob = path.join(output, 'sea.blob');
  fs.writeFileSync(seaConfig, JSON.stringify({
    main: bundle, output: seaBlob, assets, disableExperimentalSEAWarning: true
  }));
  execFileSync(nodeExe, ['--experimental-sea-config', seaConfig], { stdio: 'inherit' });

  const exePath = path.join(output, platform.exe);
  fs.copyFileSync(nodeExe, exePath);

  if (process.platform === 'darwin') {
    // macOS: the downloaded node binary is ad-hoc signed; injection invalidates
    // the signature, so strip it first and re-sign ad-hoc afterwards. The app
    // stays unsigned for Gatekeeper purposes (no notarization), like Windows
    // builds are for SmartScreen.
    execFileSync('codesign', ['--remove-signature', exePath], { stdio: 'inherit' });
    await inject(exePath, 'NODE_SEA_BLOB', fs.readFileSync(seaBlob), {
      sentinelFuse: 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2'
    });
    execFileSync('codesign', ['--sign', '-', exePath], { stdio: 'inherit' });
  } else {
    await inject(exePath, 'NODE_SEA_BLOB', fs.readFileSync(seaBlob), {
      sentinelFuse: 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2'
    });
  }

  if (process.platform !== 'win32') {
    fs.chmodSync(exePath, 0o755);
  }

  if (process.platform === 'win32') {
    // Hide console window: change subsystem from CONSOLE (3) to GUI (2)
    // node.exe has subsystem=3 (console). We change to 2 (windows/GUI) so no terminal appears.
    const data = fs.readFileSync(exePath);
    const peOffset = data.readUInt32LE(0x3c);
    const optHeaderOffset = peOffset + 4 + 20; // PE sig + COFF header
    const subsystemOffset = optHeaderOffset + 68; // PE32+ optional header field
    const currentSubsys = data.readUInt16LE(subsystemOffset);
    if (currentSubsys === 3) {
      data.writeUInt16LE(2, subsystemOffset);
      fs.writeFileSync(exePath, data);
      console.log('Console hidden (subsystem 3→2)');
    } else {
      console.log(`Subsystem already ${currentSubsys}`);
    }

    // Inject cloud logo icon via PowerShell (uses Windows API successfully)
    const iconScript = path.join(__dirname, 'inject-icon.ps1');
    if (fs.existsSync(iconScript)) {
      try {
        const icoPath = path.join(__dirname, 'cloudlocal.ico');
        if (fs.existsSync(icoPath)) {
          execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', iconScript, exePath, icoPath], { stdio: 'inherit' });
        } else {
          console.warn('ICO file missing, skipping icon injection');
        }
      } catch (err) {
        console.warn('Icon injection skipped:', err.message);
      }
    }
  }

  console.log(`Built ${platform.exe} (${platform.id}): ${exePath}`);
}
main().catch(err => { console.error(err); process.exitCode = 1; });
