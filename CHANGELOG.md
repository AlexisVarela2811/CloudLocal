# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
- **Cross-device sharing** via companion service and pairing codes (LAN only)
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
- **Legacy companion source**: not bundled with the exe and not required for browser access

---

[0.0.1]: (not yet published; local build only)