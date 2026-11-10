// Record of finished games (who won, final scores), kept in this browser so it survives
// refreshes, resets and new games. One entry per game; undoing out of a finished game removes it.

import { esc } from './ui.js';

export const RESULTS_KEY = 'hff:results:v1';

export function loadResults() {
  try {
    const list = JSON.parse(localStorage.getItem(RESULTS_KEY) || '[]');
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function save(list) {
  try {
    localStorage.setItem(RESULTS_KEY, JSON.stringify(list.slice(-50)));
  } catch {
    /* storage unavailable: the record just won't persist */
  }
}

/** Builds the record for a finished game state. */
export const resultFor = (s) => ({
  id: s.gameId,
  at: new Date().toISOString(),
  teams: s.teams.map((t) => ({ name: t.name, score: t.score })),
  winner: s.winner, // 0, 1, or null for a tie
  rounds: s.log.length,
});

/** Adds the result, or replaces it if the same game finishes again (for example after an Undo). */
export function saveResult(rec) {
  const list = loadResults().filter((r) => r.id !== rec.id);
  list.push(rec);
  save(list);
}

export const removeResult = (id) => save(loadResults().filter((r) => r.id !== id));
export const clearResults = () => save([]);

/** Plain-text line for one game, e.g. "García 245 – 180 López · García won". */
export function describeResult(r) {
  const [a, b] = r.teams;
  const outcome = r.winner == null ? 'Tie' : `${r.teams[r.winner].name} won`;
  return `${a.name} ${a.score} – ${b.score} ${b.name} · ${outcome}`;
}

/** The "Previous games" block for the host console; empty string when nothing has been played. */
export function resultsHtml() {
  const list = loadResults();
  if (!list.length) return '';
  return `<div class="results"><h3>Previous games</h3><ol>${list
    .map((r) => `<li>${esc(describeResult(r))}</li>`)
    .join('')}</ol><button type="button" class="btn" data-clear-results>Clear record</button></div>`;
}
