const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function packagedOptions(env, home) {
  const base = path.join(home, '.cloudlocal');
  return { dataDir: env.CLOUDLOCAL_DATA_DIR || path.join(base, 'files'),
    stateDir: env.CLOUDLOCAL_STATE_DIR || path.join(base, 'state') };
}

function materializeAssets(cache, names, getAsset) {
  const entries = names.map(name => {
    if (!/^[a-zA-Z0-9_-][a-zA-Z0-9_.\/-]*$/.test(name) || name.split('/').some(part => !part || part === '.' || part === '..'))
      throw new Error('Invalid asset path');
    return [name, Buffer.from(getAsset(name))];
  });
  const digest = crypto.createHash('sha256');
  for (const [name, bytes] of entries) digest.update(name).update('\0').update(bytes);
  const destination = path.join(cache, digest.digest('hex').slice(0, 24));
  for (const [name, bytes] of entries) {
    const file = path.join(destination, ...name.split('/'));
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    try { fs.writeFileSync(file, bytes, { flag: 'wx', mode: 0o600 }); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
  }
  return destination;
}

function launch({ home, env, proc, log, start, urlsFor, publish, clientDir }) {
  const options = { ...packagedOptions(env, home), ...(clientDir ? { clientDir } : {}) };
  // start owns the preferred-port/fallback-port logic; choose 80 only for this executable.
  if (env.CLOUDLOCAL_PORT === undefined && env.PORT === undefined) env.CLOUDLOCAL_PORT = '80';
  let publisher;
  let stopped = false;
  function ready(port) {
    const urls = urlsFor(port);
    log(`CloudLocal ready. Open ${urls.join(' or ')} in a browser (same local network).`);
    log('Set up a password at localhost first. HTTP on this network is not encrypted. Stop with Ctrl+C.');
    if (env.CLOUDLOCAL_NO_MDNS !== '1') {
      if (publish) { publisher = publish(port, { warn: message => log(message) }); }
      else { publisher = { stop: () => {} }; }
      log('Try http://cloudlocal.local' + (port === 80 ? '' : `:${port}`) + ' if mDNS works; use the IP link above otherwise.');
    }
  }
  const instance = start({ ...options, onReady: ready });
  function shutdown() {
    if (stopped) return;
    stopped = true;
    publisher?.stop();
    instance.shutdown();
  }
  proc.once('SIGINT', shutdown);
  proc.once('SIGTERM', shutdown);
  // A piped stdin closing is also a graceful stop for supervised isolated runs.
  if (proc.stdin && !proc.stdin.isTTY) {
    proc.stdin.once('end', shutdown);
    proc.stdin.resume();
  }
  return instance;
}
module.exports = { packagedOptions, materializeAssets, launch };
