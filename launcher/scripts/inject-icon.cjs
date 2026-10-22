#!/usr/bin/env node
'use strict';
// launcher/scripts/inject-icon.cjs — Adds icon resource to CloudLocal.exe
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const postject = require('postject');

const ROOT = path.resolve(__dirname, '../..');
const EXE_PATH = path.join(ROOT, 'launcher', 'dist', 'CloudLocal.exe');
const SVG_PATH = path.join(ROOT, 'client', 'public', 'cloudlocal.svg');

async function main() {
  if (!fs.existsSync(EXE_PATH)) {
    console.error('CloudLocal.exe not found');
    process.exitCode = 1;
    return;
  }
  if (!fs.existsSync(SVG_PATH)) {
    console.error('SVG not found at ' + SVG_PATH);
    process.exitCode = 1;
    return;
  }

  console.log('Building ICO from SVG...');
  const sizes = [16, 32, 48, 256];
  const pngBufs = [];
  for (const size of sizes) {
    const tmp = path.join(ROOT, '.cl-' + size + '.png');
    await sharp(SVG_PATH)
      .resize(size, size, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 } })
      .png()
      .toFile(tmp);
    pngBufs[pngBufs.length] = fs.readFileSync(tmp);
    fs.unlinkSync(tmp);
  }

  // Build ICO file structure
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(sizes.length, 4);

  const dirs = [];
  let dataOffset = 6 + sizes.length * 16;
  for (let i = 0; i < sizes.length; i++) {
    const d = Buffer.alloc(16);
    d.writeUInt8(sizes[i] > 255 ? 0 : sizes[i], 0);
    d.writeUInt8(sizes[i] > 255 ? 0 : sizes[i], 1);
    d.writeUInt8(0, 2);
    d.writeUInt8(0, 3);
    d.writeUInt16LE(1, 4);
    d.writeUInt16LE(32, 6);
    d.writeUInt32LE(pngBufs[i].length, 8);
    d.writeUInt32LE(dataOffset, 12);
    dirs.push(d);
    dataOffset += pngBufs[i].length;
  }

  const ico = Buffer.concat([header, ...dirs, ...pngBufs]);
  console.log('ICO built: ' + ico.length + ' bytes');

  // Inject as new PE section (appended to file with PE header update)
  const data = fs.readFileSync(EXE_PATH);
  const origSize = data.length;
  const sectionSize = Math.ceil(ico.length / 512) * 512;
  const newSize = origSize + sectionSize;
  const newExe = Buffer.alloc(newSize);
  data.copy(newExe);
  ico.copy(newExe, origSize);

  // Update PE header section count
  const peOffset = newExe.readUInt32LE(0x3c);
  const coffOffset = peOffset + 4;
  const oldSecCount = newExe.readUInt16LE(coffOffset + 2);
  newExe.writeUInt16LE(oldSecCount + 1, coffOffset + 2);

  // Get section table start
  const sectionTableOffset = coffOffset + 20 + oldSecCount * 40;

  // Get last section's VirtualAddress + VirtualSize
  const lastSec = Buffer.from(newExe.buffer, newExe.byteOffset + sectionTableOffset + (oldSecCount - 1) * 40, 40);
  const lastVA = lastSec.readUInt32LE(8);
  const lastVS = lastSec.readUInt32LE(4);
  const newVA = lastVA + lastVS;

  // Write new section entry
  const newSec = Buffer.from(newExe.buffer, newExe.byteOffset + sectionTableOffset + oldSecCount * 40, 40);
  'ICON_RES'.slice(0, 8).split('').forEach((c, i) => { newSec[i] = c.charCodeAt(0); });
  newSec.writeUInt32LE(ico.length, 4); // VirtualSize
  newSec.writeUInt32LE(newVA, 8); // VirtualAddress
  newSec.writeUInt32LE(ico.length, 12); // SizeOfRawData
  newSec.writeUInt32LE(origSize, 16); // PointerToRawData

  fs.writeFileSync(EXE_PATH, newExe);
  console.log('Icon injected successfully: ' + EXE_PATH);
}

main().catch(err => {
  console.error(err);
  process.exitCode = 1;
});