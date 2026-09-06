const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const { autoUpdater } = require('electron-updater');

// Resolve bundled FFmpeg / FFprobe binaries. When packaged with electron-builder
// and asarUnpack, the binaries live in app.asar.unpacked, so fix the path.
function unpacked(p) {
  return p ? p.replace('app.asar', 'app.asar.unpacked') : p;
}

let ffmpegPath = unpacked(require('ffmpeg-static'));
let ffprobePath = unpacked(require('ffprobe-static').path);

// Media file extensions we accept when launched from the OS (double-click /
// "Open with"). Used to pick the real file out of the process arguments.
const MEDIA_EXTS = new Set([
  '.mp4',
  '.dvr',
  '.mov',
  '.mkv',
  '.avi',
  '.wmv',
  '.m4v',
  '.ts',
  '.mpg',
  '.mpeg',
  '.flv',
  '.webm'
]);

// Extract a media file path from a process argv array. Skips the executable,
// the "." dev argument, and any flags.
function fileFromArgv(argv) {
  const args = (argv || []).slice(1).filter((a) => a && !a.startsWith('-'));
  for (const a of args) {
    if (a === '.') continue;
    if (MEDIA_EXTS.has(path.extname(a).toLowerCase()) && fs.existsSync(a)) {
      return path.resolve(a);
    }
  }
  return null;
}

function createWindow(openFile) {
  const open = BrowserWindow.getAllWindows();
  const offset = open.length * 30;
  const win = new BrowserWindow({
    width: 1180,
    height: 900,
    minWidth: 900,
    minHeight: 700,
    title: 'Fast Video Trimmer',
    icon: path.join(__dirname, 'FastTrim.png'),
    backgroundColor: '#1e1e2e',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  if (offset) {
    const b = win.getBounds();
    win.setBounds({
      x: b.x + offset,
      y: b.y + offset,
      width: b.width,
      height: b.height
    });
  }

  win.setMenuBarVisibility(false);
  win.loadFile('index.html');

  // If launched with a media file (double-click / "Open with"), load it once
  // the renderer is ready to receive it.
  if (openFile) {
    win.webContents.once('did-finish-load', () => {
      if (!win.isDestroyed()) win.webContents.send('open-file', openFile);
    });
  }
  return win;
}

// macOS delivers the opened file via the 'open-file' event; stash it until ready.
let pendingOpenFile = null;
app.on('open-file', (event, filePath) => {
  event.preventDefault();
  if (app.isReady()) createWindow(filePath);
  else pendingOpenFile = filePath;
});

// Only allow one running instance. When the user opens another file while the
// app is running, Windows launches a second process — forward its file to us
// and open it in a new window instead of starting a duplicate app.
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    createWindow(fileFromArgv(argv) || undefined);
  });

  app.whenReady().then(() => {
    const initial = pendingOpenFile || fileFromArgv(process.argv);
    createWindow(initial || undefined);
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
    // Check GitHub for a newer release shortly after launch (packaged only).
    if (app.isPackaged) {
      setTimeout(() => autoUpdater.checkForUpdates().catch(() => {}), 3000);
    }
  });
}

// Open a second (or third…) app window (Ctrl+N).
ipcMain.handle('new-window', () => {
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// --- Auto-update (GitHub Releases) ---------------------------------------
// User-driven flow: check -> download -> restart & install. electron-builder
// publishes the installer, latest.yml and blockmap that power the comparison.
autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = true;

function sendUpdateStatus(state, data) {
  const payload = Object.assign({ state }, data || {});
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('updates:status', payload);
  }
}

autoUpdater.on('checking-for-update', () => sendUpdateStatus('checking'));
autoUpdater.on('update-available', (info) =>
  sendUpdateStatus('available', { version: info.version })
);
autoUpdater.on('update-not-available', () => sendUpdateStatus('up-to-date'));
autoUpdater.on('download-progress', (p) =>
  sendUpdateStatus('downloading', { percent: Math.round(p.percent) })
);
autoUpdater.on('update-downloaded', (info) =>
  sendUpdateStatus('downloaded', { version: info.version })
);
autoUpdater.on('error', (err) =>
  sendUpdateStatus('error', { message: (err && err.message) || String(err) })
);

ipcMain.handle('app:get-version', () => app.getVersion());

ipcMain.handle('updates:check', async () => {
  // Auto-update only runs in a packaged build; dev runs report back cleanly.
  if (!app.isPackaged) {
    sendUpdateStatus('dev');
    return { ok: false, dev: true };
  }
  try {
    await autoUpdater.checkForUpdates();
    return { ok: true };
  } catch (err) {
    sendUpdateStatus('error', { message: (err && err.message) || String(err) });
    return { ok: false, error: String(err) };
  }
});

ipcMain.handle('updates:download', async () => {
  if (!app.isPackaged) return { ok: false, dev: true };
  try {
    await autoUpdater.downloadUpdate();
    return { ok: true };
  } catch (err) {
    sendUpdateStatus('error', { message: (err && err.message) || String(err) });
    return { ok: false, error: String(err) };
  }
});

ipcMain.handle('updates:install', () => {
  if (!app.isPackaged) return;
  setImmediate(() => autoUpdater.quitAndInstall());
});

// --- IPC handlers ---------------------------------------------------------

ipcMain.handle('pick-input', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const result = await dialog.showOpenDialog(win, {
    title: 'Select video file(s)',
    properties: ['openFile', 'multiSelections'],
    filters: [
      {
        name: 'Video Files',
        extensions: [
          'mp4',
          'dvr',
          'mov',
          'mkv',
          'avi',
          'wmv',
          'm4v',
          'ts',
          'mpg',
          'mpeg',
          'flv',
          'webm'
        ]
      },
      { name: 'All Files', extensions: ['*'] }
    ]
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths;
});

ipcMain.handle('pick-output', async (event, defaultName) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const isGif = /\.gif$/i.test(defaultName || '');
  const result = await dialog.showSaveDialog(win, {
    title: isGif ? 'Save GIF as' : 'Save trimmed video as',
    defaultPath: defaultName,
    filters: isGif
      ? [{ name: 'GIF Image', extensions: ['gif'] }]
      : [{ name: 'MP4 Video', extensions: ['mp4'] }]
  });
  if (result.canceled || !result.filePath) return null;
  return result.filePath;
});

// Probe media info (duration, fps, audio presence) using ffprobe JSON output.
ipcMain.handle('probe', async (event, filePath) => {
  return new Promise((resolve) => {
    const args = [
      '-v',
      'error',
      '-print_format',
      'json',
      '-show_format',
      '-show_streams',
      filePath
    ];
    const proc = spawn(ffprobePath, args);
    let out = '';
    let err = '';
    proc.stdout.on('data', (d) => (out += d.toString()));
    proc.stderr.on('data', (d) => (err += d.toString()));
    proc.on('error', (e) => resolve({ error: e.message }));
    proc.on('close', (code) => {
      if (code !== 0)
        return resolve({ error: err || `ffprobe exited with code ${code}` });
      try {
        const data = JSON.parse(out);
        let duration = data.format && parseFloat(data.format.duration);
        if (!duration || isNaN(duration)) duration = null;

        let fps = null;
        let hasAudio = false;
        let width = 0;
        let height = 0;
        for (const s of data.streams || []) {
          if (s.codec_type === 'video') {
            if (!fps) {
              const rate = s.avg_frame_rate || s.r_frame_rate || '';
              const m = /^(\d+)\/(\d+)$/.exec(rate);
              if (m && +m[2] > 0 && +m[1] > 0) fps = +m[1] / +m[2];
            }
            if (!width && s.width) {
              width = s.width;
              height = s.height || 0;
            }
          }
          if (s.codec_type === 'audio') hasAudio = true;
        }
        resolve({ duration, fps, hasAudio, width, height });
      } catch (e) {
        resolve({ error: 'Failed to parse ffprobe output: ' + e.message });
      }
    });
  });
});

// Run an ffmpeg process, forwarding progress (seconds done) to the window.
function runFFmpeg(args, event, totalDuration, progressOffset) {
  return new Promise((resolve) => {
    const proc = spawn(ffmpegPath, args);
    let err = '';
    proc.stderr.on('data', (d) => {
      const text = d.toString();
      err += text;
      const m = text.match(/time=(\d+):(\d+):(\d+\.\d+)/);
      if (m && totalDuration > 0) {
        const secs = +m[1] * 3600 + +m[2] * 60 + parseFloat(m[3]);
        const done = (progressOffset || 0) + secs;
        const pct = Math.min(100, Math.round((done / totalDuration) * 100));
        const win = BrowserWindow.fromWebContents(event.sender);
        if (win && !win.isDestroyed())
          win.webContents.send('trim-progress', pct);
      }
    });
    proc.on('error', (e) => resolve({ success: false, error: e.message }));
    proc.on('close', (code) => {
      if (code === 0) resolve({ success: true });
      else
        resolve({
          success: false,
          error:
            err.split('\n').slice(-15).join('\n') ||
            `ffmpeg exited with code ${code}`
        });
    });
  });
}

// Precise: single-pass filter_complex trim + concat, re-encoded to H.264/AAC.
// Frame-accurate and container-safe (always valid in an .mp4 output).
async function exportReencode(
  input,
  output,
  segments,
  totalDuration,
  hasAudio,
  event
) {
  const parts = [];
  let concatIns = '';
  segments.forEach((s, i) => {
    parts.push(
      `[0:v]trim=start=${s.start}:end=${s.end},setpts=PTS-STARTPTS[v${i}]`
    );
    if (hasAudio) {
      parts.push(
        `[0:a]atrim=start=${s.start}:end=${s.end},asetpts=PTS-STARTPTS[a${i}]`
      );
      concatIns += `[v${i}][a${i}]`;
    } else {
      concatIns += `[v${i}]`;
    }
  });
  const n = segments.length;
  if (hasAudio) {
    parts.push(`${concatIns}concat=n=${n}:v=1:a=1[vout][aout]`);
  } else {
    parts.push(`${concatIns}concat=n=${n}:v=1:a=0[vout]`);
  }
  const filter = parts.join(';');
  const args = ['-y', '-i', input, '-filter_complex', filter, '-map', '[vout]'];
  if (hasAudio) args.push('-map', '[aout]', '-c:a', 'aac', '-b:a', '192k');
  args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', output);
  return runFFmpeg(args, event, totalDuration, 0);
}

// Fast: stream-copy without re-encoding. A single segment is copied straight
// into the output container; multiple segments are copied to temp files and
// concatenated. This can fail if the source codecs aren't valid in the .mp4
// container — the caller handles that by falling back to a re-encode.
async function exportCopy(input, output, segments, totalDuration, event) {
  // Single segment — copy directly into the output container so ffmpeg
  // validates codec/container compatibility (a raw file copy would not).
  if (segments.length === 1) {
    const s = segments[0];
    const args = [
      '-y',
      '-ss',
      String(s.start),
      '-i',
      input,
      '-t',
      String(s.end - s.start),
      '-c',
      'copy',
      '-avoid_negative_ts',
      'make_zero',
      output
    ];
    return runFFmpeg(args, event, totalDuration, 0);
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vtrim-'));
  try {
    const ext = path.extname(input) || '.mp4';
    const listPath = path.join(tmpDir, 'list.txt');
    const listLines = [];
    let offset = 0;

    for (let i = 0; i < segments.length; i++) {
      const s = segments[i];
      const dur = s.end - s.start;
      const part = path.join(tmpDir, `seg${i}${ext}`);
      const args = [
        '-y',
        '-ss',
        String(s.start),
        '-i',
        input,
        '-t',
        String(dur),
        '-c',
        'copy',
        '-avoid_negative_ts',
        'make_zero',
        part
      ];
      const res = await runFFmpeg(args, event, totalDuration, offset);
      if (!res.success) return res;
      offset += dur;
      listLines.push(
        `file '${part.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`
      );
    }

    fs.writeFileSync(listPath, listLines.join('\n'));
    const concatArgs = [
      '-y',
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      listPath,
      '-c',
      'copy',
      output
    ];
    return runFFmpeg(concatArgs, event, 0, 0);
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (_) {
      /* ignore cleanup errors */
    }
  }
}

// Normalise the clips payload: numeric, valid, time-sorted segments per clip.
function normaliseClips(raw) {
  return (raw || [])
    .map((c) => ({
      input: c.input,
      hasAudio: !!c.hasAudio,
      segments: (c.segments || [])
        .map((s) => ({ start: Number(s.start), end: Number(s.end) }))
        .filter((s) => isFinite(s.start) && isFinite(s.end) && s.end > s.start)
        .sort((a, b) => a.start - b.start)
    }))
    .filter((c) => c.input && c.segments.length > 0);
}

// Merge clips into one output, re-encoding and normalising every segment to a
// common size (scaled to fit + padded) and frame rate. asGif adds palette gen.
async function exportMerge(clips, output, target, totalDuration, event, asGif) {
  const W = Math.max(2, Math.round((target && target.width) || 1280));
  const H = Math.max(2, Math.round((target && target.height) || 720));
  const F = Math.min(
    Math.max(Math.round((target && target.fps) || 30), 1),
    asGif ? 50 : 60
  );
  const includeAudio = !asGif && clips.some((c) => c.hasAudio);

  const inputs = [];
  clips.forEach((c) => inputs.push('-i', c.input));

  const parts = [];
  const vlabels = [];
  const alabels = [];
  clips.forEach((c, ci) => {
    c.segments.forEach((s, si) => {
      const vlab = `v${ci}_${si}`;
      parts.push(
        `[${ci}:v]trim=start=${s.start}:end=${s.end},setpts=PTS-STARTPTS,` +
          `scale=${W}:${H}:force_original_aspect_ratio=decrease,` +
          `pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=${F}[${vlab}]`
      );
      vlabels.push(vlab);
      if (includeAudio) {
        const alab = `a${ci}_${si}`;
        if (c.hasAudio) {
          parts.push(
            `[${ci}:a]atrim=start=${s.start}:end=${s.end},asetpts=PTS-STARTPTS,` +
              `aformat=sample_rates=48000:channel_layouts=stereo[${alab}]`
          );
        } else {
          // Synthesise silence so every concat input has an audio stream.
          const dur = (s.end - s.start).toFixed(6);
          parts.push(
            `anullsrc=channel_layout=stereo:sample_rate=48000,` +
              `atrim=0:${dur},asetpts=PTS-STARTPTS[${alab}]`
          );
        }
        alabels.push(alab);
      }
    });
  });

  const n = vlabels.length;
  let concatIns = '';
  for (let i = 0; i < n; i++) {
    concatIns += `[${vlabels[i]}]`;
    if (includeAudio) concatIns += `[${alabels[i]}]`;
  }
  if (includeAudio) {
    parts.push(`${concatIns}concat=n=${n}:v=1:a=1[vcat][aout]`);
  } else {
    parts.push(`${concatIns}concat=n=${n}:v=1:a=0[vcat]`);
  }

  if (asGif) {
    parts.push(
      `[vcat]scale=w='min(720,iw)':h=-1:flags=lanczos,split[s0][s1];` +
        `[s0]palettegen=max_colors=256:stats_mode=diff[p];` +
        `[s1][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle[out]`
    );
  }

  const filter = parts.join(';');
  const args = ['-y', ...inputs, '-filter_complex', filter];
  if (asGif) {
    args.push('-map', '[out]', '-loop', '0', output);
  } else {
    args.push('-map', '[vcat]');
    if (includeAudio)
      args.push('-map', '[aout]', '-c:a', 'aac', '-b:a', '192k');
    args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', output);
  }
  return runFFmpeg(args, event, totalDuration, 0);
}

// Merge clips (each with its own trimmed segments) into a single video.
// mode = 'copy' (fast, lossless — single clip only) or 'reencode'. Multiple
// clips are always re-encoded and normalised to a common size/frame rate.
ipcMain.handle('export-segments', async (event, opts) => {
  const { output, mode, target } = opts;
  const clips = normaliseClips(opts.clips);
  if (clips.length === 0) {
    return { success: false, error: 'Add at least one valid segment first.' };
  }
  for (const c of clips) {
    if (!fs.existsSync(c.input)) {
      return {
        success: false,
        error: 'A source file no longer exists:\n' + c.input
      };
    }
  }
  const totalDuration = clips.reduce(
    (t, c) => t + c.segments.reduce((a, s) => a + (s.end - s.start), 0),
    0
  );

  // Single clip, Fast mode: stream-copy with a re-encode fallback.
  if (clips.length === 1 && mode === 'copy') {
    const c = clips[0];
    const copyRes = await exportCopy(
      c.input,
      output,
      c.segments,
      totalDuration,
      event
    );
    if (copyRes.success) return { success: true, output };
    const reRes = await exportReencode(
      c.input,
      output,
      c.segments,
      totalDuration,
      c.hasAudio,
      event
    );
    return reRes.success ? { success: true, output, reencoded: true } : reRes;
  }

  // Single clip, Precise mode.
  if (clips.length === 1) {
    const c = clips[0];
    const res = await exportReencode(
      c.input,
      output,
      c.segments,
      totalDuration,
      c.hasAudio,
      event
    );
    return res.success ? { success: true, output } : res;
  }

  // Multiple clips: normalise + re-encode + concat into one video.
  const res = await exportMerge(
    clips,
    output,
    target,
    totalDuration,
    event,
    false
  );
  if (!res.success) return res;
  return {
    success: true,
    output,
    reencoded: mode === 'copy' ? true : undefined
  };
});

ipcMain.handle('reveal', async (event, filePath) => {
  shell.showItemInFolder(filePath);
});

// Export the merged clips/segments as a high-quality GIF. Clips are normalised
// to a common size/frame rate, concatenated, then a palette is generated.
ipcMain.handle('export-gif', async (event, opts) => {
  const { output, target } = opts;
  const clips = normaliseClips(opts.clips);
  if (clips.length === 0) {
    return { success: false, error: 'Add at least one valid segment first.' };
  }
  for (const c of clips) {
    if (!fs.existsSync(c.input)) {
      return {
        success: false,
        error: 'A source file no longer exists:\n' + c.input
      };
    }
  }
  const totalDuration = clips.reduce(
    (t, c) => t + c.segments.reduce((a, s) => a + (s.end - s.start), 0),
    0
  );

  const res = await exportMerge(
    clips,
    output,
    target,
    totalDuration,
    event,
    true
  );
  return res.success ? { success: true, output } : res;
});

// Grow the window to fit content so the user doesn't have to resize manually.
ipcMain.handle('fit-window', (event, contentHeight) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || win.isDestroyed()) return;
  if (win.isMaximized() || win.isFullScreen()) return;

  const { screen } = require('electron');
  const [width, currentHeight] = win.getSize();
  const workArea = screen.getDisplayMatching(win.getBounds()).workAreaSize;

  // Desired height = content + a little chrome padding, capped to the screen.
  const desired = Math.min(Math.ceil(contentHeight) + 48, workArea.height - 20);
  if (desired > currentHeight) {
    win.setSize(width, desired, true);
  }
});
