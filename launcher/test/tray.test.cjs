const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function loadTray({ platform = 'linux', interfaces = { eth0: [{ family: 'IPv4', internal: false, address: '192.168.1.10' }] } } = {}) {
  const commands = [];
  const files = [];
  const sandbox = {
    module: { exports: {} },
    process: { platform },
    console: { log() {} },
    setTimeout: callback => callback(),
    require(name) {
      if (name === 'node:child_process') return { execFile: (...args) => commands.push(args) };
      if (name === 'node:fs') return { mkdirSync() {}, writeFileSync: (...args) => files.push(args) };
      if (name === 'node:os') return { homedir: () => '/home/user', tmpdir: () => '/tmp', networkInterfaces: () => interfaces };
      return require(name);
    },
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/tray.cjs'), 'utf8'), sandbox);
  return { openTray: sandbox.module.exports.openTray, commands, files };
}

test('opens local setup with the actual port and retains LAN notification and saved URLs', () => {
  for (const port of [80, 5000, 3000]) {
    const { openTray, commands, files } = loadTray();
    const lan = `http://192.168.1.10:${port}`;
    openTray(port, [lan]);
    assert.equal(commands.find(command => command[0] === 'xdg-open')[1][0], `http://127.0.0.1:${port}`);
    assert.equal(commands.find(command => command[0] === 'notify-send')[1][1], `Dirección para otros dispositivos: ${lan}`);
    assert.match(files[0][1], new RegExp(lan.replaceAll('.', '\\.') ));
  }
});

test('notification does not advertise loopback to other devices', () => {
  const { openTray, commands } = loadTray({ interfaces: {} });
  openTray(5000, ['http://127.0.0.1:5000']);
  assert.equal(commands.find(command => command[0] === 'notify-send')[1][1], 'No se detectó una dirección para otros dispositivos.');
});

test('Windows notification script preserves Spanish text', () => {
  const { openTray, commands, files } = loadTray({ platform: 'win32' });
  openTray(5000, ['http://192.168.1.10:5000']);
  const script = files.find(([name]) => name.endsWith('n.ps1'))[1];
  assert.ok(script.startsWith('﻿'));
  assert.match(script, /Dirección para otros dispositivos/);
  assert.equal(commands.find(command => command[0] === 'cmd.exe')[1][3], 'http://127.0.0.1:5000');
});
