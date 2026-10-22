#!/usr/bin/env node
'use strict';
// launcher/scripts/make-ico.cjs — Generate proper .ico from cloudlocal.svg
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

async function main() {
  const svgPath = path.resolve(__dirname, '../../client/public/cloudlocal.svg');
  const sizes = [16, 32, 48, 64, 128, 256];
  const pngBuffers = [];

  for (const size of sizes) {
    const pngPath = path.join(__dirname, '.tmp-icon-' + size + '.png');
    await sharp(svgPath)
      .resize(size, size, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 } })
      .png({ compressionLevel: 3 })
      .toFile(pngPath);
    pngBuffers.push({ size, data: fs.readFileSync(pngPath) });
    fs.unlinkSync(pngPath); // cleanup
  }

  // Build ICO file structure
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // Reserved
  header.writeUInt16LE(1, 2); // Type: 1 = ICO
  header.writeUInt16LE(sizes.length, 4); // Count

  const dirEntries = [];
  let dataOffset = 6 + sizes.length * 16;

  for (let i = 0; i < sizes.length; i++) {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(sizes[i] > 255 ? 0 : sizes[i], 0); // Width (0 = 256)
    entry.writeUInt8(sizes[i] > 255 ? 0 : sizes[i], 1); // Height
    entry.writeUInt8(0, 2); // Color count (0 = true color with alpha)
    entry.writeUInt8(0, 3); // Reserved
    entry.writeUInt16LE(1, 4); // Color planes
    entry.writeUInt16LE(32, 6); // Bits per pixel
    entry.writeUInt32LE(pngBuffers[i].data.length, 8); // Image size
    entry.writeUInt32LE(dataOffset, 12); // Image offset
    dirEntries.push(entry);
    dataOffset += pngBuffers[i].data.length;
  }

  // Concatenate: header + dir entries + PNG data
  const parts = [header, ...dirEntries, ...pngBuffers.map(pb => pb.data)];
  const ico = Buffer.concat(parts);
  const icoPath = path.join(__dirname, 'cloudlocal.ico');
  fs.writeFileSync(icoPath, ico);

  console.log('ICO generated: ' + icoPath + ' (' + ico.length + ' bytes)');
  for (const pb of pngBuffers) {
    console.log('  ' + pb.size + 'x' + pb.size + ': ' + pb.data.length + ' bytes');
  }
}

main().catch(err => {
  console.error(err);
  process.exitCode = 1;
});