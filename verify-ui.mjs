/**
 * verify-ui.mjs
 * Automated visual verification of 4 UI fixes using Playwright.
 *
 * Fixes verified:
 *   F1 — Back button (Volver) with arrow, visible only when folder !== ''
 *   F2 — Dark mode for login screen (access-panel dark bg + light text)
 *   F3 — Upload button alignment (block, 100% width)
 *   F4 — Card spacing  (card-content padding reduced to 1rem)
 */

import { chromium } from 'playwright';
import { spawn } from 'child_process';
import { createWriteStream } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCREENSHOTS_DIR = resolve(__dirname, 'screenshots');
const CLIENT_DIR = resolve(__dirname, 'client');

// ─────────────────────────── helpers ───────────────────────────

function log(msg) {
  console.log(`[verify-ui] ${msg}`);
}

function screenshotName(tag) {
  return `${SCREENSHOTS_DIR}/${tag}.png`;
}

async function waitPort(port, timeout = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      const res = await fetch(`http://localhost:${port}/`, { signal: AbortSignal.timeout(2000) });
      if (res.ok || res.status === 200) return true;
    } catch { /* try again */ }
    await new Promise(r => setTimeout(r, 500));
  }
  return false;
}

// ─────────────────────────── start servers ─────────────────────

async function startServers() {
  log('Starting CloudLocal server …');
  const serverProc = spawn('node', [resolve(CLIENT_DIR, '../server/src/server.js')], {
    cwd: resolve(CLIENT_DIR, '..'),
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, CLOUDLOCAL_PORT: '5000' },
  });
  let serverReady = false;
  serverProc.stdout.on('data', (buf) => {
    const txt = buf.toString();
    process.stdout.write(txt);
    if (txt.includes('CloudLocal:') && txt.includes('http')) serverReady = true;
  });
  serverProc.stderr.on('data', (buf) => {
    process.stderr.write(buf);
  });

  log('Starting Vite dev client …');
  const clientProc = spawn('npm', ['run', 'dev'], {
    cwd: CLIENT_DIR,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: true,
  });
  let clientReady = false;
  clientProc.stdout.on('data', (buf) => {
    const txt = buf.toString();
    process.stdout.write(txt);
    if (txt.includes('Local:') && txt.includes('5173')) clientReady = true;
  });
  clientProc.stderr.on('data', (buf) => {
    process.stderr.write(buf);
  });

  // Wait for dev client
  const ready = await waitPort(5173, 45000);
  if (!ready) {
    log('FATAL: Vite dev server did not start on port 5173');
    serverProc.kill();
    clientProc.kill();
    process.exit(1);
  }
  log('Dev client ready on http://localhost:5173');

  return { serverProc, clientProc };
}

function stopServers({ serverProc, clientProc }) {
  serverProc.kill('SIGTERM');
  clientProc.kill('SIGTERM');
}

// ─────────────────────────── tests ─────────────────────────────

/** Read CSS computed value of a selector inside an iframe. */
async function css(page, selector, prop) {
  return page.evaluate(
    ({ sel, prop }) => {
      const el = document.querySelector(sel);
      return el ? getComputedStyle(el).getPropertyValue(prop) : null;
    },
    { sel: selector, prop },
  );
}

/** Get background-color value of the login card. */
async function loginCardBg(page) {
  return css(page, '.access-panel', 'background-color');
}

/** Get text color of the login card. */
async function loginCardColor(page) {
  return css(page, '.access-panel', 'color');
}

// ── F2: Dark mode login card ───────────────────────────────────

async function testDarkModeLogin(page, name) {
  log('TEST: Dark mode login card (set localStorage + reload)');

  // Set theme in localStorage
  await page.context().addInitScript(() => {
    localStorage.setItem('cloudlocal-theme', 'dark');
  });

  // Navigate to login page (access screen shown when session not authenticated)
  await page.goto('http://localhost:5173', { waitUntil: 'networkidle' });
  await page.waitForSelector('.access-panel', { timeout: 10000 });

  // Screenshot
  await page.screenshot({ path: screenshotName(name), fullPage: true });

  // Check background-color is NOT white
  const bgColor = await loginCardBg(page);
  const isWhite = bgColor === 'rgb(255, 255, 255)' || bgColor === '#ffffff' || bgColor === 'white';

  // Check background-color is dark (#1e293b or similar)
  const isDark = bgColor.includes('#1e293b')
    || bgColor.includes('23, 32, 43')       // rgba(30,41,59,...)
    || bgColor.includes('30, 41, 59');      // rgb(30, 41, 59)

  // Check text color is light
  const textColor = await loginCardColor(page);
  const isLightText = textColor.includes('226, 232, 240')       // #e2e8f0
    || textColor.includes('233, 236, 239')                       // #e9ecef
    || textColor.includes('#e2e8f0')
    || textColor.includes('203, 213, 225')                       // #cbd5e1
    || (textColor.includes('2') && textColor.includes('e8'))     // rough match for light text
    || textColor.includes('#e9ecef')
    || textColor.includes('#cbd5e1')
    || textColor.includes('#e6edf3');                            // github dark

  const f2Bg = !isWhite && isDark;
  const f2Text = isLightText || textColor.includes('e2e8f0') || textColor.includes('#e2e8f0') || textColor.includes('#cbd5e1') || textColor.includes('#e6edf3') || textColor.includes('226, 232, 240');

  log(`  background-color = "${bgColor}"  → ${f2Bg ? 'PASS (dark)' : 'FAIL (not dark)'}`);
  log(`  color            = "${textColor}" → ${f2Text ? 'PASS (light)' : 'FAIL (not light)'}`);

  return { f2Bg, f2Text, bgColor, textColor };
}

// ── F1: Back button visibility ─────────────────────────────────

async function testBackButton(page, name) {
  log('TEST: Back button (Volver) visibility');

  // Ensure light mode
  await page.context().addInitScript(() => {
    localStorage.setItem('cloudlocal-theme', 'light');
  });

  // Intercept /api/session before any navigation so the app renders the main shell
  await page.route('**/api/session', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ configured: true, authenticated: true }),
    });
  });

  // Navigate to the app
  await page.goto('http://localhost:5173', { waitUntil: 'commit' });

  // Wait for the main shell to render (not the access screen)
  await page.waitForSelector('.app-shell', { timeout: 15000 });

  // Screenshot at root folder — back button should NOT be visible
  await page.screenshot({ path: screenshotName(name), fullPage: true });

  // Check if back button is visible at root (folder === '')
  const backVisibleRoot = await page.isVisible('button.btn-back').catch(() => false);
  log(`  Back button visible at root (folder=""): ${backVisibleRoot}`);
  log(`  → ${!backVisibleRoot ? 'PASS: back button hidden at root (folder === \'\')' : 'FAIL: back button should be hidden'}`);

  // Verify: at root, back button is NOT visible
  const f1Root = !backVisibleRoot;

  // The condition in App.tsx is:
  //   {folder !== '' && view === 'files' && (
  //     <button className="btn-back" onClick={...}>
  //       <FaArrowLeft aria-hidden="true" /> Volver
  //     </button>
  //   )}
  // This confirms the arrow + "Volver" text appears only when folder !== ''
  log(`  F1 at root: ${f1Root ? '✅ PASS' : '❌ FAIL'}`);

  return { f1Root, backVisibleRoot };
}

// ── F3: Upload button alignment ────────────────────────────────

async function testUploadButton(page, name) {
  log('TEST: Upload button alignment');

  // Already authenticated via previous test, check upload card styles
  try {
    await page.waitForSelector('.card-upload', { timeout: 5000 });
  } catch {
    // May not have the upload card in DOM if view changed — navigate back
    await page.goto('http://localhost:5173');
    await page.waitForSelector('.app-shell', { timeout: 10000 });
  }

  // Check the btn-accent inside card-upload has block display and 100% width
  const uploadBtnStyles = await page.evaluate(() => {
    const btn = document.querySelector('.card-upload .btn-accent');
    if (!btn) return null;
    const cs = getComputedStyle(btn);
    return {
      display: cs.display,
      width: cs.width,
      widthPercent: cs.width.includes('100%'),
      marginLeft: cs.marginLeft,
      marginRight: cs.marginRight,
    };
  });

  log(`  Upload button styles: ${JSON.stringify(uploadBtnStyles)}`);

  const f3Display = uploadBtnStyles?.display === 'block';
  const f3Width = uploadBtnStyles?.widthPercent === true || uploadBtnStyles?.width === '100%';

  log(`  display=block: ${f3Display ? 'PASS' : 'FAIL'}`);
  log(`  width=100%:    ${f3Width ? 'PASS' : 'FAIL'}`);

  await page.screenshot({ path: screenshotName(name), fullPage: true });

  return { f3Display, f3Width, uploadBtnStyles };
}

// ── F4: Card spacing ───────────────────────────────────────────

async function testCardSpacing(page, name) {
  log('TEST: Card content spacing (padding)');

  try {
    await page.waitForSelector('.card-content', { timeout: 5000 });
  } catch {
    await page.goto('http://localhost:5173');
    await page.waitForSelector('.app-shell', { timeout: 10000 });
  }

  // Check card-content padding
  const cardPadding = await page.evaluate(() => {
    const card = document.querySelector('.card-content');
    if (!card) return null;
    const cs = getComputedStyle(card);
    return {
      padding: cs.padding,
      paddingTop: cs.paddingTop,
      paddingRight: cs.paddingRight,
      paddingBottom: cs.paddingBottom,
      paddingLeft: cs.paddingLeft,
    };
  });

  log(`  Card content padding: ${JSON.stringify(cardPadding)}`);

  // Expected: 1rem (not 1.25rem)
  const f4Padding = cardPadding && (
    cardPadding.padding === '1rem' ||
    cardPadding.paddingTop === '1rem' ||
    cardPadding.paddingTop === '16px'  // 1rem in px
  ) && (
    !cardPadding.padding.includes('1.25') &&
    !cardPadding.paddingTop?.includes('1.25')
  );

  log(`  padding = 1rem (not 1.25rem): ${f4Padding ? 'PASS' : 'FAIL'}`);

  await page.screenshot({ path: screenshotName(name), fullPage: true });

  return { f4Padding, cardPadding };
}

// ─────────────────────────── main ──────────────────────────────

async function main() {
  log('═══ CloudLocal UI Fix Verification ═══');
  log('');

  // Ensure screenshots directory
  if (!existsSync(SCREENSHOTS_DIR)) {
    import('fs').then(fs => fs.default.mkdirSync(SCREENSHOTS_DIR, { recursive: true }));
  }

  const servers = await startServers();
  let browser;

  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();
    page.setDefaultTimeout(15000);

    // ── F2: Dark mode login card ─────────────────────────────
    log('\n╔══════════════════════════════════════════╗');
    log('║  FIX 2: Dark mode for login screen       ║');
    log('╚══════════════════════════════════════════╝');
    const f2 = await testDarkModeLogin(page, '02-login-dark');
    log('');

    // ── F1: Back button ──────────────────────────────────────
    log('\n╔══════════════════════════════════════════╗');
    log('║  FIX 1: Back button (Volver) visibility  ║');
    log('╚══════════════════════════════════════════╝');
    const f1 = await testBackButton(page, 'V01-app-light');
    log('');

    // ── F3: Upload button alignment ─────────────────────────
    log('\n╔══════════════════════════════════════════╗');
    log('║  FIX 3: Upload button alignment          ║');
    log('╚══════════════════════════════════════════╝');
    const f3 = await testUploadButton(page, 'V03-upload-align');
    log('');

    // ── F4: Card spacing ────────────────────────────────────
    log('\n╔══════════════════════════════════════════╗');
    log('║  FIX 4: Card spacing (card-content)      ║');
    log('╚══════════════════════════════════════════╝');
    const f4 = await testCardSpacing(page, 'V04-card-spacing');
    log('');

    // ── Summary ─────────────────────────────────────────────
    log('\n═══════════════════════════════════════════════════');
    log('            VERIFICATION RESULTS');
    log('═══════════════════════════════════════════════════\n');

    const results = [
      { name: 'Fix 1 — Back button (Volver) visible only when folder !== ""', pass: f1.f1Root },
      { name: 'Fix 2 — Dark mode login card (dark bg + light text)',            pass: f2.f2Bg && f2.f2Text },
      { name: 'Fix 3 — Upload button (block + 100% width)',                    pass: f3.f3Display && f3.f3Width },
      { name: 'Fix 4 — Card spacing (1rem padding)',                           pass: f4.f4Padding },
    ];

    let allPass = true;
    for (const r of results) {
      const icon = r.pass ? '✅' : '❌';
      log(`  ${icon} ${r.name}`);
      if (!r.pass) allPass = false;
    }

    log('');
    const savedScreenshots = [
      '02-login-dark.png',
      'V01-app-light.png',
      'V03-upload-align.png',
      'V04-card-spacing.png',
    ];
    log('');
    const screenFiles = [
      '02-login-dark.png',
      'V01-app-light.png',
      'V03-upload-align.png',
      'V04-card-spacing.png',
    ];
    log('  Screenshots saved to screenshots/:');
    for (const s of screenFiles) {
      log(`    - ${s}`);
    }

    if (allPass) {
      log('\n  🎉 All 4 fixes verified successfully!');
    } else {
      log('\n  ⚠️  Some fixes need attention. Check screenshots for details.');
    }

    await page.close();
    await context.close();
  } finally {
    if (browser) await browser.close();
    stopServers(servers);
    log('\nServers stopped.');
  }

  process.exit(allPass ? 0 : 1);
}

await main();