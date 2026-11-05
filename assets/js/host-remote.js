// Host console: the Remote Buzzer button and room-code panel.

import { buzzArmed } from './state.js';
import { createRemote } from './remote.js';
import { toast, confirmDialog } from './ui.js';

const $ = (id) => document.getElementById(id);

/** Returns the remote; call remote.push() after every state change. */
export function initRemoteUI({ getState, dispatch }) {
  const remote = createRemote({
    getState,
    // Only the first buzz of a face-off counts; late or duplicate presses are ignored.
    onBuzz: (team) => buzzArmed(getState()) && dispatch('BUZZ', { team }),
    onChange: renderRemote,
  });

  function renderRemote(i) {
    const btn = $('btn-remote');
    const panel = $('remote-panel');
    btn.textContent = i.open && i.code ? `📱 Buzzer ${i.code} · ${i.count}` : '📱 Remote Buzzer';
    $('remote-code').textContent = i.code || '····';
    $('remote-url-short').textContent = remote.url() ? remote.url().replace(/\?room=.*/, '') : '';
    $('remote-status').textContent = i.error
      ? i.error
      : !i.open
        ? ''
        : i.count
          ? `${i.count} buzzer${i.count > 1 ? 's' : ''} connected.`
          : 'Waiting for the iPad to join…';
    if (!i.open) panel.hidden = true;
  }
  $('btn-remote').addEventListener('click', () => {
    const panel = $('remote-panel');
    if (!remote.info().open) {
      remote.start();
      panel.hidden = false;
    } else panel.hidden = !panel.hidden;
    $('btn-remote').setAttribute('aria-expanded', String(!panel.hidden));
  });
  // The X only hides the panel; the room keeps running. Closing the room needs a confirmation.
  $('remote-hide').addEventListener('click', () => {
    $('remote-panel').hidden = true;
    $('btn-remote').setAttribute('aria-expanded', 'false');
  });
  $('remote-stop').addEventListener('click', async () => {
    const ok = await confirmDialog({
      title: 'Close the buzzer room?',
      message: 'Connected phones will be disconnected, and opening it again gives a new code.',
      confirmText: 'Close room',
    });
    if (ok) remote.stop();
  });
  $('remote-copy').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(remote.url());
      toast('Link copied.');
    } catch {
      toast(remote.url());
    }
  });

  return remote;
}
