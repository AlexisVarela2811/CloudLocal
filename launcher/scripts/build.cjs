const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const esbuild = require('esbuild');
const { inject } = require('postject');

async function main() {
  if (process.platform !== 'win32') throw new Error('This build produces only a Windows x64 executable');
  const root = path.resolve(__dirname, '../..');
  const dist = path.join(root, 'client/dist');
  const output = path.join(__dirname, '../dist');
  const nodeExe = path.join(path.dirname(require.resolve('node-win-x64/package.json')), 'bin/node.exe');
  if (!fs.existsSync(nodeExe)) throw new Error('Pinned Node 22.23.2 Windows binary missing');
  const assets = {};
  function collect(dir) {
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, item.name);
      if (item.isDirectory()) collect(file);
      else if (item.isFile()) assets[path.relative(dist, file).split(path.sep).join('/')] = file;
    }
  }
  if (!fs.existsSync(path.join(dist, 'index.html'))) throw new Error('Build client/dist first');
  collect(dist);
  fs.mkdirSync(output, { recursive: true });
  const bundle = path.join(output, 'server.cjs');
  await esbuild.build({ entryPoints: [path.join(root, 'launcher/src/main.cjs')], outfile: bundle,
    bundle: true, platform: 'node', format: 'cjs', target: 'node22',
    define: { CLOUDLOCAL_ASSETS: JSON.stringify(Object.keys(assets)) } });
  const config = path.join(output, 'sea.json');
  const blob = path.join(output, 'sea.blob');
  fs.writeFileSync(config, JSON.stringify({ main: bundle, output: blob, assets, disableExperimentalSEAWarning: true }));
  execFileSync(nodeExe, ['--experimental-sea-config', config], { stdio: 'inherit' });
  const exe = path.join(output, 'CloudLocal.exe');
  fs.copyFileSync(nodeExe, exe);
  await inject(exe, 'NODE_SEA_BLOB', fs.readFileSync(blob), {
    sentinelFuse: 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2'
  });
  console.log(`Built unsigned Windows x64 server: ${exe}`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
