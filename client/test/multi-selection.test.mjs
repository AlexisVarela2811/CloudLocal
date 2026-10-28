/**
 * Multi-selection inspector — the panel keeps summarizing a selection of two or
 * more entries instead of disappearing, and a single selection keeps the
 * original "Detalle" panel.
 *
 * Public browser UI only: Playwright against the built app served by a stub
 * backend (same pattern as move-dialog.test.mjs).
 */

import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { chromium } from '@playwright/test';

const ENTRIES = [
  { name: 'Carpeta', path: 'Carpeta', type: 'directory', size: 0, children: 3, modifiedAt: '2025-10-20T10:00:00Z' },
  { name: 'Otra', path: 'Otra', type: 'directory', size: 0, children: 0, modifiedAt: '2025-10-19T10:00:00Z' },
  { name: 'foto.jpg', path: 'foto.jpg', type: 'file', size: 1024, modifiedAt: '2025-10-18T10:00:00Z' },
  { name: 'notas.txt', path: 'notas.txt', type: 'file', size: 2048, modifiedAt: '2025-10-17T10:00:00Z' },
];

// Stub of the real backend plus the built frontend; `calls` records POSTs so
// the actions of the selection can be observed.
function stubBackend(entries = ENTRIES) {
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
      else if (path === '/api/files') body = { entries };
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

async function openApp(t, entries = ENTRIES) {
  const { server, calls } = stubBackend(entries);
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
  return { page, calls };
}

const listCheckbox = (page, name) =>
  page.locator('.table-row.entry', { hasText: name }).locator('input[type=checkbox]');

const gridCheckbox = (page, name) =>
  page.locator('.file-grid .grid-item', { hasText: name }).locator('input[type=checkbox]');

const multiNames = page => page.locator('.multi-list .multi-name').allInnerTexts();

async function noHorizontalOverflow(page) {
  return page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
}

test('la selección de dos archivos conserva el inspector con el resumen', async t => {
  const { page, calls } = await openApp(t);

  assert.equal(await page.locator('.inspector').count(), 0, 'sin selección no hay panel');

  await listCheckbox(page, 'foto.jpg').check();
  assert.equal(await page.locator('.multi-inspector').count(), 0, 'con un archivo no hay resumen múltiple');
  assert.match(await page.locator('.inspector').innerText(), /Detalle\s+foto\.jpg/i, 'con un archivo se muestra su detalle');

  await listCheckbox(page, 'notas.txt').check();
  assert.equal(await page.locator('.inspector').isVisible(), true, 'el panel sigue visible con dos archivos');
  assert.equal(await page.locator('.multi-inspector').count(), 1, 'se muestra el resumen de la selección');
  assert.equal(await page.locator('.multi-summary .multi-count').innerText(), '2', 'el resumen muestra el número de seleccionados');
  assert.equal(await page.locator('.multi-summary h2').innerText(), '2 archivos seleccionados');
  assert.equal(await page.locator('.multi-summary p').innerText(), '3 KiB en total', 'el total suma los tamaños de los archivos');
  assert.deepEqual(await multiNames(page), ['foto.jpg', 'notas.txt'], 'la lista enumera los archivos seleccionados');
  assert.deepEqual(
    await page.locator('.multi-list .multi-size').allInnerTexts(),
    ['Archivo JPG · 1 KiB', 'Archivo TXT · 2 KiB'],
    'cada archivo muestra su tipo y tamaño',
  );
  assert.match(await page.locator('.multi-note').innerText(), /Selecciona un solo archivo para ver su vista previa y sus detalles\./);
  assert.match(await page.locator('.selection-bar').innerText(), /2 seleccionados/, 'la barra de selección sigue informando');
  assert.match(await page.locator('.multi-hint').innerText(), /Las acciones se aplican a los 2 archivos\./);

  await page.getByRole('button', { name: 'Descargar seleccionados' }).click();
  assert.match(await page.locator('.notice-bar').innerText(), /2 descargas individuales/, 'descargar usa los dos archivos seleccionados');

  await page.getByRole('button', { name: 'Mover seleccionados' }).click();
  await page.waitForSelector('.move-dialog');
  assert.match(await page.locator('.move-hint').innerText(), /2 elementos/, 'mover usa los dos archivos seleccionados');
  await page.locator('.move-dialog .btn', { hasText: 'Cancelar' }).click();
  assert.deepEqual(calls, [], 'no se envió ningún cambio al servidor');

  await page.locator('.selection-bar button', { hasText: 'Limpiar selección' }).click();
  assert.equal(await page.locator('.inspector').count(), 0, 'al limpiar la selección el panel desaparece');
  assert.equal(await page.locator('.multi-inspector').count(), 0, 'al limpiar la selección el resumen desaparece');
});

test('una sola selección mantiene el detalle original', async t => {
  const { page } = await openApp(t);

  await listCheckbox(page, 'notas.txt').check();
  assert.equal(await page.locator('.inspector').count(), 1, 'un archivo abre el panel de detalle');
  assert.equal(await page.locator('.multi-inspector').count(), 0, 'un archivo no usa el resumen de selección');
  assert.equal(await page.locator('.inspector-label').innerText(), 'DETALLE', 'el panel de un archivo se titula Detalle');
  const detail = await page.locator('.inspector').innerText();
  assert.match(detail, /notas\.txt/, 'el detalle muestra el nombre');
  assert.match(detail, /Archivo TXT/, 'el detalle muestra el tipo');
  assert.match(detail, /2 KiB/, 'el detalle muestra el tamaño');
  assert.match(detail, /Vista previa/, 'el detalle conserva sus acciones');
  assert.match(detail, /Renombrar/);
  assert.match(detail, /Enviar a la Papelera/);

  await listCheckbox(page, 'notas.txt').uncheck();
  assert.equal(await page.locator('.inspector').count(), 0, 'sin selección el detalle desaparece');
});

test('una carpeta dentro de la selección no inventa tamaños', async t => {
  const { page } = await openApp(t);

  await page.locator('.view-btn').nth(1).click();
  await page.waitForSelector('.file-grid .grid-item');
  await gridCheckbox(page, 'Carpeta').check();
  await gridCheckbox(page, 'foto.jpg').check();

  assert.equal(await page.locator('.multi-summary h2').innerText(), '2 elementos seleccionados');
  assert.equal(
    await page.locator('.multi-summary p').innerText(),
    '1 KiB en 1 archivo · 1 carpeta sin tamaño',
    'el total solo suma archivos y dice explícitamente que la carpeta no tiene tamaño',
  );
  assert.deepEqual(await multiNames(page), ['Carpeta', 'foto.jpg']);
  assert.deepEqual(
    await page.locator('.multi-list .multi-size').allInnerTexts(),
    ['Carpeta · el tamaño no se calcula', 'Archivo JPG · 1 KiB'],
  );
  assert.match(await page.locator('.multi-hint').innerText(), /Descargar incluye solo los archivos; Mover incluye también las carpetas\./);

  const downloadButton = page.getByRole('button', { name: 'Descargar seleccionados' });
  assert.equal(await downloadButton.isDisabled(), false, 'hay un archivo descargable');
  await downloadButton.click();
  assert.match(await page.locator('.notice-bar').innerText(), /1 descarga individual/, 'descargar no incluye la carpeta');
  assert.equal(await page.getByRole('button', { name: 'Mover seleccionados' }).isEnabled(), true, 'mover incluye la carpeta');
});

test('una selección de solo carpetas no ofrece descarga', async t => {
  const { page } = await openApp(t);

  await page.locator('.view-btn').nth(1).click();
  await page.waitForSelector('.file-grid .grid-item');
  await gridCheckbox(page, 'Carpeta').check();
  await gridCheckbox(page, 'Otra').check();

  assert.equal(await page.locator('.multi-summary h2').innerText(), '2 carpetas seleccionadas');
  assert.equal(
    await page.locator('.multi-summary p').innerText(),
    '2 carpetas · el tamaño de las carpetas no se calcula',
  );
  const downloadButton = page.getByRole('button', { name: 'Descargar seleccionados' });
  assert.equal(await downloadButton.isDisabled(), true, 'no se ofrece descargar carpetas');
  assert.match(await downloadButton.getAttribute('title'), /Las carpetas no se pueden descargar/);
  assert.match(await page.locator('.multi-hint').innerText(), /Las carpetas no se descargan; «Mover» las incluye\./);
  assert.equal(await page.getByRole('button', { name: 'Mover seleccionados' }).isEnabled(), true);
});

test('el resumen se adapta a móvil y a los dos temas', async t => {
  const { page } = await openApp(t);

  await listCheckbox(page, 'foto.jpg').check();
  await listCheckbox(page, 'notas.txt').check();
  assert.equal(await noHorizontalOverflow(page), true, 'sin desbordamiento en escritorio con tema claro');

  await page.locator('.rail button[aria-label="Cambiar de tema"]').click();
  assert.equal(await page.evaluate(() => document.documentElement.getAttribute('data-theme')), 'dark');
  assert.equal(await page.locator('.multi-inspector').isVisible(), true, 'el resumen sigue visible en tema oscuro');
  assert.equal(await page.locator('.multi-summary .multi-count').innerText(), '2');
  const darkPanel = await page.locator('.multi-summary').evaluate(element => getComputedStyle(element).backgroundColor);
  await page.locator('.rail button[aria-label="Cambiar de tema"]').click();
  const lightPanel = await page.locator('.multi-summary').evaluate(element => getComputedStyle(element).backgroundColor);
  assert.notEqual(darkPanel, lightPanel, 'el resumen responde al tema');

  await page.setViewportSize({ width: 390, height: 900 });
  assert.equal(await noHorizontalOverflow(page), true, 'sin desbordamiento horizontal en móvil');
  assert.match(await page.locator('.selection-bar').innerText(), /2 seleccionados/, 'la barra de selección sigue disponible en móvil');
  assert.equal(await page.locator('.selection-bar button', { hasText: 'Descargar' }).isVisible(), true, 'descargar sigue disponible en móvil');
  assert.equal(await page.locator('.multi-inspector').isVisible(), false, 'el panel lateral se oculta en móvil como el detalle de un solo archivo');

  await page.setViewportSize({ width: 1280, height: 900 });
  assert.equal(await page.locator('.multi-inspector').isVisible(), true, 'al volver a escritorio el resumen reaparece');
});

test('una selección larga se desplaza sin empujar las acciones fuera de la ventana', async t => {
  const many = Array.from({ length: 14 }, (_, index) => ({
    name: `informe-${index + 1}.pdf`,
    path: `informe-${index + 1}.pdf`,
    type: 'file',
    size: 4096,
    modifiedAt: '2025-10-18T10:00:00Z',
  }));
  const { page } = await openApp(t, many);

  await page.keyboard.press('Control+a');
  assert.equal(await page.locator('.multi-summary .multi-count').innerText(), '14');
  assert.equal(await page.locator('.multi-summary h2').innerText(), '14 archivos seleccionados');
  assert.equal(await page.locator('.multi-summary p').innerText(), '56 KiB en total');
  assert.equal(await page.locator('.multi-list li').count(), 14, 'la lista incluye todos los seleccionados');

  const scroll = await page.locator('.multi-section').evaluate(element => ({
    overflowY: getComputedStyle(element).overflowY,
    scrolls: element.scrollHeight > element.clientHeight,
  }));
  assert.equal(scroll.overflowY, 'auto', 'la lista de seleccionados es la zona desplazable');
  assert.equal(scroll.scrolls, true, 'con muchos elementos la lista desborda y se desplaza');
  assert.equal(
    await page.locator('.multi-inspector .inspector-actions').evaluate(element =>
      element.getBoundingClientRect().bottom <= window.innerHeight + 1),
    true,
    'las acciones siguen visibles dentro de la ventana',
  );
});
