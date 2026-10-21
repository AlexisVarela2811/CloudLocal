// Explicit native-artifact probe; never run as part of unit tests.
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../..');
const exe = path.join(root, 'launcher/dist/CloudLocal.exe');

async function main() {
  const cache = path.join(root, '.cache');
  await fs.mkdir(cache, { recursive: true });
  const fixture = await fs.mkdtemp(path.join(cache, 'sea-smoke-'));
  const env = { ...process.env, HOST: '127.0.0.1', PORT: '0', CLOUDLOCAL_NO_MDNS: '1',
    CLOUDLOCAL_DATA_DIR: path.join(fixture, 'files'), CLOUDLOCAL_STATE_DIR: path.join(fixture, 'state'),
    USERPROFILE: fixture, HOME: fixture };
  delete env.CLOUDLOCAL_PORT;
  let child;
  try {
    child = spawn(exe, [], { env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    const exit = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
    const deadline = Date.now() + 15000;
    let match;
    while (!(match = /http:\/\/127\.0\.0\.1:(\d+)/.exec(stdout))) {
      if (child.exitCode !== null || Date.now() > deadline) throw new Error(`No ready URL; stdout=${stdout} stderr=${stderr}`);
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    const base = `http://127.0.0.1:${match[1]}`;
    let response = await fetch(base + '/', { headers: { Accept: 'text/html' } });
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.match(html, /<html/i);
    const asset = /(?:src|href)="(\/assets\/[^" ]+)"/.exec(html);
    assert.ok(asset, 'compiled client asset referenced');
    response = await fetch(base + asset[1]);
    assert.equal(response.status, 200);
    assert.ok((await response.arrayBuffer()).byteLength > 0);
    const json = (route, body) => fetch(base + route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    assert.deepEqual(await (await fetch(base + '/api/session')).json(), { configured: false, authenticated: false, localSetup: true });
    response = await json('/api/setup', { password: 'correct horse battery' });
    assert.equal(response.status, 201);
    let cookie = response.headers.get('set-cookie').split(';')[0];
    response = await json('/api/login', { password: 'correct horse battery' });
    assert.equal(response.status, 200);
    cookie = response.headers.get('set-cookie').split(';')[0];
    const bytes = Buffer.from([0, 255, 17, 42, 0, 99]);
    const form = () => { const data = new FormData(); data.append('file', new Blob([bytes]), 'probe.bin'); return data; };
    const upload = () => fetch(base + '/api/files/upload', { method: 'POST', headers: { Cookie: cookie }, body: form() });
    assert.equal((await upload()).status, 201);
    assert.equal((await upload()).status, 409);
    response = await fetch(base + '/api/files/content?path=probe.bin', { headers: { Cookie: cookie } });
    assert.equal(response.status, 200);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
    child.stdin.end();
    const result = await Promise.race([exit, new Promise((_, reject) => setTimeout(() => reject(new Error('Shutdown timed out')), 5000))]);
    assert.deepEqual(result, { code: 0, signal: null });
    child = null;
    await assert.rejects(fetch(base + '/api/session'));
    console.log('PASS native SEA UI/assets, setup/login, byte upload/download, collision and shutdown');
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM');
      await new Promise(resolve => child.once('exit', resolve));
    }
    await fs.rm(fixture, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
