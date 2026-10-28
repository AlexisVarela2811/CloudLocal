// ── file-visuals.browser.test.mjs ──
// Real-component browser regressions for FileVisual.
//
// The harness (client/test-render.html) mounts the actual React component
// through Vite, so these tests observe the same code the app ships.
//
// Run: node --test client/test/file-visuals.browser.test.mjs

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { chromium } from '@playwright/test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const CLIENT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Minimal valid 1×1 red PNG. */
const PNG = Buffer.from([
  0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D,
  0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53, 0xDE, 0x00, 0x00, 0x00,
  0x0C, 0x49, 0x44, 0x41, 0x54, 0x08, 0xD7, 0x63, 0xF8, 0x0F, 0x00, 0x00,
  0x01, 0x05, 0xFE, 0xA2, 0x4F, 0xE3, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45,
  0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82,
]);

/**
 * Media server with switchable behaviour, used to observe queue concurrency.
 *   /ok/<name>?delay=<ms>  → 200 PNG after the delay
 *   /fail/<name>           → 404
 *   /video/<name>          → 200 video/mp4 with an invalid payload
 *   /hang/<name>           → never answers (aborted by the client)
 */
function startMediaServer() {
  const stats = { inFlight: 0, maxInFlight: 0, requests: 0 };
  /** @type {Array<import('node:http').ServerResponse>} */
  const open = [];
  /** Gate requests parked until the test releases them. */
  const held = [];
  let gateOpen = false;

  const respondWithImage = (res) => {
    res.writeHead(200, {
      'Content-Type': 'image/png',
      'Content-Length': String(PNG.length),
      'Cache-Control': 'no-store',
    });
    res.end(PNG);
  };

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const [, behaviour, name] = url.pathname.split('/');

    if (behaviour === 'control') {
      if (name === 'state') {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ requests: stats.requests, held: held.length, maxInFlight: stats.maxInFlight }));
        return;
      }
      if (name === 'flush') {
        const pending = held.splice(0, held.length);
        for (const pendingRes of pending) respondWithImage(pendingRes);
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ released: pending.length }));
        return;
      }
      if (name === 'open') {
        // Release everything parked and stop parking new requests.
        gateOpen = true;
        const pending = held.splice(0, held.length);
        for (const pendingRes of pending) respondWithImage(pendingRes);
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ released: pending.length }));
        return;
      }
      res.writeHead(404, { 'Cache-Control': 'no-store' });
      res.end('unknown control route');
      return;
    }

    stats.requests++;
    stats.inFlight++;
    stats.maxInFlight = Math.max(stats.maxInFlight, stats.inFlight);
    open.push(res);

    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      stats.inFlight--;
      const idx = open.indexOf(res);
      if (idx !== -1) open.splice(idx, 1);
    };
    res.on('close', finish);
    res.on('finish', finish);

    if (behaviour === 'ok') {
      const delay = Number(url.searchParams.get('delay') ?? 120);
      setTimeout(() => {
        if (res.destroyed) return;
        res.writeHead(200, {
          'Content-Type': 'image/png',
          'Content-Length': String(PNG.length),
          'Cache-Control': 'no-store',
        });
        res.end(PNG);
      }, delay);
      return;
    }
    if (behaviour === 'fail') {
      res.writeHead(404, { 'Cache-Control': 'no-store' });
      res.end('missing');
      return;
    }
    if (behaviour === 'video') {
      res.writeHead(200, { 'Content-Type': 'video/mp4', 'Cache-Control': 'no-store' });
      res.end('this-is-not-a-video');
      return;
    }
    if (behaviour === 'hang') {
      return; // deliberately never answered
    }
    if (behaviour === 'gate') {
      if (gateOpen) {
        respondWithImage(res);
      } else {
        held.push(res); // parked until /control/flush or /control/open
      }
      return;
    }
    res.writeHead(404, { 'Cache-Control': 'no-store' });
    res.end(`unknown behaviour for ${name}`);
  });

  return new Promise((resolvePromise) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = /** @type {any} */ (server.address());
      resolvePromise({
        server,
        stats,
        url: (path) => `http://127.0.0.1:${port}${path}`,
        close: () => new Promise((done) => {
          for (const res of open) res.destroy();
          server.close(done);
        }),
      });
    });
  });
}

/** Reserve a free TCP port for the Vite harness server. */
function freePort() {
  return new Promise((resolvePromise, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = /** @type {any} */ (probe.address());
      probe.close(() => resolvePromise(port));
    });
  });
}

describe('FileVisual — real component in chromium', { timeout: 120_000 }, () => {
  let vite;
  let media;
  let browser;
  let page;
  let baseUrl;

  before(async () => {
    const port = await freePort();
    vite = await createServer({
      configFile: false,
      plugins: [react()],
      root: CLIENT_ROOT,
      logLevel: 'error',
      server: { host: '127.0.0.1', port, strictPort: true },
      appType: 'mpa',
    });
    await vite.listen();
    baseUrl = `http://127.0.0.1:${port}`;
    media = await startMediaServer();
    browser = await chromium.launch({ headless: true });
    page = await browser.newPage();
  });

  after(async () => {
    try { await page?.close(); } catch { /* ignored */ }
    try { await browser?.close(); } catch { /* ignored */ }
    try { await media?.close(); } catch { /* ignored */ }
    try { await vite?.close(); } catch { /* ignored */ }
  });

  /** Mount a fresh list of FileVisual items on the harness page. */
  async function mount(items) {
    const encoded = encodeURIComponent(JSON.stringify(items));
    await page.goto(`${baseUrl}/test-render.html?items=${encoded}`);
    await page.waitForSelector('#items', { state: 'attached' });
  }

  /** Re-render the mounted list without reloading the page. */
  async function setItems(items) {
    await page.evaluate((next) => window.__setItems(next), items);
  }

  /** Poll an async predicate until it holds. */
  async function waitFor(predicate, timeout = 5_000) {
    const deadline = Date.now() + timeout;
    for (;;) {
      if (await predicate()) return;
      if (Date.now() > deadline) throw new Error('waitFor: condition not met in time');
      await page.waitForTimeout(100);
    }
  }

  async function waitForSelector(selector, timeout = 5_000) {
    await page.waitForSelector(selector, { timeout });
  }

  /** Wait until every mounted copy of an item's icon stops spinning. Two
   *  copies exist per item (grid and table views); the hidden one can settle
   *  later than the visible one depending on the platform. */
  async function waitForNoSpinner(index, timeout = 8_000) {
    await waitFor(
      async () => (await item(index).locator('.file-icon .fa-spin').count()) === 0,
      timeout,
    );
  }

  /** Read the media server control state. */
  async function mediaState() {
    const resp = await fetch(media.url('/control/state'));
    return resp.json();
  }

  /** Release every /gate request and let later ones through. */
  async function openGate() {
    const resp = await fetch(media.url('/control/open'));
    return resp.json();
  }

  function item(index) {
    return page.locator(`[data-testid="item-${index}"]`);
  }

  describe('non-media files (S1, S2)', () => {
    it('renders the extension icon immediately, with no spinner and no image', async () => {
      await mount([
        { path: 'doc.pdf', contentUrl: '/api/content/doc.pdf' },
        { path: 'report.docx', contentUrl: '/api/content/report.docx' },
        { path: 'app.ts', contentUrl: '/api/content/app.ts' },
        { path: 'backup.zip', contentUrl: '/api/content/backup.zip' },
        { path: 'song.mp3', contentUrl: '/api/content/song.mp3' },
        { path: 'weird.xyz123', contentUrl: '/api/content/weird.xyz123' },
      ]);

      const expected = ['pdf', 'word', 'code', 'archive', 'audio', 'unknown'];
      for (let i = 0; i < expected.length; i++) {
        const icon = item(i).locator('.file-icon');
        assert.equal(await icon.getAttribute('data-category'), expected[i], `category for item ${i}`);
        assert.equal(await icon.locator('svg').count(), 1, `icon svg for item ${i}`);
        assert.equal(await icon.locator('img').count(), 0, `no img for item ${i}`);
        assert.equal(await icon.locator('.fa-spin').count(), 0, `no spinner for item ${i}`);
      }
    });
  });

  describe('image thumbnails', () => {
    it('shows the thumbnail and reports it loaded (item 1, S1)', async () => {
      const src = media.url('/ok/photo.png?delay=120');
      await mount([{ path: 'photo.jpg', contentUrl: src }]);

      await waitForSelector('[data-testid="item-0"] .file-icon img');
      await page.waitForFunction(() => window.__loaded.includes(0), null, { timeout: 5_000 });

      assert.equal(await item(0).locator('.file-icon img').getAttribute('src'), src);
      await waitForNoSpinner(0);
      assert.equal(await item(0).locator('.file-icon .fa-spin').count(), 0);
    });

    it('keeps a loaded thumbnail past the load timeout (item 1)', async () => {
      const src = media.url('/ok/photo.png?delay=100');
      await mount([{ path: 'photo.jpg', contentUrl: src }]);
      await waitForSelector('[data-testid="item-0"] .file-icon img');

      // The component gives up after 5s; a finished thumbnail must not expire.
      await page.waitForTimeout(6_000);

      assert.equal(
        await item(0).locator('.file-icon img').count(),
        1,
        'loaded thumbnail must survive the load timeout',
      );
      assert.equal(await item(0).locator('.file-icon svg').count(), 0);
    });

    it('falls back to the image icon when the thumbnail cannot load', async () => {
      await mount([{ path: 'broken.png', contentUrl: media.url('/fail/broken.png') }]);

      await waitForSelector('[data-testid="item-0"] .file-icon svg', 5_000);
      assert.equal(await item(0).locator('.file-icon').getAttribute('data-category'), 'image');
      assert.equal(await item(0).locator('.file-icon img').count(), 0);
      await waitForNoSpinner(0);
      assert.equal(await item(0).locator('.file-icon .fa-spin').count(), 0);
    });
  });

  describe('video thumbnails', () => {
    it('falls back to the video icon when the video cannot be decoded', async () => {
      await mount([{ path: 'clip.mp4', contentUrl: media.url('/video/clip.mp4') }]);

      await waitForSelector('[data-testid="item-0"] .file-icon svg', 8_000);
      assert.equal(await item(0).locator('.file-icon').getAttribute('data-category'), 'video');
      // Both mounted copies (grid and table views) must settle; the hidden
      // one can resolve later than the visible one depending on the platform.
      await waitFor(
        async () => (await item(0).locator('.file-icon .fa-spin').count()) === 0,
        8_000,
      );
      assert.equal(await item(0).locator('.file-icon .fa-spin').count(), 0);
    });
  });

  describe('bounded queue lifecycle (item 4)', () => {
    it('releases slots for failed media, so later thumbnails still load', async () => {
      await mount([
        { path: 'a.png', contentUrl: media.url('/fail/a.png') },
        { path: 'b.png', contentUrl: media.url('/fail/b.png') },
        { path: 'c.png', contentUrl: media.url('/fail/c.png') },
        { path: 'd.png', contentUrl: media.url('/fail/d.png') },
        { path: 'good.png', contentUrl: media.url('/ok/good.png?delay=100') },
      ]);

      await waitForSelector('[data-testid="item-4"] .file-icon img', 8_000);
      for (let i = 0; i < 4; i++) {
        assert.equal(await item(i).locator('.file-icon svg').count(), 1, `failed item ${i} shows an icon`);
        await waitForNoSpinner(i);
        assert.equal(await item(i).locator('.file-icon .fa-spin').count(), 0, `failed item ${i} is not stuck`);
      }
    });

    it('never runs more than three media loads at once', async () => {
      const items = [];
      for (let i = 0; i < 6; i++) {
        items.push({ path: `gate-${i}.png`, contentUrl: media.url(`/gate/gate-${i}.png`) });
      }

      await mount(items);

      // Exactly three requests may be parked: the pool never admits a fourth.
      await waitFor(async () => (await mediaState()).held === 3, 5_000);
      await page.waitForTimeout(600);
      assert.equal((await mediaState()).held, 3, 'only three media loads may run at once');

      await openGate();
      await page.waitForFunction(() => window.__loaded.length === 6, null, { timeout: 20_000 });
      for (let i = 0; i < 6; i++) {
        assert.equal(await item(i).locator('.file-icon img').count(), 1, `item ${i} rendered`);
      }
    });

    it('frees running slots when media items unmount', async () => {
      await mount([
        { path: 'h1.png', contentUrl: media.url('/hang/h1.png') },
        { path: 'h2.png', contentUrl: media.url('/hang/h2.png') },
        { path: 'h3.png', contentUrl: media.url('/hang/h3.png') },
      ]);
      // Let all three occupy the pool.
      await page.waitForFunction(
        () => document.querySelectorAll('.file-icon .fa-spin').length === 3,
        null,
        { timeout: 5_000 },
      );

      await setItems([]);
      await setItems([{ path: 'after.png', contentUrl: media.url('/ok/after.png?delay=100') }]);

      await waitForSelector('[data-testid="item-0"] .file-icon img', 8_000);
    });
  });

  describe('path changes', () => {
    it('drops the previous thumbnail when the item changes', async () => {
      await mount([{ path: 'photo.jpg', contentUrl: media.url('/ok/photo.png?delay=100') }]);
      await waitForSelector('[data-testid="item-0"] .file-icon img');

      await setItems([{ path: 'notes.md', contentUrl: '/api/content/notes.md' }]);
      await page.waitForFunction(
        () => document.querySelector('[data-testid="item-0"] .file-icon')?.getAttribute('data-category') === 'text',
        null,
        { timeout: 5_000 },
      );
      assert.equal(await item(0).locator('.file-icon img').count(), 0);
      assert.equal(await item(0).locator('.file-icon svg').count(), 1);

      const next = media.url('/ok/second.png?delay=100');
      await setItems([{ path: 'second.png', contentUrl: next }]);
      await page.waitForFunction(
        (src) => document.querySelector('[data-testid="item-0"] .file-icon img')?.getAttribute('src') === src,
        next,
        { timeout: 5_000 },
      );
    });
  });
});
