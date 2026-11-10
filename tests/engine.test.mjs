// Rules tests for the game engine. Run with: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  freshState,
  apply,
  faceoffPlayer,
  playPlayer,
  stealPlayer,
  multiplierFor,
  timerSeconds,
  questionsUsed,
  nextQuestionIndex,
} from '../assets/js/state.js';
import { resultFor, describeResult } from '../assets/js/results.js';
import { parseQuestionFile, usableQuestions, questionIssues, rotateFrom } from '../assets/js/questions.js';

const file = JSON.parse(fs.readFileSync(new URL('../questions.json', import.meta.url)));
const pool = usableQuestions(parseQuestionFile(file));

function run(s, ...actions) {
  for (const [type, payload] of actions) {
    const r = apply(s, { type, payload });
    if (r.error) throw new Error(`${type}: ${r.error}`);
    s = r.state;
  }
  return s;
}
const start = (opts = {}) =>
  run(freshState(), [
    'START_GAME',
    {
      teams: [
        { name: 'García', captain: 'Ana', players: ['Beto', 'Carla'] },
        { name: 'López', captain: 'Diego', players: ['Eva'] },
      ],
      settings: { numRounds: 4, multipliers: [1, 2, 3, 3], timerSeconds: 20, ...opts },
      pool,
    },
  ]);
const toFaceoff = (s, team = 0) => run(s, ['REVEAL_QUESTION'], ['BUZZ', { team }]);

test('seed questions are valid placeholder data', () => {
  assert.equal(pool.length, 8);
  for (const q of parseQuestionFile(file)) {
    assert.deepEqual(questionIssues(q), [], q.question);
    assert.ok(q.placeholder);
    assert.ok(q.answers.length >= 3 && q.answers.length <= 8);
  }
});

test('multipliers: x1, x2, x3, then x3 repeats', () => {
  const st = { multipliers: [1, 2, 3, 3] };
  assert.deepEqual([0, 1, 2, 3, 4, 7].map((r) => multiplierFor(st, r)), [1, 2, 3, 3, 3, 3]);
});

test('captains face off in round 1', () => {
  const s = start();
  assert.equal(faceoffPlayer(s, 0), 'Ana');
  assert.equal(faceoffPlayer(s, 1), 'Diego');
});

test('#1 answer on first buzz wins control immediately', () => {
  let s = toFaceoff(start(), 1);
  s = run(s, ['FACEOFF_ANSWER', { idx: 0 }]);
  assert.equal(s.phase, 'choice');
  assert.equal(s.choiceTeam, 1);
  assert.equal(s.bank, pool[0].answers[0].points);
});

test('not #1: other player guesses; higher rank wins', () => {
  let s = toFaceoff(start(), 0);
  s = run(s, ['FACEOFF_ANSWER', { idx: 2 }]);
  assert.equal(s.phase, 'faceoff');
  assert.equal(s.faceoff.turn, 1);
  s = run(s, ['FACEOFF_ANSWER', { idx: 1 }]);
  assert.equal(s.choiceTeam, 1);
  assert.equal(s.bank, pool[0].answers[2].points + pool[0].answers[1].points);
});

test('not #1: other player ranks lower or misses, first family wins', () => {
  let s = run(toFaceoff(start(), 0), ['FACEOFF_ANSWER', { idx: 1 }], ['FACEOFF_ANSWER', { idx: 3 }]);
  assert.equal(s.choiceTeam, 0);
  s = run(toFaceoff(start(), 0), ['FACEOFF_ANSWER', { idx: 1 }], ['FACEOFF_ANSWER', { idx: null }]);
  assert.equal(s.choiceTeam, 0);
});

test('both miss: alternate through members, first hit wins', () => {
  let s = run(toFaceoff(start(), 0), ['FACEOFF_ANSWER', { idx: null }], ['FACEOFF_ANSWER', { idx: null }]);
  assert.equal(s.faceoff.turn, 0);
  assert.equal(faceoffPlayer(s, 0), 'Beto');
  s = run(s, ['FACEOFF_ANSWER', { idx: null }]);
  assert.equal(faceoffPlayer(s, 1), 'Eva');
  s = run(s, ['FACEOFF_ANSWER', { idx: 4 }]);
  assert.equal(s.choiceTeam, 1);
});

test('play, three strikes, steal succeeds with whole bank', () => {
  let s = run(toFaceoff(start(), 0), ['FACEOFF_ANSWER', { idx: 0 }], ['PLAY']);
  assert.equal(s.controlTeam, 0);
  assert.equal(playPlayer(s), 'Beto'); // next after the face-off player
  s = run(s, ['REVEAL', { idx: 1 }], ['STRIKE'], ['STRIKE'], ['STRIKE']);
  assert.equal(s.phase, 'steal');
  assert.equal(s.steal.team, 1);
  assert.equal(stealPlayer(s), 'Diego');
  const bank = s.bank;
  s = run(s, ['STEAL_ANSWER', { idx: 3 }]);
  assert.equal(s.phase, 'roundEnd');
  assert.equal(s.teams[1].score, bank + pool[0].answers[3].points);
  assert.equal(s.teams[0].score, 0);
});

test('failed steal awards bank to the playing family', () => {
  let s = run(toFaceoff(start(), 0), ['FACEOFF_ANSWER', { idx: 0 }], ['PASS']);
  assert.equal(s.controlTeam, 1);
  s = run(s, ['REVEAL', { idx: 1 }], ['START_STEAL'], ['STEAL_ANSWER', { idx: null }]);
  const expected = pool[0].answers[0].points + pool[0].answers[1].points;
  assert.equal(s.teams[1].score, expected);
  assert.equal(s.roundResult.how, 'defend');
});

test('clearing the board wins the bank; reveal remaining gives no points', () => {
  let s = run(toFaceoff(start(), 0), ['FACEOFF_ANSWER', { idx: 0 }], ['PLAY']);
  const n = pool[0].answers.length;
  for (let i = 1; i < n; i++) s = run(s, ['REVEAL', { idx: i }]);
  assert.equal(s.phase, 'roundEnd');
  assert.equal(s.teams[0].score, pool[0].answers.reduce((a, b) => a + b.points, 0));

  let t = run(toFaceoff(start(), 0), ['FACEOFF_ANSWER', { idx: 0 }], ['PLAY'], ['START_STEAL'], ['STEAL_ANSWER', { idx: null }]);
  const before = t.teams[0].score;
  t = run(t, ['REVEAL_REMAINING']);
  assert.ok(t.revealed.every(Boolean));
  assert.equal(t.teams[0].score, before);
});

test('round 2 doubles points and rotates face-off players', () => {
  let s = run(toFaceoff(start(), 0), ['FACEOFF_ANSWER', { idx: 0 }], ['PLAY'], ['START_STEAL'], ['STEAL_ANSWER', { idx: null }], ['NEXT_ROUND']);
  assert.equal(s.round, 1);
  assert.equal(faceoffPlayer(s, 0), 'Beto');
  assert.equal(faceoffPlayer(s, 1), 'Eva');
  s = run(s, ['REVEAL_QUESTION'], ['BUZZ', { team: 0 }], ['FACEOFF_ANSWER', { idx: 0 }]);
  assert.equal(s.bank, pool[1].answers[0].points * 2);
});

test('game ends after the last round with a winner', () => {
  let s = start({ numRounds: 1 });
  s = run(toFaceoff(s, 0), ['FACEOFF_ANSWER', { idx: 0 }], ['PLAY'], ['START_STEAL'], ['STEAL_ANSWER', { idx: null }], ['NEXT_ROUND']);
  assert.equal(s.phase, 'gameOver');
  assert.equal(s.winner, 0);
});

test('invalid actions return errors and leave state alone', () => {
  const s = start();
  assert.ok(apply(s, { type: 'STRIKE' }).error);
  assert.ok(apply(s, { type: 'BUZZ', payload: { team: 0 } }).error); // question hidden
  const f = toFaceoff(s, 0);
  assert.ok(apply(f, { type: 'FACEOFF_ANSWER', payload: { idx: 7 } }).error); // only 6 answers
});

test('swap question uses a spare before answers are given', () => {
  const s = run(start(), ['SWAP_QUESTION']);
  assert.equal(s.question.id, pool[1].id);
  assert.equal(s.round, 0);
});

test('answer timer: starts any time in a game, uses the set length, and a game move stops it', () => {
  assert.ok(apply(freshState(), { type: 'TIMER_START' }).error); // not before the game starts
  let s = start({ timerSeconds: 30 });
  assert.equal(s.settings.timerSeconds, 30);
  const t0 = Date.now();
  s = run(s, ['REVEAL_QUESTION'], ['TIMER_START']);
  assert.ok(s.timer.end >= t0 + 29_000 && s.timer.end <= Date.now() + 30_000);
  s = run(s, ['TIMER_START']); // restart is fine
  assert.ok(s.timer.end);
  s = run(s, ['BUZZ', { team: 0 }]); // any game move ends the turn
  assert.equal(s.timer.end, null);
});

test('answer timer: stop, change length, and audio changes leave it alone', () => {
  let s = run(start(), ['REVEAL_QUESTION'], ['TIMER_START']);
  s = run(s, ['SET_AUDIO', { volume: 0.5 }], ['SET_TIMER_SECONDS', { seconds: 45 }]);
  assert.ok(s.timer.end, 'still running');
  assert.equal(s.settings.timerSeconds, 45);
  s = run(s, ['TIMER_STOP']);
  assert.equal(s.timer.end, null);
  s = run(s, ['SET_TIMER_SECONDS', { seconds: 9999 }]);
  assert.equal(s.settings.timerSeconds, 300); // clamped
});

test('answer timer: starts in any phase, and old saved settings (stealSeconds) are still read', () => {
  const s = run(start(), ['TIMER_START']);
  assert.ok(s.timer.end);
  const old = { ...s, settings: { ...s.settings, timerSeconds: undefined, stealSeconds: 25 } };
  assert.equal(timerSeconds(old), 25);
});

test('rotateFrom carries on down a list and wraps to the top', () => {
  assert.deepEqual(rotateFrom([1, 2, 3, 4, 5], 0), [1, 2, 3, 4, 5]);
  assert.deepEqual(rotateFrom([1, 2, 3, 4, 5], 3), [4, 5, 1, 2, 3]);
  assert.deepEqual(rotateFrom([1, 2, 3, 4, 5], 8), [4, 5, 1, 2, 3]); // past the end wraps
  assert.deepEqual(rotateFrom([], 2), []);
});

test('next game starts after the questions this game used', () => {
  const begin = (qBase, numRounds = 3) =>
    run(freshState(), [
      'START_GAME',
      {
        teams: [
          { name: 'García', captain: 'Ana', players: ['Beto'] },
          { name: 'López', captain: 'Diego', players: ['Eva'] },
        ],
        settings: { numRounds, multipliers: [1, 2, 3], timerSeconds: 20 },
        pool: rotateFrom(pool, qBase),
        qBase,
      },
    ]);
  let s = begin(0);
  assert.equal(questionsUsed(s), 0); // nothing used until the question is shown
  assert.equal(nextQuestionIndex(s), 0);
  s = run(s, ['REVEAL_QUESTION']);
  assert.equal(nextQuestionIndex(s), 1);
  s = run(s, ['END_GAME']); // a finished game counts the question it ended on
  assert.equal(nextQuestionIndex(s), 1);

  // a swapped-away question is skipped, not replayed in the next game
  s = run(begin(0), ['SWAP_QUESTION'], ['REVEAL_QUESTION']);
  assert.equal(nextQuestionIndex(s), 2);

  // second game begins where the first stopped, and its own use is added on top
  s = run(begin(3), ['REVEAL_QUESTION']);
  assert.equal(s.question.question, pool[3].question);
  assert.equal(nextQuestionIndex(s), 4);

  // near the end of the list it wraps back to the first question
  s = run(begin(pool.length - 1), ['REVEAL_QUESTION']);
  assert.equal(s.question.question, pool[pool.length - 1].question);
  assert.equal(nextQuestionIndex(s), 0);
});

test('record of finished games: winner, scores, and ties', () => {
  let s = run(start(), ['REVEAL_QUESTION'], ['SET_SCORE', { team: 0, value: 245 }], ['SET_SCORE', { team: 1, value: 180 }], ['END_GAME']);
  s = { ...s, gameId: 'g1' };
  const r = resultFor(s);
  assert.equal(r.id, 'g1');
  assert.equal(describeResult(r), 'García 245 – 180 López · García won');
  assert.equal(describeResult({ ...r, winner: null }), 'García 245 – 180 López · Tie');
});

test('START_GAME stores the game id and keeps new names for the next game', () => {
  const s = run(start(), ['END_GAME']);
  const next = run(s, [
    'START_GAME',
    {
      teams: [{ name: 'Rivera', captain: 'Luz', players: ['Mo'] }, { name: 'Soto', captain: 'Cruz', players: [] }],
      settings: { numRounds: 3, multipliers: [1, 2, 3], timerSeconds: 20 },
      pool,
      gameId: 'game-2',
    },
  ]);
  assert.equal(next.gameId, 'game-2');
  assert.deepEqual(next.teams.map((t) => t.name), ['Rivera', 'Soto']);
  assert.deepEqual(next.teams.map((t) => t.score), [0, 0]);
  assert.equal(next.phase, 'faceoff');
});

test('sponsor ad: only between games, ends when a game starts', () => {
  let s = freshState();
  s = apply(s, { type: 'AD_SHOW' }).state;
  assert.equal(s.ad, true);
  s = apply(s, { type: 'AD_HIDE' }).state;
  assert.equal(s.ad, false);
  s = apply(s, { type: 'AD_SHOW' }).state;
  const started = apply(s, { type: 'START_GAME', payload: {} });
  if (started.state) assert.equal(started.state.ad, false);
});
