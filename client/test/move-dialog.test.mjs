import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { test } from 'node:test';
import { chromium } from '@playwright/test';

const ENTRIES = [
  { name: 'Destino', path: 'Destino', type: 'directory', size: 0, children: 1, modifiedAt: '2025-10-20T10:00:00Z' },
  { name: 'Rota', path: 'Rota', type: 'directory', size: 0, children: 0, modifiedAt: '2025-10-20T10:00:00Z' },
  { name: 'notas.txt', path: 'notas.txt', type: 'file', size: 120, modifiedAt: '2025-10-16T10:00:00Z' },
];
const FOTOS = { name: 'Fotos', path: 'Destino/Fotos', type: 'directory', size: 0, children: 0, modifiedAt: '2025-10-20T10:00:00Z' };

// A stub of the real backend plus the built frontend. `folders` decides what
// /api/files answers per folder, `fails` forces a server error and `delays`
// holds the response so the dialog's loading state can be observed.
function stubBackend({ folders = folder => (folder === 'Destino' ? [FOTOS] : folder === 'Destino/Fotos' ? [] : ENTRIES), fails = () => false, delays = () => 0 } = {}) {
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
      const folder = new URL(req.url, 'http://localhost').searchParams.get('folder') ?? '';
      const delay = path === '/api/files' ? delays(folder) : 0;
      if (delay) await sleep(delay);
      res.setHeader('Content-Type', 'application/json');
      let body = { message: 'ok', success: true, entry: null };
      if (path === '/api/session') body = { configured: true, authenticated: true, localSetup: false };
      else if (path === '/api/files' && fails(folder)) {
        res.statusCode = 500;
        body = { message: 'No se pudo leer la carpeta' };
      }
      else if (path === '/api/files') body = { entries: folders(folder) };
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
  return { server, calls };
}

async function openMoveDialog(t, backend, name = 'notas.txt') {
  const { server, calls } = backend;
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true });
  t.after(async () => {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(origin, { waitUntil: 'networkidle' });
  await page.waitForSelector('.table-row.entry');
  await page.locator('.table-row.entry', { hasText: name }).locator('input[type=checkbox]').check();
  await page.getByRole('button', { name: 'Mover', exact: true }).click();
  await page.waitForSelector('.move-dialog');
  return { page, calls };
}

test('move dialog sends files and folders to the chosen folder', async t => {
  const { page, calls } = await openMoveDialog(t, stubBackend());
  assert.equal(await page.locator('.move-dialog').evaluate(el => el.open), true, 'el diálogo se abre como modal');

  await page.getByRole('button', { name: 'Abrir carpeta Destino' }).click();
  await page.getByRole('button', { name: 'Abrir carpeta Fotos' }).click();
  assert.match(await page.locator('.move-destination').innerText(), /Destino.*Fotos/s);
  await page.getByRole('button', { name: 'Mover aquí' }).click();
  await page.waitForTimeout(300);
  assert.deepEqual(calls, ['/api/files/move {"from":"notas.txt","to":"Destino/Fotos","mode":"into"}'], 'el archivo usa la carpeta navegada y pide un destino explícito');

  await page.locator('.view-btn').nth(1).click();
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: 'Mover Destino' }).first().click();
  await page.waitForSelector('.move-dialog');
  await page.getByRole('button', { name: 'Mover aquí' }).click();
  await page.waitForTimeout(300);
  assert.equal(calls[1], '/api/files/moveFolder {"from":"Destino","to":"","mode":"into"}', 'la carpeta usa /files/moveFolder con destino explícito');
});

test('move dialog cannot confirm while the destination folder list is loading', async t => {
  const slow = folder => (folder === 'Destino' ? 400 : 0);
  const { page, calls } = await openMoveDialog(t, stubBackend({ delays: slow }));
  const confirm = page.getByRole('button', { name: 'Mover aquí' });

  assert.equal(await confirm.isDisabled(), false, 'en Inicio el destino ya está cargado');
  await page.getByRole('button', { name: 'Abrir carpeta Destino' }).click();
  await page.waitForSelector('.move-list[aria-busy=true]');
  assert.equal(await confirm.isDisabled(), true, 'mientras carga la carpeta no se puede confirmar');

  await page.getByRole('button', { name: 'Abrir carpeta Fotos' }).waitFor();
  assert.equal(await confirm.isDisabled(), false, 'al terminar la carga se puede confirmar');
  assert.deepEqual(calls, [], 'no se envió ningún movimiento durante la carga');
});

test('move dialog cannot confirm when the destination folder fails to load', async t => {
  const { page, calls } = await openMoveDialog(t, stubBackend({ fails: folder => folder === 'Rota' }));
  const confirm = page.getByRole('button', { name: 'Mover aquí' });

  await page.getByRole('button', { name: 'Abrir carpeta Rota' }).click();
  await page.locator('.move-state.error').waitFor();
  assert.match(await page.locator('.move-state.error').innerText(), /No se pudo leer la carpeta/);
  assert.equal(await confirm.isDisabled(), true, 'con la carpeta de destino rota no se puede confirmar');
  assert.deepEqual(calls, [], 'el origen no se mueve ni se renombra');
});
