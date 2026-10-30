#!/usr/bin/env node
// Checks that the documentation and the server agree.
//
//   node .scripts/check-endpoints.cjs
//
// Reads every endpoint the docs publish (README tables and the fenced examples of
// docs/api.md) and compares them with the routes registered in server/src, so a
// documented endpoint that does not exist (or a removed one still documented)
// fails here instead of in the hands of a user.
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SOURCES = ['README.md', 'docs/api.md'];
const MOUNTS = {
  '/api/files': 'server/src/routers/fileRouter.js',
  '/api/settings': 'server/src/routers/settingsRouter.js',
};

function read(relative) {
  return fs.readFileSync(path.join(ROOT, relative), 'utf8').split('\r\n').join('\n');
}

// Documented endpoints: markdown table rows and fenced `METHOD /api/...` lines.
function documentedEndpoints() {
  const found = [];
  for (const file of SOURCES) {
    for (const line of read(file).split('\n')) {
      const table = /^\|\s*`(GET|POST|PUT|DELETE|PATCH)`\s*\|\s*`([^`]+)`/.exec(line);
      if (table) {
        found.push({ file, method: table[1], route: table[2] });
        continue;
      }
      const fenced = /^(GET|POST|PUT|DELETE|PATCH)\s+(\/api\/\S*)/.exec(line.trim());
      if (fenced) found.push({ file, method: fenced[1], route: fenced[2] });
    }
  }
  return found.map(entry => ({
    ...entry,
    route: entry.route.split('?')[0].split('#')[0].replace(/\/+$/, '') || '/',
  }));
}

// Registered routes, including the paths mounted from the routers.
function registeredEndpoints() {
  const registered = new Set();
  const app = read('server/src/app.js');
  for (const match of app.matchAll(/\bapp\.(get|post|put|delete|patch)\('([^']+)'/g)) {
    registered.add(match[1].toUpperCase() + ' ' + match[2]);
  }
  for (const [mount, file] of Object.entries(MOUNTS)) {
    for (const match of read(file).matchAll(/\brouter\.(get|post|put|delete|patch)\('([^']+)'/g)) {
      registered.add(match[1].toUpperCase() + ' ' + mount + (match[2] === '/' ? '' : match[2]));
    }
  }
  return [...registered].map(entry => {
    const [method, route] = entry.split(' ');
    return { method, route, key: method + ' ' + normalise(route) };
  });
}

function normalise(route) {
  return (route.replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, ':p').replace(/\/+$/, '') || '/');
}

function matches(documented, registered) {
  const key = documented.method + ' ' + normalise(documented.route);
  return registered.some(entry => {
    if (entry.key === key) return true;
    // A wildcard route serves any deeper path: /api/files/preview/* covers the
    // concrete example the docs show.
    if (!entry.route.endsWith('/*')) return false;
    if (entry.method !== documented.method) return false;
    const prefix = normalise(entry.route.slice(0, -1));
    return normalise(documented.route).startsWith(prefix);
  });
}

const documented = documentedEndpoints();
const registered = registeredEndpoints();
const missing = documented.filter(entry => !matches(entry, registered));

for (const entry of missing) {
  console.error(`MISSING in server: ${entry.method} ${entry.route} (${entry.file})`);
}
const unique = new Set(documented.map(entry => entry.method + ' ' + entry.route));
console.log(`Documented endpoints: ${unique.size} (${documented.length} references in ${SOURCES.join(', ')}); ` +
  `registered by the server: ${registered.length}; missing: ${missing.length}`);
process.exitCode = missing.length === 0 ? 0 : 1;
