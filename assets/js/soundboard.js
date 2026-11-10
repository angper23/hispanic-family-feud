// Host-supplied sound files, kept in this browser's IndexedDB.
// Nothing here is uploaded or committed: files only exist on the computer that loaded them.

const DB_NAME = 'hff-sounds';
const STORE = 'sounds';

/** Game events whose built-in sound can be replaced by a file. */
export const EVENT_SLOTS = [
  { slot: 'ding', label: 'Correct answer (reveal)' },
  { slot: 'buzzer', label: 'Strike / wrong answer' },
  { slot: 'buzzIn', label: 'Buzz-in (face-off)' },
  { slot: 'steal', label: 'Steal starts' },
  { slot: 'fanfare', label: 'Round win / game start' },
  { slot: 'bigFanfare', label: 'Winner screen' },
  { slot: 'flip', label: 'Reveal remaining (no points)' },
  { slot: 'timeUp', label: 'Timer ends' },
];

/** Free pads the host can fire any time (intro music, applause, ...). */
export const PAD_SLOTS = [
  { slot: 'pad1', label: 'Intro / theme' },
  { slot: 'pad2', label: 'Applause' },
  { slot: 'pad3', label: 'Pad 3' },
  { slot: 'pad4', label: 'Pad 4' },
  { slot: 'pad5', label: 'Pad 5' },
  { slot: 'pad6', label: 'Pad 6' },
];

function openDb() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) return reject(new Error('This browser has no IndexedDB.'));
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const out = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(out?.result);
    t.onerror = () => reject(t.error);
  });
}

/** Returns { slot: { name, type, data: ArrayBuffer } } for every stored file. */
export async function loadAllSounds() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const out = {};
    const req = db.transaction(STORE).objectStore(STORE).openCursor();
    req.onsuccess = () => {
      const c = req.result;
      if (!c) return resolve(out);
      out[c.key] = c.value;
      c.continue();
    };
    req.onerror = () => reject(req.error);
  });
}

export async function saveSound(slot, file) {
  const data = await file.arrayBuffer();
  const rec = { name: file.name, type: file.type, data };
  await tx('readwrite', (s) => s.put(rec, slot));
  return rec;
}

export const removeSound = (slot) => tx('readwrite', (s) => s.delete(slot));
