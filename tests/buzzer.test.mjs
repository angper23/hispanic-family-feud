// Tests for the remote-buzzer status that the host sends to the buzzer page.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { freshState, apply, buzzArmed, buzzStatus } from '../assets/js/state.js';
import { parseQuestionFile, usableQuestions } from '../assets/js/questions.js';

const pool = usableQuestions(parseQuestionFile(JSON.parse(fs.readFileSync(new URL('../questions.json', import.meta.url)))));
const run = (s, ...actions) => {
  for (const [type, payload] of actions) {
    const r = apply(s, { type, payload });
    if (r.error) throw new Error(`${type}: ${r.error}`);
    s = r.state;
  }
  return s;
};
const started = () =>
  run(freshState(), [
    'START_GAME',
    {
      teams: [
        { name: 'García', captain: 'Ana', players: ['Beto'] },
        { name: 'López', captain: 'Diego', players: ['Eva'] },
      ],
      settings: { numRounds: 2, multipliers: [1, 2], stealSeconds: 20 },
      pool,
    },
  ]);

test('buzzer is not armed before the game starts', () => {
  assert.equal(buzzArmed(freshState(null)), false);
});

test('buzzer is not armed until the question is on screen', () => {
  assert.equal(buzzArmed(started()), false);
});

test('buzzer arms when the question is shown and nobody has buzzed', () => {
  const s = run(started(), ['REVEAL_QUESTION']);
  assert.equal(buzzArmed(s), true);
  assert.deepEqual(buzzStatus(s), { type: 'status', armed: true, buzzed: null, phase: 'faceoff', names: ['García', 'López'] });
});

test('after a buzz the buzzer disarms and reports who was first', () => {
  const s = run(started(), ['REVEAL_QUESTION'], ['BUZZ', { team: 1 }]);
  assert.equal(buzzArmed(s), false);
  assert.equal(buzzStatus(s).buzzed, 1);
});

test('late presses are ignored: once someone buzzed, the guard is closed until Undo re-arms it', () => {
  const before = run(started(), ['REVEAL_QUESTION']);
  const after = run(before, ['BUZZ', { team: 0 }]);
  assert.equal(buzzArmed(after), false); // host-remote.js checks this before dispatching a remote buzz
  assert.equal(buzzArmed(before), true); // Undo returns to this state
});
