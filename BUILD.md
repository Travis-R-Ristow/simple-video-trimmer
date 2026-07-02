# Building the Installer (.exe)

This guide explains how to package **Fast Video Trimmer** into a Windows installer (`.exe`) that you can share with others. The build uses [electron-builder](https://www.electron.build/).

## Prerequisites

- **Node.js** (LTS recommended) and **npm** installed.
- Windows machine (to produce a Windows installer).
- Run all commands from the project root: `d:\Coding\videoEditor`.

## 1. Install dependencies

Only needed once (or after `package.json` changes):

```powershell
npm install
```

This installs Electron, electron-builder, and the bundled `ffmpeg-static` / `ffprobe-static` binaries.

## 2. Build the installer

```powershell
npm run dist
```

This runs `electron-builder`, which:

- Packages the app into an [NSIS](https://nsis.sourceforge.io/) Windows installer.
- Unpacks the FFmpeg / FFprobe binaries so they work at runtime (configured via `asarUnpack` in `package.json`).
- Outputs everything to the `dist/` folder.

## 3. Find the output

After the build finishes, look in the `dist/` folder:

```
dist/
  Fast Video Trimmer Setup 1.0.0.exe   <- share this file
  win-unpacked/                        <- portable, unpacked build
```

The **`Fast Video Trimmer Setup 1.0.0.exe`** file is the installer to share. When a user runs it, the app is installed and added to the Start menu.

> The version number in the filename comes from the `version` field in `package.json`.

## Build configuration reference

The build is configured in [package.json](package.json) under the `"build"` key:

| Field         | Purpose                                                                             |
| ------------- | ----------------------------------------------------------------------------------- |
| `appId`       | Unique application identifier (`com.example.videotrimmer`).                         |
| `productName` | Display name of the app (`Fast Video Trimmer`).                                     |
| `win.target`  | Installer type — `nsis` (standard Windows installer).                               |
| `asarUnpack`  | Keeps the FFmpeg/FFprobe binaries outside the asar archive so they can be executed. |
| `files`       | Which files to include; excludes the `dist/` output.                                |

## Common tasks

### Change the version number

Edit `version` in `package.json`, then rebuild. The new version appears in the installer filename.

### Change the app name

Edit `productName` in the `build` section of `package.json`.

### Add an app icon

electron-builder uses `build/icon.ico` (256×256 recommended) by default. Add that file, or set an explicit path:

```json
"win": {
  "target": "nsis",
  "icon": "FastTrim.png"
}
```

For best results, provide a real `.ico` file rather than a PNG.

### Produce a portable build (no installer)

Change the Windows target in `package.json`:

```json
"win": {
  "target": "portable"
}
```

Then run `npm run dist` again to get a single portable `.exe`.

## Troubleshooting

- **FFmpeg not found in the built app** — confirm the `asarUnpack` entries for `ffmpeg-static` and `ffprobe-static` are present in `package.json`. The app remaps `app.asar` paths to `app.asar.unpacked` at runtime.
- **Build fails downloading Electron** — check your internet connection/proxy; electron-builder downloads Electron and NSIS on first run.
- **Antivirus / SmartScreen warning** — unsigned installers may trigger Windows SmartScreen. To remove the warning, sign the installer with a code-signing certificate.
