const { test } = require('node:test');
const assert = require('node:assert/strict');
const { openTray } = require('../src/tray.cjs');

test('openTray does not throw when tray is unavailable', async t => {
  assert.doesNotThrow(() => {
    openTray(80, ['http://127.0.0.1:80']);
  });
});

test('openTray handles different ports without error', () => {
  assert.doesNotThrow(() => {
    openTray(5000, ['http://192.168.1.100:5000']);
  });
  assert.doesNotThrow(() => {
    openTray(3000, ['http://10.0.0.5:3000', 'http://192.168.1.5:3000']);
  });
});