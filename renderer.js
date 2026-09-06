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

// Clip (playlist) elements
const clipList = document.getElementById('clipList');
const addClipBtn = document.getElementById('addClipBtn');
const clipsTotal = document.getElementById('clipsTotal');

const MIN_SEG = 0.05; // minimum segment length in seconds

let currentInput = null;
let duration = 0;
let fps = 30; // default until probed
let hasAudio = true;

// Playlist of clips. Each clip owns its own file + segments; the timeline and
// segment editor operate on the active clip. Export merges all clips in order.
let clips = []; // [{ id, path, name, duration, fps, hasAudio, width, height, segments, selectedId, segCounter }]
let activeClipId = null;
let clipCounter = 0;

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

// --- Load ------------------------------------------------------------------

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

// --- Clips (playlist) -----------------------------------------------------

function updateAll() {
  snapshotActive();
  renderTimeline();
  renderSegList();
  updateSelectedInputs();
  updateTotals();
  updatePlayhead();
  renderClips();
}

function fileUrl(p) {
  return 'file://' + p.replace(/\\/g, '/').replace(/^\/*/, '/');
}

function baseName(p) {
  return p.replace(/^.*[\\/]/, '');
}

// Probe each file and append it to the playlist as a clip with one full-length
// segment. Activates the first newly added clip if none is active yet.
async function addClips(paths) {
  let firstNew = null;
  for (const p of paths) {
    const info = await window.api.probe(p);
    const d = info && info.duration ? info.duration : 0;
    const clip = {
      id: ++clipCounter,
      path: p,
      name: baseName(p),
      duration: d,
      fps: info && info.fps > 0 ? info.fps : 30,
      hasAudio:
        info && typeof info.hasAudio === 'boolean' ? info.hasAudio : true,
      width: info && info.width ? info.width : 0,
      height: info && info.height ? info.height : 0,
      segCounter: 0,
      segments: [],
      selectedId: null
    };
    const seg = { id: ++clip.segCounter, start: 0, end: d };
    clip.segments = [seg];
    clip.selectedId = seg.id;
    clips.push(clip);
    if (firstNew === null) firstNew = clip.id;
  }
  if (activeClipId === null && firstNew !== null) {
    activate(firstNew);
  } else {
    snapshotActive();
    renderClips();
  }
}

// Persist the live editing state back into the active clip object.
function snapshotActive() {
  const clip = clips.find((c) => c.id === activeClipId);
  if (!clip) return;
  clip.segments = segments;
  clip.selectedId = selectedId;
  clip.segCounter = segCounter;
  clip.duration = duration;
  clip.fps = fps;
  clip.hasAudio = hasAudio;
}

// Make a clip active: load it into the player and the segment editor.
function activate(clipId) {
  snapshotActive();
  const clip = clips.find((c) => c.id === clipId);
  if (!clip) return;
  activeClipId = clip.id;
  currentInput = clip.path;
  duration = clip.duration;
  fps = clip.fps;
  hasAudio = clip.hasAudio;
  segments = clip.segments;
  selectedId = clip.selectedId;
  segCounter = clip.segCounter;

  fname.textContent = clip.path;
  durLabel.textContent = duration
    ? `(duration ${secondsToTime(duration)})`
    : '';
  player.src = fileUrl(clip.path);
  player.style.display = 'block';
  editor.classList.remove('hidden');
  timelineWrap.style.display = duration > 0 ? 'block' : 'none';
  setControlsEnabled(true);

  // If the probe couldn't read a duration, fall back to the player's metadata.
  player.onloadedmetadata = () => {
    if ((!duration || duration === 0) && isFinite(player.duration)) {
      duration = player.duration;
      segments = [makeSegment(0, duration)];
      selectedId = segments[0].id;
      durLabel.textContent = `(duration ${secondsToTime(duration)})`;
      timelineWrap.style.display = 'block';
      updateAll();
    }
  };

  updateAll();
  fitWindowToContent();
}

function removeClip(id) {
  const i = clips.findIndex((c) => c.id === id);
  if (i < 0) return;
  clips.splice(i, 1);
  if (activeClipId === id) {
    activeClipId = null;
    if (clips.length) activate(clips[Math.min(i, clips.length - 1)].id);
    else resetEditor();
  } else {
    renderClips();
  }
}

function moveClip(id, dir) {
  const i = clips.findIndex((c) => c.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= clips.length) return;
  const tmp = clips[i];
  clips[i] = clips[j];
  clips[j] = tmp;
  renderClips();
}

function resetEditor() {
  if (previewing) stopPreview();
  editor.classList.add('hidden');
  currentInput = null;
  duration = 0;
  segments = [];
  selectedId = null;
  renderClips();
}

// Render the playlist panel.
function renderClips() {
  clipList.innerHTML = '';
  clips.forEach((c, idx) => {
    const row = document.createElement('div');
    row.className = 'clip-row' + (c.id === activeClipId ? ' active' : '');
    row.dataset.id = c.id;

    const badge = document.createElement('div');
    badge.className = 'clip-idx';
    badge.textContent = idx + 1;

    const meta = document.createElement('div');
    meta.className = 'clip-meta';
    const name = document.createElement('div');
    name.className = 'clip-name';
    name.textContent = c.name;
    name.title = c.path;
    const sub = document.createElement('div');
    sub.className = 'clip-sub';
    const trimmed = c.segments.reduce((a, s) => a + (s.end - s.start), 0);
    const nSeg = c.segments.length;
    sub.textContent =
      nSeg +
      ' segment' +
      (nSeg !== 1 ? 's' : '') +
      ' · ' +
      secondsToTime(trimmed);
    meta.appendChild(name);
    meta.appendChild(sub);

    const ctrls = document.createElement('div');
    ctrls.className = 'clip-ctrls';
    const up = document.createElement('button');
    up.className = 'clip-btn';
    up.textContent = '↑';
    up.title = 'Move up';
    up.disabled = idx === 0;
    up.addEventListener('click', (e) => {
      e.stopPropagation();
      moveClip(c.id, -1);
    });
    const down = document.createElement('button');
    down.className = 'clip-btn';
    down.textContent = '↓';
    down.title = 'Move down';
    down.disabled = idx === clips.length - 1;
    down.addEventListener('click', (e) => {
      e.stopPropagation();
      moveClip(c.id, 1);
    });
    const del = document.createElement('button');
    del.className = 'clip-btn clip-del';
    del.textContent = '×';
    del.title = 'Remove clip';
    del.addEventListener('click', (e) => {
      e.stopPropagation();
      removeClip(c.id);
    });
    ctrls.appendChild(up);
    ctrls.appendChild(down);
    ctrls.appendChild(del);

    row.appendChild(badge);
    row.appendChild(meta);
    row.appendChild(ctrls);
    row.addEventListener('click', () => activate(c.id));
    clipList.appendChild(row);
  });

  const grand = clips.reduce(
    (t, c) => t + c.segments.reduce((a, s) => a + (s.end - s.start), 0),
    0
  );
  const n = clips.length;
  clipsTotal.textContent = n
    ? n + ' clip' + (n !== 1 ? 's' : '') + ' · merged ' + secondsToTime(grand)
    : '';
}

// Normalisation target for merges: the first clip's size and frame rate.
function mergeTarget() {
  const first = clips[0] || {};
  return {
    width: first.width || 1280,
    height: first.height || 720,
    fps: Math.min(Math.max(Math.round(first.fps || 30), 1), 60)
  };
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

async function openFiles() {
  const files = await window.api.pickInput();
  if (files && files.length) addClips(files);
}

drop.addEventListener('click', openFiles);
addClipBtn.addEventListener('click', openFiles);

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
  const paths = [];
  for (const f of e.dataTransfer.files) {
    const p = f.path || window.api.getPathForFile(f);
    if (p) paths.push(p);
  }
  if (paths.length) addClips(paths);
});

// Load a file passed in when the app was launched from the OS (double-click /
// "Open with"), or when a second instance forwards one.
window.api.onOpenFile((filePath) => {
  if (filePath) addClips([filePath]);
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
  snapshotActive();
  if (clips.length === 0) {
    return showStatus('Add at least one clip first.', true);
  }
  const totalSegs = clips.reduce(
    (nSeg, c) => nSeg + c.segments.filter((s) => s.end > s.start).length,
    0
  );
  if (totalSegs === 0) {
    return showStatus('Add at least one segment first.', true);
  }
  const mode = document.querySelector('input[name="mode"]:checked').value;

  const base = clips[0].path.replace(/\.[^.\\/]+$/, '');
  const suffix = clips.length > 1 ? '_merged.mp4' : '_trimmed.mp4';
  const output = await window.api.pickOutput(base + suffix);
  if (!output) return;

  if (previewing) stopPreview();
  setBusy(true);
  showStatus(
    clips.length > 1 || totalSegs > 1 ? 'Merging…' : 'Trimming…',
    false,
    true
  );

  const result = await window.api.exportSegments({
    output,
    mode,
    target: mergeTarget(),
    clips: clips.map((c) => ({
      input: c.path,
      hasAudio: c.hasAudio,
      segments: c.segments.map((s) => ({ start: s.start, end: s.end }))
    }))
  });

  setBusy(false);

  if (result.success) {
    statusEl.className = 'status ok';
    const note = result.reencoded ? ' (re-encoded for compatibility)' : '';
    statusEl.innerHTML =
      'Done!' +
      note +
      ' Saved to ' +
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
  snapshotActive();
  if (clips.length === 0) {
    return showStatus('Add at least one clip first.', true);
  }
  const totalSegs = clips.reduce(
    (nSeg, c) => nSeg + c.segments.filter((s) => s.end > s.start).length,
    0
  );
  if (totalSegs === 0) {
    return showStatus('Add at least one segment first.', true);
  }

  const base = clips[0].path.replace(/\.[^.\\/]+$/, '');
  const output = await window.api.pickOutput(base + '_clip.gif');
  if (!output) return;

  if (previewing) stopPreview();
  setBusy(true);
  showStatus('Creating GIF…', false, true);

  const result = await window.api.exportGif({
    output,
    target: mergeTarget(),
    clips: clips.map((c) => ({
      input: c.path,
      hasAudio: c.hasAudio,
      segments: c.segments.map((s) => ({ start: s.start, end: s.end }))
    }))
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
    openFiles();
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

// --- Auto-update UI -------------------------------------------------------

const updateBtn = document.getElementById('updateBtn');
const updateMsg = document.getElementById('updateMsg');
const appVersion = document.getElementById('appVersion');

let updateState = 'idle';
let availableVersion = '';

window.api.getVersion().then((v) => {
  if (v) appVersion.textContent = 'v' + v;
});

function setUpdateMsg(text, kind) {
  updateMsg.textContent = text || '';
  updateMsg.className = 'update-msg' + (kind ? ' ' + kind : '');
}

function applyUpdateUI() {
  switch (updateState) {
    case 'checking':
      updateBtn.disabled = true;
      updateBtn.textContent = 'Checking…';
      setUpdateMsg('');
      break;
    case 'available':
      updateBtn.disabled = false;
      updateBtn.textContent = 'Download v' + availableVersion;
      setUpdateMsg('Update available', 'ok');
      break;
    case 'downloading':
      updateBtn.disabled = true;
      break;
    case 'downloaded':
      updateBtn.disabled = false;
      updateBtn.textContent = 'Restart & install';
      setUpdateMsg('Ready to install', 'ok');
      break;
    case 'up-to-date':
      updateBtn.disabled = false;
      updateBtn.textContent = 'Check for updates';
      setUpdateMsg("You're up to date", 'ok');
      break;
    case 'dev':
      updateBtn.disabled = false;
      updateBtn.textContent = 'Check for updates';
      setUpdateMsg('Updates run in the installed app', '');
      break;
    case 'error':
      updateBtn.disabled = false;
      updateBtn.textContent = 'Check for updates';
      break;
    default:
      updateBtn.disabled = false;
      updateBtn.textContent = 'Check for updates';
      setUpdateMsg('');
  }
}

updateBtn.addEventListener('click', () => {
  if (updateState === 'available') window.api.downloadUpdate();
  else if (updateState === 'downloaded') window.api.installUpdate();
  else window.api.checkForUpdates();
});

window.api.onUpdateStatus((data) => {
  updateState = data.state;
  if (data.version) availableVersion = data.version;
  if (data.state === 'downloading') {
    setUpdateMsg('Downloading… ' + (data.percent || 0) + '%', '');
  } else if (data.state === 'error') {
    setUpdateMsg('Update check failed', 'err');
  }
  applyUpdateUI();
});

applyUpdateUI();
