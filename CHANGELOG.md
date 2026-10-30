# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Entradas derivadas de `git log` y de los tags `v0.0.1`–`v0.1.3`; entre paréntesis, el commit que
introduce cada cambio. Los artefactos publicados están en
[GitHub Releases](https://github.com/AlexisVarela2811/CloudLocal/releases).

## [0.1.4] — 2026-10-30

### Added

- **macOS: `CloudLocal.app`** en el asset `darwin-arm64`. El binario SEA vive en
  `Contents/MacOS/cloudlocal`, con `Contents/Info.plist` (ejecutable, identificador, versión del
  producto) y `Contents/Resources/CloudLocal.icns`. Se mantienen la firma ad-hoc y los
  [entitlements JIT](launcher/resources/darwin-entitlements.plist) de `build.cjs`; no hay
  notarización.
- **Linux: `.desktop` + PNG + `install.sh`** en el asset `linux-x64`: `CloudLocal.desktop`
  (`Exec=cloudlocal`, `Icon=cloudlocal`), `cloudlocal.png` 256×256 e `install.sh`, un instalador por
  usuario en `~/.local` que no requiere privilegios de administrador y admite `--uninstall`.
- `launcher/scripts/release-layout.cjs`: tabla única de plataformas y payload que leen
  `build.cjs`, `release.cjs`, `release-verify.cjs` y `smoke.cjs`, para que ningún nombre de archivo
  o de asset diverja entre construcción, checksums, verificación y publicación.
- `launcher/scripts/make-icons.cjs`: regenera `CloudLocal.icns` y `cloudlocal.png` desde
  `client/public/cloudlocal.svg`; los resultados se versionan en `launcher/resources/`.

### Changed

- Windows queda igual: `CloudLocal.exe` con el icono `.ico` inyectado y el mismo payload.
- `build.cjs` y `release.cjs` rechazan construir un asset cuya arquitectura no coincida con la
  plataforma publicada (`windows-x64`, `linux-x64`, `darwin-arm64`), en lugar de etiquetarlo mal.
- `release-verify.cjs` valida el payload de cada plataforma: allowlist recursiva (incluye el árbol
  de `CloudLocal.app`), cobertura exacta de `SHA256SUMS`, estructura de `Info.plist` y `.icns`,
  entrada `.desktop`, PNG nativo e `install.sh`, modos 0755/0644 y, con `--archive`, que el ZIP
  contenga exactamente el payload y conserve esos modos.
- `smoke.cjs` ejecuta el ejecutable del candidato (en macOS el binario dentro de `.app`) y comprueba
  el layout empaquetado antes de arrancar. `ci.yml` y `release.yml` le pasan el candidato y el ZIP.

- **Instalación desde Releases**: el README deja de apuntar a `launcher/dist/CloudLocal.exe`
  (ignorado por git) y describe la descarga por plataforma, con una sección "Si ves una advertencia"
  (SmartScreen, Gatekeeper/`xattr`, SHA-256, compilar desde el código) y las notas de uso: solo red
  local, servidor encendido, apagado con **Apagar** y acceso de otros equipos con la IP de
  Configuración.
- **Una sola versión de producto**: `package.json` de root, `launcher`, `server` y `client` pasan a
  0.1.4 (el client estaba en `0.0.0`). `scripts/version.cjs` acepta `set X.Y.Z` y sincroniza los
  cuatro manifiestos sin reformatearlos.
- **Documentación alineada con el código**: el README y `docs/api.md` dejan de documentar la sección
  de Dispositivos y `DELETE /api/trash` (no existen en `server/src`), documentan `GET /api/events`
  con sus siete eventos reales (`upload`, `folder`, `paste`, `move`, `copy`, `trash`, `restore`),
  `GET /api/files/preview/*` y `POST /api/files/paste`, describen las rutas legacy y dejan de marcar
  como "solo API" lo que ya está en la interfaz. El diagrama pasa a `WINDOWS · MACOS · LINUX` con
  los puertos reales (80, respaldo 5000) y `~/.cloudlocal/files`. `npm run check:docs` verifica
  enlaces, anclas y que cada endpoint documentado exista en el servidor.

### Security

- `npm audit fix` (sin `--force`) resuelve los dos avisos de severidad high: **multer** 2.4.0 →
  2.5.0 (GHSA-q7qp-rjg7-q26m) y **body-parser** 1.20.8 → 1.20.9 (GHSA-27r3-jxmh-p828). Ambas son
  actualizaciones de parche dentro del rango declarado: ningún `package.json` cambió y no hizo falta
  un salto major. El árbol de dependencias del servidor queda hoisteado en la raíz, sin cambios de
  versión en el resto de paquetes.

## [0.1.3] — 2026-10-29

### Fixed

- La UI muestra la dirección de acceso desde la red y mantiene la barra lateral visible (`c07d16c`).
- El aviso de acceso a la red del launcher deja de ser ambiguo (`dcf3179`).

## [0.1.2] — 2026-10-29

### Fixed

- La configuración inicial se abre en `localhost`, el único origen donde el servidor la permite (`0a7c5b8`).

## [0.1.1] — 2026-10-29

### Added

- Ejecutable nativo por plataforma: cada sistema construye su artefacto con el Node que lo ejecuta (`9951390`, `2a77727`).
- Candidatos de release por plataforma con verificación y smoke en CI (`18c52bd`, `4916f57`, `1b7d23b`).
- Publicación de los assets por tag en la GitHub Release (`65ace5c`, `82745b0`).
- Validación multiplataforma en CI para Linux, macOS y Windows (`d3b0fd8`, `ec10cd2`, `c41765c`).

### Fixed

- macOS: firma ad-hoc con entitlements JIT y blob SEA dentro del segmento Mach-O `NODE_SEA` (`b8071a0`, `7e7821b`).
- El servidor cierra las conexiones de UI pendientes al apagarse por HTTP (`0bec94e`).
- El smoke de CI limpia su fixture en Windows (`8577dc8`).

### Changed

- vite 6.4.5 y esbuild 0.25.12 (`5b5dc4b`); tests parametrizados por plataforma (`b323757`, `cb24dc9`, `dd1564e`).

## [0.1.0] — 2026-10-27

### Added

- Shell "Hybrid Studio": rail lateral, topbar, barra de selección e inspector (`a7b03e0`).
- Refresco en vivo del listado por SSE (`ee4bb87`).
- Iconos y miniaturas por extensión en lista y cuadrícula (`48eec4b`).
- Papelera de carpetas con su contenido (`32e334d`) y borrado permanente/vaciar desde la UI (`7bb6dc3`).
- Diálogo de destino real para mover archivos y carpetas (`ab0e2c2`, `f2f6310`).
- Configuración reconstruida con secciones (`7eccc92`), filtros tipados, vistas recientes y actividad del inspector (`f5e16a1`).
- Resumen de multi-selección en el inspector (`c9c2797`), avatar local decorativo (`9495e6e`) y franja de añadidos recientemente (`78cca48`).
- Inter servida desde el propio cliente (`5d5ea3a`).

### Fixed

- Topbar móvil y franja reciente (`e64fcb6`), rail por encima del topbar para no recortar tooltips (`b5662e5`).
- Botón de retroceso compacto en el topbar (`754dcf4`) y sin reservar la columna del inspector vacía (`3ce7732`).
- Fotos verticales sin cubrir el cuerpo de la tarjeta (`a433cd5`) y toggle de tema sincronizado con el rail (`395069b`).
- Vista de configuración a todo el ancho (`1c32611`), alineación de tabla y tema claro cálido (`6d33122`), hallazgos de lint (`8151f22`, `c92f29e`).

### Removed

- Hooks obsoletos del device hub al apagar (`16719fc`) y referencias a "companion" en la documentación (`289429f`).

### Documentation

- Sistema de diseño (`6c4ae05`), diagrama de arquitectura actualizado (`4f01e1a`) y notas de la versión (`4d16d04`).

## [0.0.1] — Initial local candidate

### Added

#### Core Features
- **Private local file server** with web interface
- **Single executable** (CloudLocal.exe) — built with Node.js SEA (Single-Executable Application)
- **LAN access** — accessible from any device on the same network (port configurable)
- **Password authentication** with scrypt hashing (64-byte salt + 64-byte hash)
- **HttpOnly session cookie** (`cloudlocal_session`, 12 h, SameSite=Strict)
- **File upload** with drag & drop (external) and upload queue
- **Internal file management** — rename (F2), copy, cut, paste, move files and folders
- **Trash system** — move files to trash, restore (UI button), permanent delete and empty (API only)
- **ZIP download** — available via API (`/api/files/zip`)
- **Image/video/audio preview** in modal viewer
- **Folder creation** with Ctrl+Alt+N or toolbar button
- **Search** files in current folder
- **Grid and list view** toggle
- **Dark mode** with cross-tab sync via localStorage
- **Graceful shutdown** endpoint (`POST /api/shutdown`)

#### User Interface
- **Compact rows** with hover and selection states
- **Selection bar** at bottom with actions for selected items
- **Breadcrumb navigation** with back button for folder traversal
- **Keyboard shortcuts**: Ctrl+A, Ctrl+C, Ctrl+X, Ctrl+V, Ctrl+Alt+N, F2, Delete, Escape, Tab
- **Keyboard focus indicators**: visible `:focus-visible` on all interactive elements
- **Custom dark mode toggle**: large 64px button with track and thumb
- **Consistent styling**: Windows Explorer-like feel
- **Responsive design** for desktop, tablet and mobile
- **Startup helpers**: toast notifications and auto-browser open (launcher)

#### Architecture
- **Server**: Node.js + Express REST API
- **Client**: React + TypeScript + Vite + TailwindCSS
- **Launcher**: Node.js SEA bundler — produces `CloudLocal.exe` (subsystem=2, no console)
- **Authentication**: scrypt password hashing, in-memory session map, 5-attempt lockout

### Changed
- Default server port is 5000 (standalone) or 80 (launcher)
- Launcher automatically sets `CLOUDLOCAL_PORT=80`
- Server uses `HOST` env var (not `CLOUDLOCAL_HOST`)
- Default upload limit is 512 MiB (not 5 GiB)
- Password length: 12–256 characters

### Fixed
- Authenticated server shutdown closes the actual HTTP listener and exits only its owning process
- New-folder shortcut is **Ctrl+Alt+N**; `Ctrl+N` is no longer intercepted

### Known limitations (local candidate)
- **No `empty-trash` button in UI**: the trash endpoint is available via API only
- **No `permanent-delete` individual button in UI**: only trash → API for permanent deletion
- **No ZIP button in UI**: ZIP download available via `/api/files/zip` endpoint only
- **`Ctrl+S` does not navigate back**: the key handler calls `preventDefault()` but performs no action
- **Move/rename operations at root**: the rename UI builds a target path but the server's move API expects a destination folder; controller rejects moves to empty-string target for `move`, `moveFolder`, and `copy`

---

[0.1.4]: https://github.com/AlexisVarela2811/CloudLocal/releases/tag/v0.1.4
[0.1.3]: https://github.com/AlexisVarela2811/CloudLocal/releases/tag/v0.1.3
[0.1.2]: https://github.com/AlexisVarela2811/CloudLocal/releases/tag/v0.1.2
[0.1.1]: https://github.com/AlexisVarela2811/CloudLocal/releases/tag/v0.1.1
[0.1.0]: https://github.com/AlexisVarela2811/CloudLocal/releases/tag/v0.1.0
[0.0.1]: (not yet published; local build only)