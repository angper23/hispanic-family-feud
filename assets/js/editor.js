// Question editor: add, edit, reorder, delete and select questions.
// Saves to localStorage on every change; Export/Import move the set in and out as JSON.

import { MAX_ANSWERS, SETUP_KEY } from './state.js';
import {
  readLocalBank,
  saveLocalBank,
  clearLocalBank,
  fetchQuestionFile,
  parseQuestionFile,
  questionIssues,
  isPlayable,
  pointsTotal,
  exportJSON,
  newId,
} from './questions.js';
import { papelPicado } from './papel.js';
import { confirmDialog, toast, esc } from './ui.js';
import { applyBranding } from './config.js';

applyBranding('Question Editor');

const $ = (id) => document.getElementById(id);
const list = $('list');
let questions = [];
let isLocal = false;
let loadError = null;

papelPicado($('papel'), { count: 22, width: 1920, height: 118 });

function numRounds() {
  try {
    return Math.max(1, Number(JSON.parse(localStorage.getItem(SETUP_KEY) || '{}').numRounds) || 4);
  } catch {
    return 4;
  }
}

function save() {
  saveLocalBank(questions);
  isLocal = true;
  setStatus();
  renderSummary();
}

function setStatus() {
  const t = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  $('status').textContent = isLocal ? `Saved in this browser · ${t}` : 'Showing questions.json · no local edits yet';
}

/* ---------- rendering ---------- */
function slotLabels() {
  const rounds = numRounds();
  let k = 0;
  return questions.map((q) => {
    if (!q.use) return { text: 'Not used', cls: 'off' };
    if (!isPlayable(q)) return { text: 'Skipped · incomplete', cls: 'off' };
    k += 1;
    return k <= rounds ? { text: `Round ${k}`, cls: '' } : { text: 'Spare', cls: 'spare' };
  });
}

function cardHtml(q, i, slot) {
  const issues = questionIssues(q);
  const total = pointsTotal(q);
  return `<article class="qcard ${q.use ? '' : 'is-off'} ${issues.length ? 'has-issues' : ''}" data-qi="${i}">
    <div class="qhead">
      <span class="qnum">${i + 1}</span>
      <label class="use"><input type="checkbox" data-field="use" ${q.use ? 'checked' : ''}> Use in game</label>
      <span class="slot ${slot.cls}">${esc(slot.text)}</span>
      ${q.placeholder ? '<span class="badge" title="Sample data. Replace with real survey results.">Placeholder</span>' : ''}
      <span class="spacer"></span>
      <span class="qid">${esc(q.id)}</span>
      <button class="btn" data-cmd="up" ${i === 0 ? 'disabled' : ''} aria-label="Move up">↑</button>
      <button class="btn" data-cmd="down" ${i === questions.length - 1 ? 'disabled' : ''} aria-label="Move down">↓</button>
      <button class="btn" data-cmd="dup">Duplicate</button>
      <button class="btn btn-danger" data-cmd="del">Delete</button>
    </div>
    <label class="qlabel" for="q-${i}">We surveyed 100 people…</label>
    <input class="qtext" id="q-${i}" data-field="question" value="${esc(q.question)}" placeholder="Name something…">
    <ol class="alist">
      ${q.answers
        .map(
          (a, j) => `<li data-ai="${j}">
          <span class="arank">${j + 1}</span>
          <input data-field="text" value="${esc(a.text)}" placeholder="Answer" aria-label="Answer ${j + 1} text">
          <input type="number" data-field="points" value="${a.points}" min="0" max="100" step="1" aria-label="Answer ${j + 1} points">
          <button class="btn" data-cmd="adel" aria-label="Remove answer ${j + 1}">×</button>
        </li>`
        )
        .join('')}
    </ol>
    <div class="qfoot">
      <button class="btn" data-cmd="aadd" ${q.answers.length >= MAX_ANSWERS ? 'disabled' : ''}>+ Add answer</button>
      <button class="btn" data-cmd="sort">Sort high → low</button>
      <span class="total ${total > 100 ? 'over' : ''}">Total <b>${total}</b> / 100</span>
      <span class="issues">${esc(issues.join(' · '))}</span>
    </div>
  </article>`;
}

function render() {
  const slots = slotLabels();
  let html = loadError ? `<div class="error-box"><strong>Couldn't load questions.json.</strong> ${esc(loadError)}</div>` : '';
  html += questions.length ? questions.map((q, i) => cardHtml(q, i, slots[i])).join('') : '<div class="card">No questions yet. Click “+ Add question”.</div>';
  list.innerHTML = html;
  renderSummary();
  setStatus();
}

/** Refreshes one card's footer and slot labels without re-rendering inputs (keeps focus). */
function refreshMeta(i) {
  const card = list.querySelector(`.qcard[data-qi="${i}"]`);
  const q = questions[i];
  if (card && q) {
    const issues = questionIssues(q);
    const total = pointsTotal(q);
    card.classList.toggle('has-issues', issues.length > 0);
    card.classList.toggle('is-off', !q.use);
    card.querySelector('.total').className = `total ${total > 100 ? 'over' : ''}`;
    card.querySelector('.total b').textContent = total;
    card.querySelector('.issues').textContent = issues.join(' · ');
  }
  const slots = slotLabels();
  list.querySelectorAll('.qcard').forEach((c) => {
    const s = slots[Number(c.dataset.qi)];
    const el = c.querySelector('.slot');
    el.textContent = s.text;
    el.className = `slot ${s.cls}`;
  });
}

function renderSummary() {
  const used = questions.filter((q) => q.use && isPlayable(q)).length;
  const rounds = numRounds();
  const issues = questions.filter((q) => q.use && questionIssues(q).length).length;
  $('summary').textContent =
    `${questions.length} questions · ${used} ready to play · the game uses the first ${Math.min(rounds, used)} for ${rounds} rounds` +
    (used > rounds ? `, plus ${used - rounds} spare${used - rounds === 1 ? '' : 's'}` : '') +
    (issues ? ` · ${issues} need attention` : '');
}

/* ---------- editing ---------- */
list.addEventListener('input', (e) => {
  const card = e.target.closest('.qcard');
  if (!card) return;
  const i = Number(card.dataset.qi);
  const q = questions[i];
  const field = e.target.dataset.field;
  const li = e.target.closest('li[data-ai]');
  if (field === 'use') q.use = e.target.checked;
  else if (field === 'question') q.question = e.target.value;
  else if (li && field === 'text') q.answers[Number(li.dataset.ai)].text = e.target.value;
  else if (li && field === 'points') q.answers[Number(li.dataset.ai)].points = Math.max(0, Math.round(Number(e.target.value) || 0));
  else return;
  if (field !== 'use' && q.placeholder) {
    delete q.placeholder; // edited by an organizer, so it's no longer sample data
    card.querySelector('.badge')?.remove();
  }
  save();
  refreshMeta(i);
});

list.addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-cmd]');
  if (!btn) return;
  const card = btn.closest('.qcard');
  const i = Number(card.dataset.qi);
  const q = questions[i];
  switch (btn.dataset.cmd) {
    case 'up':
      [questions[i - 1], questions[i]] = [questions[i], questions[i - 1]];
      break;
    case 'down':
      [questions[i + 1], questions[i]] = [questions[i], questions[i + 1]];
      break;
    case 'dup':
      {
        const copy = { ...structuredClone(q), id: newId() };
        delete copy.placeholder;
        questions.splice(i + 1, 0, copy);
      }
      break;
    case 'del': {
      const ok = await confirmDialog({
        title: 'Delete this question?',
        message: q.question || '(untitled question)',
        confirmText: 'Delete',
      });
      if (!ok) return;
      questions.splice(i, 1);
      break;
    }
    case 'aadd':
      if (q.answers.length >= MAX_ANSWERS) return;
      q.answers.push({ text: '', points: 0 });
      delete q.placeholder;
      save();
      render();
      list.querySelector(`.qcard[data-qi="${i}"] li:last-child input`)?.focus();
      return;
    case 'adel':
      q.answers.splice(Number(btn.closest('li').dataset.ai), 1);
      delete q.placeholder;
      break;
    case 'sort':
      q.answers.sort((a, b) => b.points - a.points);
      break;
    default:
      return;
  }
  save();
  render();
});

/* ---------- toolbar ---------- */
$('btn-add').addEventListener('click', () => {
  questions.push({ id: newId(), question: '', answers: Array.from({ length: 5 }, () => ({ text: '', points: 0 })), use: true });
  save();
  render();
  const inputs = list.querySelectorAll('.qtext');
  const last = inputs[inputs.length - 1];
  last?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  last?.focus({ preventScroll: true });
});

$('btn-all').addEventListener('click', () => {
  questions.forEach((q) => (q.use = true));
  save();
  render();
});
$('btn-none').addEventListener('click', () => {
  questions.forEach((q) => (q.use = false));
  save();
  render();
});

$('btn-export').addEventListener('click', () => {
  const blob = new Blob([exportJSON(questions)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'questions.json';
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('Exported questions.json. Commit it to the repo root to make it the default set.');
});

$('btn-import').addEventListener('click', () => $('file-import').click());
$('file-import').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  let incoming;
  try {
    incoming = parseQuestionFile(JSON.parse(await file.text()));
  } catch (err) {
    toast(`Couldn't import: ${err.message}`);
    return;
  }
  const ok = await confirmDialog({
    title: 'Replace the question set?',
    message: `Import ${incoming.length} questions from ${file.name}? This replaces the ${questions.length} questions shown now.`,
    confirmText: 'Import',
    danger: false,
  });
  if (!ok) return;
  questions = incoming;
  save();
  render();
  toast(`Imported ${incoming.length} questions.`);
});

$('btn-revert').addEventListener('click', async () => {
  const ok = await confirmDialog({
    title: 'Revert to questions.json?',
    message: 'This throws away every edit saved in this browser and reloads the questions from the repo file.',
    confirmText: 'Revert',
  });
  if (!ok) return;
  clearLocalBank();
  isLocal = false;
  await loadFromFile();
  render();
  toast('Reverted to questions.json.');
});

async function loadFromFile() {
  try {
    questions = await fetchQuestionFile();
    loadError = null;
  } catch (err) {
    questions = [];
    loadError = `${err.message}. Serve this folder over HTTP (GitHub Pages, or python3 -m http.server) instead of opening the file directly.`;
  }
}

/* ---------- boot ---------- */
const local = readLocalBank();
if (local) {
  questions = local;
  isLocal = true;
} else {
  await loadFromFile();
}
render();
