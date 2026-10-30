const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const esbuild = require('esbuild');
const { inject } = require('postject');
const layout = require('./release-layout.cjs');

// Host platform → executable name and platform id, from release-layout.cjs so the
// built artifact, the candidate payload and the verification never disagree. The
// SEA base binary is always process.execPath: the Node that runs this build. Node
// SEA requires the blob and the base binary to come from the same Node build, and
// npm platform packages for node binaries are incomplete (node-darwin-arm64
// stopped at 18), so each OS builds its own asset with its own interpreter.

async function main() {
  const platform = layout.layoutFor(process.platform);
  if (!platform) throw new Error('Unsupported platform: ' + process.platform);
  // Refuse to produce an artifact the asset name would mislabel.
  if (platform.arch !== process.arch) {
    throw new Error(platform.id + ' targets ' + platform.arch + ', but this host is ' +
      process.platform + '-' + process.arch + '. Published targets are windows-x64, linux-x64 and darwin-arm64.');
  }
  const root = path.resolve(__dirname, '../..');
  const dist = path.join(root, 'client', 'dist');
  const output = path.join(__dirname, '../dist');

  const nodeExe = process.execPath;

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

  const exePath = path.join(output, platform.binary);
  fs.copyFileSync(nodeExe, exePath);

  if (process.platform === 'darwin') {
    // macOS: the downloaded node binary is ad-hoc signed; injection invalidates
    // the signature, so strip it first and re-sign ad-hoc afterwards. The app
    // stays unsigned for Gatekeeper purposes (no notarization), like Windows
    // builds are for SmartScreen.
    execFileSync('codesign', ['--remove-signature', exePath], { stdio: 'inherit' });
    await inject(exePath, 'NODE_SEA_BLOB', fs.readFileSync(seaBlob), {
      sentinelFuse: 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
      // Mach-O: the blob must be a NODE_SEA_BLOB section inside a segment
      // named NODE_SEA, or the SEA loader never finds it and the binary
      // segfaults at boot (nodejs/postject#97).
      machoSegmentName: 'NODE_SEA',
    });
    // Ad-hoc re-sign with the JIT entitlements V8 needs on Apple Silicon.
    const entitlements = path.join(__dirname, '../resources/darwin-entitlements.plist');
    execFileSync('codesign', ['--sign', '-', '--force', '--entitlements', entitlements, exePath], { stdio: 'inherit' });
    execFileSync('codesign', ['--verify', '--strict', exePath], { stdio: 'inherit' });
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

  console.log(`Built ${platform.binary} (${platform.id}): ${exePath}`);
}
main().catch(err => { console.error(err); process.exitCode = 1; });
