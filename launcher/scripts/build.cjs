const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const esbuild = require('esbuild');
const { inject } = require('postject');

async function main() {
  if (process.platform !== 'win32') throw new Error('Windows x64 only');
  const root = path.resolve(__dirname, '../..');
  const dist = path.join(root, 'client', 'dist');
  const output = path.join(__dirname, '../dist');
  const nodeExe = path.join(path.dirname(require.resolve('node-win-x64/package.json')), 'bin/node.exe');

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

  const exePath = path.join(output, 'CloudLocal.exe');
  fs.copyFileSync(nodeExe, exePath);
  await inject(exePath, 'NODE_SEA_BLOB', fs.readFileSync(seaBlob), {
    sentinelFuse: 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2'
  });

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

  console.log(`Built CloudLocal.exe: ${exePath}`);

  // Hide console window: change subsystem from CONSOLE (3) to GUI (2)
  // node.exe has subsystem=3 (console). We change to 2 (windows/GUI) so no terminal appears.
  const exeData = fs.readFileSync(exePath);
  const peOff = exeData.readUInt32LE(0x3c);
  const optHeaderOff = peOff + 4 + 20; // PE sig + COFF header
  const subOff = optHeaderOff + 68; // PE32+ optional header field
  const curSub = exeData.readUInt16LE(subOff);
  if (curSub === 3) {
    exeData.writeUInt16LE(2, subOff);
    fs.writeFileSync(exePath, exeData);
    console.log('Console hidden (subsystem 3→2)');
  } else {
    console.log(`Subsystem already ${curSub}`);
  }

  // Inject cloud logo icon via PowerShell (uses Windows API successfully)
  const iconScript = path.join(__dirname, 'inject-icon.ps1');
  if (fs.existsSync(iconScript)) {
    try {
      const icoPath = path.join(__dirname, 'cloudlocal.ico');
      if (fs.existsSync(icoPath)) {
        const { execSync } = require('node:child_process');
        execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${iconScript}" "${exePath}" "${icoPath}"`, { stdio: 'inherit' });
      } else {
        console.warn('ICO file missing, skipping icon injection');
      }
    } catch (err) {
      console.warn('Icon injection skipped:', err.message);
    }
  }
}
main().catch(err => { console.error(err); process.exitCode = 1; });