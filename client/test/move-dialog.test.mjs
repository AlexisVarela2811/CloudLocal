import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { chromium } from '@playwright/test';

const ENTRIES = [
  { name: 'Destino', path: 'Destino', type: 'directory', size: 0, children: 0, modifiedAt: '2025-10-20T10:00:00Z' },
  { name: 'notas.txt', path: 'notas.txt', type: 'file', size: 120, modifiedAt: '2025-10-16T10:00:00Z' },
];

test('move dialog sends files and folders to the chosen folder', async t => {
  const calls = [];
  const server = createServer(async (req, res) => {
    const path = req.url.split('?')[0];
    if (path === '/api/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      return res.end();
    }
    if (path.startsWith('/api/')) {
      if (req.method === 'POST' && path !== '/api/shutdown') {
        let raw = '';
        for await (const chunk of req) raw += chunk;
        calls.push(path + ' ' + raw);
      }
      res.setHeader('Content-Type', 'application/json');
      let body = { message: 'ok', success: true, entry: null };
      if (path === '/api/session') body = { configured: true, authenticated: true, localSetup: false };
      else if (path === '/api/files') body = { entries: ENTRIES };
      else if (path === '/api/status') body = { storage: { free: 1, total: 2 }, urls: [], maxUploadBytes: 1048576 };
      else if (path === '/api/trash') body = { entries: [] };
      return res.end(JSON.stringify(body));
    }
    try {
      const file = path === '/' ? 'index.html' : path.slice(1);
      const contents = await readFile(new URL(`../dist/${file}`, import.meta.url));
      const type = file.endsWith('.js') ? 'text/javascript'
        : file.endsWith('.css') ? 'text/css'
          : file.endsWith('.woff2') ? 'font/woff2'
            : 'text/html';
      res.setHeader('Content-Type', type);
      res.end(contents);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true });

  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto(origin, { waitUntil: 'networkidle' });
    await page.waitForSelector('.table-row.entry');

    await page.locator('.table-row.entry', { hasText: 'notas.txt' }).locator('input[type=checkbox]').check();
    await page.getByRole('button', { name: 'Mover', exact: true }).click();
    await page.waitForSelector('.move-dialog');
    assert.equal(await page.locator('.move-dialog').evaluate(el => el.open), true, 'el diálogo se abre como modal');

    await page.locator('.move-options button', { hasText: 'Destino' }).click();
    await page.getByRole('button', { name: /^Mover$/ }).last().click();
    await page.waitForTimeout(300);
    assert.deepEqual(calls, ['/api/files/move {"from":"notas.txt","to":"Destino"}'], 'el archivo usa /files/move con el destino');

    await page.locator('.view-btn').nth(1).click();
    await page.waitForTimeout(300);
    await page.getByRole('button', { name: 'Mover Destino' }).first().click();
    await page.waitForSelector('.move-dialog');
    await page.locator('#move-target').fill('');
    await page.getByRole('button', { name: /^Mover$/ }).last().click();
    await page.waitForTimeout(300);
    assert.equal(calls[1], '/api/files/moveFolder {"from":"Destino","to":""}', 'la carpeta usa /files/moveFolder');
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
});
