# Fast Video Trimmer

A simple, fast desktop app for trimming and cutting video files. Built with Electron and bundled FFmpeg — no external installs required.

![FastTrim logo](FastTrim.png)

## Download

Grab the latest Windows installer from the
**[Releases page](https://github.com/Travis-R-Ristow/simple-video-trimmer/releases/latest)** —
download `FastVideoTrimmer-Setup-<version>.exe`, run it, and you're done. The app
checks for new versions on its own and can update itself from within (see below).

## Features

- **Wide format support** — open `mp4`, `dvr`, `mov`, `mkv`, `avi`, `wmv`, `m4v`, `ts`, `mpg`, `mpeg`, `flv`, and `webm` files.
- **Drag & drop or click** to load a video.
- **Merge multiple clips** — load several files into a playlist; each keeps its own trims, and they're combined top-to-bottom into one MP4 or GIF. Reorder or remove clips, and mismatched sizes/frame rates are auto-normalized to the first clip.
- **Visual timeline** with draggable start/end handles and a live playhead.
- **Multi-segment editing** — define several segments and merge them into a single output in time order. Drag a whole segment block to reposition it, or drag its handles to resize.
- **Two cut modes:**
  - **Fast (lossless)** — stream-copies without re-encoding. Instant, but cuts snap to the nearest keyframe.
  - **Precise (re-encode)** — frame-accurate cutting using `libx264` (slower).
- **Preview result** — play back your segments in order before exporting.
- **Export as GIF** — turn selected segments into a high-quality GIF with palette generation for clean colors.
- **Live progress bar** during export.
- **Reveal in folder** after export completes.
- **Multiple windows** — work on several videos at once (`Ctrl+N`).
- **Open from Explorer** — double-click a video or use "Open with" to launch straight into it.
- **Automatic updates** — check for and install new versions from within the app (via GitHub Releases).
- **Auto-fit window** to keep all controls visible.

## Keyboard Shortcuts

| Shortcut           | Action                            |
| ------------------ | --------------------------------- |
| `Space`            | Play / pause                      |
| `←` / `→`          | Step 1 frame                      |
| `Ctrl` + `←` / `→` | Step 10 frames                    |
| `S`                | Set segment start to current time |
| `E`                | Set segment end to current time   |
| `A`                | Add segment                       |
| `Del`              | Delete selected segment           |
| `P`                | Preview result                    |
| `Ctrl` + `S`       | Trim & save                       |
| `Ctrl` + `O`       | Open file                         |
| `Ctrl` + `N`       | New window                        |

## Usage

1. Launch the app and click the drop zone (or drag a video onto it).
2. Set the start and end of each segment using the timeline handles, the time fields, or the `S` / `E` shortcuts.
3. Add more segments with `A` if you want to keep several parts of the video.
4. Choose a cut mode — **Fast** for quick lossless cuts, **Precise** for frame-accurate results.
5. Click **Preview result** to check your cut, then **Trim & Save** (or **Save as GIF**).

## Running from source

```powershell
npm install
npm start
```

## Building an installer

See [BUILD.md](BUILD.md) for how to package the app into a shareable `.exe` installer.

## Updates

The app checks GitHub Releases for a newer version a few seconds after launch.
Use the **Check for updates** button in the top-right to check on demand; when an
update is found you can download it and click **Restart & install**.

### Publishing a new release

Cutting a release is one command — it bumps the version, tags it, and pushes the
tag, which triggers the GitHub Actions workflow that builds and publishes the
installer:

```powershell
./release.ps1            # patch bump (1.0.0 -> 1.0.1)
./release.ps1 minor      # feature release (1.0.0 -> 1.1.0)
./release.ps1 major      # breaking release (1.0.0 -> 2.0.0)
```

That's equivalent to `npm version <bump>` followed by `git push --follow-tags`.
See [BUILD.md](BUILD.md#releases--auto-update) for the full details and a manual
fallback.

## License

MIT
