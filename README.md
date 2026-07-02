# Fast Video Trimmer

A simple, fast desktop app for trimming and cutting video files. Built with Electron and bundled FFmpeg — no external installs required.

![FastTrim logo](FastTrim.png)

## Features

- **Wide format support** — open `mp4`, `dvr`, `mov`, `mkv`, `avi`, `wmv`, `m4v`, `ts`, `mpg`, `mpeg`, `flv`, and `webm` files.
- **Drag & drop or click** to load a video.
- **Visual timeline** with draggable start/end handles and a live playhead.
- **Multi-segment editing** — define several segments and merge them into a single output in time order.
- **Two cut modes:**
  - **Fast (lossless)** — stream-copies without re-encoding. Instant, but cuts snap to the nearest keyframe.
  - **Precise (re-encode)** — frame-accurate cutting using `libx264` (slower).
- **Preview result** — play back your segments in order before exporting.
- **Export as GIF** — turn selected segments into a high-quality GIF with palette generation for clean colors.
- **Live progress bar** during export.
- **Reveal in folder** after export completes.
- **Multiple windows** — work on several videos at once (`Ctrl+N`).
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

## License

MIT
