const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function loadTray() {
  const commands = [];
  const files = [];
  const sandbox = {
    module: { exports: {} },
    process: { platform: 'linux' },
    console: { log() {} },
    setTimeout: callback => callback(),
    require(name) {
      if (name === 'node:child_process') return { execFile: (...args) => commands.push(args) };
      if (name === 'node:fs') return { mkdirSync() {}, writeFileSync: (...args) => files.push(args) };
      if (name === 'node:os') return { homedir: () => '/home/user', networkInterfaces: () => ({ eth0: [{ family: 'IPv4', internal: false, address: '192.168.1.10' }] }) };
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
    assert.equal(commands.find(command => command[0] === 'notify-send')[1][1], `Running at ${lan}`);
    assert.match(files[0][1], new RegExp(lan.replaceAll('.', '\\.') ));
  }
});
