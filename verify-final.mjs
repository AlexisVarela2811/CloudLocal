import { chromium } from 'playwright';
import { spawn } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, readdirSync } from 'fs';
import net from 'net';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT = resolve(__dirname);
const SCREENSHOTS_DIR = resolve(__dirname, 'screenshots');

function log(msg) { console.log(`[v] ${msg}`); }

async function portOpen(port) {
  return new Promise(res => {
    const s = new net.Socket();
    s.setTimeout(2000);
    s.on('connect', () => { s.destroy(); res(true); });
    s.on('error', () => res(false));
    s.connect(port, '127.0.0.1');
  });
}

async function ss(page, name) {
  const f = `${SCREENSHOTS_DIR}/${name}.png`;
  try {
    await page.screenshot({ path: f, fullPage: true });
    log(`📸 ${f}`);
  } catch (e) { log(`❌ screenshot error: ${e.message}`); }
}

// Start server
const server = spawn('node', [resolve(PROJECT, 'server/src/server.js')], {
  cwd: PROJECT, stdio: 'ignore',
  env: { ...process.env, CLOUDLOCAL_PORT: '3457' }
});
log('Server :3457 started');

// Start Vite
const vite = spawn('node', [
  resolve(PROJECT, 'client/node_modules/vite/bin/vite.js'),
  '--port', '5173', '--host', '127.0.0.1'
], { cwd: resolve(PROJECT, 'client'), stdio: 'pipe' });
vite.stdout.on('data', d => { if (d.toString().includes('ready')) log('Vite ready'); });
log('Vite :5173 started');

await new Promise(r => setTimeout(r, 5000));

const srvOk = await portOpen(3457);
const viteOk = await portOpen(5173);
if (!srvOk || !viteOk) { log('❌ Ports not ready'); server.kill(); vite.kill(); process.exit(1); }

if (!existsSync(SCREENSHOTS_DIR)) {
  import('fs').then(fs => fs.default.mkdirSync(SCREENSHOTS_DIR, { recursive: true }));
}

let results = [];
let browser;
let page;

try {
  browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  page = await ctx.newPage();
  page.setDefaultTimeout(15000);

  // Intercept /api/session
  await page.route('/api/**', async route => {
    if (route.request().url().includes('/api/session')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ configured: true, authenticated: true }) });
      return;
    }
    await route.continue();
  });

  // ── Test 1: Login light ──
  log('\n🧪 TEST 1: Login light mode');
  await page.goto('http://localhost:5173', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  await ss(page, 'R01-LOGIN-LIGHT');
  const hasPanel = await page.evaluate(() => !!document.querySelector('.access-panel'));
  log(`  .access-panel: ${hasPanel ? '✅' : '❌'}`);
  results.push({ test: 'Login panel visible', pass: hasPanel });

  // ── Test 2: Login dark ──
  log('\n🧪 TEST 2: Login dark mode');
  await page.evaluate(() => localStorage.setItem('cloudlocal-theme', 'dark'));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  await ss(page, 'R02-LOGIN-DARK');

  const darkCheck = await page.evaluate(() => {
    const p = document.querySelector('.access-panel');
    if (!p) return { bg: 'none', text: 'none' };
    const cs = window.getComputedStyle(p);
    return { bg: cs.backgroundColor, text: cs.color };
  });
  log(`  Card bg: ${darkCheck.bg}`);
  log(`  Card text: ${darkCheck.text}`);
  const f2 = !darkCheck.bg.includes('255, 255, 255') && darkCheck.bg.includes('30, 41, 59');
  log(`  ${f2 ? '✅' : '❌'} PASS (dark bg #1e293b)`);
  results.push({ test: 'Login dark mode', pass: f2, detail: `bg=${darkCheck.bg}` });

  // ── Test 3: Login to app ──
  log('\n🧪 TEST 3: App after login (session mocked)');
  await page.evaluate(() => localStorage.setItem('cloudlocal-theme', 'light'));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  await ss(page, 'R03-APP-ROOT');

  const hasApp = await page.evaluate(() => !!document.querySelector('.app-shell'));
  log(`  .app-shell: ${hasApp ? '✅' : '❌'}`);
  if (hasApp) {
    results.push({ test: 'App shell loaded', pass: true });
    log('  ✅ PASS');

    // ── Test 4: Back button at root ──
    log('\n🧪 TEST 4: Back button at root (should be hidden)');
    const backRoot = await page.evaluate(() => {
      const b = document.querySelector('.btn-back');
      if (!b) return { exists: false };
      const cs = window.getComputedStyle(b);
      return { exists: true, display: cs.display };
    });
    log(`  ${JSON.stringify(backRoot)}`);
    const f4 = !backRoot.exists || backRoot.display === 'none';
    log(`  ${f4 ? '✅' : '❌'} PASS`);
    results.push({ test: 'Back button hidden at root', pass: f4 });

    // ── Test 5: Create folder, navigate, back visible ──
    log('\n🧪 TEST 5: Back button inside folder');
    try {
      const btns = await page.$$('button');
      let created = false;
      for (const btn of btns) {
        const text = await btn.textContent();
        if (text?.includes('Nueva carpeta')) {
          await btn.click();
          await page.waitForTimeout(500);
          await ss(page, 'R04-FOLDER-FORM');
          await page.fill('#folder-name', 'TestFolder');
          await page.waitForTimeout(500);
          const submitBtns = await page.$$('button');
          for (const sb of submitBtns) {
            const st = await sb.textContent();
            if (st?.includes('Crear')) {
              await sb.click();
              await page.waitForTimeout(2000);
              await ss(page, 'R05-FOLDER-CREATED');
              created = true;
              break;
            }
          }
          if (created) break;
        }
      }
      if (created) {
        // Click on TestFolder to navigate
        const folderBtns = await page.$$('button');
        for (const fb of folderBtns) {
          const ft = await fb.textContent();
          if (ft?.includes('TestFolder')) {
            await fb.click();
            await page.waitForTimeout(2000);
            await ss(page, 'R06-INSIDE-FOLDER');
            break;
          }
        }

        const backFolder = await page.evaluate(() => {
          const b = document.querySelector('.btn-back');
          if (!b) return { exists: false };
          const cs = window.getComputedStyle(b);
          return { exists: true, display: cs.display, visible: cs.display !== 'none' };
        });
        log(`  Back in folder: ${JSON.stringify(backFolder)}`);
        const f5 = backFolder.exists && backFolder.visible;
        log(`  ${f5 ? '✅' : '❌'} PASS`);
        results.push({ test: 'Back button visible in folder', pass: f5 });
      } else {
        log('  ⚠️ Folder creation failed');
        results.push({ test: 'Back in folder', pass: false, detail: 'folder creation failed' });
      }
    } catch (e) {
      log(`  ❌ ${e.message}`);
      results.push({ test: 'Back in folder', pass: false, detail: e.message });
    }

    // ── Test 6: Upload button ──
    log('\n🧪 TEST 6: Upload button alignment');
    const upload = await page.evaluate(() => {
      const b = document.querySelector('.card-upload .btn-accent');
      if (!b) return null;
      const cs = getComputedStyle(b);
      return { display: cs.display, width: cs.width, w100: cs.width.includes('100%'), ml: cs.marginLeft };
    });
    log(`  ${JSON.stringify(upload)}`);
    const f6 = upload?.display === 'block' && (upload.w100 || upload.width === '100%');
    log(`  ${f6 ? '✅' : '❌'} PASS (block + 100%)`);
    results.push({ test: 'Upload button alignment', pass: f6 });

    // ── Test 7: Card spacing ──
    log('\n🧪 TEST 7: Card spacing (card-content padding)');
    const pad = await page.evaluate(() => {
      const c = document.querySelector('.card-content');
      if (!c) return null;
      const cs = getComputedStyle(c);
      return { pad: cs.padding, top: cs.paddingTop };
    });
    log(`  ${JSON.stringify(pad)}`);
    const f7 = pad && (pad.pad === '1rem' || pad.top === '1rem' || pad.top === '16px') && !pad.pad.includes('1.25');
    log(`  ${f7 ? '✅' : '❌'} PASS (1rem)`);
    results.push({ test: 'Card spacing 1rem', pass: f7 });

    // ── Test 8: Dark mode app ──
    log('\n🧪 TEST 8: Dark mode inside app');
    await page.evaluate(() => localStorage.setItem('cloudlocal-theme', 'dark'));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1000);
    await ss(page, 'R07-DARK-APP');
    const appBg = await page.evaluate(() => {
      const b = document.body;
      return b ? window.getComputedStyle(b).backgroundColor : 'N/A';
    });
    log(`  App bg: ${appBg}`);
    const f8 = !appBg.includes('255, 255, 255');
    log(`  ${f8 ? '✅' : '❌'} PASS (dark)`);
    results.push({ test: 'App dark mode', pass: f8 });

  } else {
    log('  ❌ FAIL — App shell not loaded');
    results.push({ test: 'App shell loaded', pass: false });
  }

} catch (err) {
  log(`\n❌ Fatal error: ${err.message}`);
  try { await ss(page, 'R00-ERROR'); } catch (e) {}
}

// Results
log('\n═══════════════════════════════════════════════');
log('            FINAL RESULTS');
log('═══════════════════════════════════════════════\n');

let allPass = true;
results.forEach((r, i) => {
  const s = r.pass ? '✅' : '❌';
  log(`  ${s} ${r.test}${r.detail ? ' — ' + r.detail : ''}`);
  if (!r.pass) allPass = false;
});

log('\n📸 Screenshots:');
readdirSync(SCREENSHOTS_DIR).sort().forEach(f => log(`  ${f}`));

log(`\n${allPass ? '🎉 ALL TESTS PASSED' : '⚠️  SOME TESTS FAILED'}`);

// Cleanup
server.kill();
vite.kill();
if (browser) await browser.close();
process.exit(allPass ? 0 : 1);