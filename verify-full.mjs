import { chromium } from 'playwright';
import { execSync } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCREENSHOTS_DIR = resolve(__dirname, 'screenshots');

function log(msg) { console.log(`[verify] ${msg}`); }
function ss(page, name) {
  const f = `${SCREENSHOTS_DIR}/${name}.png`;
  page.screenshot({ path: f, fullPage: true }).then(() => log(`📸 ${f}`));
  return f;
}

async function main() {
  if (!existsSync(SCREENSHOTS_DIR)) {
    await import('fs').then(fs => fs.default.mkdirSync(SCREENSHOTS_DIR, { recursive: true }));
  }

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  page.setDefaultTimeout(20000);

  try {
    // Intercept /api/session BEFORE navigation so the app thinks we're logged in
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

    log('╔══════════════════════════════════════════╗');
    log('║  STEP 0: Open login page                 ║');
    log('╚══════════════════════════════════════════╝');
    await page.goto('http://localhost:5173', { waitUntil: 'networkidle' });
    await page.waitForSelector('.access-panel', { timeout: 10000 });
    await ss(page, 'S00-LOGIN-LIGHT');
    log('   ✅ Login light shown');

    log('\n╔══════════════════════════════════════════╗');
    log('║  STEP 1: Verify dark mode login          ║');
    log('╚══════════════════════════════════════════╝');
    // Switch to dark mode
    await page.evaluate(() => localStorage.setItem('cloudlocal-theme', 'dark'));
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('.access-panel', { timeout: 10000 });
    await ss(page, 'S01-LOGIN-DARK');

    const darkCheck = await page.evaluate(() => {
      const p = document.querySelector('.access-panel');
      if (!p) return { error: 'panel not found' };
      const cs = window.getComputedStyle(p);
      return {
        bg: cs.backgroundColor,
        text: cs.color,
        isWhite: cs.backgroundColor === 'rgb(255, 255, 255)',
        isDark: cs.backgroundColor === 'rgb(30, 41, 59)',
        textLight: cs.color.includes('226') || cs.color.includes('232'),
      };
    });
    log(`   Card bg: ${darkCheck.bg}`);
    log(`   Card text: ${darkCheck.text}`);
    log(`   Is dark bg: ${darkCheck.isDark ? '✅' : '❌'}`);
    log(`   Is white: ${darkCheck.isWhite ? '❌ BUG' : '✅ good'}`);
    log(`   Text light: ${darkCheck.textLight ? '✅' : '❌'}`);

    log('\n╔══════════════════════════════════════════╗');
    log('║  STEP 2: Login to app                    ║');
    log('╚══════════════════════════════════════════╝');
    // Switch back to light mode for app
    await page.evaluate(() => localStorage.setItem('cloudlocal-theme', 'light'));
    // Reload to apply
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);
    await ss(page, 'S02-BEFORE-LOGIN');

    // The session is already mocked, so app should auto-login via route interception
    // But let's verify by checking if app-shell appears
    try {
      await page.waitForSelector('.app-shell', { timeout: 8000 });
      log('   ✅ App shell loaded (session mocked via route)');
      await ss(page, 'S03-APP-ROOT');
    } catch (e) {
      log('   ❌ App shell not loaded, trying login form...');
      // Try to login through form
      try {
        await page.fill('#password', 'correct horse battery');
        await page.click('button:has-text("Entrar")');
        await page.waitForTimeout(3000);
        await ss(page, 'S03-APP-ROOT-2');
        const shell = await page.isVisible('.app-shell').catch(() => false);
        log(`   App shell visible: ${shell ? '✅' : '❌'}`);
      } catch (e2) {
        log(`   ❌ Login form failed: ${e2.message}`);
      }
    }

    // Check if we're in the app now
    const inApp = await page.evaluate(() => !!document.querySelector('.app-shell'));
    if (inApp) {
      log('\n╔══════════════════════════════════════════╗');
      log('║  STEP 3: Back button at root             ║');
      log('╚══════════════════════════════════════════╝');
      const backRoot = await page.evaluate(() => {
        const btn = document.querySelector('.btn-back');
        if (!btn) return { exists: false };
        const cs = window.getComputedStyle(btn);
        return { exists: true, display: cs.display, visible: cs.display !== 'none' };
      });
      log(`   Back button at root: ${JSON.stringify(backRoot)}`);
      log(`   ${!backRoot.exists || !backRoot.visible ? '✅' : '❌'} PASS`);
      await ss(page, 'S04-BACK-ROOT');

      log('\n╔══════════════════════════════════════════╗');
      log('║  STEP 4: Create folder & navigate        ║');
      log('╚══════════════════════════════════════════╝');
      // Click "Nueva carpeta"
      try {
        await page.evaluate(() => {
          document.querySelector('button')?.click();
        });
        await page.waitForTimeout(500);
        await ss(page, 'S05-FOLDER-FORM');

        await page.fill('#folder-name', 'TestFolder');
        const createBtn = await page.$('button:has-text("Crear")');
        if (createBtn) {
          await createBtn.click();
          await page.waitForTimeout(1500);
          await ss(page, 'S06-FOLDER-CREATED');

          // Click folder to navigate
          await page.click('button:has-text("TestFolder")');
          await page.waitForTimeout(1500);
          await ss(page, 'S07-INSIDE-FOLDER');

          const backFolder = await page.evaluate(() => {
            const btn = document.querySelector('.btn-back');
            if (!btn) return { exists: false };
            const cs = window.getComputedStyle(btn);
            return {
              exists: true,
              display: cs.display,
              visible: cs.display !== 'none' && cs.visibility !== 'hidden'
            };
          });
          log(`   Back button in folder: ${JSON.stringify(backFolder)}`);
          log(`   ${backFolder.exists && backFolder.visible ? '✅' : '❌'} PASS`);
        }
      } catch (e) {
        log(`   ⚠️ Folder creation failed: ${e.message}`);
      }

      log('\n╔══════════════════════════════════════════╗');
      log('║  STEP 5: Upload button alignment         ║');
      log('╚══════════════════════════════════════════╝');
      const uploadStyles = await page.evaluate(() => {
        const btn = document.querySelector('.card-upload .btn-accent');
        if (!btn) return null;
        const cs = getComputedStyle(btn);
        return { display: cs.display, width: cs.width, marginLeft: cs.marginLeft, widthPercent: cs.width.includes('100%') };
      });
      log(`   Upload button: ${JSON.stringify(uploadStyles)}`);
      const f3 = uploadStyles?.display === 'block' && (uploadStyles.widthPercent || uploadStyles.width === '100%');
      log(`   ${f3 ? '✅' : '❌'} PASS (block + 100%)`);
      await ss(page, 'S08-UPLOAD-BUTTON');

      log('\n╔══════════════════════════════════════════╗');
      log('║  STEP 6: Card spacing                    ║');
      log('╚══════════════════════════════════════════╝');
      const cardPad = await page.evaluate(() => {
        const c = document.querySelector('.card-content');
        if (!c) return null;
        const cs = getComputedStyle(c);
        return { padding: cs.padding, paddingTop: cs.paddingTop };
      });
      log(`   Card padding: ${JSON.stringify(cardPad)}`);
      const f4 = cardPad && (cardPad.padding === '1rem' || cardPad.paddingTop === '1rem' || cardPad.paddingTop === '16px') && !cardPad.padding.includes('1.25');
      log(`   ${f4 ? '✅' : '❌'} PASS (1rem)`);
      await ss(page, 'S09-CARD-PADDING');

      log('\n╔══════════════════════════════════════════╗');
      log('║  STEP 7: Dark mode app                   ║');
      log('╚══════════════════════════════════════════╝');
      await page.evaluate(() => localStorage.setItem('cloudlocal-theme', 'dark'));
      await page.reload({ waitUntil: 'networkidle' });
      await page.waitForTimeout(500);
      await ss(page, 'S10-DARK-APP');

      const appBg = await page.evaluate(() => {
        const b = document.body;
        return b ? window.getComputedStyle(b).backgroundColor : 'N/A';
      });
      log(`   App bg (dark): ${appBg}`);
      log(`   ${!appBg.includes('255') ? '✅' : '❌'} PASS (dark)`);
    }

    log('\n═══════════════════════════════════════════════════');
    log('            ALL TESTS COMPLETE');
    log('═══════════════════════════════════════════════════\n');
    log('Screenshots in screenshots/:');
    for (const f of ['S00-LOGIN-LIGHT', 'S01-LOGIN-DARK', 'S02-BEFORE-LOGIN', 'S03-APP-ROOT', 'S04-BACK-ROOT', 'S05-FOLDER-FORM', 'S06-FOLDER-CREATED', 'S07-INSIDE-FOLDER', 'S08-UPLOAD-BUTTON', 'S09-CARD-PADDING', 'S10-DARK-APP']) {
      if (existsSync(`${SCREENSHOTS_DIR}/${f}.png`)) {
        log(`  ✅ ${f}.png`);
      } else {
        log(`  ❌ ${f}.png (missing)`);
      }
    }

  } catch (err) {
    log(`❌ Error: ${err.message}`);
    log('Taking emergency screenshot...');
    try { await ss(page, 'EMERGENCY'); } catch (e) {}
  }

  await browser.close();
}

await main();