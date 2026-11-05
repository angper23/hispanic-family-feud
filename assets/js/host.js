// Host console: owns the game state, records undo history, plays sounds,
// and publishes every change to the display window.

import {
  HISTORY_KEY,
  SETUP_KEY,
  NON_UNDOABLE,
  freshState,
  apply,
  currentMultiplier,
  multiplierLabel,
  faceoffPlayer,
  playPlayer,
  stealPlayer,
  isLastRound,
  parseMultipliers,
  other,
} from './state.js';
import { publish, readState, onHello } from './sync.js';
import { createRemote } from './remote.js?v=5';
import { initAudio, setAudio, playFx, play, setCustomSound, stopAll } from './audio.js';
import { EVENT_SLOTS, PAD_SLOTS, loadAllSounds, saveSound, removeSound } from './soundboard.js';
import { loadQuestionBank, usableQuestions, isPlayable, BANK_KEY } from './questions.js';
import { papelPicado } from './papel.js';
import { confirmDialog, toast, esc, isDialogOpen } from './ui.js';

const $ = (id) => document.getElementById(id);
const MAX_HISTORY = 120;

let state = readState() || freshState(null);
let history = loadHistory();
let bank = { questions: [], source: 'file', error: null };

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

function commit(next, { record = null } = {}) {
  if (record) {
    history.push(record);
    if (history.length > MAX_HISTORY) history.shift();
    saveHistory();
  }
  state = next;
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

/* ---------- top bar ---------- */
$('btn-display').addEventListener('click', () => {
  const w = window.open('index.html', 'hff-display', 'popup=yes,width=1280,height=720');
  if (!w) toast('The pop-up was blocked. Allow pop-ups for this site, or open index.html in a new window.');
  else {
    w.focus();
    publish(state);
  }
});
/* ---------- remote buzzer ---------- */
const remote = createRemote({
  getState: () => state,
  onBuzz: (team) => {
    // Ignore late/duplicate presses; the engine only accepts the first buzz of a face-off.
    if (state.phase === 'faceoff' && state.questionShown && state.faceoff.buzzed == null) dispatch('BUZZ', { team });
  },
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
$('remote-stop').addEventListener('click', () => remote.stop());
$('remote-copy').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(remote.url());
    toast('Link copied.');
  } catch {
    toast(remote.url());
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
const SETUP_FIELDS = ['name0', 'captain0', 'players0', 'name1', 'captain1', 'players1', 'numRounds', 'multipliers', 'stealSeconds'];

function loadSetupDraft() {
  try {
    const d = JSON.parse(localStorage.getItem(SETUP_KEY) || '{}');
    SETUP_FIELDS.forEach((f) => {
      if (d[f] != null) form.elements[f].value = d[f];
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
  let html = `<h3>Questions</h3><p class="small">Using <strong>${usable.length}</strong> question${usable.length === 1 ? '' : 's'} from ${src}.
    ${placeholder ? '<span class="tag">Placeholder sample set</span>' : ''}
    <a href="editor.html" target="_blank" rel="noopener" style="color:var(--sun)">Edit or reorder</a></p>`;
  if (skipped) html += `<p class="small warn">${skipped} selected question${skipped === 1 ? ' is' : 's are'} skipped because they need a question and at least 3 answers.</p>`;
  if (usable.length < rounds) html += `<p class="small warn">Only ${usable.length} usable questions for ${rounds} rounds. The game will end after ${usable.length}.</p>`;
  html += '<ol>';
  usable.forEach((q, i) => {
    const r = i < rounds;
    const m = mults[Math.min(i, mults.length - 1)];
    html += `<li class="${r ? '' : 'spare'}">${r ? `<strong>R${i + 1} ×${m}</strong> · ` : 'Spare · '}${esc(q.question)}</li>`;
  });
  el.innerHTML = html + '</ol>';
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const f = form.elements;
  const pool = usableQuestions(bank.questions);
  if (!pool.length) {
    toast(bank.error ? "Questions couldn't load. See the message above." : 'No usable questions. Add some in the Question Editor.');
    return;
  }
  saveSetupDraft();
  dispatch('START_GAME', {
    teams: [0, 1].map((i) => ({ name: f[`name${i}`].value, captain: f[`captain${i}`].value, players: lines(f[`players${i}`].value) })),
    settings: { numRounds: f.numRounds.value, multipliers: parseMultipliers(f.multipliers.value), stealSeconds: f.stealSeconds.value },
    pool,
  });
});

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
  else if (k === 't') dispatch('STEAL_TIMER_START');
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
  document.title = setup ? 'Host Console · Hispanic Family Feud' : `R${state.round + 1} · ${PHASE_LABEL[state.phase]} · Host`;
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
        <div class="timer-big" id="host-timer">${s.steal.timerSkipped ? 'Timer skipped' : `0:${String(s.settings.stealSeconds).padStart(2, '0')}`}</div>
        <div class="actions"><button class="btn btn-gold" data-act="STEAL_TIMER_START">${s.steal.timerEnd ? 'Restart' : 'Start'} ${s.settings.stealSeconds}s timer <kbd>T</kbd></button>
        <button class="btn" data-act="STEAL_TIMER_SKIP">Skip timer</button></div>
        <p class="small">On the board: the bank goes to ${tname(s.steal.team)}. Miss: it goes to ${tname(s.controlTeam)}.</p>`;
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
        <p class="small">Use Reset Game to start over, or Undo to go back.</p>`;
      break;
    default:
      break;
  }
  el.innerHTML = html;
  tickHostTimer();
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

/* ---------- steal timer (host side plays the ticks) ---------- */
let lastTickSec = null;
let firedEnd = null;
function tickHostTimer() {
  const el = $('host-timer');
  const end = state.phase === 'steal' ? state.steal?.timerEnd : null;
  if (!end) {
    lastTickSec = null;
    return;
  }
  const left = Math.max(0, Math.ceil((end - Date.now()) / 1000));
  if (el) {
    el.textContent = left > 0 ? `0:${String(left).padStart(2, '0')}` : "Time's up!";
    el.classList.toggle('low', left <= 5);
  }
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

/* ---------- soundboard ---------- */
const soundFiles = {}; // slot -> file name of a loaded custom sound
let sbError = null;
let pendingSlot = null;
const MAX_FILE_MB = 40;
const PAD_LABELS_KEY = 'hff:padLabels:v1';

/** True while the Soundboard panel is open: number keys then fire pads instead of picking answers. */
const padsLive = () => $('soundboard').open;

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

function firePad(slot) {
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
      <div class="row"><button class="btn" data-sb-load="${slot}">Load</button>${f ? `<button class="btn" data-sb-clear="${slot}">Clear</button>` : ''}</div>
    </div>`;
  }).join('');
  $('sb-events').innerHTML = EVENT_SLOTS.map(({ slot, label }) => {
    const f = soundFiles[slot];
    return `<div class="sb-row"><span class="lbl">${esc(label)}</span>
      <span class="file ${f ? 'custom' : ''}" title="${esc(f || '')}">${f ? esc(f) : 'Built-in'}</span>
      <span class="btns"><button class="btn" data-sb-play="${slot}">▶ Test</button>
      <button class="btn" data-sb-load="${slot}">Load</button>
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

$('sb-file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  const slot = pendingSlot;
  pendingSlot = null;
  if (!file || !slot) return;
  if (file.size > MAX_FILE_MB * 1024 * 1024) {
    toast(`That file is over ${MAX_FILE_MB} MB. Trim it or use a compressed MP3.`);
    return;
  }
  try {
    const rec = await saveSound(slot, file);
    await setCustomSound(slot, rec.data);
    soundFiles[slot] = file.name;
    renderSoundboard();
    toast(`Loaded ${file.name}.`);
  } catch (err) {
    await removeSound(slot).catch(() => {});
    toast(`Couldn't use that file: ${err.message || 'the browser could not decode it'}.`);
  }
});

async function initSoundboard() {
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

/* ---------- boot ---------- */
initSoundboard();
loadSetupDraft();
publish(state);
render();
refreshBank();
