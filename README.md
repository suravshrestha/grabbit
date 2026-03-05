# Grabbit

Grabbit is a local-first YouTube downloader with two parts:
- Chrome extension (`apps/extension`) as the user-facing UX.
- Tauri desktop app (`apps/desktop`) as the native download engine.

The extension sends download requests to a localhost API, and the desktop app runs `yt-dlp` + `ffmpeg` on the user's machine.

## Architecture

```text
Chrome Extension Popup (WXT + React)
        |
        | POST http://localhost:47891/api/download
        v
Tauri Desktop App (Rust + React)
        |
        | spawn yt-dlp + ffmpeg
        v
~/Downloads/<filename>
```

## Prerequisites

- Node.js 22+
- pnpm 9+
- Rust stable toolchain
- Platform build tools:
  - macOS: Xcode Command Line Tools
  - Windows: MSVC Build Tools
  - Linux: GCC/Clang + common build deps

## Quick Start

```bash
pnpm install
pnpm fetch-binaries
pnpm dev:desktop
pnpm dev:extension
```

Load unpacked extension from `apps/extension/.output/chrome-mv3` in `chrome://extensions`.

## Build

```bash
pnpm build:extension
pnpm build:desktop
```

## Conventional Commit Examples

- `feat(extension): add subtitle language picker to popup`
- `fix(desktop): handle yt-dlp binary not found on first launch`
- `chore(deps): update yt-dlp to 2025.03.01`
- `ci: add tauri build matrix for windows/mac/linux`

## IPC Flow

1. Popup reads active YouTube tab and extracts `videoId`.
2. Popup calls desktop API:
   - `GET /api/info?videoId=...`
   - `POST /api/download`
3. Desktop app enqueues job and starts `yt-dlp`.
4. Popup polls `GET /api/status/:jobId` every 1.5s.
5. Rust backend emits Tauri events:
   - `download://progress`
   - `download://complete`
   - `download://error`
