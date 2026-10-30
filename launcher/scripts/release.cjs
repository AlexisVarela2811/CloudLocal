#!/usr/bin/env node
'use strict';

// launcher/scripts/release.cjs — creates a local release candidate for the host
// platform with provenance metadata, SHA256SUMS, and a .zip archive sibling.
//
// Windows ships a loose CloudLocal.exe; macOS ships CloudLocal.app (with the
// .icns icon inside); Linux ships the binary plus a .desktop entry, a PNG icon
// and a rootless install.sh. release-layout.cjs owns those names.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync, execSync } = require('node:child_process');
const layout = require('./release-layout.cjs');

// ── Project root: launcher/scripts → ../.. ────────────────────────────────
const SCRIPT_DIR = path.resolve(__dirname);
const PROJECT_ROOT = path.resolve(SCRIPT_DIR, '../..');
const LAUNCHER_DIR = path.resolve(SCRIPT_DIR, '..');
const DIST_DIR = path.join(LAUNCHER_DIR, 'dist');
const RESOURCES_DIR = path.join(LAUNCHER_DIR, 'resources');

// ── Host platform identity (build.cjs produces the native binary) ─────────
const HOST_INFO = {
  win32: { homeLabel: '%USERPROFILE%', hashPrefix: 'certutil -hashfile', hashSuffix: 'SHA256' },
  linux: { homeLabel: '~', hashPrefix: 'sha256sum', hashSuffix: '' },
  darwin: { homeLabel: '~', hashPrefix: 'shasum -a 256', hashSuffix: '' },
};
const LAYOUT = layout.layoutFor(process.platform);
const PLATFORM = LAYOUT ? { ...LAYOUT, ...HOST_INFO[process.platform] } : null;

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

// ── Archive creation: bsdtar on Windows, zip elsewhere ─────────────────

function createArchive(srcDir, zipPath) {
  if (process.platform === 'win32') {
    const tarExe = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
    if (!fs.existsSync(tarExe)) {
      throw new Error('bsdtar not found at ' + tarExe + ' — Windows 10+ archive utility required');
    }
    // bsdtar -a -c -f <zip> -C <srcDir> .
    execFileSync(tarExe, ['-a', '-c', '-f', zipPath, '-C', srcDir, '.'], {
      cwd: srcDir,
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    return;
  }
  // zip is preinstalled on macOS and standard Linux CI images.
  execFileSync('zip', ['-r', '-q', zipPath, '.'], {
    cwd: srcDir,
    stdio: ['ignore', 'ignore', 'pipe'],
  });
}

// Written/copied documents keep a fixed mode so a restrictive umask cannot make
// the candidate differ between machines (release-verify enforces 0644).
function writeDocument(filePath, content) {
  fs.writeFileSync(filePath, content);
  if (process.platform !== 'win32') fs.chmodSync(filePath, 0o644);
}

// ── Candidate documents (README/RELEASE-NOTES) ────────────────────────────

// Payload files of this platform, i.e. everything that is not a shared notice.
function payloadDisplayPaths() {
  if (!PLATFORM) return ['executable'];
  return layout.payloadPaths(PLATFORM).filter(file => !layout.COMMON_FILES.includes(file));
}

function hashCommand(target) {
  return PLATFORM.hashPrefix + ' ' + target + (PLATFORM.hashSuffix ? ' ' + PLATFORM.hashSuffix : '');
}

function executablePath() {
  return PLATFORM.kind === 'macos' ? layout.APP_EXECUTABLE : PLATFORM.binary;
}

// Instructions bundled inside the archive: self-contained, no repository links.
function archiveReadme(version) {
  const lines = [
    `# CloudLocal ${version} — ${PLATFORM.id}`,
    '',
    'Extrae todos los archivos del ZIP en una carpeta. No necesitas instalar Node.js ni Bun.',
    '',
  ];

  if (PLATFORM.kind === 'windows') {
    lines.push(
      'Ejecuta CloudLocal.exe. El servidor funciona en segundo plano, sin consola.',
    );
  } else if (PLATFORM.kind === 'macos') {
    lines.push(
      'Abre CloudLocal.app (doble clic). El ejecutable está en Contents/MacOS/cloudlocal.',
      'La app está firmada de forma ad-hoc, sin notarización de Apple: si macOS la bloquea',
      'o dice que está dañada, ejecuta en Terminal:',
      '',
      '  xattr -dr com.apple.quarantine CloudLocal.app',
      '',
      'y vuelve a abrirla. Ese aviso es esperable: no hay certificado de desarrollador.',
    );
  } else {
    lines.push(
      'Ejecuta ./cloudlocal-linux-x64. El ZIP conserva el permiso 0755; si tu extractor lo',
      'pierde, aplica chmod +x cloudlocal-linux-x64.',
      '',
      'Opcional: ./install.sh instala sin privilegios de administrador en ~/.local',
      '(binario `cloudlocal`, entrada de menú CloudLocal.desktop e icono cloudlocal.png).',
      './install.sh --uninstall deshace esa instalación.',
    );
  }

  lines.push(
    '',
    'El navegador se abre automáticamente en el equipo servidor con el puerto real.',
    'Configura allí la contraseña (entre 12 y 256 caracteres). Por seguridad,',
    'la configuración inicial solo está permitida desde el equipo servidor.',
    'Si el navegador no se abre, visita http://127.0.0.1:80 en ese equipo;',
    'si se usa otro puerto, sustituye 80 por el puerto indicado al iniciar.',
    '',
    'En otros dispositivos de la misma LAN, abre la dirección que muestra',
    'Configuración → Servidor → Conectar otros dispositivos, con ese puerto.',
    'HTTP no cifra el tráfico: no publiques el puerto en Internet.', '',
    'Los archivos se guardan por defecto en ' + PLATFORM.homeLabel + '/.cloudlocal/files y',
    'las credenciales en ' + PLATFORM.homeLabel + '/.cloudlocal/state. Guarda copias de seguridad.', '',
    'Para crear una carpeta usa el botón o Ctrl+Alt+N. Ctrl+N queda para el navegador.',
    'Antes de detenerlo espera a que terminen las transferencias y pulsa Apagar servidor',
    '(el botón Apagar de la barra lateral), o Configuración → Servidor → Apagar el servidor.',
    'Solo se detiene esa instancia. Para reiniciar, ejecuta de nuevo ' +
    (PLATFORM.kind === 'macos' ? 'CloudLocal.app' : PLATFORM.binary) + ' y recarga la página.', '',
    'Verificación: ejecuta `' + hashCommand(executablePath()) + '` y compara el',
    'resultado con SHA256SUMS. El ZIP tiene su checksum en un archivo .zip.sha256 separado.',
    'Un checksum comprueba integridad, no identidad del editor ni autenticidad.', '',
    'No se realizó firma confiable de CloudLocal ni notarización;',
    (PLATFORM.kind === 'windows' ? 'no se verificó Authenticode. Windows puede mostrar advertencias de seguridad.' :
      PLATFORM.kind === 'macos' ? 'la app solo tiene firma ad-hoc. macOS puede mostrar advertencias de seguridad.' :
        'el binario no está firmado. Linux puede mostrar advertencias al ejecutarlo.'), '',
    'Consulta RELEASE-NOTES.md, LICENSE, NODE-LICENSE.txt y THIRD-PARTY-NOTICES.txt.', ''
  );
  return lines.join('\n');
}

function describePayloadFile(file) {
  if (file === layout.APP_BUNDLE) return 'macOS app bundle (Finder shows the .icns icon)';
  if (file === layout.APP_EXECUTABLE) return 'packed executable inside the bundle (SEA)';
  if (file === layout.APP_INFO_PLIST) return 'bundle metadata (CFBundleExecutable, version, icon)';
  if (file === layout.APP_ICON) return 'application icon (Apple Icon Image) inside the bundle';
  if (file === layout.LINUX_BINARY) return 'packed executable (SEA), mode 0755';
  if (file === layout.LINUX_DESKTOP_ENTRY) return 'desktop menu entry (Exec=cloudlocal, Icon=cloudlocal)';
  if (file === layout.LINUX_ICON) return 'desktop icon (PNG 256x256)';
  if (file === layout.LINUX_INSTALLER) return 'per-user install helper (no root), mode 0755';
  if (file === 'LICENSE') return 'MIT license (project)';
  if (file === 'NODE-LICENSE.txt') return 'Node.js MIT license (Node 22.23.2)';
  if (file === 'THIRD-PARTY-NOTICES.txt') return 'third-party dependency notices';
  if (file === 'README.md') return 'usage instructions';
  if (file === 'RELEASE-NOTES.md') return 'this file';
  if (file === 'candidate.json') return 'machine-readable provenance';
  if (file === 'SHA256SUMS') return 'checksums for verification';
  return null;
}

function releaseNotes(versionTag, version, git) {
  const payload = layout.payloadPaths(PLATFORM).filter(file => file !== 'SHA256SUMS');
  const files = payload.map(file => '- `' + file + '` — ' + describePayloadFile(file));
  files.push('- `SHA256SUMS` — checksums for verification');
  const signing = PLATFORM.kind === 'windows'
    ? ['Authenticode verification is unavailable in this environment. The upstream',
      'Node signature may be invalidated by SEA injection; its status is not verified.']
    : PLATFORM.kind === 'macos'
      ? ['The bundle keeps an ad-hoc signature with the JIT entitlements V8 needs, but it is',
        'not notarized and no developer certificate was used.']
      : ['The Linux binary carries no signature.'];
  return [
    '# CloudLocal Release Notes',
    '',
    `## Version: ${versionTag}`,
    '',
    `## Product Version: ${version}`,
    '',
    `## Platform: ${PLATFORM.id}`,
    '',
    '### ⚠ Unsigned',
    '',
    'No trusted CloudLocal signing was performed.',
    ...signing,
    'Checksums provide integrity, not publisher identity.',
    '',
    '## Files',
    '',
    ...files,
    '',
    '## Verification',
    '',
    'Compute SHA-256 of each file and compare against SHA256SUMS:',
    '',
    '  `' + hashCommand(executablePath()) + '`',
    '',
    'or use the provided verify script:',
    '',
    '  `node launcher/scripts/release-verify.cjs <candidate-directory>`',
    '',
    'Archive checksum:',
    '  File: <candidateName>.zip.sha256 (sibling of candidate directory)',
    '',
    '## Known Limitations',
    '',
    '- No trusted CloudLocal signing was performed; Authenticode/notarization was not verified.',
    '- Built on branch `' + (git.branch || 'unknown') + '` from commit `' + (git.commit || 'unknown') + '`.',
    git.dirty === true ? '- Working directory has uncommitted changes — content may differ from a clean build.' :
      git.dirty === false ? '- Clean working directory.' :
        '- Git status unknown (provenance may be incomplete).',
  ].join('\n') + '\n';
}

// ── Usage / help ──────────────────────────────────────────────────────────

function printHelp() {
  console.log('Usage: node launcher/scripts/release.cjs [OPTIONS] [version-tag]');
  console.log('');
  console.log('Create a local release candidate for the host platform (' + (PLATFORM ? PLATFORM.id : 'unsupported') + ').');
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
  const payload = payloadDisplayPaths();
  for (const entry of payload) console.log('  ' + entry);
  console.log('  ' + layout.COMMON_FILES.join(', '));
  console.log('');
  console.log('Platform layouts:');
  console.log('  windows-x64  CloudLocal.exe (icon injected by build.cjs)');
  console.log('  linux-x64    ' + [layout.LINUX_BINARY, layout.LINUX_DESKTOP_ENTRY, layout.LINUX_ICON, layout.LINUX_INSTALLER].join(', '));
  console.log('  darwin-arm64 ' + layout.APP_BUNDLE + ' (' + [layout.APP_INFO_PLIST, layout.APP_EXECUTABLE, layout.APP_ICON].join(', ') + ')');
  console.log('');
  console.log('Verification:');
  console.log('  node launcher/scripts/release-verify.cjs <candidate-directory>');
}

// ── Main ──────────────────────────────────────────────────────────────────

function main() {
  if (!PLATFORM) {
    console.error('Error: unsupported platform for release candidate: ' + process.platform);
    process.exitCode = 1;
    return;
  }
  // Only these architectures are published; a mislabeled asset is worse than a
  // clear refusal, because the archive name is what users download.
  if (PLATFORM.arch !== process.arch) {
    console.error('Error: ' + PLATFORM.id + ' targets ' + PLATFORM.arch + ', but this host is ' +
      process.platform + '-' + process.arch + '.');
    console.error('Published targets are windows-x64, linux-x64 and darwin-arm64.');
    process.exitCode = 1;
    return;
  }
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
  const exePath = path.join(DIST_DIR, PLATFORM.binary);
  if (!fs.existsSync(exePath)) {
    console.error('Error: ' + PLATFORM.binary + ' not found at ' + exePath);
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
  const candidateName = versionTag + '-' + PLATFORM.id;
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
    // Platform payload: loose executable, Linux extras, or a macOS .app bundle.
    layout.writePayload({
      layout: PLATFORM,
      candidateRoot,
      binarySource: exePath,
      resourcesDir: RESOURCES_DIR,
      version,
    });
    const exeHashActual = sha256file(path.join(candidateRoot, executablePath()));
    if (exeHashActual !== exeHash) {
      console.error('Error: Executable hash mismatch after copy');
      process.exitCode = 1;
      return;
    }

    fs.copyFileSync(requiredSourceFiles.LICENSE, path.join(candidateRoot, 'LICENSE'));
    fs.copyFileSync(requiredSourceFiles.NODE_LICENSE, path.join(candidateRoot, 'NODE-LICENSE.txt'));
    if (process.platform !== 'win32') {
      for (const name of ['LICENSE', 'NODE-LICENSE.txt']) fs.chmodSync(path.join(candidateRoot, name), 0o644);
    }

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
    writeDocument(path.join(candidateRoot, 'THIRD-PARTY-NOTICES.txt'), thirdPartyContent);

    // Bundle user instructions without links to files outside this archive.
    writeDocument(path.join(candidateRoot, 'README.md'), archiveReadme(version));
    writeDocument(path.join(candidateRoot, 'RELEASE-NOTES.md'), releaseNotes(versionTag, version, git));

    const candidate = {
      name: 'CloudLocal',
      version: versionTag,
      productVersion: version,
      platform: process.platform,
      arch: process.arch,
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
        executable: executablePath(),
        appBundle: PLATFORM.kind === 'macos' ? layout.APP_BUNDLE : null,
        desktopEntry: PLATFORM.kind === 'linux' ? layout.LINUX_DESKTOP_ENTRY : null,
        icon: PLATFORM.kind === 'macos' ? layout.APP_ICON
          : PLATFORM.kind === 'linux' ? layout.LINUX_ICON : null,
        installer: PLATFORM.kind === 'linux' ? layout.LINUX_INSTALLER : null,
        license: 'LICENSE',
        nodeLicense: 'NODE-LICENSE.txt',
        thirdPartyNotices: 'THIRD-PARTY-NOTICES.txt',
        readme: 'README.md',
        notes: 'RELEASE-NOTES.md',
        provenance: 'candidate.json',
        checksums: 'SHA256SUMS',
      },
      // Exactly the files SHA256SUMS covers, in payload order.
      payload: layout.payloadPaths(PLATFORM).filter(file => file !== 'SHA256SUMS'),
      builtAt: new Date().toISOString(),
      buildTool: 'esbuild + postject',
      runtime: 'node22',
    };
    fs.writeFileSync(path.join(candidateRoot, 'candidate.json'), JSON.stringify(candidate, null, 2) + '\n');

    const sumLines = [];
    for (const file of candidate.payload) {
      const fpath = path.join(candidateRoot, file);
      if (!fs.existsSync(fpath)) throw new Error('Payload file missing after assembly: ' + file);
      sumLines.push(sha256file(fpath) + '  ' + file);
    }
    fs.writeFileSync(path.join(candidateRoot, 'SHA256SUMS'), sumLines.join('\n') + '\n');

    const zipPath = path.join(releaseDir, candidateName + '.zip');
    createArchive(candidateRoot, zipPath);

    const zipHash = sha256file(zipPath);
    fs.writeFileSync(zipPath + '.sha256', zipHash + '  ' + candidateName + '.zip\n');

    console.log('Candidate created: ' + candidateRoot);
    console.log('  Payload: ' + payloadDisplayPaths().join(', '));
    console.log('  Executable: ' + executablePath() + ' (' + exeHashActual + ')');
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