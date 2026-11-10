// The "Next game" form: edit family names, captains and players before the next game starts.

import { esc } from './ui.js';

const lines = (text) =>
  String(text || '')
    .split(/\r?\n|,/)
    .map((x) => x.trim())
    .filter(Boolean);

/**
 * Shows a form prefilled with the current families. Resolves to
 * [{ name, captain, players }, { name, captain, players }], or null if cancelled.
 * `summary` is a short line about the game that just ended.
 */
export function askNextGameTeams(teams, summary = '') {
  return new Promise((resolve) => {
    const d = document.createElement('dialog');
    d.className = 'confirm next-game';
    d.innerHTML = `<form method="dialog">
      <h2>Next game</h2>
      ${summary ? `<p class="small">${esc(summary)}</p>` : ''}
      <p class="small">Change anything for the new families, or leave it as it is. The record of past games is kept.</p>
      <div class="ng-teams">${teams
        .map(
          (t, i) => `<fieldset class="ng-team t${i}"><legend>Family ${i + 1}</legend>
            <label>Name <input name="name${i}" value="${esc(t.name)}" maxlength="40" autocomplete="off"></label>
            <label>Captain <input name="captain${i}" value="${esc(t.captain)}" maxlength="40" autocomplete="off"></label>
            <label>Other players <textarea name="players${i}" rows="4" placeholder="One name per line">${esc((t.players || []).join('\n'))}</textarea></label>
          </fieldset>`,
        )
        .join('')}</div>
      <div class="confirm-actions">
        <button type="button" class="btn" data-cancel>Cancel</button>
        <button value="ok" class="btn btn-gold">Start game</button>
      </div>
    </form>`;
    document.body.append(d);
    const form = d.querySelector('form');
    d.addEventListener('close', () => {
      const f = form.elements;
      resolve(
        d.returnValue === 'ok'
          ? [0, 1].map((i) => ({ name: f[`name${i}`].value.trim(), captain: f[`captain${i}`].value.trim(), players: lines(f[`players${i}`].value) }))
          : null,
      );
      d.remove();
    });
    d.querySelector('[data-cancel]').addEventListener('click', () => d.close('cancel')); // plain button, so Enter submits "Start game"
    d.showModal();
    form.elements.name0.select();
  });
}
