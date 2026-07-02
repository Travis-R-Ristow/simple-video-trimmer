// Renderer logic for Video Trimmer.

const drop = document.getElementById('drop');
const editor = document.getElementById('editor');
const player = document.getElementById('player');
const fname = document.getElementById('fname');
const durLabel = document.getElementById('dur');
const startInput = document.getElementById('startInput');
const endInput = document.getElementById('endInput');
const setStartBtn = document.getElementById('setStart');
const setEndBtn = document.getElementById('setEnd');
const trimBtn = document.getElementById('trimBtn');
const gifBtn = document.getElementById('gifBtn');
const previewBtn = document.getElementById('previewBtn');
const statusEl = document.getElementById('status');
const progressWrap = document.getElementById('progressWrap');
const progressBar = document.getElementById('progressBar');

// Timeline elements
const timelineWrap = document.getElementById('timelineWrap');
const timeline = document.getElementById('timeline');
const segLayer = document.getElementById('segLayer');
const playhead = document.getElementById('playhead');
const selLabel = document.getElementById('selLabel');

// Segment list elements
const segList = document.getElementById('segList');
const addSegBtn = document.getElementById('addSegBtn');
const totalLabel = document.getElementById('totalLabel');

const MIN_SEG = 0.05; // minimum segment length in seconds

let currentInput = null;
let duration = 0;
let fps = 30; // default until probed
let hasAudio = true;

// Segments are kept sorted by start time (chronological, model B).
let segments = []; // [{ id, start, end }]
let selectedId = null;
let segCounter = 0;

// Preview-result playback state.
let previewing = false;
let previewIndex = 0;

// --- Time helpers ---------------------------------------------------------

function secondsToTime(sec) {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const ms = Math.round((sec - Math.floor(sec)) * 1000);
  const pad = (n, l = 2) => String(n).padStart(l, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)}.${pad(ms, 3)}`;
}

function timeToSeconds(str) {
  const parts = str.trim().split(':');
  if (parts.length !== 3) return NaN;
  const h = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  const s = parseFloat(parts[2]);
  if ([h, m, s].some((v) => isNaN(v))) return NaN;
  return h * 3600 + m * 60 + s;
}

// --- Load a file ----------------------------------------------------------

async function loadFile(filePath) {
  currentInput = filePath;
  fname.textContent = filePath;
  statusEl.textContent = '';
  statusEl.className = 'status';

  // Load into the preview player.
  player.src = 'file://' + filePath.replace(/\\/g, '/').replace(/^\/*/, '/');
  player.style.display = 'block';
  editor.classList.remove('hidden');

  // Probe duration via ffprobe (reliable for odd containers like .dvr).
  const info = await window.api.probe(filePath);
  if (info && info.duration) {
    duration = info.duration;
  } else {
    duration = 0;
  }
  fps = info && info.fps && info.fps > 0 ? info.fps : 30;
  hasAudio = info && typeof info.hasAudio === 'boolean' ? info.hasAudio : true;

  player.onloadedmetadata = () => {
    if ((!duration || duration === 0) && isFinite(player.duration)) {
      duration = player.duration;
    }
    finalizeLoad();
  };

  // In case metadata is already loaded or the container isn't previewable.
  setTimeout(() => {
    if (duration > 0 || isFinite(player.duration)) finalizeLoad();
  }, 800);
}

function finalizeLoad() {
  const d = duration || (isFinite(player.duration) ? player.duration : 0);
  duration = d;
  durLabel.textContent = d ? `(duration ${secondsToTime(d)})` : '';
  // Start with a single segment covering the whole video (matches old behavior).
  segCounter = 0;
  segments = [makeSegment(0, d)];
  selectedId = segments[0].id;
  timelineWrap.style.display = d > 0 ? 'block' : 'none';
  setControlsEnabled(true);
  updateAll();
  fitWindowToContent();
}

function makeSegment(start, end) {
  return { id: ++segCounter, start, end };
}

function setControlsEnabled(on) {
  trimBtn.disabled = !on;
  gifBtn.disabled = !on;
  previewBtn.disabled = !on;
  addSegBtn.disabled = !on;
}

// Ask the main process to grow the window so all controls are visible.
function fitWindowToContent() {
  // Wait a frame so layout (video, timeline) has settled.
  requestAnimationFrame(() => {
    setTimeout(() => {
      const needed = document.body.scrollHeight;
      if (window.api.fitWindow) window.api.fitWindow(needed);
    }, 60);
  });
}

// --- Timeline & segments --------------------------------------------------

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function getSelected() {
  return segments.find((s) => s.id === selectedId) || null;
}

function sortSegments() {
  segments.sort((a, b) => a.start - b.start);
}

// The free range a segment may occupy without overlapping its neighbors.
function neighborBounds(seg) {
  sortSegments();
  const i = segments.indexOf(seg);
  const lo = i > 0 ? segments[i - 1].end : 0;
  const hi = i < segments.length - 1 ? segments[i + 1].start : duration;
  return { lo, hi };
}

function selectSegment(id) {
  selectedId = id;
  updateSelectedInputs();
  renderTimeline();
  renderSegList();
}

// Add a new segment in a free gap (prefer the gap under the playhead).
function addSegment() {
  if (!duration) return;
  sortSegments();
  const gaps = [];
  let cursor = 0;
  for (const s of segments) {
    if (s.start - cursor > 0.1) gaps.push({ start: cursor, end: s.start });
    cursor = Math.max(cursor, s.end);
  }
  if (duration - cursor > 0.1) gaps.push({ start: cursor, end: duration });

  if (gaps.length === 0) {
    showStatus('No free space left. Shrink or delete a segment first.', true);
    return;
  }

  const ph = player.currentTime;
  let gap = gaps.find((g) => ph >= g.start && ph <= g.end);
  if (!gap) {
    gap = gaps.reduce((a, b) => (b.end - b.start > a.end - a.start ? b : a));
  }

  const DEFAULT_LEN = 5;
  let start = ph >= gap.start && ph <= gap.end ? ph : gap.start;
  let end = Math.min(start + DEFAULT_LEN, gap.end);
  if (end - start < 0.2) {
    start = gap.start;
    end = Math.min(gap.start + DEFAULT_LEN, gap.end);
  }

  const seg = makeSegment(start, end);
  segments.push(seg);
  selectedId = seg.id;
  sortSegments();
  updateAll();
  player.currentTime = start;
}

function deleteSelected() {
  if (segments.length <= 1) {
    showStatus('Keep at least one segment.', true);
    return;
  }
  const i = segments.findIndex((s) => s.id === selectedId);
  if (i < 0) return;
  segments.splice(i, 1);
  selectedId = segments[Math.min(i, segments.length - 1)].id;
  updateAll();
}

// Render the colored segment blocks + green/red handles on the timeline.
function renderTimeline() {
  segLayer.innerHTML = '';
  if (!duration) return;
  sortSegments();
  segments.forEach((s, idx) => {
    const block = document.createElement('div');
    block.className = 'tl-segment' + (s.id === selectedId ? ' selected' : '');
    block.style.left = (s.start / duration) * 100 + '%';
    block.style.width = ((s.end - s.start) / duration) * 100 + '%';
    block.dataset.id = s.id;

    const num = document.createElement('div');
    num.className = 'tl-seg-num';
    num.textContent = idx + 1;
    block.appendChild(num);

    const hs = document.createElement('div');
    hs.className = 'tl-handle start';
    hs.dataset.id = s.id;
    hs.dataset.edge = 'start';

    const he = document.createElement('div');
    he.className = 'tl-handle end';
    he.dataset.id = s.id;
    he.dataset.edge = 'end';

    block.appendChild(hs);
    block.appendChild(he);
    segLayer.appendChild(block);
  });
}

// Render the segment list panel below the timeline.
function renderSegList() {
  segList.innerHTML = '';
  sortSegments();
  segments.forEach((s, idx) => {
    const row = document.createElement('div');
    row.className = 'seg-row' + (s.id === selectedId ? ' selected' : '');
    row.dataset.id = s.id;

    const badge = document.createElement('div');
    badge.className = 'seg-idx';
    badge.textContent = idx + 1;

    const range = document.createElement('div');
    range.className = 'seg-range';
    range.innerHTML =
      secondsToTime(s.start) +
      '<span class="arrow">→</span>' +
      secondsToTime(s.end);

    const dur = document.createElement('div');
    dur.className = 'seg-dur';
    dur.textContent = secondsToTime(s.end - s.start);

    const del = document.createElement('button');
    del.className = 'seg-del';
    del.textContent = '×';
    del.title = 'Delete segment';
    del.addEventListener('click', (e) => {
      e.stopPropagation();
      selectedId = s.id;
      deleteSelected();
    });

    row.appendChild(badge);
    row.appendChild(range);
    row.appendChild(dur);
    row.appendChild(del);
    row.addEventListener('click', () => {
      selectSegment(s.id);
      player.currentTime = s.start;
    });
    segList.appendChild(row);
  });
}

function updateSelectedInputs() {
  const s = getSelected();
  if (!s) {
    startInput.value = '';
    endInput.value = '';
    selLabel.textContent = '';
    return;
  }
  startInput.value = secondsToTime(s.start);
  endInput.value = secondsToTime(s.end);
  selLabel.textContent = 'Selected: ' + secondsToTime(s.end - s.start);
}

function updateTotals() {
  const total = segments.reduce((t, s) => t + (s.end - s.start), 0);
  const n = segments.length;
  totalLabel.textContent =
    n + ' segment' + (n !== 1 ? 's' : '') + ' · total ' + secondsToTime(total);
}

function updateAll() {
  renderTimeline();
  renderSegList();
  updateSelectedInputs();
  updateTotals();
  updatePlayhead();
}

function updatePlayhead() {
  if (!duration) return;
  const pct = clamp((player.currentTime / duration) * 100, 0, 100);
  playhead.style.left = pct + '%';
}

// Convert a mouse X within the timeline to seconds.
function xToSeconds(clientX) {
  const rect = timeline.getBoundingClientRect();
  const ratio = clamp((clientX - rect.left) / rect.width, 0, 1);
  return ratio * duration;
}

// Drag a segment handle (green = start, red = end).
function startDrag(handle, isStart) {
  const seg = getSelected();
  if (!seg) return;
  const block = handle.closest('.tl-segment');
  handle.classList.add('dragging');

  const onMove = (e) => {
    const t = xToSeconds(e.clientX);
    const { lo, hi } = neighborBounds(seg);
    if (isStart) seg.start = clamp(t, lo, seg.end - MIN_SEG);
    else seg.end = clamp(t, seg.start + MIN_SEG, hi);

    block.style.left = (seg.start / duration) * 100 + '%';
    block.style.width = ((seg.end - seg.start) / duration) * 100 + '%';
    player.currentTime = isStart ? seg.start : seg.end;
    updateSelectedInputs();
    updateTotals();
    renderSegList();
  };
  const onUp = () => {
    handle.classList.remove('dragging');
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
    renderTimeline();
  };
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
}

// Drag the whole segment block left/right, preserving its length.
function startMoveSegment(seg, block, grabClientX) {
  const grabStart = seg.start;
  const len = seg.end - seg.start;
  let moved = false;
  block.classList.add('moving');
  if (previewing) stopPreview();

  const onMove = (e) => {
    const deltaSec =
      ((e.clientX - grabClientX) / timeline.getBoundingClientRect().width) *
      duration;
    if (Math.abs(e.clientX - grabClientX) > 2) moved = true;
    const { lo, hi } = neighborBounds(seg);
    // Clamp so the whole block stays within its neighbor gap.
    const newStart = clamp(grabStart + deltaSec, lo, hi - len);
    seg.start = newStart;
    seg.end = newStart + len;

    block.style.left = (seg.start / duration) * 100 + '%';
    player.currentTime = seg.start;
    updateSelectedInputs();
    renderSegList();
  };
  const onUp = () => {
    block.classList.remove('moving');
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
    sortSegments();
    updateAll();
  };
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
}

// Delegate mousedown on the segment layer to handles / block selection.
segLayer.addEventListener('mousedown', (e) => {
  const handle = e.target.closest('.tl-handle');
  if (handle) {
    e.preventDefault();
    selectSegment(+handle.dataset.id);
    startDrag(handle, handle.dataset.edge === 'start');
    return;
  }
  const block = e.target.closest('.tl-segment');
  if (block) {
    e.preventDefault();
    const seg = segments.find((s) => s.id === +block.dataset.id);
    selectSegment(+block.dataset.id);
    if (seg) startMoveSegment(seg, block, e.clientX);
  }
});

// Click on empty timeline area seeks the preview (and stops preview mode).
timeline.addEventListener('mousedown', (e) => {
  if (e.target.closest('.tl-handle') || e.target.closest('.tl-segment')) return;
  if (previewing) stopPreview();
  player.currentTime = clamp(xToSeconds(e.clientX), 0, duration);
});

addSegBtn.addEventListener('click', addSegment);

// Keep the selected segment in sync with the text inputs.
startInput.addEventListener('change', () => {
  const s = getSelected();
  const t = timeToSeconds(startInput.value);
  if (s && !isNaN(t)) {
    const { lo } = neighborBounds(s);
    s.start = clamp(t, lo, s.end - MIN_SEG);
    updateAll();
  }
});
endInput.addEventListener('change', () => {
  const s = getSelected();
  const t = timeToSeconds(endInput.value);
  if (s && !isNaN(t)) {
    const { hi } = neighborBounds(s);
    s.end = clamp(t, s.start + MIN_SEG, hi);
    updateAll();
  }
});

// --- Preview result -------------------------------------------------------

function startPreview() {
  if (!duration || segments.length === 0) return;
  sortSegments();
  previewing = true;
  previewIndex = 0;
  previewBtn.textContent = '■ Stop preview';
  previewBtn.classList.add('active');
  player.currentTime = segments[0].start;
  player.play();
}

function stopPreview() {
  previewing = false;
  previewBtn.textContent = '▶ Preview result';
  previewBtn.classList.remove('active');
  player.pause();
}

function togglePreview() {
  if (previewing) stopPreview();
  else startPreview();
}

previewBtn.addEventListener('click', togglePreview);

player.addEventListener('timeupdate', () => {
  updatePlayhead();
  if (!previewing) return;
  sortSegments();
  const seg = segments[previewIndex];
  if (!seg) {
    stopPreview();
    return;
  }
  if (player.currentTime >= seg.end - 0.02) {
    previewIndex++;
    const next = segments[previewIndex];
    if (next) player.currentTime = next.start;
    else stopPreview();
  }
});

player.addEventListener('ended', () => {
  if (previewing) stopPreview();
});

// --- Events ---------------------------------------------------------------

async function openFile() {
  const file = await window.api.pickInput();
  if (file) loadFile(file);
}

drop.addEventListener('click', openFile);

['dragenter', 'dragover'].forEach((ev) =>
  drop.addEventListener(ev, (e) => {
    e.preventDefault();
    drop.classList.add('drag');
  })
);
['dragleave', 'drop'].forEach((ev) =>
  drop.addEventListener(ev, (e) => {
    e.preventDefault();
    drop.classList.remove('drag');
  })
);
drop.addEventListener('drop', (e) => {
  const f = e.dataTransfer.files[0];
  if (f && f.path) loadFile(f.path);
});

function setStartAtPlayhead() {
  const s = getSelected();
  if (!s) return;
  const { lo } = neighborBounds(s);
  s.start = clamp(player.currentTime, lo, s.end - MIN_SEG);
  updateAll();
}
function setEndAtPlayhead() {
  const s = getSelected();
  if (!s) return;
  const { hi } = neighborBounds(s);
  s.end = clamp(player.currentTime, s.start + MIN_SEG, hi);
  updateAll();
}
setStartBtn.addEventListener('click', setStartAtPlayhead);
setEndBtn.addEventListener('click', setEndAtPlayhead);

// Step the playhead by a number of frames (negative = backward).
function stepFrames(frames) {
  if (!duration) return;
  const frameDur = 1 / (fps || 30);
  player.pause();
  player.currentTime = clamp(
    player.currentTime + frames * frameDur,
    0,
    duration
  );
  updatePlayhead();
}

function togglePlay() {
  if (!duration) return;
  if (player.paused) player.play();
  else player.pause();
}

window.api.onProgress((pct) => {
  progressBar.style.width = pct + '%';
});

function setBusy(busy) {
  setControlsEnabled(!busy);
  setStartBtn.disabled = busy;
  setEndBtn.disabled = busy;
  progressWrap.style.display = busy ? 'block' : 'none';
  if (busy) progressBar.style.width = '0%';
}

trimBtn.addEventListener('click', runTrim);

async function runTrim() {
  if (trimBtn.disabled) return;
  if (segments.length === 0) {
    return showStatus('Add at least one segment first.', true);
  }
  const mode = document.querySelector('input[name="mode"]:checked').value;

  const base = currentInput.replace(/\.[^.\\/]+$/, '');
  const output = await window.api.pickOutput(base + '_trimmed.mp4');
  if (!output) return;

  if (previewing) stopPreview();
  setBusy(true);
  showStatus(
    segments.length > 1 ? 'Merging segments…' : 'Trimming…',
    false,
    true
  );

  const result = await window.api.exportSegments({
    input: currentInput,
    output,
    mode,
    hasAudio,
    segments: segments.map((s) => ({ start: s.start, end: s.end }))
  });

  setBusy(false);

  if (result.success) {
    statusEl.className = 'status ok';
    statusEl.innerHTML =
      'Done! Saved to ' +
      result.output +
      ' <a id="revealLink">Show in folder</a>';
    document.getElementById('revealLink').addEventListener('click', () => {
      window.api.reveal(result.output);
    });
  } else {
    showStatus('Failed:\n' + result.error, true);
  }
}

gifBtn.addEventListener('click', runGif);

async function runGif() {
  if (gifBtn.disabled) return;
  if (segments.length === 0) {
    return showStatus('Add at least one segment first.', true);
  }

  const base = currentInput.replace(/\.[^.\\/]+$/, '');
  const output = await window.api.pickOutput(base + '_clip.gif');
  if (!output) return;

  if (previewing) stopPreview();
  setBusy(true);
  showStatus('Creating GIF…', false, true);

  // GIFs are big at high fps/width; cap fps at 15 and width at 480 for size.
  const result = await window.api.exportGif({
    input: currentInput,
    output,
    fps: Math.min(fps || 15, 15),
    width: 480,
    segments: segments.map((s) => ({ start: s.start, end: s.end }))
  });

  setBusy(false);

  if (result.success) {
    statusEl.className = 'status ok';
    statusEl.innerHTML =
      'GIF saved to ' +
      result.output +
      ' <a id="revealLinkGif">Show in folder</a>';
    document.getElementById('revealLinkGif').addEventListener('click', () => {
      window.api.reveal(result.output);
    });
  } else {
    showStatus('Failed:\n' + result.error, true);
  }
}

function showStatus(msg, isError, persist) {
  statusEl.textContent = msg;
  statusEl.className = 'status ' + (isError ? 'err' : '');
  clearStatusTimer();
  // Auto-clear transient messages so they don't linger forever.
  if (msg && !persist) {
    statusTimer = setTimeout(clearStatus, isError ? 6000 : 4000);
  }
}

let statusTimer = null;
function clearStatusTimer() {
  if (statusTimer) {
    clearTimeout(statusTimer);
    statusTimer = null;
  }
}
function clearStatus() {
  clearStatusTimer();
  statusEl.textContent = '';
  statusEl.className = 'status';
}

// --- Keyboard shortcuts ---------------------------------------------------
// Space: play/pause | ←/→: frame step | Ctrl+←/→: big step (10 frames)
// S: set Start | E: set End | Ctrl+S: trim & save
// Ctrl+O: open file (when none loaded) | Ctrl+N: new window

const BIG_STEP_FRAMES = 10;

document.addEventListener('keydown', (e) => {
  const inField =
    e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA';

  // Ctrl+N — new window (always available).
  if (e.ctrlKey && (e.key === 'n' || e.key === 'N')) {
    e.preventDefault();
    window.api.newWindow();
    return;
  }
  // Ctrl+O — open file.
  if (e.ctrlKey && (e.key === 'o' || e.key === 'O')) {
    e.preventDefault();
    openFile();
    return;
  }
  // Ctrl+S — trim & save.
  if (e.ctrlKey && (e.key === 's' || e.key === 'S')) {
    e.preventDefault();
    runTrim();
    return;
  }

  // The following need a loaded video and shouldn't fire while typing.
  if (inField || !duration) return;

  switch (e.key) {
    case ' ':
      e.preventDefault();
      togglePlay();
      break;
    case 'ArrowLeft':
      e.preventDefault();
      stepFrames(e.ctrlKey ? -BIG_STEP_FRAMES : -1);
      break;
    case 'ArrowRight':
      e.preventDefault();
      stepFrames(e.ctrlKey ? BIG_STEP_FRAMES : 1);
      break;
    case 's':
    case 'S':
      e.preventDefault();
      setStartAtPlayhead();
      break;
    case 'e':
    case 'E':
      e.preventDefault();
      setEndAtPlayhead();
      break;
    case 'a':
    case 'A':
      e.preventDefault();
      addSegment();
      break;
    case 'p':
    case 'P':
      e.preventDefault();
      togglePreview();
      break;
    case 'Delete':
    case 'Backspace':
      e.preventDefault();
      deleteSelected();
      break;
  }
});
