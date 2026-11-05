// Buzzer page: two big buttons, one per face-off player. Both live on the same device, so the
// order of the touches is decided locally and exactly: the first pointerdown wins, the other
// button locks instantly. Only that single result is sent to the host (via a public MQTT broker).

import { topics, connectBroker } from './remote.js';
import { applyBranding } from './config.js';

applyBranding('Buzzer');

const $ = (id) => document.getElementById(id);
const BUILD = 'v6';
const DEBUG = new URLSearchParams(location.search).has('debug'); // add ?debug to the address to show the progress line
if (DEBUG) $('diag').hidden = false;
const MY_ID = Math.random().toString(36).slice(2, 10);

let client = null;
let room = null;
let st = { armed: false, buzzed: null, names: ['Family 1', 'Family 2'], phase: null };
let pressed = null; // team this device buzzed for, until the host says otherwise
let connected = false; // true while the host is answering
let lastHeard = 0;
let hb = null;
const diagLog = [];
function diag(msg) {
  diagLog.push(msg);
  $('diag').textContent = `${BUILD} · ` + diagLog.slice(-4).join(' → ');
}

const btns = [$('b0'), $('b1')];

function show(view) {
  $('join').hidden = view !== 'join';
  $('pad').hidden = view !== 'pad';
}

function render() {
  const banner = $('banner');
  btns.forEach((b, t) => {
    b.querySelector('.who').textContent = st.names[t];
    const mine = st.buzzed === t || pressed === t;
    b.classList.toggle('won', mine);
    b.classList.toggle('lost', (st.buzzed != null || pressed != null) && !mine);
    b.disabled = !connected || !st.armed || pressed != null;
  });
  banner.className = 'banner';
  if (!connected) {
    banner.textContent = 'Connecting to host…';
    banner.classList.add('wait');
  } else if (st.buzzed != null || pressed != null) {
    const t = st.buzzed ?? pressed;
    banner.textContent = `${st.names[t]} buzzed in first!`;
    banner.classList.add('done');
  } else if (st.armed) {
    banner.textContent = 'BUZZ IN!';
    banner.classList.add('go');
  } else {
    banner.textContent = 'Waiting for the host to show the question…';
    banner.classList.add('wait');
  }
}

const sendUp = (msg) => client?.connected && client.publish(topics(room).up, JSON.stringify({ id: MY_ID, ...msg }), { qos: 1 });

function press(team) {
  if (!connected || !st.armed || pressed != null) return; // first touch wins, instantly
  pressed = team;
  sendUp({ type: 'buzz', team });
  navigator.vibrate?.(60);
  render();
}
btns.forEach((b, t) =>
  b.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    press(t);
  }),
);

function onStatus(m) {
  const wasArmed = st.armed;
  st = m;
  if (m.armed && !wasArmed) pressed = null; // re-armed (Undo or a new question)
  if (m.buzzed != null) pressed = null; // host has settled it: trust the host
  if (!m.armed && m.buzzed == null) pressed = null;
  render();
}

function join(code) {
  room = code.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (room.length !== 4) return ($('join-msg').textContent = 'Room codes are 4 characters.');
  if (!window.mqtt) return ($('join-msg').textContent = 'Could not load the messaging library. Check your connection.');
  $('join-msg').textContent = 'Connecting…';
  history.replaceState(null, '', `?room=${room}${DEBUG ? '&debug' : ''}`);
  show('pad');
  render();
  diag('contacting broker');
  clearInterval(hb);
  client?.end(true);
  connectBroker(
    (c, url) => {
      client = c;
      diag(`broker ok (${new URL(url).hostname})`);
      c.subscribe(topics(room).down, { qos: 1 });
      c.on('message', (_t, buf) => {
        try {
          const m = JSON.parse(buf.toString());
          if (m?.type !== 'status') return;
          lastHeard = Date.now();
          if (!connected) diag('host answered');
          connected = true;
          onStatus(m);
        } catch {
          /* ignore */
        }
      });
      sendUp({ type: 'hello' });
      diag(`asking host ${room}`);
      hb = setInterval(() => {
        sendUp({ type: 'hello' });
        if (connected && Date.now() - lastHeard > 14000) {
          connected = false;
          pressed = null;
          diag('host went quiet');
          render();
        }
        if (!connected && Date.now() - lastHeard > 10000 && diagLog.length < 8) {
          diag(`no answer from ${room}: check the code`);
          $('banner').textContent = `No answer from room ${room}. Check the code, and that the host page is open.`;
        }
      }, 4000);
    },
    () => {
      diag('broker unreachable');
      $('join-msg').textContent = 'Could not reach the message service on this network. Try cellular data or another Wi-Fi.';
      show('join');
    },
    () => {
      connected = false;
      diag('broker connection lost');
      render();
    },
  );
}

$('join-form').addEventListener('submit', (e) => {
  e.preventDefault();
  join($('code').value);
});

// Keep the screen from zooming/selecting while players mash the buttons.
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('contextmenu', (e) => e.preventDefault());

const q = new URLSearchParams(location.search).get('room');
if (q) {
  $('code').value = q.toUpperCase();
  join(q);
} else show('join');
