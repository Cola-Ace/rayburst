<div align="center">
  <img src="docs/brand/banner.png" alt="Rayburst — Redefining the open-source download manager" width="800" />

[![GitHub release](https://img.shields.io/github/v/release/Cola-Ace/rayburst.svg)](https://github.com/Cola-Ace/rayburst/releases)
![Build](https://img.shields.io/github/actions/workflow/status/Cola-Ace/rayburst/ci.yml?branch=main&label=Build)
![Total Downloads](https://img.shields.io/github/downloads/Cola-Ace/rayburst/total.svg)
<br>
![Platform](https://img.shields.io/badge/releases-Windows%20x64-blue.svg)

</div>

## About this fork

This fork of [AnInsomniacy/rayburst](https://github.com/AnInsomniacy/rayburst) focuses on direct and streaming-media downloads. Application versions follow the upstream version; the current base is **v4.1.2**. Fork changes are recorded in this README, Git history and release notes.

## Changes from upstream

- **Direct downloads** — Keep HTTP, HTTPS, FTP and SFTP, plus native HLS/DASH media downloads. Remove BitTorrent, magnet, eD2k, torrent-file handling, peer/tracker management and their settings.
- **Link handling** — Remove Thunder links and the desktop's browser-download capture controls. Keep the Extension API for explicit submissions and task controls, including its statistics response contract.
- **System integration** — Remove automatic URL-scheme, Default Apps and Native Messaging host registration. Start Rayburst manually before connecting the browser extension.
- **Manual updates** — Remove update checks, update channels, downloads and installation from the app. Install new versions from this fork's Releases page.
- **Windows x64 releases** — Publish only the NSIS `Rayburst_<version>_x64-setup.exe` installer, with the bundled Aria2 Next engine. Release builds do not generate updater manifests or signatures.

<div align="center">
  <table><tr>
    <td><img src="docs/media/screenshot-light.png" alt="Upstream Light Mode" width="400" /></td>
    <td><img src="docs/media/screenshot-dark.png" alt="Upstream Dark Mode" width="400" /></td>
  </tr><tr>
    <td align="center"><sub>Upstream light-mode screenshot</sub></td>
    <td align="center"><sub>Upstream dark-mode screenshot</sub></td>
  </tr></table>
</div>

## Features

- **Download engine** — [Aria2 Next](https://github.com/AnInsomniacy/aria2-next), bundled as a sidecar.
- **HLS and DASH** — Track selection, subtitles, live recording, resumable downloads and MP4/MKV output. See [media downloads](docs/MEDIA.md).
- **Download organization** — Favorite and recent folders, file-type categories, stale-record cleanup and SQLite-backed history.
- **Speed control** — Global and per-task limits, concurrent task and connection limits, and scheduled speed limits.
- **Desktop integration** — Tray operation, lightweight mode, notifications, keep-awake and optional shutdown after completion.
- **Personalization** — Light/dark/system themes, dynamic Material Design 3 colors and 27 languages.
- **Native desktop app** — Vue 3, TypeScript, Tauri 2 and Rust.

## Installation

Download `Rayburst_4.1.2_x64-setup.exe` from [GitHub Releases](https://github.com/Cola-Ace/rayburst/releases/latest) and run the installer on Windows x64.

The installer includes the download engine. Updates are installed manually from the same Releases page. Fork installers are unsigned and may trigger Windows SmartScreen warnings.

## Development

### Prerequisites

- [Rust](https://rustup.rs/) (latest stable)
- [Node.js](https://nodejs.org/) >= 22
- [pnpm](https://pnpm.io/), using the version pinned in `package.json`
- [Tauri Windows prerequisites](https://v2.tauri.app/start/prerequisites/#windows), including Microsoft C++ Build Tools and WebView2

### Setup

```powershell
git clone https://github.com/Cola-Ace/rayburst.git
cd rayburst
pnpm install --frozen-lockfile

# Launch Tauri and Vite
pnpm tauri dev

# Build the Windows x64 installer
pnpm tauri build --target x86_64-pc-windows-msvc --bundles nsis -- --locked
```

### Verification

```powershell
pnpm lint
pnpm format:check
pnpm check:repo
pnpm test
pnpm build
pnpm build:native-launcher
cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --workspace --all-targets --locked -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml --workspace --all-targets --locked
```

See [release configuration](docs/RELEASING.md) for versioning and packaging, [download architecture](docs/DOWNLOADS.md) for task ownership, and [the upstream repository](https://github.com/AnInsomniacy/rayburst) for the original project.

## License

[MIT](LICENSE) — Copyright (c) 2025-present AnInsomniacy. See Git history for fork contributions.
