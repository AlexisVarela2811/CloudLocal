import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { chromium } from '@playwright/test';

const TRASH = [
  { id: '11111111-1111-4111-8111-111111111111', name: 'viejo.txt', path: 'viejo.txt', deletedAt: '2025-10-20T10:00:00Z' },
  { id: '22222222-2222-4222-8222-222222222222', name: 'foto.jpg', path: 'foto.jpg', deletedAt: '2025-10-21T10:00:00Z' },
];

test('trash offers permanent delete per item and empty-all', async t => {
  const calls = [];
  const server = createServer(async (req, res) => {
    const path = req.url.split('?')[0];
    if (path === '/api/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      return res.end();
    }
    if (path.startsWith('/api/')) {
      if (req.method !== 'GET') calls.push(req.method + ' ' + path);
      res.setHeader('Content-Type', 'application/json');
      let body = { message: 'ok', success: true };
      if (path === '/api/session') body = { configured: true, authenticated: true, localSetup: false };
      else if (path === '/api/files') body = { entries: [] };
      else if (path === '/api/status') body = { storage: { free: 1, total: 2 }, urls: [], maxUploadBytes: 1048576 };
      else if (path === '/api/trash') body = { entries: TRASH };
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
    page.on('dialog', dialog => dialog.accept());
    await page.goto(origin, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'Papelera', exact: true }).click();
    await page.waitForSelector('text=viejo.txt');

    const permanent = await page.locator('[aria-label^="Eliminar definitivamente"]').count();
    assert.equal(permanent, TRASH.length, 'cada elemento ofrece borrado definitivo');
    assert.equal(await page.getByRole('button', { name: 'Vaciar papelera' }).count(), 1, 'existe vaciar papelera');

    await page.locator('[aria-label="Eliminar definitivamente viejo.txt"]').click();
    await page.waitForTimeout(300);
    assert.deepEqual(calls, ['POST /api/files/permanent'], 'el borrado definitivo llama al endpoint de un elemento');

    await page.getByRole('button', { name: 'Vaciar papelera' }).click();
    await page.waitForTimeout(300);
    assert.deepEqual(calls, ['POST /api/files/permanent', 'POST /api/trash/empty'], 'vaciar llama al endpoint global');
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
});
