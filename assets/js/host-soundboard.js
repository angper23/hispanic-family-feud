// Host console: the Soundboard panel (load your own audio files, fire pads).
// Files live in this browser's IndexedDB (see soundboard.js); nothing is uploaded.

import { initAudio, play, setCustomSound, stopAll } from './audio.js';
import { EVENT_SLOTS, PAD_SLOTS, loadAllSounds, saveSound, removeSound } from './soundboard.js';
import { toast, esc } from './ui.js';

const $ = (id) => document.getElementById(id);

const soundFiles = {}; // slot -> file name of a loaded custom sound
let sbError = null;
let pendingSlot = null;
const MAX_FILE_MB = 40;
const PAD_LABELS_KEY = 'hff:padLabels:v1';

/** True while the Soundboard panel is open: number keys then fire pads instead of picking answers. */
export const padsLive = () => $('soundboard').open;

function loadPadLabels() {
  try {
    return JSON.parse(localStorage.getItem(PAD_LABELS_KEY) || '{}');
  } catch {
    return {};
  }
}
const padLabels = loadPadLabels();
const padLabel = (slot) => padLabels[slot]?.trim() || PAD_SLOTS.find((p) => p.slot === slot).label;

function updatePadsLive() {
  const live = padsLive();
  $('pads-live').hidden = !live;
  $('sb-summary').dataset.live = String(live);
}
$('soundboard').addEventListener('toggle', updatePadsLive);

$('soundboard').addEventListener('input', (e) => {
  const slot = e.target.dataset?.sbLabel;
  if (!slot) return;
  padLabels[slot] = e.target.value;
  try {
    localStorage.setItem(PAD_LABELS_KEY, JSON.stringify(padLabels));
  } catch {
    /* storage full: the label still works until refresh */
  }
  const name = $('soundboard').querySelector(`[data-sb-play="${slot}"] .name`);
  if (name) name.textContent = padLabel(slot);
});
$('soundboard').addEventListener('keydown', (e) => {
  if (e.target.dataset?.sbLabel && (e.key === 'Enter' || e.key === 'Escape')) e.target.blur();
});

export function firePad(slot) {
  if (!soundFiles[slot]) {
    toast('That pad is empty. Open the Soundboard and load a file into it.');
    return;
  }
  initAudio();
  play(slot);
}

function renderSoundboard() {
  const loaded = Object.keys(soundFiles).length;
  $('sb-summary').textContent = sbError ? `· ${sbError}` : loaded ? `· ${loaded} file${loaded === 1 ? '' : 's'} loaded` : '· built-in sounds';
  $('sb-pads').innerHTML = PAD_SLOTS.map(({ slot, label }, i) => {
    const f = soundFiles[slot];
    return `<div class="sb-pad">
      <button class="btn fire ${f ? 'has-file' : ''}" data-sb-play="${slot}">
        <span class="name">${esc(padLabel(slot))}</span><span class="file">${f ? esc(f) : 'Empty'}</span><span class="key">Key ${i + 1}</span></button>
      <input class="sb-label" data-sb-label="${slot}" value="${esc(padLabels[slot] || '')}" placeholder="${esc(label)}" maxlength="28" aria-label="Rename pad ${i + 1}">
      <div class="row"><button class="btn" data-sb-load="${slot}">Load / drag &amp; drop</button>${f ? `<button class="btn" data-sb-clear="${slot}">Clear</button>` : ''}</div>
    </div>`;
  }).join('');
  $('sb-events').innerHTML = EVENT_SLOTS.map(({ slot, label }) => {
    const f = soundFiles[slot];
    return `<div class="sb-row"><span class="lbl">${esc(label)}</span>
      <span class="file ${f ? 'custom' : ''}" title="${esc(f || '')}">${f ? esc(f) : 'Built-in'}</span>
      <span class="btns"><button class="btn" data-sb-play="${slot}">▶ Test</button>
      <button class="btn" data-sb-load="${slot}">Load / drag &amp; drop</button>
      ${f ? `<button class="btn" data-sb-clear="${slot}">Use built-in</button>` : ''}</span></div>`;
  }).join('');
}

$('soundboard').addEventListener('click', async (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.id === 'sb-stop') return stopAll();
  if (b.dataset.sbPlay) {
    const slot = b.dataset.sbPlay;
    if (slot.startsWith('pad')) return firePad(slot);
    initAudio();
    return play(slot);
  }
  if (b.dataset.sbLoad) {
    pendingSlot = b.dataset.sbLoad;
    return $('sb-file').click();
  }
  if (b.dataset.sbClear) {
    const slot = b.dataset.sbClear;
    await removeSound(slot).catch(() => {});
    await setCustomSound(slot, null);
    delete soundFiles[slot];
    renderSoundboard();
    toast(slot.startsWith('pad') ? 'Pad cleared.' : 'Back to the built-in sound.');
  }
  return undefined;
});

$('sb-file').addEventListener('change', (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  const slot = pendingSlot;
  pendingSlot = null;
  if (file && slot) loadFileInto(slot, file);
});

/** Validates, stores and activates a user-chosen audio file for a pad or game-event slot. */
async function loadFileInto(slot, file) {
  if (file.size > MAX_FILE_MB * 1024 * 1024) {
    toast(`That file is over ${MAX_FILE_MB} MB. Trim it or use a compressed MP3.`);
    return;
  }
  // Decode first: a bad file must not touch the sound that is already in this slot.
  try {
    await setCustomSound(slot, await file.arrayBuffer());
  } catch (err) {
    toast(`Couldn't use that file: ${err.message || 'the browser could not decode it'}.`);
    return;
  }
  soundFiles[slot] = file.name;
  renderSoundboard();
  try {
    await saveSound(slot, file);
    toast(`Loaded ${file.name}.`);
  } catch {
    toast(`Loaded ${file.name} for this session, but the browser could not save it for next time.`);
  }
}

/* ---------- drag and drop: drop an audio file on any pad or game-sound row ---------- */
const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
const dropTarget = (e) => e.target.closest?.('.sb-pad, .sb-row');
const slotOf = (el) => el?.querySelector('[data-sb-play]')?.dataset.sbPlay;
const clearDrop = () => $('soundboard').querySelectorAll('.drop').forEach((el) => el.classList.remove('drop'));

$('soundboard').addEventListener('dragover', (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  const t = dropTarget(e);
  clearDrop();
  if (t) t.classList.add('drop');
  e.dataTransfer.dropEffect = t ? 'copy' : 'none';
});
$('soundboard').addEventListener('dragleave', (e) => {
  if (!e.currentTarget.contains(e.relatedTarget)) clearDrop();
});
$('soundboard').addEventListener('drop', (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  const t = dropTarget(e);
  clearDrop();
  const slot = slotOf(t);
  const files = [...e.dataTransfer.files];
  if (!slot) return toast('Drop the file right onto a pad or a game-sound row.');
  if (files.length > 1) toast('Only one file per slot: using the first one.');
  loadFileInto(slot, files[0]);
  return undefined;
});
// A file dropped anywhere else would make the browser leave the game and open the file.
['dragover', 'drop'].forEach((type) => window.addEventListener(type, (e) => hasFiles(e) && e.preventDefault()));

export async function initSoundboard() {
  updatePadsLive();
  renderSoundboard();
  try {
    const all = await loadAllSounds();
    for (const [slot, rec] of Object.entries(all)) {
      try {
        await setCustomSound(slot, rec.data);
        soundFiles[slot] = rec.name;
      } catch {
        await removeSound(slot).catch(() => {});
      }
    }
  } catch (err) {
    sbError = `unavailable: ${err.message}`;
  }
  renderSoundboard();
}
