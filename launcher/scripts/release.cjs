#!/usr/bin/env node
'use strict';

// launcher/scripts/release.cjs — creates a local 0.0.1 release candidate
// with provenance metadata, SHA256SUMS, and a .zip archive sibling.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync, execSync } = require('node:child_process');

// ── Project root: launcher/scripts → ../.. ────────────────────────────────
const SCRIPT_DIR = path.resolve(__dirname);
const PROJECT_ROOT = path.resolve(SCRIPT_DIR, '../..');
const LAUNCHER_DIR = path.resolve(SCRIPT_DIR, '..');
const DIST_DIR = path.join(LAUNCHER_DIR, 'dist');

// ── Product versions (read from package.json files) ────────────────────────

function readPackageJson(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf-8')); } catch { return null; }
}

function getVersions() {
  const rootPkg = readPackageJson(path.join(PROJECT_ROOT, 'package.json'));
  const launcherPkg = readPackageJson(path.join(LAUNCHER_DIR, 'package.json'));
  const serverPkg = readPackageJson(path.join(PROJECT_ROOT, 'server', 'package.json'));
  return {
    root: rootPkg ? rootPkg.version : null,
    launcher: launcherPkg ? launcherPkg.version : null,
    server: serverPkg ? serverPkg.version : null,
  };
}

// ── Git info — must not fabricate clean state ─────────────────────────────

function gitInfo() {
  try {
    const cwd = path.resolve(__dirname, '..'); // launcher dir
    const commit = execSync('git rev-parse HEAD', { cwd, encoding: 'utf-8' }).trim();
    const branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd, encoding: 'utf-8' }).trim();
    let dirty = null; // unknown — don't fabricate
    try {
      const status = execSync('git status --porcelain', { cwd, encoding: 'utf-8' }).trim();
      dirty = status.length > 0;
    } catch {
      // git status unavailable — leave dirty as null (unknown)
    }
    return { commit, branch, dirty };
  } catch {
    // git completely unavailable
    return { commit: null, branch: null, dirty: null };
  }
}

// ── Hash helpers ───────────────────────────────────────────────────────────

function sha256file(filePath) {
  const data = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(data).digest('hex');
}

function runtimeSourceSha256() {
  const roots = ['client/src', 'server/src', 'launcher/src'];
  if (roots.some(dir => !fs.existsSync(path.join(PROJECT_ROOT, dir)))) return null;
  const hash = crypto.createHash('sha256');
  function walk(dir) {
    for (const name of fs.readdirSync(dir).sort()) {
      const file = path.join(dir, name);
      if (fs.statSync(file).isDirectory()) {
        walk(file);
        continue;
      }
      hash.update(path.relative(PROJECT_ROOT, file).split(path.sep).join('/'));
      hash.update('\0');
      hash.update(fs.readFileSync(file));
    }
  }
  for (const dir of roots) walk(path.join(PROJECT_ROOT, dir));
  return hash.digest('hex');
}

// ── Third-party notices from installed production deps ─────────────────────

function collectThirdPartyNotices() {
  const lines = [];
  const seen = new Set();
  const workspaces = ['client', 'server'].map(name => path.join(PROJECT_ROOT, name, 'package.json'));

  function resolvePackage(name, from) {
    let current = from;
    while (current === PROJECT_ROOT || current.startsWith(PROJECT_ROOT + path.sep)) {
      const manifest = path.join(current, 'node_modules', name, 'package.json');
      if (fs.existsSync(manifest)) return manifest;
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
    return null;
  }

  function visit(manifest, workspace = false) {
    const real = fs.realpathSync(manifest);
    if (seen.has(real)) return;
    seen.add(real);
    const pkg = JSON.parse(fs.readFileSync(manifest, 'utf8'));
    const dir = path.dirname(manifest);
    if (!workspace && !workspaces.some(file => fs.existsSync(file) && fs.realpathSync(file) === real)) {
      const license = typeof pkg.license === 'string' ? pkg.license :
        pkg.license?.type || (Array.isArray(pkg.licenses) ? pkg.licenses.map(item => item.type).join(', ') : 'UNKNOWN');
      lines.push(`- ${pkg.name} ${pkg.version} (license: ${license})`);
      const notices = fs.readdirSync(dir).sort().filter(name => /^(licen[sc]e|copying|notice)(?:$|[.-])/i.test(name));
      let copied = 0;
      for (const name of notices) {
        const file = path.join(dir, name);
        if (!fs.lstatSync(file).isFile()) continue;
        lines.push(`--- ${pkg.name}/${name} ---`, fs.readFileSync(file, 'utf8'), '');
        copied++;
      }
      if (!copied) lines.push('No license/notice text found in the installed package; see its declared license above.', '');
    }
    const optional = pkg.optionalDependencies || {};
    for (const name of Object.keys({ ...pkg.dependencies, ...optional }).sort()) {
      const dependency = resolvePackage(name, dir);
      if (!dependency) {
        if (name in optional) continue;
        throw new Error('Production dependency is not installed: ' + name + '. Run npm ci first.');
      }
      visit(dependency);
    }
  }

  for (const manifest of workspaces) {
    if (fs.existsSync(manifest)) visit(manifest, true);
  }
  return lines;
}

// ── bsdtar ZIP creation using Windows System32 tar.exe ─────────────────────

function createZipWithBsdtar(srcDir, zipPath) {
  const tarExe = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
  if (!fs.existsSync(tarExe)) {
    throw new Error('bsdtar not found at ' + tarExe + ' — Windows 10+ archive utility required');
  }
  // bsdtar -a -c -f <zip> -C <srcDir> .
  execFileSync(tarExe, ['-a', '-c', '-f', zipPath, '-C', srcDir, '.'], {
    cwd: srcDir,
    stdio: ['ignore', 'ignore', 'pipe'],
  });
}

// ── Usage / help ──────────────────────────────────────────────────────────

function printHelp() {
  console.log('Usage: node launcher/scripts/release.cjs [OPTIONS] [version-tag]');
  console.log('');
  console.log('Create a local 0.0.1 Windows x64 release candidate.');
  console.log('');
  console.log('Options:');
  console.log('  --help    Print this help message and exit.');
  console.log('');
  console.log('Arguments:');
  console.log('  version-tag  Candidate version tag (default: 0.0.1-rc.1).');
  console.log('               Must match X.Y.Z-rc.N (e.g. 0.0.1-rc.1).');
  console.log('');
  console.log('Outputs:');
  console.log('  launcher/dist/release/<candidateName>/ — candidate directory');
  console.log('  launcher/dist/release/<candidateName>.zip — portable archive');
  console.log('  launcher/dist/release/<candidateName>.zip.sha256 — archive checksum');
  console.log('');
  console.log('Candidate payload files:');
  console.log('  CloudLocal.exe, LICENSE, NODE-LICENSE.txt, THIRD-PARTY-NOTICES.txt,');
  console.log('  README.md, RELEASE-NOTES.md, candidate.json, SHA256SUMS');
  console.log('');
  console.log('Verification:');
  console.log('  node launcher/scripts/release-verify.cjs <candidate-directory>');
}

// ── Main ──────────────────────────────────────────────────────────────────

function main() {
  // Parse arguments
  const args = process.argv.slice(2);
  let versionTag = '0.0.1-rc.1';
  let showHelp = false;

  for (const arg of args) {
    if (arg === '--help') {
      showHelp = true;
    } else if (versionTag === '0.0.1-rc.1' || args.indexOf(arg) < args.indexOf(versionTag)) {
      // First non-option arg is the version tag
      if (arg.startsWith('--')) continue;
      versionTag = arg;
    }
  }

  // Re-scan properly
  let foundVersion = false;
  for (const arg of args) {
    if (arg === '--help') { showHelp = true; continue; }
    if (!foundVersion) { versionTag = arg; foundVersion = true; }
  }
  if (showHelp) { printHelp(); return; }

  // Validate version tag format
  if (!/^[\d]+\.[\d]+\.[\d]+-[.\w]+$/.test(versionTag)) {
    console.error('Error: version tag must match X.Y.Z-rc.N');
    console.error('Example: node scripts/release.cjs 0.0.1-rc.1');
    process.exitCode = 1;
    return;
  }

  // Read versions
  const versions = getVersions();

  // Locate executable
  const exePath = path.join(DIST_DIR, 'CloudLocal.exe');
  if (!fs.existsSync(exePath)) {
    console.error('Error: CloudLocal.exe not found at ' + exePath);
    console.error('Run "npm run build:exe" first to build the executable.');
    process.exitCode = 1;
    return;
  }

  // Verify required source files BEFORE creating anything
  const requiredSourceFiles = {
    LICENSE: path.join(PROJECT_ROOT, 'LICENSE'),
    README: path.join(PROJECT_ROOT, 'README.md'),
    NODE_LICENSE: path.join(LAUNCHER_DIR, 'resources', 'NODE-LICENSE-22.23.2.txt'),
  };

  for (const [label, fpath] of Object.entries(requiredSourceFiles)) {
    if (!fs.existsSync(fpath)) {
      console.error('Error: Required file not found: ' + fpath + ' (' + label + ')');
      console.error('Cannot create candidate without all source files.');
      process.exitCode = 1;
      return;
    }
  }

  // Check git availability for provenance
  const git = gitInfo();

  const exeHash = sha256file(exePath);
  const version = versions.root; // product version comes from the source manifest
  const candidateName = versionTag + '-windows-x64';
  const releaseDir = path.join(DIST_DIR, 'release');
  const candidateRoot = path.join(releaseDir, candidateName);

  // Create release directory
  fs.mkdirSync(releaseDir, { recursive: true });

  // Check for existing candidate (prevent accidental overwrite)
  for (const output of [candidateRoot, candidateRoot + '.zip', candidateRoot + '.zip.sha256']) {
    if (!fs.existsSync(output)) continue;
    console.error('Error: Candidate output already exists: ' + output);
    console.error('Use a different version tag; existing output was not changed.');
    process.exitCode = 1;
    return;
  }

  fs.mkdirSync(candidateRoot, { recursive: true });

  try {
    fs.copyFileSync(exePath, path.join(candidateRoot, 'CloudLocal.exe'));
    const exeHashActual = sha256file(path.join(candidateRoot, 'CloudLocal.exe'));
    if (exeHashActual !== exeHash) {
      console.error('Error: Executable hash mismatch after copy');
      process.exitCode = 1;
      return;
    }

    fs.copyFileSync(requiredSourceFiles.LICENSE, path.join(candidateRoot, 'LICENSE'));
    fs.copyFileSync(requiredSourceFiles.NODE_LICENSE, path.join(candidateRoot, 'NODE-LICENSE.txt'));

    const tpLines = collectThirdPartyNotices();
    const thirdPartyContent = [
      '# Third-Party Notices',
      '',
      'This distribution includes third-party software components.',
      'The installed client/server production dependency graph is listed below.',
      'Available upstream LICENSE/NOTICE texts are reproduced verbatim.',
      'Node.js and its bundled components are covered separately in NODE-LICENSE.txt.',
      '',
      '## Production Dependencies',
      '',
      tpLines.length > 0 ? tpLines.join('\n') : '- No production dependencies found',
      '',
      '## Build/Tool Dependencies',
      '',
      '- esbuild and postject are build tools, not standalone programs in this archive.',
      '- The Node.js runtime and its bundled dependencies retain the terms in NODE-LICENSE.txt.',
    ].join('\n') + '\n';
    fs.writeFileSync(path.join(candidateRoot, 'THIRD-PARTY-NOTICES.txt'), thirdPartyContent);

    // Bundle user instructions without links to files outside this archive.
    fs.writeFileSync(path.join(candidateRoot, 'README.md'), [
      `# CloudLocal ${version} — candidato local para Windows x64`, '',
      'Extrae todos los archivos del ZIP en una carpeta y ejecuta CloudLocal.exe.',
      'No necesitas instalar Node.js ni Bun. El servidor funciona sin consola.', '',
      'Abre http://localhost:80 en el equipo servidor. Si ese puerto está ocupado,',
      'el launcher intenta usar el puerto 5000. El navegador se abre al iniciar;',
      'usa la dirección y el puerto reales que muestre la aplicación.', '',
      'Configura la contraseña desde localhost (entre 12 y 256 caracteres).',
      'En otros dispositivos de la misma LAN, abre la IP del servidor con ese puerto.',
      'Mantén el servidor encendido. HTTP no cifra el tráfico: no publiques el puerto en Internet.', '',
      'Los archivos se guardan por defecto en %USERPROFILE%/.cloudlocal/files y',
      'las credenciales en %USERPROFILE%/.cloudlocal/state. Guarda copias de seguridad.', '',
      'Para crear una carpeta usa el botón o Ctrl+Alt+N. Ctrl+N queda para el navegador.',
      'Antes de detenerlo espera a que terminen las transferencias y pulsa Detener Server.',
      'Solo se detiene esa instancia. Para reiniciar, ejecuta de nuevo CloudLocal.exe y recarga la página.', '',
      'Verificación: ejecuta certutil -hashfile CloudLocal.exe SHA256 y compara el',
      'resultado con SHA256SUMS. El ZIP tiene su checksum en un archivo .zip.sha256 separado.',
      'Un checksum comprueba integridad, no identidad del editor ni autenticidad.', '',
      'Este candidato es local y no publicado. No se realizó firma confiable de CloudLocal;',
      'no se verificó Authenticode. Windows puede mostrar advertencias de seguridad.',
      'Consulta RELEASE-NOTES.md, LICENSE, NODE-LICENSE.txt y THIRD-PARTY-NOTICES.txt.', ''
    ].join('\n'));

    fs.writeFileSync(path.join(candidateRoot, 'RELEASE-NOTES.md'), [
      '# CloudLocal Release Notes',
      '',
      `## Version: ${versionTag}`,
      '',
      `## Product Version: ${version}`,
      '',
      '### ⚠ Unsigned Local Candidate',
      '',
      'This is a local candidate; no trusted CloudLocal signing has been performed.',
      'Authenticode verification is unavailable in this environment. The upstream',
      'Node signature may be invalidated by SEA injection; its status is not verified.',
      'Windows may show a security warning. Checksums provide integrity, not publisher identity.',
      '',
      '## Files',
      '',
      '- `CloudLocal.exe` — the packed executable (SEA, subsystem GUI)',
      '- `LICENSE` — MIT license (project)',
      '- `NODE-LICENSE.txt` — Node.js MIT license (Node 22.23.2)',
      '- `THIRD-PARTY-NOTICES.txt` — third-party dependency notices',
      '- `README.md` — usage instructions',
      '- `RELEASE-NOTES.md` — this file',
      '- `candidate.json` — machine-readable provenance',
      '- `SHA256SUMS` — checksums for verification',
      '',
      '## Verification',
      '',
      'Compute SHA-256 of each file and compare against SHA256SUMS:',
      '',
      '  `certutil -hashfile CloudLocal.exe SHA256` (Windows)',
      '  or use the provided verify script:',
      '',
      '  `node launcher/scripts/release-verify.cjs <candidate-directory>`',
      '',
      'Archive checksum:',
      '  File: <candidateName>.zip.sha256 (sibling of candidate directory)',
      '',
      '## Known Limitations',
      '',
      '- No trusted CloudLocal signing was performed; Authenticode status was not verified.',
      '- Built on branch `' + (git.branch || 'unknown') + '` from commit `' + (git.commit || 'unknown') + '`.',
      git.dirty === true ? '- Working directory has uncommitted changes — content may differ from a clean build.' :
      git.dirty === false ? '- Clean working directory.' :
      '- Git status unknown (provenance may be incomplete).',
    ].join('\n') + '\n');

    const candidate = {
      name: 'CloudLocal',
      version: versionTag,
      productVersion: version,
      platform: 'win32',
      arch: 'x64',
      unsigned: true,
      unsignedNote: 'No trusted CloudLocal signing performed. Authenticode status is not verified.',
      signatureStatus: 'not-verified',
      runtimeSourceSha256: runtimeSourceSha256(),
      metadataKind: 'assembled-candidate',
      sha256: exeHashActual,
      git: {
        commit: git.commit || null,
        branch: git.branch || null,
        dirty: git.dirty !== null ? git.dirty : null,
        known: git.commit !== null,
      },
      versions: {
        root: versions.root,
        server: versions.server,
        launcher: versions.launcher,
      },
      files: {
        executable: 'CloudLocal.exe',
        license: 'LICENSE',
        nodeLicense: 'NODE-LICENSE.txt',
        thirdPartyNotices: 'THIRD-PARTY-NOTICES.txt',
        readme: 'README.md',
        notes: 'RELEASE-NOTES.md',
        provenance: 'candidate.json',
        checksums: 'SHA256SUMS',
      },
      builtAt: new Date().toISOString(),
      buildTool: 'esbuild + postject',
      runtime: 'node22',
    };
    fs.writeFileSync(path.join(candidateRoot, 'candidate.json'), JSON.stringify(candidate, null, 2) + '\n');

    const payloadFiles = [
      'CloudLocal.exe',
      'LICENSE',
      'NODE-LICENSE.txt',
      'THIRD-PARTY-NOTICES.txt',
      'README.md',
      'RELEASE-NOTES.md',
      'candidate.json',
    ];
    const sumLines = [];
    for (const file of payloadFiles) {
      const fpath = path.join(candidateRoot, file);
      if (fs.existsSync(fpath)) {
        const hash = sha256file(fpath);
        sumLines.push(hash + '  ' + file);
      }
    }
    fs.writeFileSync(path.join(candidateRoot, 'SHA256SUMS'), sumLines.join('\n') + '\n');

    const zipPath = path.join(releaseDir, candidateName + '.zip');
    createZipWithBsdtar(candidateRoot, zipPath);

    const zipHash = sha256file(zipPath);
    fs.writeFileSync(zipPath + '.sha256', zipHash + '  ' + candidateName + '.zip\n');

    console.log('Candidate created: ' + candidateRoot);
    console.log('  Executable: CloudLocal.exe (' + exeHashActual + ')');
    console.log('  Archive: ' + zipPath);
    console.log('  Archive SHA-256: ' + zipHash);
    console.log('  Commit: ' + (git.commit || 'unknown') + ' (' + (git.branch || 'unknown') + (git.dirty === true ? ' [dirty]' : git.dirty === false ? ' [clean]' : ' [unknown]') + ')');
    console.log('  Verify with: node launcher/scripts/release-verify.cjs "' + candidateRoot + '"');
  } catch (err) {
    console.error('Error creating candidate: ' + err.message);
    // Clean up partial output on failure
    try {
      if (fs.existsSync(candidateRoot)) {
        fs.rmSync(candidateRoot, { recursive: true, force: true });
      }
    } catch { /* best effort cleanup */ }
    process.exitCode = 1;
  }
}

main();