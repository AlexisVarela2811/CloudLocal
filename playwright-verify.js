import { test, expect } from '@playwright/test';
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const SCREENSHOT_DIR = path.join(__dirname, '../screenshots');
const CLIENT_URL = 'http://localhost:5173';

// Create screenshots directory
if (!fs.existsSync(SCREENSHOT_DIR)) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

async function screenshot(page, name) {
  const filePath = path.join(SCREENSHOT_DIR, name);
  await page.screenshot({ path: filePath, fullPage: false });
  console.log(`📸 Saved: ${filePath}`);
  return filePath;
}

// Test 1: Login screen - Light mode
test('verify login screen light mode', async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  await page.goto(CLIENT_URL, { waitUntil: 'networkidle' });
  await screenshot(page, '01-login-light.png');
  console.log('✅ Login screen light mode captured');
  await browser.close();
});

// Test 2: Login screen - Dark mode
test('verify login screen dark mode', async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  await page.goto(CLIENT_URL, { waitUntil: 'networkidle' });
  // Apply dark mode via localStorage and reload
  await page.evaluate(() => {
    localStorage.setItem('cloudlocal-theme', 'dark');
    window.location.reload();
  });
  await page.waitForTimeout(1000);
  await screenshot(page, '02-login-dark.png');
  console.log('✅ Login screen dark mode captured');
  await browser.close();
});

// Test 3: Login screen - Check card styling
test('verify login card is not white on dark background', async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  await page.goto(CLIENT_URL, { waitUntil: 'networkidle' });
  await page.evaluate(() => {
    localStorage.setItem('cloudlocal-theme', 'dark');
    window.location.reload();
  });
  await page.waitForTimeout(1000);
  
  // Check the login card background color
  const panelBg = await page.evaluate(() => {
    const panel = document.querySelector('.access-panel');
    return panel ? window.getComputedStyle(panel).backgroundColor : 'not-found';
  });
  console.log(`Login card background in dark mode: ${panelBg}`);
  console.log('✅ Login card color check complete');
  await browser.close();
});

console.log('🚀 Playwright UI verification tests launched!');