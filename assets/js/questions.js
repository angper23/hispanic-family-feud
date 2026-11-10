// Question bank: questions.json in the repo, overridden by editor changes in localStorage.

import { MAX_ANSWERS } from './state.js';
import { CONFIG } from './config.js';

export const BANK_KEY = 'hff:questions:v1';

export function newId() {
  return 'q-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

export function cleanQuestion(q = {}, i = 0) {
  return {
    id: String(q.id ?? `q${i + 1}`),
    question: String(q.question ?? ''),
    answers: (Array.isArray(q.answers) ? q.answers : []).map((a) => ({
      text: String(a?.text ?? ''),
      points: Math.max(0, Math.round(Number(a?.points) || 0)),
    })),
    use: q.use !== false,
    ...(q.placeholder ? { placeholder: true } : {}),
  };
}

/** Accepts either a bare array or { questions: [...] }. */
export function parseQuestionFile(data) {
  const arr = Array.isArray(data) ? data : data?.questions;
  if (!Array.isArray(arr)) throw new Error('The file has no "questions" list.');
  const seen = new Set();
  return arr.map((q, i) => {
    const c = cleanQuestion(q, i);
    if (seen.has(c.id)) c.id = newId();
    seen.add(c.id);
    return c;
  });
}

export function readLocalBank() {
  try {
    const raw = localStorage.getItem(BANK_KEY);
    return raw ? parseQuestionFile(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export function saveLocalBank(list) {
  localStorage.setItem(BANK_KEY, JSON.stringify({ savedAt: new Date().toISOString(), questions: list }));
}

export const clearLocalBank = () => localStorage.removeItem(BANK_KEY);

export async function fetchQuestionFile() {
  const res = await fetch('questions.json', { cache: 'no-cache' });
  if (!res.ok) throw new Error(`questions.json returned HTTP ${res.status}`);
  return parseQuestionFile(await res.json());
}

/** Returns { questions, source: 'local' | 'file' }. */
export async function loadQuestionBank() {
  const local = readLocalBank();
  if (local) return { questions: local, source: 'local' };
  return { questions: await fetchQuestionFile(), source: 'file' };
}

export const pointsTotal = (q) => q.answers.reduce((n, a) => n + (Number(a.points) || 0), 0);

export function questionIssues(q) {
  const issues = [];
  const named = q.answers.filter((a) => a.text.trim());
  if (!q.question.trim()) issues.push('Question text is empty');
  if (named.length < 3) issues.push('Needs at least 3 answers');
  if (q.answers.length > MAX_ANSWERS) issues.push(`Max ${MAX_ANSWERS} answers`);
  if (q.answers.some((a) => !a.text.trim())) issues.push('An answer is blank');
  const total = pointsTotal(q);
  if (total > 100) issues.push(`Points add up to ${total} (max 100)`);
  if (q.answers.some((a, i) => i > 0 && a.points > q.answers[i - 1].points)) issues.push('Not sorted high to low');
  return issues;
}

export const isPlayable = (q) => !!q.question.trim() && q.answers.filter((a) => a.text.trim()).length >= 3;

/** The list starting at `start` and wrapping around, so a later game can carry on down the list. */
export const rotateFrom = (list, start) => {
  if (!list.length) return [];
  const n = ((Math.floor(start) % list.length) + list.length) % list.length;
  return [...list.slice(n), ...list.slice(0, n)];
};

/* Which question the next game starts at. Saved in this browser so it survives refreshes. */
export const NEXT_KEY = 'hff:nextQuestion:v1';
export function getNextIndex() {
  try {
    return Math.max(0, Math.floor(Number(localStorage.getItem(NEXT_KEY))) || 0);
  } catch {
    return 0;
  }
}
export function setNextIndex(n) {
  try {
    localStorage.setItem(NEXT_KEY, String(Math.max(0, Math.floor(n) || 0)));
  } catch {
    /* storage unavailable: the next game just starts from the top */
  }
}

/** The questions a game will use, in order, cleaned and sorted. */
export function usableQuestions(list) {
  return list
    .filter((q) => q.use && isPlayable(q))
    .map((q) => ({
      id: q.id,
      question: q.question.trim(),
      answers: q.answers
        .filter((a) => a.text.trim())
        .map((a) => ({ text: a.text.trim(), points: a.points }))
        .sort((a, b) => b.points - a.points)
        .slice(0, MAX_ANSWERS),
    }));
}

export function exportJSON(list) {
  const out = {
    _about:
      `${CONFIG.gameName} question set (${CONFIG.orgShort}, ${CONFIG.venue}). Answers are sorted high to low; points per question total 100 or less. Questions with "use": false are skipped. Order = play order.`,
    exportedAt: new Date().toISOString(),
    questions: list.map((q) => ({
      id: q.id,
      question: q.question,
      answers: q.answers.map((a) => ({ text: a.text, points: a.points })),
      ...(q.use === false ? { use: false } : {}),
      ...(q.placeholder ? { placeholder: true } : {}),
    })),
  };
  return JSON.stringify(out, null, 2) + '\n';
}
