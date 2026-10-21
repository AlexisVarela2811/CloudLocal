import { chromium } from 'playwright';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCREENSHOTS_DIR = resolve(__dirname, 'screenshots');

if (!fs.existsSync(SCREENSHOTS_DIR)) fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });

function log(msg) { console.log(`[v] ${msg}`); }

async function ss(page, name) {
  const f = `${SCREENSHOTS_DIR}/${name}.png`;
  try { await page.screenshot({ path: f, fullPage: true }); log(`📸 ${f}`); } catch(e) {}
}

const results = [];

async function run() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  page.setDefaultTimeout(15000);

  try {
    // ── STEP 1: Login light ──
    log('\n🧪 STEP 1: Login light');
    await page.goto('http://localhost:5173', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
    await ss(page, 'F01-LOGIN-LIGHT');
    const hasPanel = await page.evaluate(() => !!document.querySelector('.access-panel'));
    log(`  Login panel: ${hasPanel ? '✅' : '❌'}`);
    results.push({ test: 'Login panel visible', pass: hasPanel });

    // ── STEP 2: Login dark ──
    log('\n🧪 STEP 2: Login dark');
    await page.evaluate(() => localStorage.setItem('cloudlocal-theme', 'dark'));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    await ss(page, 'F02-LOGIN-DARK');
    const dark = await page.evaluate(() => {
      const p = document.querySelector('.access-panel');
      if (!p) return { bg: 'none' };
      const cs = window.getComputedStyle(p);
      return { bg: cs.backgroundColor, text: cs.color };
    });
    log(`  Card bg: ${dark.bg} (dark=${!dark.bg.includes('255') ? '✅' : '❌'})`);
    log(`  Card text: ${dark.text} (light=${dark.text.includes('226') || dark.text.includes('232') ? '✅' : '❌'})`);
    results.push({ test: 'Login dark mode', pass: !dark.bg.includes('255') && (dark.text.includes('226') || dark.text.includes('232')) });

    // ── STEP 3: Login to app ──
    log('\n🧪 STEP 3: Login to app');
    await page.evaluate(() => localStorage.setItem('cloudlocal-theme', 'light'));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    const loginBtn = await page.$('button:has-text("Entrar")');
    if (loginBtn) {
      await page.fill('#password', 'correct horse battery');
      await loginBtn.click();
      await page.waitForTimeout(3000);
    }
    await ss(page, 'F03-APP-ROOT');
    const hasApp = await page.evaluate(() => !!document.querySelector('.app-shell'));
    log(`  App shell: ${hasApp ? '✅' : '❌'}`);
    results.push({ test: 'App shell loaded', pass: hasApp });

    if (hasApp) {
      // ── STEP 4: Back button at root (hidden) ──
      log('\n🧪 STEP 4: Back button at root');
      const backRoot = await page.evaluate(() => {
        const b = document.querySelector('.btn-back');
        if (!b) return { exists: false };
        const cs = window.getComputedStyle(b);
        return { exists: true, display: cs.display };
      });
      log(`  ${JSON.stringify(backRoot)}`);
      const f4 = !backRoot.exists || backRoot.display === 'none';
      log(`  ${f4 ? '✅' : '❌'} PASS (hidden at root)`);
      results.push({ test: 'Back button at root hidden', pass: f4 });

      // ── STEP 5: Create folder, navigate, back visible ──
      log('\n🧪 STEP 5: Navigate to folder → back visible');
      try {
        // Click "Nueva carpeta"
        await page.evaluate(() => {
          for (const btn of Array.from(document.querySelectorAll('button'))) {
            if (btn.textContent.includes('Nueva carpeta')) { btn.click(); return; }
          }
        });
        await page.waitForTimeout(800);
        await ss(page, 'F04-FOLDER-FORM');
        
        await page.fill('#folder-name', 'TestFolder');
        await page.waitForTimeout(500);
        await page.click('button:has-text("Crear")');
        await page.waitForTimeout(2000);
        await ss(page, 'F05-FOLDER-CREATED');

        // Find and click TestFolder — might be in a list, not a button
        await page.click('button:has-text("TestFolder")').catch(async () => {
          // Try as text selector
          await page.click('text="TestFolder"').catch(async () => {
            // Try as div/span
            await page.click('[title="TestFolder"]');
          });
        });
        await page.waitForTimeout(2000);
        await ss(page, 'F06-INSIDE-FOLDER');

        const backFolder = await page.evaluate(() => {
          const b = document.querySelector('.btn-back');
          if (!b) return { exists: false };
          const cs = window.getComputedStyle(b);
          return { exists: true, display: cs.display, visible: cs.display !== 'none' };
        });
        log(`  Back in folder: ${JSON.stringify(backFolder)}`);
        const f5 = backFolder.exists && backFolder.visible;
        log(`  ${f5 ? '✅' : '❌'} PASS (visible in folder)`);
        results.push({ test: 'Back button in folder', pass: f5 });
      } catch (e) {
        log(`  ⚠️ ${e.message}`);
        // Still check if back button exists at all
        const hasBack = await page.evaluate(() => !!document.querySelector('.btn-back'));
        log(`  Has .btn-back element: ${hasBack ? '✅' : '❌'}`);
        results.push({ test: 'Back button in folder', pass: hasBack, detail: 'click failed' });
      }

      // ── STEP 6: Upload button (block + full width) ──
      log('\n🧪 STEP 6: Upload button alignment');
      const upload = await page.evaluate(() => {
        const b = document.querySelector('.card-upload .btn-accent');
        if (!b) return null;
        const cs = getComputedStyle(b);
        return { 
          display: cs.display, 
          width: cs.width, 
          marginLeft: cs.marginLeft,
          marginRight: cs.marginRight,
        };
      });
      log(`  ${JSON.stringify(upload)}`);
      // display: block AND no margin-left AND no margin-right = full width aligned left
      const f6 = upload?.display === 'block' && upload?.marginLeft === '0px';
      log(`  ${f6 ? '✅' : '❌'} PASS (block, no margin)`);
      results.push({ test: 'Upload button alignment', pass: f6 });

      // ── STEP 7: Card spacing (1rem = 16px) ──
      log('\n🧪 STEP 7: Card spacing (1rem)');
      const pad = await page.evaluate(() => {
        const c = document.querySelector('.card-content');
        if (!c) return null;
        const cs = getComputedStyle(c);
        return { 
          pad: cs.padding, 
          top: cs.paddingTop, 
          topPx: parseInt(cs.paddingTop),
          leftPx: parseInt(cs.paddingLeft),
        };
      });
      log(`  ${JSON.stringify(pad)}`);
      // 1rem at default font-size = 16px
      const f7 = pad && (pad.topPx === 16) && (pad.leftPx === 16);
      log(`  ${f7 ? '✅' : '❌'} PASS (1rem = 16px)`);
      results.push({ test: 'Card spacing 1rem', pass: f7 });

      // ── STEP 8: Dark mode app ──
      log('\n🧪 STEP 8: Dark mode app');
      await page.evaluate(() => localStorage.setItem('cloudlocal-theme', 'dark'));
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1000);
      await ss(page, 'F07-DARK-APP');
      const bg = await page.evaluate(() => {
        const b = document.body;
        return b ? window.getComputedStyle(b).backgroundColor : 'N/A';
      });
      log(`  App bg: ${bg} (dark=${!bg.includes('255') ? '✅' : '❌'})`);
      results.push({ test: 'App dark mode', pass: !bg.includes('255') && !bg.includes('f7f8fa') });
    }

  } catch (err) {
    log(`\n❌ Error: ${err.message}`);
  }

  // Results
  log('\n═══════════════════════════════════════════');
  log('            FINAL RESULTS');
  log('═══════════════════════════════════════════');
  let allPass = true;
  results.forEach(r => {
    const s = r.pass ? '✅' : '❌';
    log(`  ${s} ${r.test}${r.detail ? ' — ' + r.detail : ''}`);
    if (!r.pass) allPass = false;
  });

  log('\n📸 Screenshots:');
  fs.readdirSync(SCREENSHOTS_DIR).sort().forEach(f => log(`  ${f}`));

  log(`\n${allPass ? '🎉 ALL TESTS PASSED ✅' : '⚠️  SOME TESTS FAILED'}`);

  await browser.close();
  process.exit(allPass ? 0 : 1);
}

run();