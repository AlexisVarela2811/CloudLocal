const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { packagedOptions, materializeAssets, launch } = require('../src/runtime.cjs');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cloudlocal-launcher-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test('packaged defaults keep files, state and UI cache disjoint; explicit data/state overrides survive', t => {
  const home = fixture(t);
  const defaults = packagedOptions({}, home);
  assert.deepEqual(defaults, {
    dataDir: path.join(home, '.cloudlocal', 'files'),
    stateDir: path.join(home, '.cloudlocal', 'state')
  });
  assert.deepEqual(packagedOptions({ CLOUDLOCAL_DATA_DIR: '/old/files', CLOUDLOCAL_STATE_DIR: '/old/state' }, home),
    { dataDir: '/old/files', stateDir: '/old/state' });
});

test('SEA assets are extracted from embedded bytes into private cache and do not overwrite existing content', t => {
  const home = fixture(t);
  const assets = { 'index.html': Buffer.from('<h1>UI</h1>'), 'assets/app.js': Buffer.from('ready') };
  const cache = materializeAssets(path.join(home, '.cloudlocal', 'runtime'), Object.keys(assets), name => assets[name]);
  assert.equal(fs.readFileSync(path.join(cache, 'index.html'), 'utf8'), '<h1>UI</h1>');
  assert.equal(fs.readFileSync(path.join(cache, 'assets', 'app.js'), 'utf8'), 'ready');
  fs.writeFileSync(path.join(cache, 'index.html'), 'existing');
  assert.equal(materializeAssets(path.join(home, '.cloudlocal', 'runtime'), Object.keys(assets), name => assets[name]), cache);
  assert.equal(fs.readFileSync(path.join(cache, 'index.html'), 'utf8'), 'existing');
  assert.throws(() => materializeAssets(cache, ['../escape'], () => Buffer.from('x')), /Invalid asset path/);
});

test('launcher starts server only, advertises fallback URLs and stops publisher and server on shutdown', async t => {
  const home = fixture(t);
  const calls = [];
  const listeners = {};
  const proc = { env: { HOST: '127.0.0.1', PORT: '0', CLOUDLOCAL_NO_MDNS: '1' }, on: (signal, cb) => { listeners[signal] = cb; }, once: (signal, cb) => { listeners[signal] = cb; } };
  const server = { listening: true, address: () => ({ port: 42512 }), close: cb => { calls.push('close'); cb?.(); } };
  const app = { locals: { closeDeviceHub: () => calls.push('hub') } };
  const logs = [];
  const result = launch({ home, env: proc.env, proc, log: message => logs.push(message),
    start: opts => { calls.push(opts); queueMicrotask(() => opts.onReady(42512)); return { app, server, shutdown: () => { calls.push('shutdown'); app.locals.closeDeviceHub(); server.close(); } }; },
    urlsFor: port => [`http://127.0.0.1:${port}`], publish: () => { calls.push('publish'); return { stop: () => calls.push('stop') }; } });
  assert.equal(calls[0].dataDir, path.join(home, '.cloudlocal', 'files'));
  assert.equal(calls[0].clientDir, undefined);
  assert.equal(calls.includes('publish'), false);
  await new Promise(resolve => setImmediate(resolve));
  assert.match(logs.join('\n'), /http:\/\/127\.0\.0\.1:42512/);
  assert.match(logs.join('\n'), /Ctrl\+C/);
  listeners.SIGINT();
  assert.deepEqual(calls.slice(1), ['shutdown', 'hub', 'close']);
  assert.equal(result.server, server);
});
