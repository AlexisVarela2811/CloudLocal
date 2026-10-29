'use strict';

const { execFile } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

function sendNotification(title, body) {
  try {
    if (process.platform === 'win32') {
      console.log('[notify] sending Windows toast...');
      const tmpdir = os.tmpdir();
      const dir = path.join(tmpdir, 'cl-notif');
      fs.mkdirSync(dir, { recursive: true });
      const script = path.join(dir, 'n.ps1');
      fs.writeFileSync(script,
        '\ufefftry {' +
        '$t = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent(' +
        '[Windows.UI.Notifications.ToastTemplateType]::ToastText02)' +
        '$x = $t.GetElementsByTagName("text")' +
        '$x[0].AppendChild($t.CreateTextNode("CloudLocal")) | Out-Null' +
        '$x[1].AppendChild($t.CreateTextNode("' + body.replace(/"/g, '\\"') + '")) | Out-Null' +
        '[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier(' +
        '"CloudLocal").Show($t)' +
        '} catch {}'
      );
      execFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', script],
        { timeout: 3000, windowsHide: true }, () => {
          try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
          console.log('[notify] done');
        });
      return;
    }
    if (process.platform === 'darwin') {
      execFile('osascript', ['-e',
        'display notification "' + body + '" with title "' + title + '"'],
        { timeout: 3000 }, () => {});
      return;
    }
    // Linux — libnotify
    execFile('notify-send', [title, body], { timeout: 3000 }, () => {});
  } catch { /* silently ignore */ }
}

function getLANIP() {
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal && iface.address !== '100.94.82.83') {
        return iface.address;
      }
    }
  }
  return '127.0.0.1';
}

function launchBrowser(url) {
  try {
    if (process.platform === 'win32') {
      execFile('cmd.exe', ['/c', 'start', '', url], { timeout: 3000, windowsHide: true }, () => {});
    } else if (process.platform === 'darwin') {
      execFile('open', [url], { timeout: 3000 }, () => {});
    } else {
      execFile('xdg-open', [url], { timeout: 3000 }, () => {});
    }
  } catch { /* silently ignore */ }
}

function saveUrls(port, urls) {
  try {
    const home = os.homedir();
    const dir = path.join(home, '.cloudlocal');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'urls.txt'),
      urls.map(u => u + '\n').join('') +
      '\n# CloudLocal URLs — saved on ' + new Date().toISOString() + '\n'
    );
  } catch { /* ignore */ }
}

/**
 * Notify the user that CloudLocal is running (non-blocking), auto-opens
 * the browser locally so initial setup is permitted.
 *
 * @param {number}   port  — the port the server is listening on
 * @param {string[]} urls  — all URLs the server is reachable at
 */
function openTray(port, urls) {
  try {
    console.log('[notify] openTray called with port:', port, 'urls:', JSON.stringify(urls));
    const lanIp = getLANIP();
    const url = `http://${lanIp}:${port}`;
    console.log('[notify] LAN IP:', lanIp, 'URL:', url);

    saveUrls(port, urls);
    console.log('[notify] URLs saved');

    // Show notification (non-blocking)
    setTimeout(() => {
      console.log('[notify] sending notification...');
      sendNotification('CloudLocal', lanIp === '127.0.0.1'
        ? 'No se detectó una dirección para otros dispositivos.'
        : `Dirección para otros dispositivos: ${url}`);
      console.log('[notify] notification sent');
    }, 100);

    // Auto-open browser after a short delay
    setTimeout(() => {
      console.log('[notify] opening browser...');
      launchBrowser(`http://127.0.0.1:${port}`);
      console.log('[notify] browser launched');
    }, 1500);

  } catch (error) {
    console.log(`[notify] ERROR: ${error.message}`);
    console.log(`[notify] stack: ${error.stack}`);
  }
}

module.exports = { openTray };