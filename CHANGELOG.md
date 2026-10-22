# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2025-10-21

### Added

#### Core Features
- **Private local file server** with web interface
- **Single executable** (CloudLocal.exe) - no Node.js required on client machines
- **LAN access** - accessible from any device on the same network (http://192.168.1.6:80)
- **Password authentication** with bcrypt hashing
- **File upload** with drag & drop (external) and upload queue
- **Internal file management** - rename, copy, cut, paste, move
- **Trash system** - move files to trash, restore or permanently delete, empty trash
- **ZIP download** - compress multiple files into a single archive
- **Image/video/audio preview** in modal viewer
- **Folder creation** with Ctrl+N shortcut
- **Search** files in current folder
- **Grid and list view** toggle
- **Dark mode** with cross-tab sync via localStorage
- **Cross-device sharing** via companion service and pairing codes

#### User Interface
- **Compact rows** (40px) with hover and selection states
- **Selection bar** at bottom with actions for selected items
- **Breadcrumb navigation** with back button for folder traversal
- **Keyboard shortcuts**: Ctrl+A, Ctrl+C, Ctrl+X, Ctrl+V, Ctrl+N, Ctrl+S, F2, Delete, Escape, Tab
- **Keyboard focus indicators**: visible :focus-visible on all interactive elements
- **Custom dark mode toggle**: large 64px button with track and thumb
- **Consistent styling**: Windows Explorer-like feel, no heavy shadows or gradients
- **Responsive design** for desktop, tablet and mobile

#### Architecture
- **Server**: Node.js + Express REST API
- **Client**: React + TypeScript + Vite + TailwindCSS
- **Launcher**: Node.js SEA (Secure Node) single executable bundler
- **Companion service**: LAN device discovery and pairing (bonjour-service)

### Changed
- Removed Electron desktop layer (now server-only with web UI)
- Default port changed to 80 (was 5000)
- Dark mode syncs across all open tabs via localStorage storage event

### Fixed
- **Ctrl+N keyboard shortcut**: Now creates folder instead of opening browser new tab
- **Dark mode toggle**: Large visible button (64px width) with green active state
- **Dark mode login**: Hardcoded dark palette for access panel to guarantee contrast
- **Upload card alignment**: Fixed button positioning and card gaps
- **Back button**: Added proper folder navigation with breadcrumb trail
- **Focus indicators**: 3px solid accent outline on all interactive controls

### Removed
- Desktop Electron layer (`desktop/` folder)
- mDNS advertising (didn't work on Windows without extra software)
- Screenshots and Playwright test artifacts from git

## [Unreleased]

### Planned
- [ ] Add icon to CloudLocal.exe (Windows icon resource)
- [ ] Silent mode (no black console window on Windows)
- [ ] System tray icon (run in background)
- [ ] Windows Defender exception automation
- [ ] Auto-update mechanism
- [ ] HTTPS support via proxy configuration
- [ ] Multi-language support (i18n)
- [ ] File permissions and ACL management

---

[0.1.0]: https://github.com/AlexisVarela2025/CloudLocal/releases/tag/v0.1.0