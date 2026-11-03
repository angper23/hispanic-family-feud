// Keeps the host and display windows in sync.
// Primary channel: BroadcastChannel. Fallback: the `storage` event on localStorage,
// which fires in every other same-origin window when the host saves state.

import { STATE_KEY } from './state.js';

const bc = typeof BroadcastChannel === 'function' ? new BroadcastChannel('hff-sync') : null;

export function readState() {
  try {
    const raw = localStorage.getItem(STATE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/** Saves state (persistence for refreshes) and broadcasts it to the display. */
export function publish(state) {
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify(state));
  } catch (e) {
    console.warn('[hff] could not save state', e);
  }
  bc?.postMessage({ type: 'state', state });
}

export function onState(cb) {
  bc?.addEventListener('message', (e) => {
    if (e.data?.type === 'state') cb(e.data.state);
  });
  window.addEventListener('storage', (e) => {
    if (e.key !== STATE_KEY || !e.newValue) return;
    try {
      cb(JSON.parse(e.newValue));
    } catch {
      /* ignore malformed */
    }
  });
}

/** The display says hello when it opens; the host answers with the current state. */
export const sayHello = () => bc?.postMessage({ type: 'hello' });
export function onHello(cb) {
  bc?.addEventListener('message', (e) => {
    if (e.data?.type === 'hello') cb();
  });
}
