// Host console: owns the game state, records undo history, plays sounds,
// and publishes every change to the display window.

import {
  HISTORY_KEY,
  SETUP_KEY,
  NON_UNDOABLE,
  freshState,
  apply,
  currentMultiplier,
  timerSeconds,
  nextQuestionIndex,
  multiplierLabel,
  faceoffPlayer,
  playPlayer,
  stealPlayer,
  isLastRound,
  parseMultipliers,
  other,
} from './state.js';
import { publish, readState, onHello } from './sync.js';
import { saveResult, removeResult, clearResults, resultFor, describeResult, loadResults, resultsHtml } from './results.js';
import { askNextGameTeams } from './next-game.js';
import { initRemoteUI } from './host-remote.js';
import { padsLive, firePad, initSoundboard } from './host-soundboard.js';
import { applyBranding, CONFIG } from './config.js';
import { initAudio, setAudio, playFx, play, stopAll } from './audio.js';
import { PAD_SLOTS } from './soundboard.js';
import { loadQuestionBank, usableQuestions, isPlayable, rotateFrom, getNextIndex, setNextIndex, BANK_KEY } from './questions.js';
import { papelPicado } from './papel.js';
import { confirmDialog, toast, esc, isDialogOpen } from './ui.js';

const $ = (id) => document.getElementById(id);
const MAX_HISTORY = 120;

let state = readState() || freshState(null);
let history = loadHistory();
let bank = { questions: [], source: 'file', error: null };

applyBranding('Host Console');
papelPicado($('papel'), { count: 22, width: 1920, height: 118 });
setAudio(state.settings);

/* ---------- persistence ---------- */
function loadHistory() {
  try {
    const h = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
    return Array.isArray(h) ? h : [];
  } catch {
    return [];
  }
}
function saveHistory() {
  for (;;) {
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
      return;
    } catch {
      if (history.length < 2) return; // quota: drop the oldest half and retry
      history = history.slice(Math.floor(history.length / 2));
    }
  }
}

/** Keeps the record of finished games in step with the game state. */
function recordResult(prev, next) {
  if (next.phase === 'gameOver' && next.gameId) saveResult(resultFor(next));
  // Undo back out of a finished game: it hasn't finished after all, so drop its entry.
  else if (prev.phase === 'gameOver' && prev.gameId && next.gameId === prev.gameId) removeResult(prev.gameId);
}

function commit(next, { record = null } = {}) {
  if (record) {
    history.push(record);
    if (history.length > MAX_HISTORY) history.shift();
    saveHistory();
  }
  recordResult(state, next);
  state = next;
  if (state.phase !== 'setup') setNextIndex(nextQuestionIndex(state)); // the next game carries on down the list
  publish(state);
  render();
  remote.push();
}

function dispatch(type, payload) {
  const res = apply(state, { type, payload });
  if (res.error) {
    toast(res.error);
    return false;
  }
  initAudio();
  commit(res.state, { record: NON_UNDOABLE.has(type) ? null : state });
  playFx(res.state.fx.list);
  return true;
}

function undo() {
  const prev = history.pop();
  if (!prev) {
    toast('Nothing to undo.');
    return;
  }
  saveHistory();
  const rev = state.rev + 1;
  const restored = {
    ...prev,
    timer: { end: null }, // a timer from the past would just read "Time's up!"
    settings: { ...prev.settings, volume: state.settings.volume, muted: state.settings.muted },
    rev,
    fx: { rev, list: [{ t: 'undo' }] },
  };
  commit(restored);
  toast('Undone.');
}

async function resetGame() {
  const ok = await confirmDialog({
    title: 'Reset the game?',
    message: 'Scores, rounds and the undo history will be cleared. Team names stay filled in on the setup screen.',
    confirmText: 'Reset Game',
  });
  if (!ok) return;
  history = [];
  saveHistory();
  commit(freshState(state));
  toast('Game reset.');
}

onHello(() => publish(state));

/* ---------- audio controls ---------- */
const muteBtn = $('btn-mute');
const volume = $('volume');
function setAudioState(patch) {
  const res = apply(state, { type: 'SET_AUDIO', payload: patch });
  state = res.state;
  setAudio(state.settings);
  publish(state);
  renderAudio();
}
function toggleMute() {
  initAudio();
  setAudioState({ muted: !state.settings.muted });
}
function renderAudio() {
  const m = state.settings.muted;
  muteBtn.setAttribute('aria-pressed', String(m));
  muteBtn.textContent = m ? '🔇 Muted' : '🔊 Sound';
  volume.value = Math.round(state.settings.volume * 100);
}
muteBtn.addEventListener('click', toggleMute);
volume.addEventListener('input', () => {
  initAudio();
  setAudioState({ volume: Number(volume.value) / 100 });
});
volume.addEventListener('change', () => play('ding'));

/* ---------- remote buzzer ---------- */
const remote = initRemoteUI({ getState: () => state, dispatch });

/* ---------- top bar ---------- */
$('btn-display').addEventListener('click', () => {
  const w = window.open('index.html', 'hff-display', 'popup=yes,width=1280,height=720');
  if (!w) toast('The pop-up was blocked. Allow pop-ups for this site, or open index.html in a new window.');
  else {
    w.focus();
    publish(state);
  }
});
$('btn-undo').addEventListener('click', undo);
$('btn-reset').addEventListener('click', resetGame);
$('btn-endgame').addEventListener('click', async () => {
  const ok = await confirmDialog({
    title: 'End the game now?',
    message: 'This skips the remaining rounds and shows the winner screen. Any points still in the bank are not awarded. You can undo it.',
    confirmText: 'End game',
  });
  if (ok) dispatch('END_GAME');
});

/* ---------- setup ---------- */
const form = $('setup-form');
const SETUP_FIELDS = ['name0', 'captain0', 'players0', 'name1', 'captain1', 'players1', 'numRounds', 'multipliers', 'timerSeconds'];

function loadSetupDraft() {
  try {
    const d = JSON.parse(localStorage.getItem(SETUP_KEY) || '{}');
    SETUP_FIELDS.forEach((f) => {
      const v = f === 'timerSeconds' ? (d[f] ?? d.stealSeconds) : d[f]; // older drafts used stealSeconds
      if (v != null) form.elements[f].value = v;
    });
  } catch {
    /* ignore */
  }
}
function saveSetupDraft() {
  const d = {};
  SETUP_FIELDS.forEach((f) => (d[f] = form.elements[f].value));
  localStorage.setItem(SETUP_KEY, JSON.stringify(d));
}
form.addEventListener('input', () => {
  saveSetupDraft();
  renderSetupQuestions();
});

const lines = (text) =>
  String(text || '')
    .split(/\r?\n|,/)
    .map((x) => x.trim())
    .filter(Boolean);

async function refreshBank() {
  try {
    const b = await loadQuestionBank();
    bank = { ...b, error: null };
  } catch (e) {
    bank = { questions: [], source: 'file', error: e.message };
  }
  renderSetupQuestions();
}
window.addEventListener('storage', (e) => {
  if (e.key === BANK_KEY) refreshBank();
});

function renderSetupQuestions() {
  const el = $('setup-questions');
  if (bank.error) {
    el.innerHTML = `<div class="error-box"><strong>Couldn't load questions.json.</strong> ${esc(bank.error)}<br>
      Open this site through a web server (GitHub Pages, or <code>python3 -m http.server</code> in this folder), not by double-clicking the file.</div>`;
    return;
  }
  const rounds = Math.max(1, Number(form.elements.numRounds.value) || 4);
  const mults = parseMultipliers(form.elements.multipliers.value);
  const usable = usableQuestions(bank.questions);
  const skipped = bank.questions.filter((q) => q.use && !isPlayable(q)).length;
  const placeholder = bank.questions.some((q) => q.placeholder && q.use);
  const src = bank.source === 'local' ? 'your Question Editor changes (saved in this browser)' : 'questions.json';
  const ptr = usable.length ? getNextIndex() % usable.length : 0;
  const ordered = rotateFrom(usable, ptr);
  let html = `<h3>Questions</h3><p class="small">Using <strong>${usable.length}</strong> question${usable.length === 1 ? '' : 's'} from ${src}.
    ${placeholder ? '<span class="tag">Placeholder sample set</span>' : ''}
    <a href="editor.html" target="_blank" rel="noopener" style="color:var(--sun)">Edit or reorder</a></p>`;
  if (ptr > 0) {
    html += `<p class="small">Earlier games used the first ${ptr}, so this game <strong>carries on from question ${ptr + 1}</strong>.
      <button type="button" class="btn" data-qreset>Start over from question 1</button></p>`;
    if (usable.length - ptr < rounds) html += `<p class="small warn">Only ${usable.length - ptr} unused question${usable.length - ptr === 1 ? '' : 's'} left, then the list starts over from the top.</p>`;
  }
  if (skipped) html += `<p class="small warn">${skipped} selected question${skipped === 1 ? ' is' : 's are'} skipped because they need a question and at least 3 answers.</p>`;
  if (usable.length < rounds) html += `<p class="small warn">Only ${usable.length} usable questions for ${rounds} rounds. The game will end after ${usable.length}.</p>`;
  html += '<ol>';
  ordered.forEach((q, i) => {
    const r = i < rounds;
    const m = mults[Math.min(i, mults.length - 1)];
    const num = (ptr + i) % usable.length;
    html += `<li class="${r ? '' : 'spare'}">${r ? `<strong>R${i + 1} ×${m}</strong> · ` : 'Spare · '}${esc(q.question)}${ptr > 0 ? ` <span class="small">(#${num + 1})</span>` : ''}</li>`;
  });
  el.innerHTML = html + '</ol>' + resultsHtml();
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const f = form.elements;
  const all = usableQuestions(bank.questions);
  const start = all.length ? getNextIndex() % all.length : 0;
  const pool = rotateFrom(all, start);
  if (!pool.length) {
    toast(bank.error ? "Questions couldn't load. See the message above." : 'No usable questions. Add some in the Question Editor.');
    return;
  }
  saveSetupDraft();
  dispatch('START_GAME', {
    teams: [0, 1].map((i) => ({ name: f[`name${i}`].value, captain: f[`captain${i}`].value, players: lines(f[`players${i}`].value) })),
    settings: { numRounds: f.numRounds.value, multipliers: parseMultipliers(f.multipliers.value), timerSeconds: f.timerSeconds.value },
    pool,
    qBase: start,
    gameId: newGameId(),
  });
});

const newGameId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** After a game: edit the families if you like, then start with scores reset and the next questions down the list. */
async function startNextGame() {
  const all = usableQuestions(bank.questions);
  if (!all.length) return toast('No usable questions. Add some in the Question Editor.');
  const last = loadResults().find((r) => r.id === state.gameId);
  const teams = await askNextGameTeams(
    state.teams.map((t) => ({ name: t.name, captain: t.captain, players: t.players })),
    last ? `Last game: ${describeResult(last)}` : '',
  );
  if (!teams) return false;
  // Keep the setup screen's saved names in step, so a later Reset starts from these families.
  teams.forEach((t, i) => {
    form.elements[`name${i}`].value = t.name;
    form.elements[`captain${i}`].value = t.captain;
    form.elements[`players${i}`].value = t.players.join('\n');
  });
  saveSetupDraft();
  const start = getNextIndex() % all.length;
  return dispatch('START_GAME', {
    teams,
    settings: { numRounds: state.settings.numRounds, multipliers: state.settings.multipliers, timerSeconds: timerSeconds(state) },
    pool: rotateFrom(all, start),
    qBase: start,
    gameId: newGameId(),
  });
}

async function clearRecord() {
  const ok = await confirmDialog({
    title: 'Clear the record of past games?',
    message: 'This removes the list of winners from this browser. It cannot be undone.',
    confirmText: 'Clear record',
  });
  if (!ok) return;
  clearResults();
  render();
}

/* ---------- game input ---------- */
function handleAnswer(i) {
  const s = state;
  switch (s.phase) {
    case 'faceoff':
      if (!s.questionShown) return toast('Reveal the question first (Q).');
      if (s.faceoff.buzzed == null) return toast('First mark which family buzzed in (← or →).');
      return dispatch('FACEOFF_ANSWER', { idx: i });
    case 'choice':
      return toast('Waiting on Play or Pass (P / O).');
    case 'play':
      return dispatch('REVEAL', { idx: i });
    case 'steal':
      return dispatch('STEAL_ANSWER', { idx: i });
    case 'roundEnd':
      return dispatch('REVEAL_ONE', { idx: i });
    case 'gameOver':
      return toast('The game is over.');
    default:
      return undefined;
  }
}

function handleMiss() {
  const s = state;
  switch (s.phase) {
    case 'faceoff':
      if (!s.questionShown) return toast('Reveal the question first (Q).');
      if (s.faceoff.buzzed == null) return toast('First mark which family buzzed in (← or →).');
      return dispatch('FACEOFF_ANSWER', { idx: null });
    case 'play':
      return dispatch('STRIKE');
    case 'steal':
      return dispatch('STEAL_ANSWER', { idx: null });
    default:
      return toast('No answer is being given right now.');
  }
}

document.addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn || btn.disabled) return;
  if (btn.dataset.reveal != null) return handleAnswer(Number(btn.dataset.reveal));
  if (btn.id === 'btn-miss') return handleMiss();
  if (btn.id === 'btn-next-game') return startNextGame();
  if (btn.dataset.qreset != null) {
    setNextIndex(0);
    return renderSetupQuestions();
  }
  if (btn.dataset.clearResults != null) return clearRecord();
  if (btn.dataset.act) {
    const payload = btn.dataset.team != null ? { team: Number(btn.dataset.team) } : undefined;
    return dispatch(btn.dataset.act, payload);
  }
  if (btn.dataset.ovr) return applyOverride(btn.dataset.ovr);
  return undefined;
});

function applyOverride(which) {
  const map = {
    score0: ['SET_SCORE', { team: 0 }, 'ovr-score0'],
    score1: ['SET_SCORE', { team: 1 }, 'ovr-score1'],
    bank: ['SET_BANK', {}, 'ovr-bank'],
    strikes: ['SET_STRIKES', {}, 'ovr-strikes'],
  };
  const [type, extra, id] = map[which];
  const input = $(id);
  if (dispatch(type, { ...extra, value: input.value })) {
    input.blur();
    toast('Updated.');
  }
}
document.querySelectorAll('.ovr-grid input').forEach((input) => {
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') applyOverride(input.id.replace('ovr-', ''));
  });
});

document.addEventListener('keydown', (e) => {
  if (e.target instanceof Element && e.target.closest('input, textarea, select, [contenteditable]')) return;
  if (isDialogOpen()) return;
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    undo();
    return;
  }
  if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (k === 'u') {
    undo();
    e.preventDefault();
    return;
  }
  if (k === 'm') {
    toggleMute();
    return;
  }
  if (k === 'Escape') {
    stopAll();
    return;
  }
  // Pads: plain 1–6 while the Soundboard panel is open, Shift+1–6 any time.
  const padKey = /^Digit[1-6]$/.test(e.code) ? Number(e.code.slice(5)) : /^[1-6]$/.test(k) ? Number(k) : 0;
  if (padKey && (e.shiftKey || padsLive())) {
    firePad(PAD_SLOTS[padKey - 1].slot);
    e.preventDefault();
    return;
  }
  if (state.phase === 'setup') return;
  if (/^[1-8]$/.test(k)) handleAnswer(Number(k) - 1);
  else if (k === 'x') handleMiss();
  else if (k === 's') dispatch('START_STEAL');
  else if (k === 'p') dispatch('PLAY');
  else if (k === 'o') dispatch('PASS');
  else if (k === 'n') dispatch('NEXT_ROUND');
  else if (k === 'q') dispatch('REVEAL_QUESTION');
  else if (k === 't') dispatch('TIMER_START');
  else if (k === 'r') dispatch('REVEAL_REMAINING');
  else if (k === 'ArrowLeft') dispatch('BUZZ', { team: 0 });
  else if (k === 'ArrowRight') dispatch('BUZZ', { team: 1 });
  else return;
  e.preventDefault();
});

/* ---------- rendering ---------- */
const PHASE_LABEL = {
  faceoff: 'Step 1 · Face-Off',
  choice: 'Step 1 · Play or Pass',
  play: 'Step 2 · Playing the Round',
  steal: 'Step 3 · The Steal',
  roundEnd: 'Round Over',
  gameOver: 'Game Over',
};
const SRC_LABEL = { faceoff: 'Face-off', play: 'Revealed', steal: 'Stolen', end: 'Shown, no points' };
const tname = (t) => esc(state.teams[t].name);
const teamBtn = (act, t, label, key = '') =>
  `<button class="btn btn-lg btn-team${t}" data-act="${act}" data-team="${t}">${label}${key ? ` <kbd>${key}</kbd>` : ''}</button>`;
const strikesHtml = (n) => `<span class="mini-x">${[0, 1, 2].map((i) => `<i class="${i < n ? 'on' : ''}">✕</i>`).join('')}</span>`;

function render() {
  renderAudio();
  $('btn-undo').disabled = !history.length;
  const setup = state.phase === 'setup';
  $('setup').hidden = !setup;
  $('game').hidden = setup;
  document.title = setup ? `Host Console · ${CONFIG.gameName}` : `R${state.round + 1} · ${PHASE_LABEL[state.phase]} · Host`;
  if (setup) {
    renderSetupQuestions();
    return;
  }
  renderRoundBar();
  renderQuestion();
  renderAnswers();
  renderPhase();
  renderTeams();
  renderOverrides();
  renderLog();
}

function renderRoundBar() {
  const s = state;
  const m = currentMultiplier(s);
  $('round-bar').innerHTML = `
    <span class="stat"><span class="k">Round</span><span class="v">${s.round + 1}/${s.totalRounds}</span></span>
    <span class="stat"><span class="k">Multiplier</span><span class="v">×${m}</span></span>
    <span class="stat"><span class="k">Bank</span><span class="v">${s.bank}</span></span>
    <span class="stat"><span class="k">Strikes</span>${strikesHtml(s.strikes)}</span>
    <span class="phase">${PHASE_LABEL[s.phase]}</span>`;
}

function renderQuestion() {
  const s = state;
  $('question-box').innerHTML = `<div class="k">We surveyed 100 people…
      <span class="shown ${s.questionShown ? 'on' : 'off'}">${s.questionShown ? 'On screen' : 'Hidden from audience'}</span></div>
    <div class="q">${esc(s.question.question)}</div>`;
}

function renderAnswers() {
  const s = state;
  const m = currentMultiplier(s);
  const locked = ['choice', 'gameOver'].includes(s.phase) || (s.phase === 'faceoff' && (!s.questionShown || s.faceoff.buzzed == null));
  $('answers').innerHTML = s.question.answers
    .map((a, i) => {
      const on = s.revealed[i];
      const src = s.revealSrc[i];
      const sub = on ? SRC_LABEL[src] : `×${m} = ${a.points * m}`;
      return `<button class="ans ${on ? 'is-revealed' : ''} ${src === 'end' ? 'src-end' : ''} ${locked ? 'is-locked' : ''}" data-reveal="${i}" ${on ? 'disabled' : ''}>
        <kbd>${i + 1}</kbd><span class="t">${esc(a.text)}<span class="sub">${esc(sub)}</span></span><span class="p">${a.points}</span></button>`;
    })
    .join('');

  const miss = $('btn-miss');
  const labels = {
    faceoff: '✕ Not on board',
    play: `✕ Strike ${Math.min(3, s.strikes + 1)} of 3`,
    steal: '✕ Steal fails · not on board',
  };
  miss.innerHTML = `${labels[s.phase] || '✕ Not on board'} <kbd>X</kbd>`;
  miss.disabled = !labels[s.phase] || (s.phase === 'faceoff' && (!s.questionShown || s.faceoff.buzzed == null));

  // Functions, so only the current phase's hint is built (other phases may have null teams).
  const hints = {
    faceoff: () =>
      !s.questionShown
        ? 'Press Q to put the question on screen.'
        : s.faceoff.buzzed == null
          ? 'Mark who buzzed in first with ← or →.'
          : `Click ${esc(faceoffPlayer(s, s.faceoff.turn))}'s answer, or Not on board.`,
    choice: () => `${tname(s.choiceTeam)} decides: Play (P) or Pass (O).`,
    play: () => `Click ${esc(playPlayer(s))}'s answer, or Strike if it isn't on the board.`,
    steal: () => "Click the captain's answer if it's on the board, or Steal fails.",
    roundEnd: () => 'Click any hidden answer to show it with no points, or Reveal Remaining (R).',
    gameOver: () => 'Game over.',
  };
  $('click-hint').innerHTML = hints[s.phase]?.() || '';
}

function podium(s) {
  const fo = s.faceoff;
  return `<div class="podium">${[0, 1]
    .map(
      (t) => `<div class="pod t${t} ${fo.turn === t && fo.buzzed != null ? 'turn' : ''}">
        <div class="fam">${tname(t)}</div><div class="who">${esc(faceoffPlayer(s, t))}</div></div>`
    )
    .join('<div class="vs">vs</div>')}</div>`;
}

function renderPhase() {
  const s = state;
  const el = $('phase-panel');
  let html = `<div class="step">${PHASE_LABEL[s.phase]}</div>`;
  switch (s.phase) {
    case 'faceoff': {
      const fo = s.faceoff;
      html += podium(s);
      if (!s.questionShown) {
        html += `<h2>Bring the players to the podium</h2>
          <p>Read the question aloud, then put it on screen.</p>
          <div class="actions"><button class="btn btn-gold btn-lg" data-act="REVEAL_QUESTION">Reveal Question <kbd>Q</kbd></button>
          <button class="btn" data-act="SWAP_QUESTION">Swap question</button></div>`;
      } else if (fo.buzzed == null) {
        html += `<h2>Who buzzed in first?</h2>
          <div class="actions">${teamBtn('BUZZ', 0, `← ${tname(0)}`)}${teamBtn('BUZZ', 1, `${tname(1)} →`)}</div>`;
      } else {
        const t = fo.turn;
        const note =
          fo.attempts.length === 0
            ? 'If it is the #1 answer, they win control right away.'
            : fo.attempts.length === 1
              ? fo.attempts[0].idx != null
                ? `They need an answer ranked higher than #${fo.attempts[0].idx + 1} to win control.`
                : 'Any answer on the board wins control.'
              : 'Alternating until someone hits the board. First hit wins control.';
        html += `<h2>${esc(faceoffPlayer(s, t))} · ${tname(t)} answers</h2><p>${note}</p>`;
        if (fo.attempts.length) {
          html += `<ul class="attempts">${fo.attempts
            .map((a) => `<li>${esc(a.player)} (${tname(a.team)}): ${a.idx == null ? 'not on board' : `#${a.idx + 1} ${esc(s.question.answers[a.idx].text)}`}</li>`)
            .join('')}</ul>`;
        }
      }
      break;
    }
    case 'choice':
      html += `<h2>${tname(s.choiceTeam)} won the face-off</h2>
        <p>Do they play the round, or pass it to ${tname(other(s.choiceTeam))}?</p>
        <div class="actions"><button class="btn btn-gold btn-lg" data-act="PLAY">Play <kbd>P</kbd></button>
        <button class="btn btn-lg" data-act="PASS">Pass <kbd>O</kbd></button></div>`;
      break;
    case 'play':
      html += `<h2>${tname(s.controlTeam)} is playing</h2>
        <p>Up now: <strong>${esc(playPlayer(s))}</strong>. Strikes: ${strikesHtml(s.strikes)}</p>
        <div class="actions"><button class="btn btn-lg" data-act="START_STEAL">Start Steal now <kbd>S</kbd></button></div>
        <p class="small">The steal starts automatically on the 3rd strike. Clearing the board wins the bank.</p>`;
      break;
    case 'steal':
      html += `<h2>STEAL! ${tname(s.steal.team)} huddles</h2>
        <p>Captain <strong>${esc(stealPlayer(s))}</strong> gives one answer for the whole bank of <strong>${s.bank}</strong>.</p>
        <p class="small">On the board: the bank goes to ${tname(s.steal.team)}. Miss: it goes to ${tname(s.controlTeam)}. Press <kbd>T</kbd> to start the answer timer.</p>`;
      break;
    case 'roundEnd': {
      const r = s.roundResult;
      const last = isLastRound(s);
      const verb = r.how === 'steal' ? 'stole' : r.how === 'defend' ? 'kept' : 'won';
      html += `<h2>${r.team == null || !r.award ? 'No points this round' : `${tname(r.team)} ${verb} ${r.award} points`}</h2>
        <div class="actions"><button class="btn btn-lg" data-act="REVEAL_REMAINING" ${s.revealed.every(Boolean) ? 'disabled' : ''}>Reveal Remaining <kbd>R</kbd></button>
        <button class="btn btn-gold btn-lg" data-act="NEXT_ROUND">${last ? 'Show Winner' : 'Next Round'} <kbd>N</kbd></button></div>
        ${last ? '' : `<p class="small">Next: Round ${s.round + 2}, ${multiplierLabel(currentMultiplier({ ...s, round: s.round + 1 }))}.</p>`}`;
      break;
    }
    case 'gameOver':
      html += `<h2>${s.winner == null ? "It's a tie!" : `${tname(s.winner)} wins!`}</h2>
        <div class="final">${s.teams.map((t, i) => `<div class="tcard t${i}"><div class="name">${esc(t.name)}</div><div class="score">${t.score}</div></div>`).join('')}</div>
        <div class="actions"><button class="btn btn-gold btn-lg" id="btn-next-game">Next game · new questions</button></div>
        <p class="small">Same families and settings, scores back to zero.${nextUpHtml()}</p>
        ${resultsHtml()}
        <p class="small">Reset Game goes back to setup. Undo goes back into this game.</p>`;
      break;
    default:
      break;
  }
  el.innerHTML = html;
  renderTimer();
}

/** "Next up: ..." line for the game-over panel: the first questions of the next game. */
function nextUpHtml() {
  const all = usableQuestions(bank.questions);
  if (!all.length) return '';
  const upcoming = rotateFrom(all, getNextIndex() % all.length).slice(0, Math.min(state.settings.numRounds, all.length));
  return ` Next up: ${upcoming.map((q) => `<em>${esc(q.question)}</em>`).join(' · ')}`;
}

function renderTeams() {
  const s = state;
  const current = (t) => {
    if (s.phase === 'faceoff') return faceoffPlayer(s, t);
    if (s.phase === 'play' && s.controlTeam === t) return playPlayer(s);
    if (s.phase === 'steal' && s.steal.team === t) return stealPlayer(s);
    return null;
  };
  const ctl = s.phase === 'steal' ? s.steal.team : s.phase === 'choice' ? s.choiceTeam : s.controlTeam;
  $('teams-panel').innerHTML = `<h3>Families</h3><div class="teams">${s.teams
    .map((team, t) => {
      const cur = current(t);
      return `<div class="tcard t${t} ${ctl === t ? 'ctl' : ''}"><div class="name">${esc(team.name)}</div><div class="score">${team.score}</div>
        <ol>${team.roster.map((p, i) => `<li class="${p === cur ? 'cur' : ''}">${esc(p)}${i === 0 ? '<span class="cap">captain</span>' : ''}</li>`).join('')}</ol></div>`;
    })
    .join('')}</div>`;
}

function renderOverrides() {
  const s = state;
  [0, 1].forEach((t) => {
    $(`ovr-name${t}`).textContent = `${s.teams[t].name} score`;
    const inp = $(`ovr-score${t}`);
    if (document.activeElement !== inp) inp.value = s.teams[t].score;
  });
  if (document.activeElement !== $('ovr-bank')) $('ovr-bank').value = s.bank;
  if (document.activeElement !== $('ovr-strikes')) $('ovr-strikes').value = s.strikes;
  const live = ['faceoff', 'choice', 'play', 'steal'].includes(s.phase);
  $('ovr-award').innerHTML = live
    ? `<span class="lbl">Award bank (${s.bank}) to:</span>${[0, 1].map((t) => `<button class="btn btn-team${t}" data-act="AWARD_BANK" data-team="${t}">${tname(t)}</button>`).join('')}`
    : '';
  $('ovr-control').innerHTML = ['faceoff', 'choice'].includes(s.phase)
    ? `<span class="lbl">Give face-off win to:</span>${[0, 1].map((t) => `<button class="btn btn-team${t}" data-act="SET_CHOICE" data-team="${t}">${tname(t)}</button>`).join('')}`
    : '';
}

function renderLog() {
  const s = state;
  const how = { sweep: 'cleared the board', steal: 'stole', defend: 'kept it after a failed steal', manual: 'awarded by host' };
  $('log-panel').innerHTML = `<h3>Round history</h3>${
    s.log.length
      ? `<ol>${s.log
          .map((r) => `<li><strong>R${r.round} ×${r.mult}</strong> · ${r.team == null ? 'No points' : `${tname(r.team)} +${r.award} (${how[r.how] || r.how})`}</li>`)
          .join('')}</ol>`
      : '<p class="small muted">No rounds finished yet.</p>'
  }
  <p class="small muted">Upcoming: ${s.pool
    .slice(s.qPtr + 1, s.qPtr + 1 + Math.max(0, s.totalRounds - s.round - 1))
    .map((q) => esc(q.question))
    .join(' · ') || 'none'}</p>`;
}

/* ---------- answer timer (host side shows the clock and plays the ticks) ---------- */
let lastTickSec = null;
let firedEnd = null;
const clock = (n) => `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`;

/** Static parts of the timer card: button labels and the length box. */
function renderTimer() {
  const secs = timerSeconds(state);
  const running = !!state.timer?.end;
  $('btn-timer-start').innerHTML = `${running ? 'Restart' : 'Start'} ${secs}s timer <kbd>T</kbd>`;
  $('btn-timer-stop').disabled = !running;
  if (document.activeElement !== $('timer-seconds')) $('timer-seconds').value = secs;
  tickHostTimer();
}

function tickHostTimer() {
  const el = $('timer-readout');
  const end = state.timer?.end ?? null;
  if (!end) {
    lastTickSec = null;
    el.textContent = clock(timerSeconds(state));
    el.classList.remove('low', 'up');
    return;
  }
  const left = Math.max(0, Math.ceil((end - Date.now()) / 1000));
  el.textContent = left > 0 ? clock(left) : "Time's up!";
  el.classList.toggle('low', left <= 5);
  el.classList.toggle('up', left === 0);
  if (left !== lastTickSec) {
    if (left > 0 && left <= 5 && lastTickSec != null) play('tick');
    if (left === 0 && firedEnd !== end) {
      firedEnd = end;
      play('timeUp');
    }
    lastTickSec = left;
  }
}
setInterval(tickHostTimer, 200);

$('btn-timer-start').addEventListener('click', () => dispatch('TIMER_START'));
$('btn-timer-stop').addEventListener('click', () => dispatch('TIMER_STOP'));
$('timer-seconds').addEventListener('change', (e) => dispatch('SET_TIMER_SECONDS', { seconds: e.target.value }));

/* ---------- boot ---------- */
initSoundboard();
loadSetupDraft();
publish(state);
render();
refreshBank();
