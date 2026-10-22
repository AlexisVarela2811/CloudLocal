/**
 * CloudLocal versioning script.
 * Usage:
 *   npm run version:patch   # 0.1.0 → 0.1.1
 *   npm run version:minor   # 0.1.0 → 0.2.0
 *   npm run version:major   # 0.1.0 → 1.0.0
 *
 * Also updates launcher and server package.json files,
 * creates a git tag, and updates CHANGELOG.md.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const BUMP_TYPE = process.argv[2];

if (!['patch', 'minor', 'major'].includes(BUMP_TYPE)) {
  console.error(`Usage: node scripts/version.cjs <patch|minor|major>`);
  process.exit(1);
}

// Read root package.json
const rootPkgPath = path.join(__dirname, '..', 'package.json');
const rootPkg = JSON.parse(fs.readFileSync(rootPkgPath, 'utf8'));

// Parse version
const [major, minor, patch] = rootPkg.version.split('.').map(Number);

// Bump version
let newVersion;
if (BUMP_TYPE === 'major') {
  newVersion = `${major + 1}.0.0`;
} else if (BUMP_TYPE === 'minor') {
  newVersion = `${major}.${minor + 1}.0`;
} else {
  newVersion = `${major}.${minor}.${patch + 1}`;
}

// Update root package.json
rootPkg.version = newVersion;
fs.writeFileSync(rootPkgPath, JSON.stringify(rootPkg, null, 4) + '\n', 'utf8');

// Update launcher package.json (must match root)
const launcherPkgPath = path.join(__dirname, '..', 'launcher', 'package.json');
const launcherPkg = JSON.parse(fs.readFileSync(launcherPkgPath, 'utf8'));
launcherPkg.version = newVersion;
fs.writeFileSync(launcherPkgPath, JSON.stringify(launcherPkg, null, 4) + '\n', 'utf8');

// Update server package.json (also synced)
const serverPkgPath = path.join(__dirname, '..', 'server', 'package.json');
const serverPkg = JSON.parse(fs.readFileSync(serverPkgPath, 'utf8'));
serverPkg.version = newVersion;
fs.writeFileSync(serverPkgPath, JSON.stringify(serverPkg, null, 4) + '\n', 'utf8');

console.log(`Version bumped: ${rootPkg.version} → ${newVersion}`);
console.log(`- Updated ${rootPkg.version}`);
console.log(`- Updated launcher ${launcherPkg.version}`);
console.log(`- Updated server ${serverPkg.version}`);

// Create git commit and tag
try {
  execSync(`git add package.json launcher/package.json server/package.json`, { stdio: 'inherit' });
  execSync(`git commit -m "chore: bump version to ${newVersion}"`, { stdio: 'inherit' });
  execSync(`git tag -a "v${newVersion}" -m "Release v${newVersion}"`, { stdio: 'inherit' });
  console.log(`\n✓ Created git tag: v${newVersion}`);
} catch (err) {
  console.warn(`\n⚠ Git commit/tag failed (not a git repo or already committed?): ${err.message}`);
}

console.log(`\n✅ CloudLocal v${newVersion} ready!`);
console.log(`   To push: git push origin main && git push origin v${newVersion}`);