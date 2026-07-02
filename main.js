const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');

// Resolve bundled FFmpeg / FFprobe binaries. When packaged with electron-builder
// and asarUnpack, the binaries live in app.asar.unpacked, so fix the path.
function unpacked(p) {
  return p ? p.replace('app.asar', 'app.asar.unpacked') : p;
}

let ffmpegPath = unpacked(require('ffmpeg-static'));
let ffprobePath = unpacked(require('ffprobe-static').path);

function createWindow() {
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
  return win;
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Open a second (or third…) app window (Ctrl+N).
ipcMain.handle('new-window', () => {
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// --- IPC handlers ---------------------------------------------------------

ipcMain.handle('pick-input', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const result = await dialog.showOpenDialog(win, {
    title: 'Select a video file',
    properties: ['openFile'],
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
  return result.filePaths[0];
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
        for (const s of data.streams || []) {
          if (s.codec_type === 'video' && !fps) {
            const rate = s.avg_frame_rate || s.r_frame_rate || '';
            const m = /^(\d+)\/(\d+)$/.exec(rate);
            if (m && +m[2] > 0 && +m[1] > 0) fps = +m[1] / +m[2];
          }
          if (s.codec_type === 'audio') hasAudio = true;
        }
        resolve({ duration, fps, hasAudio });
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

// Validate and normalise a segments array. Returns { segments, totalDuration }.
function normaliseSegments(raw) {
  const segments = (raw || [])
    .map((s) => ({ start: Number(s.start), end: Number(s.end) }))
    .filter((s) => isFinite(s.start) && isFinite(s.end) && s.end > s.start)
    .sort((a, b) => a.start - b.start);
  const totalDuration = segments.reduce((t, s) => t + (s.end - s.start), 0);
  return { segments, totalDuration };
}

// Export one or more segments concatenated into a single video.
// mode = 'copy' (fast, lossless) or 'reencode' (frame accurate).
ipcMain.handle('export-segments', async (event, opts) => {
  const { input, output, mode, hasAudio } = opts;

  if (!fs.existsSync(input)) {
    return { success: false, error: 'Input file no longer exists.' };
  }
  const { segments, totalDuration } = normaliseSegments(opts.segments);
  if (segments.length === 0) {
    return { success: false, error: 'Add at least one valid segment first.' };
  }

  // --- Precise: single-pass filter_complex trim + concat (re-encode) -------
  if (mode === 'reencode') {
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
    const args = [
      '-y',
      '-i',
      input,
      '-filter_complex',
      filter,
      '-map',
      '[vout]'
    ];
    if (hasAudio) args.push('-map', '[aout]', '-c:a', 'aac', '-b:a', '192k');
    args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', output);

    const res = await runFFmpeg(args, event, totalDuration, 0);
    return res.success ? { success: true, output } : res;
  }

  // --- Fast: stream-copy each segment to temp files, then concat -----------
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

    if (segments.length === 1) {
      // Single segment — just move the temp file to the destination.
      fs.copyFileSync(path.join(tmpDir, `seg0${ext}`), output);
      return { success: true, output };
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
    const res = await runFFmpeg(concatArgs, event, 0, 0);
    return res.success ? { success: true, output } : res;
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (_) {
      /* ignore cleanup errors */
    }
  }
});

ipcMain.handle('reveal', async (event, filePath) => {
  shell.showItemInFolder(filePath);
});

// Export the selected segment(s) as a high-quality GIF. Multiple segments are
// trimmed and concatenated, then a palette is generated for clean colors.
ipcMain.handle('export-gif', async (event, opts) => {
  const { input, output, fps, width } = opts;

  if (!fs.existsSync(input)) {
    return { success: false, error: 'Input file no longer exists.' };
  }
  const { segments, totalDuration } = normaliseSegments(opts.segments);
  if (segments.length === 0) {
    return { success: false, error: 'Add at least one valid segment first.' };
  }

  const gifFps = fps && fps > 0 ? fps : 15;
  const gifWidth = width && width > 0 ? width : 480;

  // Trim each segment, concat, then fps/scale + palettegen/paletteuse.
  const parts = [];
  let concatIns = '';
  segments.forEach((s, i) => {
    parts.push(
      `[0:v]trim=start=${s.start}:end=${s.end},setpts=PTS-STARTPTS[v${i}]`
    );
    concatIns += `[v${i}]`;
  });
  parts.push(`${concatIns}concat=n=${segments.length}:v=1:a=0[cat]`);
  parts.push(
    `[cat]fps=${gifFps},scale=${gifWidth}:-1:flags=lanczos,split[s0][s1];` +
      `[s0]palettegen=stats_mode=diff[p];` +
      `[s1][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle[out]`
  );
  const filter = parts.join(';');

  const args = [
    '-y',
    '-i',
    input,
    '-filter_complex',
    filter,
    '-map',
    '[out]',
    '-loop',
    '0',
    output
  ];

  const res = await runFFmpeg(args, event, totalDuration, 0);
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
