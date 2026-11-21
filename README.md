# Yoinkstagram

[![Build Status](https://img.shields.io/badge/build-passing-brightgreen?style=flat-square)](#verify)
[![Platform](https://img.shields.io/badge/platform-Windows%2010%2B-blue?style=flat-square)](#downloads--installers)
[![Architecture](https://img.shields.io/badge/arch-x64%20%7C%20arm64-informational?style=flat-square)](#downloads--installers)
[![Electron](https://img.shields.io/badge/Electron-45.4-47848F?style=flat-square&logo=electron&logoColor=white)](https://www.electronjs.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react&logoColor=black)](https://react.dev/)
[![License](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](LICENSE)

A high-performance Windows desktop workspace for preserving Instagram media and metadata. Built with Electron, React, and an isolated Python archival engine.

---

## Highlights

- **Multi-Source Archiving**: Archive full user profiles, posts, reels, carousels, highlights, tagged media, and followed feeds.
- **Granular Target Filtering**: Filter by date boundaries, regex caption patterns, carousel slide indices, or custom collection limits.
- **Resumable Queue Engine**: Background job scheduler with automated rate-limit backoff, server cooldown tracking, and resumable JSON/XZ cursor checkpoints.
- **Zero-Cloud Local Vault**: Account credentials and session tokens are encrypted at rest using Windows DPAPI (`safeStorage`) and stored strictly on your local machine.
- **Modern Embedded Verification**: Streamlined popup login supporting two-factor authentication and automatic session synchronization.
- **Rich Metadata Extraction**: Captures sidecar comments, geotags, timestamps, and JSON-formatted post metrics alongside high-resolution media.

---

## System Architecture

```
┌────────────────────────────────────────────────────────┐
│                   Yoinkstagram UI                      │
│        React 19 • DM Sans • Custom Dark/Light UI       │
└───────────────────────────┬────────────────────────────┘
                            │ IPC Bridge (Preload Context)
┌───────────────────────────▼────────────────────────────┐
│              Electron Main Process (Node.js)           │
│   • Task Queue Orchestrator   • SafeStorage DPAPI      │
│   • Session Cookie Store      • Native Window Chrome   │
└───────────────────────────┬────────────────────────────┘
                            │ Subprocess IPC (JSON Streams)
┌───────────────────────────▼────────────────────────────┐
│              Archivist Python Core (Engine)            │
│   • Instaloader Subprocess    • Web API GraphQL Engine │
│   • Resumable File Streamer   • Rate Limiting Monitor  │
└────────────────────────────────────────────────────────┘
```

---

## Downloads & Installers

Pre-built binaries are generated for modern 64-bit and ARM64 Windows environments:

| Package | Architecture | Description |
| :--- | :--- | :--- |
| **Yoinkstagram Setup** (`.exe`) | `x64` | Full Windows NSIS installer with desktop shortcut and uninstaller |
| **Yoinkstagram Portable** (`.exe`) | `x64` | Standalone single-file executable requiring no installation |
| **Yoinkstagram Package** (`.zip`) | `x64` | Portable archive bundle ready to unpack and run |
| **Yoinkstagram ARM64** (`.zip`) | `arm64` | Native ARM64 package optimized for Snapdragon X Elite and Surface ARM |

> **Note**: Electron 45 dropped legacy 32-bit (`ia32`) support. For 32-bit systems, please build from source using an older Electron runtime.

---

## Quick Start (Building from Source)

### Prerequisites

- **Node.js**: v22.12 or newer
- **Python**: 64-bit Python 3.11, 3.12, or 3.13
- **Git**

### Installation

1. **Clone the repository**:
   ```powershell
   git clone https://github.com/mehenuf/yoinkstagram.git
   cd yoinkstagram
   ```

2. **Initialize Python virtual environment**:
   ```powershell
   python -m venv .venv
   .\.venv\Scripts\Activate.ps1
   pip install -r requirements.txt
   pip install "pyinstaller>=6.11,<7"
   ```

3. **Install Node dependencies**:
   ```powershell
   npm ci
   ```

4. **Launch development environment**:
   ```powershell
   npm run dev
   ```

---

## Packaging Binaries

To produce standalone executables and distributables locally:

```powershell
# Compile frontend and standalone Python engine
npm run build
npm run build:engine

# Package Windows x64 Setup installer
npm run package:setup

# Package Windows x64 Portable executable
npm run package:portable

# Package Windows ARM64 bundle
npm run package:arm64
```

Output binaries will be located in the `release/` folder.

---

## Verification & Testing

Yoinkstagram includes a comprehensive test suite across the Electron host, IPC bridges, and Python engine:

```powershell
# Run Electron & Frontend unit tests
npm test

# Run Python engine test suite
.\.venv\Scripts\python.exe -m unittest discover -s engine -t .
```

---

## Security & Storage Policy

- **Credential Safety**: Passwords are never stored on disk. When authenticating via the embedded browser, session cookies (`sessionid`, `ds_user_id`, `csrftoken`) are captured and secured using Windows Data Protection API (DPAPI).
- **Telemetry Free**: Yoinkstagram does not phone home, contain tracking analytics, or send user information to third-party endpoints.
- **Local Media**: All downloaded photos, videos, and metadata files remain exclusively in the local folder you designate.

---

## Legal & Compliance

This software is an independent open-source utility designed for personal archiving, backup, and research. Yoinkstagram is not affiliated with, endorsed by, or sponsored by Instagram, Meta, or any related entity.

Always respect creators' intellectual property rights and adhere to applicable platform terms of service when preserving content.
