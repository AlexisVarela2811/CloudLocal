# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Entradas derivadas de `git log` y de los tags `v0.0.1`–`v0.1.3`; entre paréntesis, el commit que
introduce cada cambio. Los artefactos publicados están en
[GitHub Releases](https://github.com/AlexisVarela2811/CloudLocal/releases).

## [0.1.4] — sin publicar

### Changed

- **Instalación desde Releases**: el README deja de apuntar a `launcher/dist/CloudLocal.exe`
  (ignorado por git) y describe la descarga por plataforma, con una sección "Si ves una advertencia"
  (SmartScreen, Gatekeeper/`xattr`, SHA-256, compilar desde el código) y las notas de uso: solo red
  local, servidor encendido, apagado con **Apagar** y acceso de otros equipos con la IP de
  Configuración.
- **Una sola versión de producto**: `package.json` de root, `launcher`, `server` y `client` pasan a
  0.1.4 (el client estaba en `0.0.0`). `scripts/version.cjs` acepta `set X.Y.Z` y sincroniza los
  cuatro manifiestos sin reformatearlos.

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

[0.1.4]: sin publicar (rama `release/0.1.4`)
[0.1.3]: https://github.com/AlexisVarela2811/CloudLocal/releases/tag/v0.1.3
[0.1.2]: https://github.com/AlexisVarela2811/CloudLocal/releases/tag/v0.1.2
[0.1.1]: https://github.com/AlexisVarela2811/CloudLocal/releases/tag/v0.1.1
[0.1.0]: https://github.com/AlexisVarela2811/CloudLocal/releases/tag/v0.1.0
[0.0.1]: (not yet published; local build only)