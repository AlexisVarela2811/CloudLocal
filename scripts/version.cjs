// CloudLocal versioning script — keeps the root, launcher, server and client
// package.json versions in sync. Does NOT commit or tag.
//
// Usage:
//   node scripts/version.cjs patch|minor|major   bump the shared version
//   node scripts/version.cjs set X.Y.Z           set an exact version
const fs = require('fs');
const path = require('path');

const BUMP_TYPE = process.argv[2];
const SET_VERSION = process.argv[3];

const USAGE = [
  'Usage: node scripts/version.cjs <patch|minor|major>',
  '       node scripts/version.cjs set <X.Y.Z>',
].join('\n');

// Manifests that must always share the same product version.
const TARGETS = [
  { label: 'root', file: path.join('package.json') },
  { label: 'launcher', file: path.join('launcher', 'package.json') },
  { label: 'server', file: path.join('server', 'package.json') },
  { label: 'client', file: path.join('client', 'package.json') },
];

function parseVersion(value) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(value || '').trim());
  if (!match) return null;
  return match.slice(1).map(Number);
}

function resolveVersion() {
  if (BUMP_TYPE === 'set') {
    if (!parseVersion(SET_VERSION)) {
      console.error('Error: "set" requires an exact X.Y.Z version (for example 0.1.4)');
      console.error(USAGE);
      process.exit(1);
    }
    return SET_VERSION;
  }
  if (!['patch', 'minor', 'major'].includes(BUMP_TYPE)) {
    console.error(USAGE);
    process.exit(1);
  }
  const rootPkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  const parsed = parseVersion(rootPkg.version);
  if (!parsed) {
    console.error('Error: root package.json has an invalid version: ' + rootPkg.version);
    process.exit(1);
  }
  const [major, minor, patch] = parsed;
  if (BUMP_TYPE === 'major') return `${major + 1}.0.0`;
  if (BUMP_TYPE === 'minor') return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

function readManifest(label, file) {
  const full = path.join(__dirname, '..', file);
  let text;
  try {
    text = fs.readFileSync(full, 'utf8');
    return { label, full, file, pkg: JSON.parse(text), indent: detectIndent(text) };
  } catch (err) {
    console.error(`Error: cannot read ${label} manifest at ${file}: ${err.message}`);
    process.exit(1);
  }
}

// Preserve each manifest's existing style so a version bump never reformats it.
function detectIndent(text) {
  const match = /\n([ \t]+)"/.exec(text);
  return match ? match[1] : 2;
}

const previous = readManifest(TARGETS[0].label, TARGETS[0].file);
const previousVersion = previous.pkg.version;
const newVersion = resolveVersion();
const manifests = TARGETS.map(target => (target.label === previous.label ? previous : readManifest(target.label, target.file)));

for (const { full, pkg, indent } of manifests) {
  pkg.version = newVersion;
  fs.writeFileSync(full, JSON.stringify(pkg, null, indent) + '\n', 'utf8');
}

console.log(`Version bumped: ${previousVersion} → ${newVersion}`);
for (const { label, file } of manifests) {
  console.log(`- ${label}: ${file.split(path.sep).join('/')} = ${newVersion}`);
}
console.log(`\n✅ CloudLocal v${newVersion} ready!`);
console.log(`   Commit: git add -A && git commit -m "chore(release): bump version to ${newVersion}"`);
console.log('   Tag and push stay a manual, separate decision.');
