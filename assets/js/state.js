// Game engine: plain state object plus a pure reducer.
// No DOM access here, so the rules can be tested in Node.

export const STATE_KEY = 'hff:state:v1';
export const HISTORY_KEY = 'hff:history:v1';
export const SETUP_KEY = 'hff:setup:v1';
export const MAX_ANSWERS = 8;

export const DEFAULT_SETTINGS = Object.freeze({
  numRounds: 4,
  multipliers: Object.freeze([1, 2, 3, 3]),
  stealSeconds: 20,
  volume: 0.7,
  muted: false,
});

export const defaultTeamName = (i) => (i === 0 ? 'Family A' : 'Family B');
export const other = (t) => (t === 0 ? 1 : 0);

/** A brand-new game in the setup phase. Keeps audio settings and bumps rev from `prev`. */
export function freshState(prev = null) {
  const settings = { ...DEFAULT_SETTINGS, multipliers: [...DEFAULT_SETTINGS.multipliers] };
  if (prev?.settings) {
    settings.volume = prev.settings.volume;
    settings.muted = prev.settings.muted;
  }
  const rev = (prev?.rev ?? 0) + 1;
  return {
    v: 1,
    rev,
    phase: 'setup',
    settings,
    teams: [0, 1].map((i) => ({ name: defaultTeamName(i), captain: '', players: [], roster: [], score: 0 })),
    pool: [],
    qPtr: 0,
    round: 0,
    totalRounds: 0,
    question: null,
    revealed: [],
    revealSrc: [],
    bank: 0,
    strikes: 0,
    questionShown: false,
    faceoff: null,
    choiceTeam: null,
    controlTeam: null,
    playIdx: 0,
    steal: null,
    roundResult: null,
    log: [],
    winner: null,
    fx: { rev, list: [{ t: 'reset' }] },
  };
}

/* ---------- read helpers used by both views ---------- */

export function multiplierFor(settings, round) {
  const m = settings?.multipliers?.length ? settings.multipliers : DEFAULT_SETTINGS.multipliers;
  return m[Math.min(Math.max(round, 0), m.length - 1)];
}
export const currentMultiplier = (s) => multiplierFor(s.settings, s.round);

export function multiplierLabel(m) {
  return { 1: 'Single points', 2: 'Double points', 3: 'Triple points', 4: 'Quadruple points' }[m] || `×${m} points`;
}

export function rosterAt(team, i) {
  const r = team.roster?.length ? team.roster : ['Captain'];
  return r[((i % r.length) + r.length) % r.length];
}

/** The next face-off guesser for team t (the podium player before anyone has guessed). */
export const faceoffPlayer = (s, t) => rosterAt(s.teams[t], s.round + (s.faceoff?.count?.[t] ?? 0));
export const playPlayer = (s) => (s.controlTeam == null ? '' : rosterAt(s.teams[s.controlTeam], s.playIdx));
export const stealPlayer = (s) => (s.steal ? rosterAt(s.teams[s.steal.team], 0) : '');
export const allRevealed = (s) => s.revealed.length > 0 && s.revealed.every(Boolean);
export const isLastRound = (s) => s.round + 1 >= s.totalRounds || s.qPtr + 1 >= s.pool.length;

export function parseMultipliers(text) {
  const list = String(text ?? '')
    .split(/[\s,;]+/)
    .map((x) => Number(x.replace(/^x/i, '')))
    .filter((n) => Number.isFinite(n) && n >= 1)
    .map((n) => Math.round(n));
  return list.length ? list : [...DEFAULT_SETTINGS.multipliers];
}

export function buildRoster(captain, players) {
  const list = [];
  const seen = new Set();
  for (const raw of [captain, ...players]) {
    const name = String(raw ?? '').trim();
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    list.push(name);
  }
  return list.length ? list : ['Captain'];
}

export function normalizeQuestion(q) {
  return {
    id: String(q.id ?? ''),
    question: String(q.question ?? '').trim(),
    answers: (q.answers || [])
      .map((a) => ({ text: String(a.text ?? '').trim(), points: Math.max(0, Math.round(Number(a.points) || 0)) }))
      .filter((a) => a.text)
      .sort((a, b) => b.points - a.points)
      .slice(0, MAX_ANSWERS),
  };
}

function clampInt(v, lo, hi, fallback) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
}

/* ---------- internal mutations (operate on a cloned state) ---------- */

function setupRound(s) {
  s.question = s.pool[s.qPtr];
  const n = s.question.answers.length;
  s.revealed = Array(n).fill(false);
  s.revealSrc = Array(n).fill(null);
  s.bank = 0;
  s.strikes = 0;
  s.questionShown = false;
  s.faceoff = { buzzed: null, turn: null, attempts: [], count: [0, 0], winner: null };
  s.choiceTeam = null;
  s.controlTeam = null;
  s.playIdx = 0;
  s.steal = null;
  s.roundResult = null;
  s.phase = 'faceoff';
}

function reveal(s, idx, src, scored) {
  s.revealed[idx] = true;
  s.revealSrc[idx] = src;
  if (scored) s.bank += s.question.answers[idx].points * currentMultiplier(s);
}

function checkIdx(s, idx) {
  const n = s.question.answers.length;
  if (!Number.isInteger(idx) || idx < 0 || idx >= n) return `This question only has ${n} answers.`;
  if (s.revealed[idx]) return `Answer ${idx + 1} is already showing.`;
  return null;
}

function endRound(s, team, how, fx, delay = 0) {
  const award = s.bank;
  if (team != null) s.teams[team].score += award;
  s.roundResult = { team, award, how };
  s.log.push({ round: s.round + 1, question: s.question.question, team, award, how, mult: currentMultiplier(s) });
  s.bank = 0;
  if (s.steal) s.steal.timerEnd = null;
  s.phase = 'roundEnd';
  fx.push({ t: 'roundWin', team, award, how, delay });
}

function enterSteal(s, fx, delay) {
  s.phase = 'steal';
  s.steal = { team: other(s.controlTeam), timerEnd: null, timerSkipped: false, result: null };
  fx.push({ t: 'steal', team: s.steal.team, delay });
}

function finishGame(s, fx) {
  s.phase = 'gameOver';
  s.bank = 0;
  const [a, b] = s.teams.map((t) => t.score);
  s.winner = a === b ? null : a > b ? 0 : 1;
  fx.push({ t: 'gameWin', team: s.winner, delay: 0.2 });
}

function choose(s, pass, fx) {
  if (s.phase !== 'choice') {
    return s.phase === 'faceoff' ? 'Finish the face-off first.' : 'Play or Pass only happens right after the face-off.';
  }
  const team = pass ? other(s.choiceTeam) : s.choiceTeam;
  s.controlTeam = team;
  s.playIdx = s.round + s.faceoff.count[team];
  s.phase = 'play';
  fx.push({ t: 'control', team, pass });
  if (allRevealed(s)) endRound(s, team, 'sweep', fx, 0.4);
  return null;
}

const LIVE = ['faceoff', 'choice', 'play', 'steal'];
const isTeam = (t) => t === 0 || t === 1;

/* ---------- action handlers: return an error string or nothing ---------- */

const handlers = {
  START_GAME(s, p, fx) {
    const pool = (p.pool || []).map(normalizeQuestion).filter((q) => q.question && q.answers.length);
    if (!pool.length) return 'There are no usable questions. Add some in the Question Editor.';
    const st = p.settings || {};
    s.settings.numRounds = clampInt(st.numRounds, 1, 50, DEFAULT_SETTINGS.numRounds);
    s.settings.multipliers =
      Array.isArray(st.multipliers) && st.multipliers.length
        ? st.multipliers.map((m) => clampInt(m, 1, 99, 1))
        : [...DEFAULT_SETTINGS.multipliers];
    s.settings.stealSeconds = clampInt(st.stealSeconds, 3, 300, DEFAULT_SETTINGS.stealSeconds);
    s.teams = [0, 1].map((i) => {
      const t = p.teams?.[i] ?? {};
      const name = String(t.name ?? '').trim() || defaultTeamName(i);
      const captain = String(t.captain ?? '').trim();
      const players = (t.players || []).map((x) => String(x).trim()).filter(Boolean);
      return { name, captain, players, roster: buildRoster(captain, players), score: 0 };
    });
    s.pool = pool;
    s.qPtr = 0;
    s.round = 0;
    s.totalRounds = Math.min(s.settings.numRounds, pool.length);
    s.log = [];
    s.winner = null;
    setupRound(s);
    fx.push({ t: 'start' });
  },

  REVEAL_QUESTION(s, p, fx) {
    if (s.phase !== 'faceoff' || s.questionShown) return 'The question is already showing.';
    s.questionShown = true;
    fx.push({ t: 'question' });
  },

  SWAP_QUESTION(s, p, fx) {
    if (s.phase !== 'faceoff') return 'You can only swap the question before the face-off starts.';
    if (s.faceoff.attempts.length || s.revealed.some(Boolean)) {
      return 'Answers were already given for this question. Use Undo instead.';
    }
    if (s.qPtr + 1 >= s.pool.length) return 'No spare questions left. Add more in the Question Editor.';
    s.qPtr += 1;
    setupRound(s);
    fx.push({ t: 'swap' });
  },

  BUZZ(s, { team }, fx) {
    if (s.phase !== 'faceoff') return 'Buzzing in only happens during the face-off.';
    if (!s.questionShown) return 'Reveal the question first (Q).';
    if (s.faceoff.attempts.length) return 'The face-off is under way. Use Undo to change who buzzed first.';
    if (!isTeam(team)) return 'Pick a family.';
    s.faceoff.buzzed = team;
    s.faceoff.turn = team;
    fx.push({ t: 'buzz', team });
  },

  FACEOFF_ANSWER(s, { idx }, fx) {
    if (s.phase !== 'faceoff') return 'The face-off is over.';
    if (!s.questionShown) return 'Reveal the question first (Q).';
    const fo = s.faceoff;
    if (fo.buzzed == null) return 'Mark which family buzzed in first (← or →).';
    const hit = idx != null;
    if (hit) {
      const e = checkIdx(s, idx);
      if (e) return e;
    }
    const t = fo.turn;
    fo.attempts.push({ team: t, idx: hit ? idx : null, player: faceoffPlayer(s, t) });
    fo.count[t] += 1;
    if (hit) {
      reveal(s, idx, 'faceoff', true);
      fx.push({ t: 'ding', idx });
    } else {
      fx.push({ t: 'strike', count: 1, faceoff: true });
    }

    const n = fo.attempts.length;
    let winner = null;
    if (n === 1) {
      if (hit && idx === 0) winner = t; // #1 answer: instant control
    } else if (n === 2) {
      const first = fo.attempts[0];
      if (first.idx != null) winner = hit && idx < first.idx ? t : first.team;
      else if (hit) winner = t;
    } else if (hit) {
      winner = t; // alternating after two misses: first hit wins
    }

    if (winner == null) {
      fo.turn = other(t);
      return;
    }
    fo.winner = winner;
    s.choiceTeam = winner;
    s.phase = 'choice';
    fx.push({ t: 'faceoffWin', team: winner, delay: 0.6 });
  },

  SET_CHOICE(s, { team }, fx) {
    if (!['faceoff', 'choice'].includes(s.phase)) return 'Face-off control can only be set before play starts.';
    if (!isTeam(team)) return 'Pick a family.';
    s.questionShown = true;
    s.faceoff.winner = team;
    s.choiceTeam = team;
    s.phase = 'choice';
    fx.push({ t: 'faceoffWin', team });
  },

  PLAY(s, p, fx) {
    return choose(s, false, fx);
  },
  PASS(s, p, fx) {
    return choose(s, true, fx);
  },

  REVEAL(s, { idx }, fx) {
    if (s.phase !== 'play') return 'Answers are revealed this way only while a family is playing the round.';
    const e = checkIdx(s, idx);
    if (e) return e;
    reveal(s, idx, 'play', true);
    fx.push({ t: 'ding', idx });
    s.playIdx += 1;
    if (allRevealed(s)) endRound(s, s.controlTeam, 'sweep', fx, 0.9);
  },

  STRIKE(s, p, fx) {
    if (s.phase !== 'play') return 'Strikes only count while a family is playing the round.';
    if (s.strikes >= 3) return 'Already at 3 strikes.';
    s.strikes += 1;
    fx.push({ t: 'strike', count: s.strikes });
    s.playIdx += 1;
    if (s.strikes >= 3) enterSteal(s, fx, 1.3);
  },

  START_STEAL(s, p, fx) {
    if (s.phase === 'steal') return 'The steal is already on.';
    if (s.phase !== 'play') return 'A steal can only start while a family is playing the round.';
    s.strikes = 3;
    enterSteal(s, fx, 0);
  },

  STEAL_TIMER_START(s, p, fx) {
    if (s.phase !== 'steal') return 'The huddle timer is only for the steal.';
    s.steal.timerEnd = Date.now() + s.settings.stealSeconds * 1000;
    s.steal.timerSkipped = false;
    fx.push({ t: 'timerStart' });
  },

  STEAL_TIMER_SKIP(s) {
    if (s.phase !== 'steal') return 'The huddle timer is only for the steal.';
    s.steal.timerEnd = null;
    s.steal.timerSkipped = true;
  },

  STEAL_ANSWER(s, { idx }, fx) {
    if (s.phase !== 'steal') return 'There is no steal in progress.';
    if (idx != null) {
      const e = checkIdx(s, idx);
      if (e) return e;
      reveal(s, idx, 'steal', true);
      fx.push({ t: 'ding', idx });
      s.steal.result = 'success';
      endRound(s, s.steal.team, 'steal', fx, 0.9);
    } else {
      fx.push({ t: 'strike', count: 1, steal: true });
      s.steal.result = 'fail';
      endRound(s, s.controlTeam, 'defend', fx, 1.3);
    }
  },

  REVEAL_REMAINING(s, p, fx) {
    if (s.phase !== 'roundEnd') return 'Reveal the remaining answers after the round ends.';
    const idxs = s.revealed.map((r, i) => (r ? -1 : i)).filter((i) => i >= 0);
    if (!idxs.length) return 'Every answer is already showing.';
    idxs.forEach((i) => reveal(s, i, 'end', false));
    fx.push({ t: 'revealRest', idxs });
  },

  REVEAL_ONE(s, { idx }, fx) {
    if (s.phase !== 'roundEnd') return 'The round is still going.';
    const e = checkIdx(s, idx);
    if (e) return e;
    reveal(s, idx, 'end', false);
    fx.push({ t: 'revealRest', idxs: [idx] });
  },

  NEXT_ROUND(s, p, fx) {
    if (s.phase !== 'roundEnd') return s.phase === 'gameOver' ? 'The game is over.' : 'Finish this round first.';
    if (isLastRound(s)) {
      finishGame(s, fx);
      return;
    }
    s.round += 1;
    s.qPtr += 1;
    setupRound(s);
    fx.push({ t: 'nextRound' });
  },

  END_GAME(s, p, fx) {
    if (s.phase === 'setup' || s.phase === 'gameOver') return 'There is no game in progress.';
    finishGame(s, fx);
  },

  SET_SCORE(s, { team, value }, fx) {
    if (s.phase === 'setup') return 'Start a game first.';
    if (!isTeam(team)) return 'Pick a family.';
    const n = Math.round(Number(value));
    if (!Number.isFinite(n) || value === '' || value == null) return 'Enter a whole number.';
    s.teams[team].score = n;
    fx.push({ t: 'adjust' });
  },

  SET_BANK(s, { value }, fx) {
    if (!LIVE.includes(s.phase)) return 'There is no live bank right now.';
    const n = Math.round(Number(value));
    if (!Number.isFinite(n) || n < 0 || value === '' || value == null) return 'Enter a whole number, 0 or more.';
    s.bank = n;
    fx.push({ t: 'adjust' });
  },

  SET_STRIKES(s, { value }, fx) {
    if (!LIVE.includes(s.phase)) return 'Strikes can only be changed during a round.';
    const n = Math.round(Number(value));
    if (!Number.isFinite(n) || n < 0 || n > 3) return 'Strikes must be 0 to 3.';
    s.strikes = n;
    fx.push({ t: 'adjust' });
  },

  AWARD_BANK(s, { team }, fx) {
    if (!LIVE.includes(s.phase)) return 'There is no live bank to award.';
    if (!isTeam(team)) return 'Pick a family.';
    endRound(s, team, 'manual', fx);
  },

  SET_AUDIO(s, { volume, muted }) {
    if (volume != null) s.settings.volume = Math.min(1, Math.max(0, Number(volume)));
    if (muted != null) s.settings.muted = !!muted;
  },
};

/** Not recorded in the undo history. */
export const NON_UNDOABLE = new Set(['SET_AUDIO']);

/**
 * Applies an action. Returns { state } on success or { error } with a host-facing message.
 * The returned state carries fx: { rev, list } describing sounds and animations to play.
 */
export function apply(prev, action) {
  const h = handlers[action.type];
  if (!h) return { error: `Unknown action: ${action.type}` };
  const s = structuredClone(prev);
  const fx = [];
  const err = h(s, action.payload ?? {}, fx);
  if (typeof err === 'string') return { error: err };
  s.rev = prev.rev + 1;
  s.fx = { rev: s.rev, list: fx };
  return { state: s };
}
