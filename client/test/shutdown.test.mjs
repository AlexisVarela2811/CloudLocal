import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { chromium, expect } from '@playwright/test';

const key = 'cloudlocal-server-shutdown';
const running = { active: true, shuttingDown: false };

test('shutdown button lifecycle', async t => {
  // Serve only the built UI; API and shutdown requests are isolated mocks.
  const server = createServer(async (req, res) => {
    try {
      const path = req.url === '/' ? 'index.html' : req.url.slice(1);
      const contents = await readFile(new URL(`../dist/${path}`, import.meta.url));
      res.setHeader('Content-Type', path.endsWith('.js') ? 'text/javascript' : path.endsWith('.css') ? 'text/css' : 'text/html');
      res.end(contents);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true });
  try {
    async function open(stale, shutdownStatus = 200) {
      const page = await browser.newPage();
      await page.addInitScript(({ key, stale }) => {
        if (stale) localStorage.setItem(key, JSON.stringify(stale));
      }, { key, stale });
      // Let the previous loopback probe succeed too: it still must update React.
      await page.route('http://127.0.0.1:80/', route => route.fulfill({ body: 'ok' }));
      let shutdownCalls = 0;
      await page.route('**/api/**', async route => {
        const path = new URL(route.request().url()).pathname;
        let body;
        let status = 200;
        if (path === '/api/session') body = { configured: true, authenticated: true, localSetup: false };
        else if (path === '/api/files') body = { entries: [] };
        else if (path === '/api/status') body = { storage: { free: 100, total: 200 }, urls: [], maxUploadBytes: 1024 };
        else if (path === '/api/shutdown') {
          shutdownCalls++;
          status = shutdownStatus;
          body = status === 200 ? { success: true } : { message: 'Shutdown failed' };
        } else if (path === '/api/events') {
          await route.fulfill({ status: 200, contentType: 'text/event-stream', body: '' });
          return;
        } else throw new Error(`Unexpected API request: ${path}`);
        await route.fulfill({ status, json: body });
      });
      await page.goto(origin);
      const button = page.getByRole('button', { name: /^(Detener Server|Apagando…)$/ });
      await expect(button).toBeVisible();
      return { page, button, calls: () => shutdownCalls };
    }
    for (const stale of [{ active: false, shuttingDown: false }, { active: true, shuttingDown: true }]) {
      await t.test(`reconnect clears stale state ${JSON.stringify(stale)}`, async () => {
        const { page, button, calls } = await open(stale);
        try {
          await expect(button).toBeEnabled();
          assert.deepEqual(await page.evaluate(key => JSON.parse(localStorage.getItem(key)), key), running);
          assert.equal(calls(), 0);
        } finally { await page.close(); }
      });
    }
    await t.test('fresh connection keeps the button enabled', async () => {
      const { page, button, calls } = await open(null);
      try { await expect(button).toBeEnabled(); assert.equal(calls(), 0); }
      finally { await page.close(); }
    });
    await t.test('successful shutdown disables the button and persists stopped state', async () => {
      const { page, button, calls } = await open(null);
      try {
        await button.click();
        await expect(button).toBeDisabled();
        await expect.poll(() => page.evaluate(key => localStorage.getItem(key), key)).toBe(JSON.stringify({ active: false, shuttingDown: false }));
        assert.equal(calls(), 1);
      } finally { await page.close(); }
    });
    await t.test('failed shutdown re-enables the button', async () => {
      const { page, button, calls } = await open(null, 500);
      try {
        await button.click();
        await expect(button).toBeEnabled();
        await expect.poll(() => page.evaluate(key => localStorage.getItem(key), key)).toBe(JSON.stringify(running));
        assert.equal(calls(), 1);
      } finally { await page.close(); }
    });
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
});
