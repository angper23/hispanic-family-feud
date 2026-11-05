// Buzzer page: two big buttons, one per face-off player. Both live on the same device, so the
// order of the touches is decided locally and exactly: the first pointerdown wins, the other
// button locks instantly. Only that single result is sent to the host.

import { PREFIX, PEER_OPTIONS } from './remote.js?v=3';

const $ = (id) => document.getElementById(id);

let peer = null;
let conn = null;
let room = null;
let st = { armed: false, buzzed: null, names: ['Family 1', 'Family 2'], phase: null };
let pressed = null; // team this device buzzed for, until the host says otherwise
let connected = false;
const BUILD = 'v4';
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

function press(team) {
  if (!connected || !st.armed || pressed != null) return; // first touch wins, instantly
  pressed = team;
  conn.send({ type: 'buzz', team });
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
  // Re-armed (host used Undo, or a new question): clear our local lock.
  if (m.armed && !wasArmed) pressed = null;
  // Host settled on a different team than we pressed (e.g. it buzzed in the same instant): trust the host.
  if (m.buzzed != null) pressed = null;
  if (!m.armed && m.buzzed == null) pressed = null;
  render();
}

function join(code) {
  room = code.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (room.length !== 4) return ($('join-msg').textContent = 'Room codes are 4 characters.');
  if (typeof window.Peer !== 'function') return ($('join-msg').textContent = 'Could not load PeerJS. Check your connection.');
  $('join-msg').textContent = 'Connecting…';
  history.replaceState(null, '', `?room=${room}`);
  peer?.destroy();
  diag('contacting broker');
  peer = new window.Peer(undefined, PEER_OPTIONS);
  peer.on('open', () => {
    diag('broker ok');
    connect();
  });
  peer.on('error', (e) => {
    diag(`error: ${e.type}`);
    connected = false;
    if (e.type === 'peer-unavailable') {
      $('join-msg').textContent = `No room "${room}" found. Check the code on the host console.`;
      show('join');
    } else {
      $('join-msg').textContent = `Connection problem: ${e.type}`;
    }
    render();
  });
  peer.on('disconnected', () => !peer.destroyed && peer.reconnect());
}

let retry = null;
let slow = null;
function connect() {
  clearTimeout(retry);
  conn = peer.connect(PREFIX + room, { reliable: true });
  clearTimeout(slow);
  slow = setTimeout(() => {
    if (!connected) {
      $('banner').textContent = 'Still connecting… the network may be blocking the link. Try Wi-Fi on both devices, or reload.';
    }
  }, 12000);
  diag(`calling ${room}`);
  conn.peerConnection?.addEventListener('iceconnectionstatechange', () => diag(`ice ${conn.peerConnection.iceConnectionState}`));
  conn.on('open', () => {
    diag('connected');
    connected = true;
    show('pad');
    conn.send({ type: 'hello' });
    render();
  });
  conn.on('data', (m) => m?.type === 'status' && onStatus(m));
  const lost = () => {
    connected = false;
    pressed = null;
    render();
    retry = setTimeout(() => peer && !peer.destroyed && connect(), 1500);
  };
  conn.on('close', lost);
  conn.on('error', lost);
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
  show('pad');
  render();
  join(q);
} else show('join');
