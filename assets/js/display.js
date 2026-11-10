// Projector view. Read-only: renders whatever state the host publishes.

import {
  freshState,
  currentMultiplier,
  multiplierLabel,
  faceoffPlayer,
  playPlayer,
  stealPlayer,
  rosterAt,
  MAX_ANSWERS,
} from './state.js';
import { readState, onState, sayHello } from './sync.js';
import { papelPicado } from './papel.js';
import { createConfetti } from './confetti.js';
import { esc } from './ui.js';
import { applyBranding } from './config.js';

applyBranding('Display');

const $ = (id) => document.getElementById(id);
const stage = $('stage');
const board = $('d-board');
const confetti = createConfetti($('d-confetti'));
const X_SVG =
  '<svg viewBox="0 0 100 100" aria-hidden="true"><path d="M18 18L82 82M82 18L18 82" stroke="#fff" stroke-width="30" stroke-linecap="round"/><path d="M18 18L82 82M82 18L18 82" stroke="#e3192b" stroke-width="19" stroke-linecap="round"/></svg>';

let cur = null;
let boardKey = null;
let raining = false;
const timers = new Set();

papelPicado($('papel'), { count: 17, width: 1920, height: 118 });
$('d-strikes').innerHTML = [0, 1, 2].map(() => `<span class="sx">${X_SVG}</span>`).join('');

/* ---------- stage scaling ---------- */
function fitStage() {
  const s = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
  stage.style.transform = `translate(-50%, -50%) scale(${s})`;
}
window.addEventListener('resize', fitStage);
fitStage();

/* ---------- text fitting ---------- */
function fitOneLine(el, max, min) {
  let size = max;
  el.style.whiteSpace = 'nowrap';
  el.style.fontSize = size + 'px';
  while (el.scrollWidth > el.clientWidth + 1 && size > min) {
    size -= 2;
    el.style.fontSize = size + 'px';
  }
  return el.scrollWidth <= el.clientWidth + 1;
}
function fitBox(el, max, min) {
  let size = max;
  el.style.fontSize = size + 'px';
  while ((el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1) && size > min) {
    size -= 2;
    el.style.fontSize = size + 'px';
  }
}
function fitAnswer(el) {
  if (fitOneLine(el, 38, 28)) return;
  el.style.whiteSpace = 'normal';
  el.style.lineHeight = '1';
  let size = 30;
  el.style.fontSize = size + 'px';
  while (el.scrollHeight > 84 && size > 20) {
    size -= 2;
    el.style.fontSize = size + 'px';
  }
}
function refitAll() {
  board.querySelectorAll('.ans-text').forEach(fitAnswer);
  document.querySelectorAll('.team-name').forEach((el) => fitBox(el, 44, 20));
  fitBox($('d-qtext'), 46, 26);
  fitOneLine($('d-ribbon-text'), 38, 22);
}
document.fonts?.ready.then(refitAll);

/* ---------- number tweening ---------- */
function tween(el, to) {
  const from = Number(el.dataset.val ?? to);
  el.dataset.val = to;
  if (from === to) {
    el.textContent = to;
    return;
  }
  el.classList.remove('bump');
  void el.offsetWidth;
  el.classList.add('bump');
  const start = performance.now();
  const dur = 650;
  const step = (now) => {
    const k = Math.min(1, (now - start) / dur);
    const e = 1 - Math.pow(1 - k, 3);
    el.textContent = Math.round(from + (to - from) * e);
    if (k < 1 && Number(el.dataset.val) === to) requestAnimationFrame(step);
    else if (k >= 1) el.textContent = to;
  };
  requestAnimationFrame(step);
}

function later(ms, fn) {
  const id = setTimeout(() => {
    timers.delete(id);
    fn();
  }, ms);
  timers.add(id);
}
function cancelLater() {
  timers.forEach(clearTimeout);
  timers.clear();
}

/* ---------- board ---------- */
function buildBoard(s, animate) {
  const answers = s.question?.answers ?? [];
  let html = '';
  for (let i = 0; i < MAX_ANSWERS; i++) {
    const a = answers[i];
    const d = `style="--d:${(i % 4) * 0.07 + Math.floor(i / 4) * 0.28}s"`;
    if (!a) {
      html += `<div class="tile empty ${animate ? 'deal' : ''}" ${d}><div class="tile-inner"><div class="tile-front"></div></div></div>`;
      continue;
    }
    html += `<div class="tile ${animate ? 'deal' : ''}" data-i="${i}" ${d}>
      <div class="tile-inner">
        <div class="tile-front"><span class="num">${i + 1}</span></div>
        <div class="tile-back"><span class="ans-text">${esc(a.text)}</span><span class="ans-pts">${a.points}</span></div>
      </div></div>`;
  }
  board.innerHTML = html;
  board.querySelectorAll('.ans-text').forEach(fitAnswer);
}

function updateBoard(s, { instant, stagger }) {
  if (instant) board.classList.add('no-anim');
  board.querySelectorAll('.tile[data-i]').forEach((tile) => {
    const i = Number(tile.dataset.i);
    const on = !!s.revealed[i];
    const k = stagger ? stagger.indexOf(i) : -1;
    tile.querySelector('.tile-inner').style.transitionDelay = k >= 0 ? `${k * 0.35}s` : '';
    tile.classList.toggle('revealed', on);
    tile.classList.toggle('src-end', on && s.revealSrc[i] === 'end');
  });
  if (instant) {
    void board.offsetWidth;
    requestAnimationFrame(() => board.classList.remove('no-anim'));
  }
}

/* ---------- teams ---------- */
function teamView(s, t) {
  const team = s.teams[t];
  const v = { chip: '', chipSteal: false, role: '', who: '', active: false, dim: false };
  switch (s.phase) {
    case 'faceoff': {
      const fo = s.faceoff;
      v.role = fo.buzzed == null ? 'At the podium' : fo.turn === t ? 'Answering' : 'At the podium';
      v.who = faceoffPlayer(s, t);
      v.active = fo.buzzed != null && fo.turn === t;
      if (fo.buzzed === t && !fo.attempts.length) v.chip = 'Buzzed in!';
      break;
    }
    case 'choice':
      v.active = s.choiceTeam === t;
      v.dim = !v.active;
      if (v.active) {
        v.chip = 'Play or pass?';
        v.role = 'Won the face-off';
      }
      break;
    case 'play':
      v.active = s.controlTeam === t;
      v.dim = !v.active;
      if (v.active) {
        v.chip = 'Playing';
        v.role = 'Up now';
        v.who = playPlayer(s);
      } else {
        v.role = 'Ready to steal';
        v.who = rosterAt(team, 0);
      }
      break;
    case 'steal':
      v.active = s.steal.team === t;
      v.dim = !v.active;
      if (v.active) {
        v.chip = 'Steal!';
        v.chipSteal = true;
        v.role = 'Captain answers';
        v.who = stealPlayer(s);
      } else {
        v.role = 'Fingers crossed';
      }
      break;
    case 'roundEnd': {
      const r = s.roundResult;
      v.active = r?.team === t;
      if (v.active) {
        v.chip = `+${r.award}`;
        v.role = r.how === 'steal' ? 'Stole the round' : 'Won the round';
      }
      break;
    }
    default:
      break;
  }
  return v;
}

function renderTeams(s) {
  [0, 1].forEach((t) => {
    const el = $(`team${t}`);
    const v = teamView(s, t);
    const nameEl = el.querySelector('.team-name');
    if (nameEl.textContent !== s.teams[t].name) {
      nameEl.textContent = s.teams[t].name;
      fitBox(nameEl, 44, 20);
    }
    tween(el.querySelector('.team-score'), s.teams[t].score);
    const chip = el.querySelector('.team-chip');
    chip.textContent = v.chip;
    chip.classList.toggle('steal', v.chipSteal);
    el.querySelector('.team-player').innerHTML =
      (v.role ? `<span class="role">${esc(v.role)}</span>` : '') + (v.who ? `<span class="who">${esc(v.who)}</span>` : '');
    el.classList.toggle('is-active', v.active);
    el.classList.toggle('is-dim', v.dim);
  });
}

/* ---------- ribbon ---------- */
function ribbonView(s) {
  const name = (t) => `<b>${esc(s.teams[t].name)}</b>`;
  switch (s.phase) {
    case 'faceoff': {
      const fo = s.faceoff;
      const vs = `${esc(faceoffPlayer(s, 0))} <b>vs</b> ${esc(faceoffPlayer(s, 1))}`;
      if (!s.questionShown) return { html: `Face-off! ${vs}` };
      if (fo.buzzed == null) return { html: `Face-off · ${vs} · Hands on the buzzer!` };
      const t = fo.turn;
      return { html: `${esc(faceoffPlayer(s, t))} · ${name(t)} · your answer?`, team: t };
    }
    case 'choice':
      return { html: `${name(s.choiceTeam)} wins the face-off · Play or pass?`, team: s.choiceTeam };
    case 'play':
      return { html: `${name(s.controlTeam)} is playing · Up now: ${esc(playPlayer(s))}`, team: s.controlTeam };
    case 'steal':
      return { html: `Steal! ${name(s.steal.team)} huddle up · Captain ${esc(stealPlayer(s))} answers`, steal: true };
    case 'roundEnd': {
      const r = s.roundResult;
      if (!r || r.team == null || r.award === 0) return { html: 'No points this round' };
      const verb = r.how === 'steal' ? 'steals' : r.how === 'defend' ? 'keeps' : 'wins';
      return { html: `${name(r.team)} ${verb} ${r.award} points!`, team: r.team };
    }
    default:
      return { html: '' };
  }
}

function renderRibbon(s) {
  const v = ribbonView(s);
  const rib = $('d-ribbon');
  const txt = $('d-ribbon-text');
  rib.className = 'ribbon' + (v.steal ? ' is-steal' : v.team != null ? ` team-${v.team}` : '');
  if (txt.innerHTML !== v.html) {
    txt.innerHTML = v.html;
    fitOneLine(txt, 38, 22);
  }
  tickTimer();
}

function tickTimer() {
  const el = $('d-timer');
  const end = cur?.timer?.end ?? null;
  if (!end) {
    el.hidden = true;
    return;
  }
  const left = Math.max(0, Math.ceil((end - Date.now()) / 1000));
  el.hidden = false;
  el.textContent = left > 0 ? `0:${String(left).padStart(2, '0')}` : 'TIME!';
  el.classList.toggle('low', left <= 5);
}
setInterval(tickTimer, 200);

/* ---------- overlays ---------- */
function showStrikes(count) {
  const ov = $('d-xover');
  $('d-splash').innerHTML = ''; // a strike always wins over a leftover callout
  ov.innerHTML = Array.from({ length: count }, () => `<div class="bigx">${X_SVG}</div>`).join('');
  ov.hidden = false;
  ov.classList.remove('shake');
  void ov.offsetWidth;
  ov.classList.add('shake');
  clearTimeout(showStrikes.t);
  showStrikes.t = setTimeout(() => (ov.hidden = true), 1400);
}

function splash(big, small = '', cls = '') {
  const el = $('d-splash');
  el.innerHTML = `<div class="splash-card ${cls}"><div class="splash-big">${esc(big)}</div>${small ? `<div class="splash-small">${esc(small)}</div>` : ''}</div>`;
  const b = el.querySelector('.splash-big');
  b.style.whiteSpace = 'nowrap';
  let size = 150;
  while (b.scrollWidth > 1400 && size > 60) {
    size -= 6;
    b.style.fontSize = size + 'px';
  }
  clearTimeout(splash.t);
  splash.t = setTimeout(() => (el.innerHTML = ''), 2500);
}

function runFx(s, list) {
  for (const fx of list) {
    const ms = (fx.delay || 0) * 1000;
    const team = fx.team != null ? s.teams[fx.team]?.name : '';
    switch (fx.t) {
      case 'strike':
        later(ms, () => showStrikes(fx.count || 1));
        break;
      case 'start':
        later(ms, () => splash('¡A jugar!', `Round 1 · ${multiplierLabel(currentMultiplier(s))}`));
        break;
      case 'nextRound':
        later(ms, () => splash(`Round ${s.round + 1}`, multiplierLabel(currentMultiplier(s))));
        break;
      case 'control':
        later(ms, () => splash(fx.pass ? 'Pass!' : 'Play!', `${team} takes control`, `team-${fx.team}`));
        break;
      case 'steal':
        later(ms, () => splash('Steal!', `${team} · huddle up!`, 'steal'));
        break;
      case 'roundWin':
        later(ms, () => {
          if (!fx.award || fx.team == null) {
            splash('No points', 'Nobody banks this round');
            return;
          }
          const msg = fx.how === 'steal' ? `${team} steals it!` : fx.how === 'defend' ? `${team} keeps the bank!` : `${team} wins the round!`;
          splash(`+${fx.award}`, msg, `team-${fx.team}`);
          confetti.burst(200, { x: fx.team === 0 ? 0.2 : 0.8, y: 0.45 });
        });
        break;
      case 'undo':
      case 'reset':
        cancelLater();
        $('d-xover').hidden = true;
        $('d-splash').innerHTML = '';
        break;
      default:
        break;
    }
  }
}

/* ---------- winner ---------- */
function renderWinner(s) {
  const on = s.phase === 'gameOver';
  $('d-winner').hidden = !on;
  if (on) {
    const tie = s.winner == null;
    $('d-ws-name').textContent = tie ? "It's a tie!" : s.teams[s.winner].name;
    $('d-ws-wins').textContent = tie ? '¡Qué partido!' : 'Wins!';
    $('d-ws-scores').innerHTML = s.teams
      .map((t, i) => `<div class="ws-team t${i} ${s.winner === i ? 'win' : ''}"><div class="n">${esc(t.name)}</div><div class="s">${t.score}</div></div>`)
      .join('');
    const n = $('d-ws-name');
    n.style.fontSize = '';
    fitOneLine(n, 150, 60);
  }
  if (on && !raining) {
    confetti.rain(true);
    confetti.burst(260, { x: 0.5, y: 0.5 });
  } else if (!on && raining) {
    confetti.clear();
  }
  raining = on;
}

/* ---------- main render ---------- */
function render(s, { fx = [], initial = false } = {}) {
  const prev = cur;
  cur = s;
  const m = currentMultiplier(s);

  $('d-ad').hidden = !s.ad;
  $('d-titlescreen').hidden = s.phase !== 'setup';
  $('d-round').textContent = s.phase === 'setup' ? '–' : s.round + 1;
  $('d-round-of').textContent = s.totalRounds ? `of ${s.totalRounds}` : '';
  $('d-mult').textContent = `×${m}`;
  $('d-mult-lbl').textContent = multiplierLabel(m);
  document.querySelector('.d-mult').classList.toggle('hot', m > 1 && s.phase !== 'setup');

  // Question
  const qBox = $('d-question');
  const qText = $('d-qtext');
  const showQ = s.question && s.questionShown;
  const qHtml = showQ ? esc(s.question.question) : s.phase === 'setup' ? '' : 'Get ready for the face-off!';
  qBox.classList.toggle('is-hidden', !showQ);
  $('d-qkicker').style.visibility = showQ ? 'visible' : 'hidden';
  if (qText.innerHTML !== qHtml) {
    qText.innerHTML = qHtml;
    fitBox(qText, 46, 26);
    if (showQ && !initial) {
      qBox.classList.remove('pop');
      void qBox.offsetWidth;
      qBox.classList.add('pop');
    }
  }

  // Board
  const key = s.question ? `${s.qPtr}:${s.question.id}:${s.round}` : 'none';
  const rebuilt = key !== boardKey;
  if (rebuilt) {
    boardKey = key;
    buildBoard(s, !initial);
  }
  const rest = fx.find((f) => f.t === 'revealRest');
  updateBoard(s, { instant: initial || rebuilt, stagger: rest?.idxs });

  tween($('d-bank'), s.bank);
  document.querySelectorAll('#d-strikes .sx').forEach((el, i) => el.classList.toggle('on', i < s.strikes));

  renderTeams(s);
  renderRibbon(s);
  renderWinner(s);
  if (!initial) runFx(s, fx);
  if (prev && prev.phase !== s.phase && s.phase === 'setup') confetti.clear();
}

/* ---------- wiring ---------- */
render(readState() || freshState(null), { initial: true });

onState((s) => {
  if (!s || (cur && s.rev === cur.rev)) return;
  const fresh = s.fx && s.fx.rev === s.rev;
  render(s, { fx: fresh ? s.fx.list : [] });
});
sayHello();

// Full screen on double-click or F. These are viewing aids, not game controls.
function toggleFullscreen() {
  const d = document;
  if (d.fullscreenElement || d.webkitFullscreenElement) (d.exitFullscreen || d.webkitExitFullscreen).call(d);
  else {
    const el = d.documentElement;
    (el.requestFullscreen || el.webkitRequestFullscreen)?.call(el);
  }
}
document.addEventListener('dblclick', toggleFullscreen);
document.addEventListener('keydown', (e) => {
  if (e.key === 'f' || e.key === 'F') toggleFullscreen();
});
setTimeout(() => $('fs-hint').classList.add('gone'), 6000);

// Hide the cursor when idle so it doesn't sit on the projected board.
let idle;
document.addEventListener('mousemove', () => {
  document.body.classList.remove('hide-cursor');
  clearTimeout(idle);
  idle = setTimeout(() => document.body.classList.add('hide-cursor'), 2500);
});
