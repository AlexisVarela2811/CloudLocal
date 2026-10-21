const os = require('node:os');
const path = require('node:path');
const sea = require('node:sea');
const { start } = require('../../server/src/server');
const { urlsFor } = require('../../server/src/network');
const { launch, materializeAssets } = require('./runtime.cjs');

try {
  if (!sea.isSea()) throw new Error('Run the compiled CloudLocal.exe, not its source bundle');
  const home = os.homedir();
  const clientDir = materializeAssets(path.join(home, '.cloudlocal', 'runtime'),
    CLOUDLOCAL_ASSETS, name => sea.getAsset(name));
  launch({ home, env: process.env, proc: process, log: console.log, start, urlsFor, clientDir });
} catch (error) {
  console.error('CloudLocal cannot start:', error.message);
  process.exitCode = 1;
}
