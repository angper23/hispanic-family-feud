// All sounds are synthesized with the Web Audio API. Nothing is sampled or copied.
// Sounds play from the host window: both windows live on the same computer, and the
// host window always has a user gesture, so browsers never block its audio.

let ctx = null;
let master = null;
let noise = null;
let volume = 0.7;
let muted = false;

export function initAudio() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    const comp = ctx.createDynamicsCompressor();
    master.connect(comp);
    comp.connect(ctx.destination);
    applyGain();
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

export function setAudio(opts) {
  if (opts.volume != null) volume = opts.volume;
  if (opts.muted != null) muted = opts.muted;
  applyGain();
}

function applyGain() {
  if (master) master.gain.setTargetAtTime(muted ? 0 : volume, ctx.currentTime, 0.02);
}

function tone(type, freq, t0, dur, o = {}) {
  const { gain = 0.25, attack = 0.01, pluck = false, to = null, dest = master, detune = 0 } = o;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (to) osc.frequency.exponentialRampToValueAtTime(to, t0 + dur);
  osc.detune.value = detune;
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + attack);
  if (!pluck) g.gain.setValueAtTime(gain, Math.max(t0 + attack, t0 + dur - 0.06));
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g);
  g.connect(dest);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

function noiseBurst(t0, dur, from, to, gain = 0.3) {
  if (!noise) {
    noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const src = ctx.createBufferSource();
  src.buffer = noise;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.Q.value = 1.2;
  bp.frequency.setValueAtTime(from, t0);
  bp.frequency.exponentialRampToValueAtTime(to, t0 + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + dur * 0.3);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(bp);
  bp.connect(g);
  g.connect(master);
  src.start(t0);
  src.stop(t0 + dur + 0.05);
}

function bell(freq, t0, gain = 0.32) {
  [
    [1, 1, 1.5],
    [2.0, 0.35, 0.9],
    [3.01, 0.2, 0.6],
    [4.2, 0.1, 0.35],
  ].forEach(([mul, g, d]) => tone('sine', freq * mul, t0, d, { gain: gain * g, attack: 0.003, pluck: true }));
}

function brass(freq, t0, dur, gain = 0.14) {
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.Q.value = 3;
  lp.frequency.setValueAtTime(freq * 1.5, t0);
  lp.frequency.linearRampToValueAtTime(freq * 7, t0 + 0.05);
  lp.frequency.linearRampToValueAtTime(freq * 3, t0 + dur);
  lp.connect(master);
  tone('sawtooth', freq, t0, dur, { gain, attack: 0.02, dest: lp });
  tone('sawtooth', freq, t0, dur, { gain: gain * 0.8, attack: 0.02, dest: lp, detune: 9 });
}

const N = { G4: 392, A4: 440, C5: 523.25, D5: 587.33, E5: 659.25, G5: 783.99, A5: 880, C6: 1046.5, E6: 1318.5, B6: 1975.5 };

const SOUNDS = {
  ding(t) {
    bell(N.E6, t);
    bell(N.B6, t + 0.12, 0.26);
  },
  buzzer(t) {
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1700;
    lp.connect(master);
    tone('sawtooth', 92, t, 0.95, { gain: 0.32, dest: lp });
    tone('sawtooth', 97.5, t, 0.95, { gain: 0.3, dest: lp });
    tone('square', 184, t, 0.95, { gain: 0.1, dest: lp });
  },
  buzzIn(t) {
    tone('square', 660, t, 0.1, { gain: 0.1 });
    tone('square', 990, t + 0.1, 0.16, { gain: 0.1 });
  },
  fanfare(t) {
    [
      [N.G4, 0, 0.14],
      [N.C5, 0.15, 0.14],
      [N.E5, 0.3, 0.14],
      [N.G5, 0.45, 0.3],
      [N.E5, 0.78, 0.13],
      [N.G5, 0.93, 0.8],
    ].forEach(([f, d, l]) => brass(f, t + d, l));
    brass(N.C5, t + 0.93, 0.8, 0.09);
    brass(N.E5, t + 0.93, 0.8, 0.09);
  },
  bigFanfare(t) {
    [
      [N.C5, 0, 0.18],
      [N.C5, 0.2, 0.1],
      [N.C5, 0.32, 0.1],
      [N.G5, 0.45, 0.5],
      [N.E5, 1.0, 0.18],
      [N.G5, 1.2, 0.18],
      [N.C6, 1.4, 1.3],
    ].forEach(([f, d, l]) => brass(f, t + d, l));
    [N.C5, N.E5, N.G5].forEach((f) => brass(f, t + 1.4, 1.3, 0.08));
    tone('sine', 65, t + 1.4, 1.0, { gain: 0.5, attack: 0.005, pluck: true });
  },
  steal(t) {
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2400;
    lp.connect(master);
    tone('sawtooth', 220, t, 0.6, { gain: 0.14, to: 880, dest: lp });
    tone('sawtooth', 147, t + 0.65, 0.5, { gain: 0.18, dest: lp });
    tone('sawtooth', 139, t + 0.65, 0.5, { gain: 0.18, dest: lp });
  },
  tick(t) {
    tone('square', 1250, t, 0.05, { gain: 0.08, attack: 0.002, pluck: true });
  },
  timeUp(t) {
    tone('square', 440, t, 0.6, { gain: 0.14 });
    tone('square', 415, t, 0.6, { gain: 0.14 });
  },
  flip(t) {
    noiseBurst(t, 0.28, 700, 3200, 0.22);
    tone('triangle', 600, t, 0.12, { gain: 0.08, to: 900, pluck: true });
  },
  whoosh(t) {
    noiseBurst(t, 0.5, 300, 2200, 0.25);
  },
};

/* ---------- host-supplied files ---------- */
const custom = new Map(); // slot -> AudioBuffer
const active = new Set(); // playing file sources, so Stop can cut them

/** Decodes and installs a file for a slot. Pass null to go back to the built-in sound. */
export async function setCustomSound(slot, arrayBuffer) {
  if (!arrayBuffer) {
    custom.delete(slot);
    return;
  }
  if (!initAudio()) throw new Error('This browser has no Web Audio support.');
  const buf = await ctx.decodeAudioData(arrayBuffer.slice(0));
  custom.set(slot, buf);
}

export const hasCustomSound = (slot) => custom.has(slot);

function playBuffer(buf, when) {
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(master);
  src.onended = () => active.delete(src);
  active.add(src);
  src.start(when);
}

export function stopAll() {
  active.forEach((src) => {
    try {
      src.stop();
    } catch {
      /* already stopped */
    }
  });
  active.clear();
}

export function play(name, delay = 0) {
  if (!initAudio()) return;
  const when = ctx.currentTime + 0.02 + delay;
  if (custom.has(name)) playBuffer(custom.get(name), when);
  else if (SOUNDS[name]) SOUNDS[name](when);
}

/** Maps reducer effects to sounds. */
export function playFx(list = []) {
  for (const fx of list) {
    const d = fx.delay || 0;
    switch (fx.t) {
      case 'ding':
        play('ding', d);
        break;
      case 'strike':
        play('buzzer', d);
        break;
      case 'buzz':
        play('buzzIn', d);
        break;
      case 'roundWin':
        if (fx.award > 0) play('fanfare', d);
        break;
      case 'gameWin':
        play('bigFanfare', d);
        break;
      case 'steal':
        play('steal', d);
        break;
      case 'revealRest':
        fx.idxs.forEach((_, k) => play('flip', d + k * 0.35));
        break;
      case 'question':
      case 'nextRound':
      case 'swap':
        play('whoosh', d);
        break;
      case 'start':
        play('fanfare', d);
        break;
      default:
        break;
    }
  }
}
