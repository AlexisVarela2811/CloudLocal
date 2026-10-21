import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SCREENSHOT_DIR = path.join(__dirname, 'screenshots');
const URL = 'http://localhost:80';

if (!fs.existsSync(SCREENSHOT_DIR)) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

async function ss(page, name) {
  const f = path.join(SCREENSHOT_DIR, name);
  await page.screenshot({ path: f, fullPage: false });
  console.log(`📸 ${f}`);
  return f;
}

async function main() {
  const results = [];
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  
  // ===== TEST 1: Dark Mode Login =====
  console.log('\n🧪 TEST 1: Dark Mode Login');
  let page = await ctx.newPage();
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  
  // Check light mode first
  const lightCheck = await page.evaluate(() => {
    const panel = document.querySelector('.access-panel');
    if (!panel) return { error: 'no panel' };
    return {
      bg: window.getComputedStyle(panel).backgroundColor,
      text: window.getComputedStyle(panel.querySelector('h1')).color,
    };
  });
  console.log(`   Light mode - Card bg: ${lightCheck.bg} (white=❌)`);
  console.log(`   Light mode - Text: ${lightCheck.text} (dark=✅)`);
  
  // Now check dark mode
  await page.evaluate(() => localStorage.setItem('cloudlocal-theme', 'dark'));
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  await ss(page, 'TEST-01-dark-login.png');
  
  const darkCheck = await page.evaluate(() => {
    const panel = document.querySelector('.access-panel');
    if (!panel) return { error: 'no panel' };
    const cs = window.getComputedStyle(panel);
    return {
      bg: cs.backgroundColor,
      text: window.getComputedStyle(panel.querySelector('h1')).color,
      input: window.getComputedStyle(panel.querySelector('input')).backgroundColor,
      border: cs.borderColor,
    };
  });
  console.log(`   Dark mode - Card bg: ${darkCheck.bg} (dark=#1e293b=✅, white=#fff=❌)`);
  console.log(`   Dark mode - Text: ${darkCheck.text} (light=✅, dark=❌)`);
  console.log(`   Dark mode - Input bg: ${darkCheck.input} (dark=✅)`);
  
  results.push({
    test: 'Dark Mode Login',
    bg: darkCheck.bg,
    ok: !darkCheck.bg.includes('255, 255, 255')
  });
  
  await page.close();
  
  // ===== TEST 2: Login & App Navigation =====
  console.log('\n🧪 TEST 2: Login y navegación');
  page = await ctx.newPage();
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  
  // Login with correct password
  await page.fill('#password', 'correct horse battery');
  await page.click('button:has-text("Entrar")');
  await page.waitForTimeout(2000);
  await ss(page, 'TEST-02-app-root.png');
  
  // Check root state (back button should NOT be visible)
  const rootCheck = await page.evaluate(() => {
    const backBtn = document.querySelector('.btn-back');
    return { 
      exists: !!backBtn,
      visible: backBtn ? window.getComputedStyle(backBtn).display !== 'none' : false
    };
  });
  console.log(`   Root - Back button: ${JSON.stringify(rootCheck)} (not visible=✅)`);
  
  // Check upload button exists
  const uploadCheck = await page.evaluate(() => {
    const btn = document.querySelector('.card-upload .btn-accent');
    if (!btn) return { exists: false };
    const cs = window.getComputedStyle(btn);
    return {
      exists: true,
      display: cs.display,
      width: cs.width,
      marginLeft: cs.marginLeft,
    };
  });
  console.log(`   Root - Upload button: ${JSON.stringify(uploadCheck)}`);
  
  results.push({
    test: 'Back button root',
    data: rootCheck,
    ok: !rootCheck.exists && !rootCheck.visible
  });
  
  results.push({
    test: 'Upload button alignment',
    data: uploadCheck,
    ok: uploadCheck.exists && uploadCheck.display === 'block'
  });
  
  // Create folder and navigate to test back button
  console.log('   Creating folder...');
  try {
    // Click "Nueva carpeta" button
    const newFolderBtn = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      return btns.find(b => b.textContent.includes('Nueva carpeta'));
    });
    
    if (newFolderBtn) {
      await page.evaluate(() => {
        document.querySelector('button').click();
      });
      await page.waitForTimeout(500);
      await page.fill('#folder-name', 'TestFolder');
      await page.click('button:has-text("Crear")');
      await page.waitForTimeout(1000);
      
      // Click on folder to navigate in
      await page.click('button:has-text("TestFolder")');
      await page.waitForTimeout(1000);
      await ss(page, 'TEST-03-app-inside-folder.png');
      
      // Check back button in folder (should be visible!)
      const insideCheck = await page.evaluate(() => {
        const backBtn = document.querySelector('.btn-back');
        if (!backBtn) return { exists: false };
        const cs = window.getComputedStyle(backBtn);
        return {
          exists: true,
          display: cs.display,
          visibility: cs.visibility,
          color: cs.color,
        };
      });
      console.log(`   Inside folder - Back button: ${JSON.stringify(insideCheck)} (visible=✅)`);
      
      results.push({
        test: 'Back button in folder',
        data: insideCheck,
        ok: insideCheck.exists && insideCheck.display !== 'none'
      });
    } else {
      console.log('   ⚠️ No se encontró botón "Nueva carpeta"');
    }
  } catch (e) {
    console.log(`   ⚠️ Error: ${e.message}`);
  }
  
  await page.close();
  
  // ===== TEST 3: Dark Mode App =====
  console.log('\n🧪 TEST 3: Dark Mode App');
  page = await ctx.newPage();
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  await page.evaluate(() => localStorage.setItem('cloudlocal-theme', 'dark'));
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  
  // Login
  await page.fill('#password', 'correct horse battery');
  await page.click('button:has-text("Entrar")');
  await page.waitForTimeout(2000);
  await ss(page, 'TEST-04-dark-app.png');
  
  await page.close();
  await browser.close();
  
  // ===== Print Results =====
  console.log('\n\n========== RESULTADO FINAL ==========');
  results.forEach((r, i) => {
    const status = r.ok ? '✅' : '❌';
    console.log(`${i+1}. ${r.test}: ${status}`);
    if (!r.ok) {
      console.log(`   Data: ${JSON.stringify(r.data)}`);
    }
  });
  console.log('=====================================');
}

main().catch(err => { console.error('❌', err.message); process.exit(1); });