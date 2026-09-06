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
  FastVideoTrimmer-Setup-1.0.0.exe   <- share this file
  win-unpacked/                      <- portable, unpacked build
```

The **`FastVideoTrimmer-Setup-1.0.0.exe`** file is the installer to share. When a user runs it, the app is installed and added to the Start menu.

> The installer filename is controlled by `artifactName` in `package.json` (`FastVideoTrimmer-Setup-${version}.${ext}`).

> The version number in the filename comes from the `version` field in `package.json`.

## Releases & auto-update

The app ships with an in-app updater (`electron-updater`) that reads GitHub
Releases. Alongside the installer, `electron-builder` publishes a `latest.yml`
and a `.blockmap`; the running app compares its version against `latest.yml` to
detect updates.

### Cut a release (recommended)

Run the release helper with an optional bump type. It bumps the version, creates
the git tag, and pushes it — which triggers the GitHub Actions workflow that
builds and publishes the installer:

```powershell
./release.ps1            # patch bump (1.0.0 -> 1.0.1)
./release.ps1 minor      # feature release (1.0.0 -> 1.1.0)
./release.ps1 major      # breaking release (1.0.0 -> 2.0.0)
```

Under the hood this is just `npm version <bump>` + `git push --follow-tags`.
The workflow ([.github/workflows/release.yml](.github/workflows/release.yml))
runs `npm ci` and `npm run publish` on a Windows runner using the built-in
`GITHUB_TOKEN`, attaches the installer, `latest.yml` and `.blockmap` to the
matching GitHub Release, and then promotes that release from draft to published
(via `gh release edit --draft=false --latest`) so it's downloadable and the
updater can see it. No secrets to configure, and nothing to click.

### Publish manually (fallback)

To build and upload from your own machine instead of via CI, bump the version,
set a GitHub token, and run the publish script directly:

```powershell
npm version patch                 # or edit "version" in package.json
$env:GH_TOKEN = "ghp_yourtoken"   # a token with repo access
npm run publish
```

> `npm run publish` on its own leaves the GitHub Release as a **draft** — open
> the Releases page and click **Publish release** afterward. (The CI workflow
> does this automatically.)

> Keep tokens out of source control — never commit them (`.gh-token` and `.env` are gitignored).

### How users get it

- **First install:** download the `.exe` from the
  [Releases page](https://github.com/Travis-R-Ristow/simple-video-trimmer/releases/latest).
- **Updates:** the app checks on launch and via the **Check for updates** button;
  users download the update and click **Restart & install**.

> Auto-update only runs in a packaged/installed build. In `npm start` the updater
> reports "Updates run in the installed app" and takes no action.

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
