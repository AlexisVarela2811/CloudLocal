// Explicit native-artifact probe; never run as part of unit tests.
const fs = require('node:fs/promises');
const fss = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');
const { chromium, expect } = require('@playwright/test');
const layout = require('./release-layout.cjs');
const root = path.resolve(__dirname, '../..');

const LAYOUT = layout.layoutFor(process.platform);
if (!LAYOUT) throw new Error('Unsupported platform for smoke: ' + process.platform);

// Release candidate under test: an explicit argument, else the single candidate
// this host built, else the loose binary in launcher/dist.
function resolveArtifact() {
  const releaseRoot = path.join(root, 'launcher/dist/release');
  const suffix = '-' + LAYOUT.id;
  const candidates = fss.existsSync(releaseRoot)
    ? fss.readdirSync(releaseRoot).filter(name => name.endsWith(suffix) &&
        fss.statSync(path.join(releaseRoot, name)).isDirectory()).sort()
    : [];
  const explicit = process.argv[2];
  if (explicit && !fss.existsSync(explicit)) {
    throw new Error('Release candidate directory not found: ' + explicit);
  }
  const candidateDir = explicit ? path.resolve(explicit)
    : candidates.length > 0 ? path.join(releaseRoot, candidates[candidates.length - 1])
      : null;
  const executable = candidateDir
    ? path.join(candidateDir, LAYOUT.kind === 'macos' ? layout.APP_EXECUTABLE : LAYOUT.binary)
    : path.join(root, 'launcher/dist', LAYOUT.binary);
  return { candidateDir, executable };
}

// The packaged layout must be what the user extracts, not just a binary: the
// .app bundle on macOS, the desktop entry, the icon and the installer on Linux.
function assertPayload(candidateDir) {
  const must = (relative) => {
    const full = path.join(candidateDir, relative);
    assert.ok(fss.existsSync(full), 'candidate payload is missing ' + relative);
    return full;
  };
  for (const file of layout.COMMON_FILES) must(file);
  if (LAYOUT.kind === 'windows') {
    must(LAYOUT.binary);
    return;
  }
  if (LAYOUT.kind === 'macos') {
    assert.ok(fss.lstatSync(must(layout.APP_BUNDLE)).isDirectory(), 'CloudLocal.app must be a directory');
    const executable = must(layout.APP_EXECUTABLE);
    assert.ok(fss.statSync(executable).mode & 0o111, 'bundle executable must be executable');
    const plist = fss.readFileSync(must(layout.APP_INFO_PLIST), 'utf8');
    assert.match(plist, /<key>CFBundleExecutable<\/key>\s*<string>cloudlocal<\/string>/);
    assert.equal(fss.readFileSync(must(layout.APP_ICON)).toString('ascii', 0, 4), 'icns');
    return;
  }
  const binary = must(layout.LINUX_BINARY);
  assert.ok(fss.statSync(binary).mode & 0o111, 'linux binary must be executable');
  assert.ok(fss.statSync(must(layout.LINUX_INSTALLER)).mode & 0o111, 'install.sh must be executable');
  assert.match(fss.readFileSync(must(layout.LINUX_DESKTOP_ENTRY), 'utf8'), /^Exec=/m);
  assert.equal(fss.readFileSync(must(layout.LINUX_ICON)).toString('hex', 0, 8), '89504e470d0a1a0a');
}

const artifact = resolveArtifact();
const exe = artifact.executable;
if (!fss.existsSync(exe)) {
  throw new Error('Packaged executable not found: ' + exe + ' (run "npm run build:exe" first)');
}
if (artifact.candidateDir) assertPayload(artifact.candidateDir);

async function main() {
  const cache = path.join(root, '.cache');
  await fs.mkdir(cache, { recursive: true });
  const fixture = await fs.mkdtemp(path.join(cache, 'sea-smoke-'));
  const env = { ...process.env, HOST: '127.0.0.1', PORT: '0', CLOUDLOCAL_NO_MDNS: '1',
    CLOUDLOCAL_DATA_DIR: path.join(fixture, 'files'), CLOUDLOCAL_STATE_DIR: path.join(fixture, 'state'),
    USERPROFILE: fixture, HOME: fixture, TEMP: fixture, TMP: fixture, TMPDIR: fixture };
  delete env.CLOUDLOCAL_PORT;
  let child;
  const browser = await chromium.launch({ headless: true });
  try {
    child = spawn(exe, [], { env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    const exit = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
    const deadline = Date.now() + 15000;
    let match;
    while (!(match = /http:\/\/127\.0\.0\.1:(\d+)/.exec(stdout))) {
      if (child.exitCode !== null || child.signalCode || Date.now() > deadline) throw new Error(`No ready URL (exit=${child.exitCode}, signal=${child.signalCode}); stdout=${stdout} stderr=${stderr}`);
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
    const page = await browser.newPage();
    const [cookieName, cookieValue] = cookie.split('=');
    await page.context().addCookies([{ name: cookieName, value: cookieValue, url: base + '/api', httpOnly: true, sameSite: 'Strict' }]);
    await page.goto(base);
    await expect(page.locator('.shortcut-hint')).toHaveText('Ctrl+Alt+N');
    const stop = page.getByRole('button', { name: 'Apagar servidor', exact: true });
    await expect(stop).toBeEnabled();
    await stop.click();
    let timer;
    const result = await Promise.race([exit, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Shutdown timed out; stdout=${stdout} stderr=${stderr}`)), 6000);
    })]).finally(() => clearTimeout(timer));
    assert.deepEqual(result, { code: 0, signal: null }, `stdout=${stdout} stderr=${stderr}`);
    assert.equal(stderr, '');
    assert.match(stdout, /CloudLocal: shutting down\.\.\./);
    assert.match(stdout, /CloudLocal: stopped/);
    child = null;
    await assert.rejects(fetch(base + '/api/session', { signal: AbortSignal.timeout(1000) }));
    console.log('PASS native SEA UI/assets, setup/login, byte upload/download, collision, shortcut hint and browser-button process shutdown');
    console.log('  Artifact: ' + (artifact.candidateDir || path.join(root, 'launcher', 'dist')));
    if (artifact.candidateDir) {
      console.log('  Payload layout: ' + LAYOUT.kind + ' — ' + layout.payloadPaths(LAYOUT).join(', '));
    }
  } finally {
    await browser.close();
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM');
      await new Promise(resolve => child.once('exit', resolve));
    }
    // Windows can briefly keep file handles alive after process exit (AV,
    // endpoint protection, deferred handle release). Cleanup is best-effort
    // and must never mask a passing smoke run.
    for (let attempt = 0; ; attempt++) {
      try {
        await fs.rm(fixture, { recursive: true, force: true });
        break;
      } catch (error) {
        if (attempt >= 4 || (error.code !== 'EBUSY' && error.code !== 'EPERM')) {
          console.warn(`WARN: could not remove smoke fixture ${fixture}: ${error.message}`);
          break;
        }
        await new Promise(resolve => setTimeout(resolve, 250));
      }
    }
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
