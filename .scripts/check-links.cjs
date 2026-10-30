#!/usr/bin/env node
// Link checker for repository documentation (local verification helper, not committed).
// - relative links must resolve to an existing file
// - #anchor links must match a heading anchor in the target document
// - external http(s) links are skipped here (checked separately)
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const FILES = process.argv.slice(2).length > 0
  ? process.argv.slice(2)
  : ['README.md', ...fs.readdirSync(path.join(ROOT, 'docs')).filter(f => f.endsWith('.md')).map(f => 'docs/' + f)];

function readDoc(file) {
  // Documentation in this repository mixes CRLF and LF; normalize before parsing.
  return fs.readFileSync(path.join(ROOT, file), 'utf8').split('\r\n').join('\n');
}

function slug(text) {
  return text.trim().toLowerCase()
    .replace(/`/g, '')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '-');
}

function anchorsOf(file) {
  const anchors = new Set();
  for (const line of readDoc(file).split('\n')) {
    const match = /^(#{1,6})\s+(.*)$/.exec(line);
    if (match) anchors.add(slug(match[2]));
  }
  return anchors;
}

const cache = new Map();
let errors = 0;
const checked = new Set();

for (const file of FILES) {
  const text = readDoc(file);
  const re = /\[[^\]]*\]\(([^)\s]+)\)/g;
  let match;
  while ((match = re.exec(text))) {
    const target = match[1];
    if (checked.has(file + ' ' + target)) continue;
    checked.add(file + ' ' + target);
    if (/^https?:/.test(target) || target.startsWith('mailto:')) continue;
    const [rawPath, anchor] = target.split('#');
    const resolved = rawPath === '' ? file : path.posix.join(path.posix.dirname(file), rawPath);
    if (!fs.existsSync(path.join(ROOT, resolved))) {
      console.error(`MISSING ${file}: ${target} -> ${resolved}`);
      errors++;
      continue;
    }
    if (anchor) {
      const base = rawPath === '' ? file : resolved;
      if (!cache.has(base)) cache.set(base, anchorsOf(base));
      if (!cache.get(base).has(anchor)) {
        console.error(`ANCHOR ${file}: ${target} (no heading anchor "${anchor}" in ${base})`);
        errors++;
      }
    }
  }
}

console.log(errors === 0 ? `Local links OK (${checked.size} checked)` : `Local link errors: ${errors}`);
process.exitCode = errors === 0 ? 0 : 1;
