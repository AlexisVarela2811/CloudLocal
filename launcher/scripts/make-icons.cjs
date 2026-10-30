#!/usr/bin/env node
'use strict';

// launcher/scripts/make-icons.cjs — regenerates the packaged icon resources from
// the single source of truth, client/public/cloudlocal.svg:
//
//   launcher/resources/CloudLocal.icns    macOS .app bundle icon
//   launcher/resources/cloudlocal.png     Linux .desktop icon (256x256)
//
// The outputs are committed so builds stay offline and deterministic; run this
// script only when the source SVG changes. Windows keeps using the prebuilt
// launcher/scripts/cloudlocal.ico (see make-ico.cjs).
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');

const LAUNCHER_DIR = path.resolve(__dirname, '..');
const SVG_PATH = path.resolve(LAUNCHER_DIR, '..', 'client', 'public', 'cloudlocal.svg');
const RESOURCES_DIR = path.join(LAUNCHER_DIR, 'resources');

// ICNS chunk types for PNG-encoded representations (Apple Icon Image format).
const ICNS_CHUNKS = [
  ['icp4', 16],
  ['icp5', 32],
  ['ic07', 128],
  ['ic08', 256],
  ['ic09', 512],
  ['ic10', 1024],
];

const LINUX_ICON_SIZE = 256;

async function renderPng(size) {
  return sharp(SVG_PATH)
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

function buildIcns(entries) {
  const chunks = entries.map(([type, data]) => {
    const header = Buffer.alloc(8);
    header.write(type, 0, 4, 'ascii');
    header.writeUInt32BE(data.length + 8, 4);
    return Buffer.concat([header, data]);
  });
  const body = Buffer.concat(chunks);
  const header = Buffer.alloc(8);
  header.write('icns', 0, 4, 'ascii');
  header.writeUInt32BE(body.length + 8, 4);
  return Buffer.concat([header, body]);
}

async function main() {
  if (!fs.existsSync(SVG_PATH)) throw new Error('Source icon not found: ' + SVG_PATH);
  fs.mkdirSync(RESOURCES_DIR, { recursive: true });

  const entries = [];
  for (const [type, size] of ICNS_CHUNKS) entries.push([type, await renderPng(size)]);
  const icnsPath = path.join(RESOURCES_DIR, 'CloudLocal.icns');
  fs.writeFileSync(icnsPath, buildIcns(entries));

  const pngPath = path.join(RESOURCES_DIR, 'cloudlocal.png');
  fs.writeFileSync(pngPath, await renderPng(LINUX_ICON_SIZE));

  console.log('ICNS generated: ' + icnsPath + ' (' + fs.statSync(icnsPath).size + ' bytes)');
  for (const [type, size] of ICNS_CHUNKS) {
    const entry = entries.find(([candidate]) => candidate === type);
    console.log('  ' + type + ' ' + size + 'x' + size + ': ' + entry[1].length + ' bytes');
  }
  console.log('PNG generated: ' + pngPath + ' (' + fs.statSync(pngPath).size + ' bytes, ' +
    LINUX_ICON_SIZE + 'x' + LINUX_ICON_SIZE + ')');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
