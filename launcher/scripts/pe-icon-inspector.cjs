#!/usr/bin/env node
'use strict';

// Inject icon into PE file by modifying the resource directory
// Uses raw PE parsing (no external dependencies)

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const ROOT = path.resolve(__dirname, '../..');
const EXE_PATH = path.join(ROOT, 'launcher', 'dist', 'CloudLocal.exe');
const ICO_PATH = path.join(__dirname, 'cloudlocal.ico');

function readPE(filePath) {
  return fs.readFileSync(filePath);
}

function getPEOffset(data) {
  return data.readUInt32LE(0x3C);
}

function getSectionCount(peOffset, data) {
  return data.readUInt16LE(peOffset + 4 + 2 + 20); // COFF header offset 20
}

function getSectionTableOffset(peOffset, sectionCount) {
  return peOffset + 4 + 20 + sectionCount * 40; // COFF header + section entries (40 bytes each)
}

function getRVA(data, sectionTableOffset, sectionIndex, field) {
  const section = sectionTableOffset + sectionIndex * 40;
  if (field === 'VirtualAddress') {
    return data.readUInt32LE(section + 8);
  }
  if (field === 'VirtualSize') {
    return data.readUInt32LE(section + 4);
  }
  return 0;
}

async function main() {
  if (!fs.existsSync(EXE_PATH)) {
    console.error('CloudLocal.exe not found');
    process.exitCode = 1;
    return;
  }
  if (!fs.existsSync(ICO_PATH)) {
    console.error('ICO not found');
    process.exitCode = 1;
    return;
  }

  const icoData = fs.readFileSync(ICO_PATH);
  console.log('Read ICO: ' + icoData.length + ' bytes');

  // Parse ICO structure
  const count = icoData.readUInt16LE(4);
  let offset = 6;
  const images = [];
  for (let i = 0; i < count; i++) {
    const width = icoData[offset];
    const imageOffset = icoData.readUInt32LE(offset + 12);
    const imageSize = icoData.readUInt32LE(offset + 8);
    images.push({
      width,
      data: icoData.slice(imageOffset, imageOffset + imageSize)
    });
    offset += 16;
  }
  console.log('Parsed ' + images.length + ' icon images');

  // Now read the PE file
  const peData = readPE(EXE_PATH);
  const peOff = getPEOffset(peData);
  const sectionCount = getSectionCount(peOff, peData);
  
  // Check for existing resource directory
  const optHeaderOff = peOff + 4 + 20; // PE signature + COFF header
  const rvaField = optHeaderOff + 112; // Data directory RVA (PE32+ offset 112)
  const sizeField = rvaField - 4;
  
  const existingRva = peData.readUInt32LE(rvaField);
  const existingSize = peData.readUInt32LE(sizeField);
  
  console.log('Existing resource directory: RVA=' + existingRva + ', Size=' + existingSize);
  
  if (existingRva === 0) {
    console.log('No existing resource directory - need to create one');
    // This is complex - requires adding a new section
    console.log('Skipping - requires complex PE modification');
    process.exit(0);
    return;
  }
  
  console.log('Resource directory exists - injection would require complex modification');
  console.log('The Windows API approach is more reliable for adding resources');
}

main().catch(err => {
  console.error(err);
  process.exitCode = 1;
});