// ── file-visuals.test.mjs ──
// Extension classification tests — FileVisual feature.
// Run: node --test client/test/file-visuals.test.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert';

import { classifyExtension, EXT_MAP } from '../src/components/fileVisuals.mjs';

describe('classifyExtension', () => {
  it('classifies image extensions to "image"', () => {
    assert.equal(classifyExtension('photo.jpg'), 'image');
    assert.equal(classifyExtension('photo.JPG'), 'image');
    assert.equal(classifyExtension('photo.png'), 'image');
    assert.equal(classifyExtension('photo.gif'), 'image');
    assert.equal(classifyExtension('photo.webp'), 'image');
    assert.equal(classifyExtension('photo.bmp'), 'image');
    assert.equal(classifyExtension('photo.avif'), 'image');
    assert.equal(classifyExtension('photo.svg'), 'image');
  });

  it('classifies video extensions to "video"', () => {
    assert.equal(classifyExtension('clip.mp4'), 'video');
    assert.equal(classifyExtension('clip.WEBM'), 'video');
    assert.equal(classifyExtension('clip.mov'), 'video');
    assert.equal(classifyExtension('clip.mkv'), 'video');
    assert.equal(classifyExtension('clip.avi'), 'video');
  });

  it('classifies audio extensions to "audio"', () => {
    assert.equal(classifyExtension('song.mp3'), 'audio');
    assert.equal(classifyExtension('song.wav'), 'audio');
    assert.equal(classifyExtension('song.ogg'), 'audio');
    assert.equal(classifyExtension('song.flac'), 'audio');
    assert.equal(classifyExtension('song.m4a'), 'audio');
  });

  it('classifies PDF', () => {
    assert.equal(classifyExtension('doc.pdf'), 'pdf');
  });

  it('classifies Word docs', () => {
    assert.equal(classifyExtension('doc.docx'), 'word');
    assert.equal(classifyExtension('doc.doc'), 'word');
  });

  it('classifies Excel spreadsheets', () => {
    assert.equal(classifyExtension('data.xlsx'), 'excel');
    assert.equal(classifyExtension('data.xls'), 'excel');
    assert.equal(classifyExtension('data.csv'), 'excel');
  });

  it('classifies PowerPoint presentations', () => {
    assert.equal(classifyExtension('slides.pptx'), 'powerpoint');
    assert.equal(classifyExtension('slides.ppt'), 'powerpoint');
  });

  it('classifies archives', () => {
    assert.equal(classifyExtension('file.zip'), 'archive');
    assert.equal(classifyExtension('file.rar'), 'archive');
    assert.equal(classifyExtension('file.tar.gz'), 'archive');
    assert.equal(classifyExtension('file.gz'), 'archive');
  });

  it('classifies text files', () => {
    assert.equal(classifyExtension('readme.txt'), 'text');
    assert.equal(classifyExtension('readme.md'), 'text');
    assert.equal(classifyExtension('data.json'), 'text');
  });

  it('classifies code files', () => {
    assert.equal(classifyExtension('app.ts'), 'code');
    assert.equal(classifyExtension('app.py'), 'code');
    assert.equal(classifyExtension('app.js'), 'code');
    assert.equal(classifyExtension('style.css'), 'code');
  });

  it('returns "unknown" for unrecognized extensions', () => {
    assert.equal(classifyExtension('file.xyz123'), 'unknown');
    assert.equal(classifyExtension('noext'), 'unknown');
  });

  it('handles filenames with dots', () => {
    assert.equal(classifyExtension('my.file.jpg'), 'image');
    assert.equal(classifyExtension('archive.tar.gz'), 'archive'); // .gz maps to archive
  });
});

describe('EXT_MAP', () => {
  it('has entries for all categories', () => {
    // At least one entry per category
    const categories = ['image', 'video', 'audio', 'pdf', 'word', 'excel',
      'powerpoint', 'archive', 'text', 'code'];
    for (const cat of categories) {
      let found = false;
      for (const [, v] of EXT_MAP) { if (v === cat) { found = true; break; } }
      assert.ok(found, `EXT_MAP should have entries for category "${cat}"`);
    }
  });
});