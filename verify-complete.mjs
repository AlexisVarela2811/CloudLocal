import { chromium } from 'playwright';
import { spawn } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, readdirSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT = resolve(__dirname);

function log(msg) { console.log(`[verify] ${msg}`); }

// Start server
const server = spawn('node', [resolve(PROJECT, 'server/src/server.js')], {
  cwd: PROJECT,
  stdio: 'ignore',
  env: { ...process.env, CLOUDLOCAL_PORT: '3457' }
});
log('Server started on :3457 (PID ' + server.pid + ')');

// Start Vite (keep it alive!)
const vite = spawn('node', [
  resolve(PROJECT, 'client/node_modules/vite/bin/vite.js'),
  '--port', '5173',
  '--host', '127.0.0.1'
], {
  cwd: resolve(PROJECT, 'client'),
  stdio: 'pipe'
});
vite.stdout.on('data', d => {
  const txt = d.toString();
  if (txt.includes('ready') || txt.includes('localhost')) {
    log('Vite: ' + txt.trim());
  }
});
log('Vite started on :5173');

// Wait for Vite
await new Promise(r => setTimeout(r, 5000));

// Check ports
const { default: net } = await import('net');
async function portOpen(port) {
  return new Promise(res => {
    const s = new net.Socket();
    s.setTimeout(2000);
    s.on('connect', () => { s.destroy(); res(true); });
    s.on('error', () => res(false));
    s.connect(port, '127.0.0.1');
  });
}

const serverOk = await portOpen(3457);
const viteOk = await portOpen(5173);
log(`Server :3457: ${serverOk ? '✅' : '❌'}`);
log(`Vite :5173: ${viteOk ? '✅' : '❌'}`);

if (!viteOk) {
  log('❌ Vite did not start. Exiting.');
  server.kill();
  vite.kill();
  process.exit(1);
}

const SCREENSHOTS_DIR = resolve(__dirname, 'screenshots');
if (!existsSync(SCREENSHOTS_DIR)) {
  import('fs').then(fs => fs.default.mkdirSync(SCREENSHOTS_DIR, { recursive: true }));
}

function ss(page, name) {
  const f = `${SCREENSHOTS_DIR}/${name}.png`;
  try {
    page.screenshot({ path: f, fullPage: true });
    log(`📸 ${f}`);
  } catch (e) { log(`❌ screenshot: ${e.message}`); }
  return f;
}

try {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  page.setDefaultTimeout(15000);

  // Intercept /api/session to make app think we're logged in
  await page.route('/api/**', async route => {
    const url = route.request().url();
    if (url.includes('/api/session')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ configured: true, authenticated: true }),
      });
      return;
    }
    await route.continue();
  });

  log('\n🧪 Opening login page...');
  await page.goto('http://localhost:5173', { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);

  // Take screenshot of current state
  await ss(page, 'Z01-FIRST-PAGE');

  // Check what's showing
  const hasAccessPanel = await page.evaluate(() => !!document.querySelector('.access-panel'));
  const hasAppShell = await page.evaluate(() => !!document.querySelector('.app-shell'));
  const bodyCls = await page.evaluate(() => document.body?.className || 'none');
  log(`.access-panel: ${hasAccessPanel}`);
  log(`.app-shell: ${hasAppShell}`);
  log(`body.className: ${bodyCls}`);

  // Check page source
  const title = await page.title();
  log(`Page title: ${title}`);

  // Get first 300 chars of body text
  const bodyTxt = await page.evaluate(() => {
    const b = document.body;
    if (!b) return 'no body';
    return (b.innerText || b.textContent || '').substring(0, 300);
  });
  log(`Body text: ${bodyTxt}`);

  // List top-level elements
  const elements = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('*'))
      .slice(0, 20)
      .map(e => `${e.tagName}${e.className ? '.' + e.className.split(' ')[0] : ''}`)
      .join(' > ');
  });
  log(`DOM top: ${elements}`);

  if (hasAccessPanel) {
    log('\n✅ Login panel found!');
    await ss(page, 'Z02-LOGIN-PANEL');
    
    // Check dark mode
    await page.evaluate(() => localStorage.setItem('cloudlocal-theme', 'dark'));
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);
    await ss(page, 'Z03-LOGIN-DARK');

    const darkCheck = await page.evaluate(() => {
      const p = document.querySelector('.access-panel');
      if (!p) return { error: 'panel gone' };
      const cs = window.getComputedStyle(p);
      return {
        bg: cs.backgroundColor,
        text: cs.color,
        white: cs.backgroundColor === 'rgb(255, 255, 255)',
        dark: cs.backgroundColor === 'rgb(30, 41, 59)',
      };
    });
    log(`Dark mode: bg=${darkCheck.bg}, text=${darkCheck.text}, white=${darkCheck.white}, dark=${darkCheck.dark}`);
    log(`${!darkCheck.white && darkCheck.dark ? '✅' : '❌'} Dark mode works`);

  } else if (hasAppShell) {
    log('\n✅ App shell found (already logged in)!');
    await ss(page, 'Z02-APP-ROOT');

    // Check back button
    const backRoot = await page.evaluate(() => {
      const b = document.querySelector('.btn-back');
      if (!b) return { exists: false };
      const cs = window.getComputedStyle(b);
      return { exists: true, display: cs.display, visible: cs.display !== 'none' };
    });
    log(`Back button at root: ${JSON.stringify(backRoot)}`);
    log(`${!backRoot.exists || !backRoot.visible ? '✅' : '❌'} PASS`);

    // Create folder and navigate
    try {
      const btn = await page.$('button');
      if (btn) {
        await btn.click();
        await page.waitForTimeout(500);
        await ss(page, 'Z04-FORM');
        await page.fill('#folder-name', 'TestFolder');
        const createBtn = await page.$('button:has-text("Crear")');
        if (createBtn) {
          await createBtn.click();
          await page.waitForTimeout(1500);
          await ss(page, 'Z05-CREATED');
          
          await page.click('button:has-text("TestFolder")');
          await page.waitForTimeout(1500);
          await ss(page, 'Z06-INSIDE');

          const backFolder = await page.evaluate(() => {
            const b = document.querySelector('.btn-back');
            if (!b) return { exists: false };
            const cs = window.getComputedStyle(b);
            return { exists: true, display: cs.display, visible: cs.display !== 'none' };
          });
          log(`Back button in folder: ${JSON.stringify(backFolder)}`);
          log(`${backFolder.exists && backFolder.visible ? '✅' : '❌'} PASS`);
        }
      }
    } catch (e) { log(`⚠️ Folder test: ${e.message}`); }

    // Upload button
    const upload = await page.evaluate(() => {
      const b = document.querySelector('.card-upload .btn-accent');
      if (!b) return null;
      const cs = getComputedStyle(b);
      return { display: cs.display, width: cs.width, w100: cs.width.includes('100%') };
    });
    log(`Upload button: ${JSON.stringify(upload)}`);
    log(`${upload?.display === 'block' && upload?.w100 ? '✅' : '❌'} PASS`);

    // Card spacing
    const pad = await page.evaluate(() => {
      const c = document.querySelector('.card-content');
      if (!c) return null;
      const cs = getComputedStyle(c);
      return { pad: cs.padding, top: cs.paddingTop };
    });
    log(`Card padding: ${JSON.stringify(pad)}`);
    log(`${pad && (pad.pad === '1rem' || pad.top === '1rem') && !pad.pad.includes('1.25') ? '✅' : '❌'} PASS`);

    // Dark mode app
    await page.evaluate(() => localStorage.setItem('cloudlocal-theme', 'dark'));
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(500);
    await ss(page, 'Z07-DARK-APP');
    const appBg = await page.evaluate(() => document.body ? window.getComputedStyle(document.body).backgroundColor : 'N/A');
    log(`App dark bg: ${appBg} ${!appBg.includes('255') ? '✅' : '❌'}`);

  } else {
    log('\n❌ Neither .access-panel nor .app-shell found!');
    log('DOM elements:');
    await page.evaluate(() => {
      document.querySelectorAll('*').forEach((el, i) => {
        if (i < 30) console.log(`  ${el.tagName}${el.className ? '.' + el.className.split(' ')[0] : ''}`);
      });
    });
  }

  await browser.close();

  log('\n══════════════════════════════════════════════');
  log('         PLAYWRIGHT VERIFICATION COMPLETE');
  log('══════════════════════════════════════════════');
  log('\nScreenshots:');
  readdirSync(SCREENSHOTS_DIR).sort().forEach(f => log(`  📸 ${f}`));

} catch (err) {
  log(`❌ Error: ${err.message}`);
}

// Cleanup
log('\nStopping servers...');
server.kill();
vite.kill();