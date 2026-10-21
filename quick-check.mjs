import { chromium } from 'playwright';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, readdirSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCREENSHOTS_DIR = resolve(__dirname, 'screenshots');

function log(msg) { console.log(`[verify] ${msg}`); }
function ss(page, name) {
  const f = `${SCREENSHOTS_DIR}/${name}.png`;
  try { page.screenshot({ path: f, fullPage: true }); log(`📸 ${f}`); } catch(e) { log(`❌ screenshot: ${e.message}`); }
  return f;
}

async function main() {
  if (!existsSync(SCREENSHOTS_DIR)) {
    import('fs').then(fs => fs.default.mkdirSync(SCREENSHOTS_DIR, { recursive: true }));
  }

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  page.setDefaultTimeout(15000);

  try {
    log('Opening http://localhost:5173...');
    await page.goto('http://localhost:5173', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(4000);
    
    // Take screenshot of whatever is on page
    await ss(page, 'Q01-AS-IS');
    
    // Get page title and body
    const title = await page.title();
    const bodyText = await page.evaluate(() => document.body?.innerText?.substring(0, 500) || 'no body');
    log(`Title: ${title}`);
    log(`Body text (first 500): ${bodyText}`);
    
    // Check for selectors
    const hasAccessPanel = await page.evaluate(() => !!document.querySelector('.access-panel'));
    const hasAppShell = await page.evaluate(() => !!document.querySelector('.app-shell'));
    const hasAuthGate = await page.evaluate(() => !!document.querySelector('.auth-gate'));
    log(`.access-panel: ${hasAccessPanel}`);
    log(`.app-shell: ${hasAppShell}`);
    log(`.auth-gate: ${hasAuthGate}`);
    
    // Try to find any button
    const buttons = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      return btns.map(b => b.textContent?.trim().substring(0, 30)).filter(Boolean);
    });
    log(`Buttons found: ${JSON.stringify(buttons)}`);
    
    // Check CSS classes on body/html
    const bodyClasses = await page.evaluate(() => document.body?.className || 'no body');
    const htmlClasses = await page.evaluate(() => document.documentElement?.className || 'no html');
    log(`Body className: ${bodyClasses}`);
    log(`HTML className: ${htmlClasses}`);
    
  } catch (err) {
    log(`Error: ${err.message}`);
    try { await ss(page, 'Q01-ERROR'); } catch(e) {}
  }

  await browser.close();
  log('\nScreenshots:');
  readdirSync(SCREENSHOTS_DIR).sort().slice(-3).forEach(f => log(`  ${f}`));
}

await main();