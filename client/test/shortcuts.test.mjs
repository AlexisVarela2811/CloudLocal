import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { chromium, expect } from '@playwright/test';

// Test the production UI with isolated API responses, never real user files.
test('new folder keyboard shortcut', async t => {
  const server = createServer(async (req, res) => {
    try {
      const path = req.url === '/' ? 'index.html' : req.url.slice(1);
      const contents = await readFile(new URL(`../dist/${path}`, import.meta.url));
      res.setHeader('Content-Type', path.endsWith('.js') ? 'text/javascript' : path.endsWith('.css') ? 'text/css' : 'text/html');
      res.end(contents);
    } catch { res.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  let mutations = 0;
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() !== 'GET') mutations++;
    let body;
    if (path === '/api/session') body = { configured: true, authenticated: true, localSetup: false };
    else if (path === '/api/files') body = { entries: [{ name: 'sample.txt', path: 'sample.txt', type: 'file', size: 1, modifiedAt: '2026-01-01T00:00:00Z' }] };
    else if (path === '/api/trash') body = { entries: [] };
    else if (path === '/api/status') body = { storage: { free: 100, total: 200 }, urls: [], maxUploadBytes: 1024 };
    else throw new Error(`Unexpected API request: ${path}`);
    await route.fulfill({ json: body });
  });
  async function reset() {
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await expect(page.getByRole('heading', { name: 'Mis archivos', exact: true })).toBeVisible();
    await expect(page.getByRole('checkbox', { name: 'Seleccionar sample.txt', exact: true })).toBeVisible();
  }
  const form = page.locator('.folder-form');
  try {
    await t.test('Ctrl+Alt+N opens and focuses new folder without creating data', async () => {
      await reset();
      await page.keyboard.press('Control+Alt+n');
      await expect(form).toBeVisible();
      await expect(page.locator('#folder-name')).toBeFocused();
      assert.equal(mutations, 0);
    });
    await t.test('toolbar advertises Ctrl+Alt+N', async () => {
      await reset();
      await expect(page.locator('.shortcut-hint')).toHaveText('Ctrl+Alt+N');
      await expect(page.getByRole('button', { name: /Nueva carpeta/ })).toHaveAttribute('aria-keyshortcuts', 'Control+Alt+N');
    });
    await t.test('Ctrl+N remains unhandled by the app', async () => {
      await reset();
      // A synthetic event measures app cancellation; it does not emulate browser chrome.
      const allowed = await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'n', code: 'KeyN', ctrlKey: true, bubbles: true, cancelable: true
      })));
      assert.equal(allowed, true);
      await expect(form).toHaveCount(0);
      assert.equal(mutations, 0);
    });
    await t.test('shortcut does not interrupt typing in search', async () => {
      await reset();
      const search = page.getByRole('searchbox', { name: 'Buscar archivos' });
      await search.fill('sample');
      await page.keyboard.press('Control+Alt+n');
      await expect(form).toHaveCount(0);
      await expect(search).toHaveValue('sample');
      await expect(search).toBeFocused();
    });
    await t.test('shortcut is inactive in trash', async () => {
      await reset();
      await page.getByRole('button', { name: 'Papelera', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Papelera', exact: true })).toBeVisible();
      await page.keyboard.press('Control+Alt+n');
      await expect(form).toHaveCount(0);
    });
    await t.test('toolbar button and cancellation retain their behavior', async () => {
      await reset();
      await page.getByRole('button', { name: /Nueva carpeta/ }).click();
      await expect(form).toBeVisible();
      await page.getByRole('button', { name: 'Cancelar', exact: true }).click();
      await expect(form).toHaveCount(0);
      assert.equal(mutations, 0);
    });
    await t.test('existing Ctrl+A and Escape selection shortcuts still work', async () => {
      await reset();
      await page.keyboard.press('Control+a');
      await expect(page.getByRole('checkbox', { name: 'Seleccionar sample.txt', exact: true })).toBeChecked();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('checkbox', { name: 'Seleccionar sample.txt', exact: true })).not.toBeChecked();
      assert.equal(mutations, 0);
    });
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
});
