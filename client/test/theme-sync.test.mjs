import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { chromium } from '@playwright/test';

const THEME_KEY = 'cloudlocal-theme';

function apiBody(path) {
  if (path === '/api/session') return { configured: true, authenticated: true, localSetup: false };
  if (path === '/api/files') {
    return { entries: [{ name: 'a.txt', path: 'a.txt', type: 'file', size: 1, modifiedAt: '2026-01-01T00:00:00Z' }] };
  }
  if (path === '/api/status') return { storage: { free: 1, total: 2 }, urls: [], maxUploadBytes: 1048576 };
  if (path === '/api/trash') return { entries: [] };
  if (path === '/api/settings') {
    return { folderPath: null, activeFolderPath: '/data', envOverride: false, needsRestart: false };
  }
  if (path === '/api/events') return null;
  return { message: 'not found' };
}

test('theme switch in settings follows the rail toggle and vice versa', async t => {
  const server = createServer(async (req, res) => {
    const path = req.url.split('?')[0];
    if (path === '/api/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      return res.end();
    }
    if (path.startsWith('/api/')) {
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify(apiBody(path)));
    }
    try {
      const file = path === '/' ? 'index.html' : path.slice(1);
      const contents = await readFile(new URL(`../dist/${file}`, import.meta.url));
      const type = file.endsWith('.js') ? 'text/javascript'
        : file.endsWith('.css') ? 'text/css'
          : file.endsWith('.woff2') ? 'font/woff2'
            : 'text/html';
      res.setHeader('Content-Type', type);
      if (file === 'index.html') res.setHeader('Content-Security-Policy', "default-src 'self'; object-src 'none'; frame-ancestors 'none'");
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

    const avatar = page.locator('.rail-avatar svg');
    await avatar.waitFor({ timeout: 3000 });
    const avatarMarkup = await avatar.evaluate(element => element.outerHTML);
    assert.ok(await avatar.locator('path').count() > 0, 'el avatar se genera localmente');
    assert.equal(await page.locator('.rail-avatar').getAttribute('aria-hidden'), 'true', 'el avatar es decorativo');
    await page.reload({ waitUntil: 'networkidle' });
    assert.equal(await avatar.evaluate(element => element.outerHTML), avatarMarkup, 'el avatar se conserva al recargar');

    const state = () => page.evaluate(key => ({
      theme: document.documentElement.getAttribute('data-theme') ?? 'light',
      stored: localStorage.getItem(key),
      switchChecked: document.querySelector('#dark-mode-toggle')?.getAttribute('aria-checked') ?? null,
    }), THEME_KEY);

    const initial = await state();
    assert.equal(initial.theme, 'light', 'la app arranca en claro sin tema guardado');

    // 1) El rail se activa desde Archivos y el tema cambia.
    await page.getByRole('button', { name: 'Cambiar de tema', exact: true }).click();
    await page.waitForTimeout(150);
    const afterRail = await state();
    assert.equal(afterRail.theme, 'dark', 'el botón del rail aplica el tema oscuro');
    assert.equal(afterRail.stored, 'dark', 'el botón del rail persiste el tema');

    // 2) Al entrar en Configuración, el interruptor refleja ese estado.
    await page.getByRole('button', { name: 'Configuración', exact: true }).click();
    await page.waitForSelector('#dark-mode-toggle');
    await page.waitForTimeout(200);
    const settingsOpen = await state();
    assert.equal(settingsOpen.switchChecked, 'true', 'el interruptor nace sincronizado con el rail');

    // 3) Estando DENTRO de Configuración, el rail cambia el tema y el interruptor debe seguirlo.
    await page.getByRole('button', { name: 'Cambiar de tema', exact: true }).click();
    await page.waitForTimeout(200);
    const liveFromRail = await state();
    assert.equal(liveFromRail.theme, 'light', 'el rail cambia el tema con Configuración abierta');
    assert.equal(liveFromRail.switchChecked, 'false', 'el interruptor se actualiza en vivo al usar el rail');

    // 4) El interruptor de Configuración sigue mandando en sentido contrario.
    await page.locator('#dark-mode-toggle').click();
    await page.waitForTimeout(200);
    const fromSwitch = await state();
    assert.equal(fromSwitch.theme, 'dark', 'el interruptor aplica el tema');
    assert.equal(fromSwitch.stored, 'dark', 'el interruptor persiste el tema');
    assert.equal(fromSwitch.switchChecked, 'true', 'el interruptor refleja su propio cambio');

    // 5) Salir a Archivos, cambiar en el rail y volver: el interruptor se resincroniza.
    await page.getByRole('button', { name: 'Archivos', exact: true }).click();
    await page.waitForSelector('.table-row.entry');
    await page.getByRole('button', { name: 'Cambiar de tema', exact: true }).click();
    await page.waitForTimeout(200);
    const afterRailAgain = await state();
    assert.equal(afterRailAgain.theme, 'light', 'el rail sigue mandando tras pasar por Configuración');

    await page.getByRole('button', { name: 'Configuración', exact: true }).click();
    await page.waitForSelector('#dark-mode-toggle');
    await page.waitForTimeout(200);
    const settingsAgain = await state();
    assert.equal(settingsAgain.switchChecked, 'false', 'el interruptor se resincroniza al reabrir Configuración');
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
});
