/* =========================================================
   Audio: every sound effect is synthesised at runtime with the
   Web Audio API. The only sampled asset is the music loop.
   ========================================================= */

import { settings } from './settings.js';

let ctx = null;
let masterGain = null;
let sfxGain = null;
let musicGain = null;
let musicEl = null;
let musicSrc = null;
let noiseBuffer = null;
let unlocked = false;
let blurred = false;

/* ---------- graph ---------- */

function ensureCtx() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();

  masterGain = ctx.createGain();
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -8;
  limiter.knee.value = 12;
  limiter.ratio.value = 9;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.22;
  masterGain.connect(limiter);
  limiter.connect(ctx.destination);

  sfxGain = ctx.createGain();
  sfxGain.connect(masterGain);

  musicGain = ctx.createGain();
  musicGain.connect(masterGain);

  noiseBuffer = makeNoise(2.2);
  applyVolumes();
  return ctx;
}

function makeNoise(seconds) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  // Slightly brown-tinted noise reads as "water and wind" rather than hiss.
  let last = 0;
  for (let i = 0; i < len; i++) {
    const white = Math.random() * 2 - 1;
    last = (last + 0.02 * white) / 1.02;
    d[i] = white * 0.72 + last * 3.2;
  }
  return buf;
}

function applyVolumes() {
  if (!ctx) return;
  const mute = blurred && settings.get('blurMute');
  const m = mute ? 0 : settings.get('master') / 100;
  const t = ctx.currentTime;
  masterGain.gain.setTargetAtTime(m, t, 0.05);
  sfxGain.gain.setTargetAtTime(settings.get('sfx') / 100, t, 0.05);
  musicGain.gain.setTargetAtTime((settings.get('music') / 100) * 0.85, t, 0.12);
}

settings.onChange((k) => {
  if (k === 'master' || k === 'music' || k === 'sfx' || k === 'blurMute') applyVolumes();
});

window.addEventListener('blur', () => { blurred = true; applyVolumes(); });
window.addEventListener('focus', () => { blurred = false; applyVolumes(); });

/* ---------- unlock (browsers require a gesture) ---------- */

export function unlockAudio() {
  const c = ensureCtx();
  if (!c) return;
  if (c.state === 'suspended') c.resume();
  if (!unlocked) {
    unlocked = true;
    startMusic();
  }
}

export function isUnlocked() { return unlocked; }

/* ---------- music ---------- */

export function startMusic(src = 'assets/music/naval-silence.mp3') {
  const c = ensureCtx();
  if (!c) return;
  if (!musicEl) {
    musicEl = new Audio(src);
    musicEl.loop = true;
    musicEl.preload = 'auto';
    musicEl.crossOrigin = 'anonymous';
    try {
      musicSrc = c.createMediaElementSource(musicEl);
      musicSrc.connect(musicGain);
    } catch {
      // Fall back to element volume if routing is unavailable.
      musicSrc = null;
    }
  }
  const p = musicEl.play();
  if (p && p.catch) p.catch(() => { /* will retry on next gesture */ });
  if (!musicSrc) musicEl.volume = (settings.get('music') / 100) * 0.6;
}

export function musicDuck(amount = 0.35, seconds = 1.2) {
  if (!ctx || !musicGain) return;
  const target = (settings.get('music') / 100) * 0.85;
  const t = ctx.currentTime;
  musicGain.gain.cancelScheduledValues(t);
  musicGain.gain.setValueAtTime(musicGain.gain.value, t);
  musicGain.gain.linearRampToValueAtTime(target * amount, t + 0.08);
  musicGain.gain.linearRampToValueAtTime(target, t + seconds);
}

/* ---------- primitives ---------- */

function now() { return ctx.currentTime; }

function env(gain, t0, { a = 0.005, d = 0.2, peak = 1, sustain = 0, s = 0, r = 0.05 } = {}) {
  const g = gain.gain;
  g.setValueAtTime(0.0001, t0);
  g.exponentialRampToValueAtTime(Math.max(0.0001, peak), t0 + a);
  if (sustain > 0 && s > 0) {
    g.exponentialRampToValueAtTime(Math.max(0.0001, peak * sustain), t0 + a + d);
    g.setValueAtTime(Math.max(0.0001, peak * sustain), t0 + a + d + s);
    g.exponentialRampToValueAtTime(0.0001, t0 + a + d + s + r);
    return t0 + a + d + s + r;
  }
  g.exponentialRampToValueAtTime(0.0001, t0 + a + d);
  return t0 + a + d;
}

function noiseSource(t0, dur, { rate = 1, offset = null } = {}) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer;
  src.playbackRate.value = rate;
  const off = offset === null ? Math.random() * (noiseBuffer.duration - dur - 0.05) : offset;
  src.start(t0, Math.max(0, off), dur + 0.05);
  src.stop(t0 + dur + 0.06);
  return src;
}

function tone(t0, { type = 'sine', f0 = 220, f1 = null, dur = 0.3, peak = 0.3, dest = null, ...rest }) {
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(f0, t0);
  if (f1 !== null) osc.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t0 + dur);
  osc.connect(g);
  g.connect(dest || sfxGain);
  const end = env(g, t0, { a: 0.006, d: dur, peak, ...rest });
  osc.start(t0);
  osc.stop(end + 0.05);
  return osc;
}

function filtNoise(t0, { dur = 0.4, type = 'bandpass', f0 = 900, f1 = null, q = 1, peak = 0.3, rate = 1, dest = null, ...rest }) {
  const src = noiseSource(t0, dur, { rate });
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.setValueAtTime(f0, t0);
  if (f1 !== null) f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
  f.Q.value = q;
  const g = ctx.createGain();
  src.connect(f); f.connect(g); g.connect(dest || sfxGain);
  env(g, t0, { a: 0.004, d: dur, peak, ...rest });
  return { src, filter: f, gain: g };
}

/** Short convolution-free "space": a couple of delayed taps. */
function withEcho(t0, fn, { taps = 2, delay = 0.14, decay = 0.4 } = {}) {
  fn(t0, 1);
  for (let i = 1; i <= taps; i++) fn(t0 + delay * i, Math.pow(decay, i));
}

/* ---------- the sound library ---------- */

const LIB = {
  /* --- UI --- */
  uiHover(t) {
    tone(t, { type: 'square', f0: 520, dur: 0.045, peak: 0.045 });
  },
  uiClick(t) {
    tone(t, { type: 'square', f0: 300, f1: 150, dur: 0.07, peak: 0.1 });
    filtNoise(t, { dur: 0.06, type: 'highpass', f0: 2600, peak: 0.12 });
  },
  uiHeavy(t) {
    // A bolt driven home: metallic clack plus a low body thud.
    tone(t, { type: 'triangle', f0: 150, f1: 62, dur: 0.16, peak: 0.3 });
    filtNoise(t, { dur: 0.1, type: 'bandpass', f0: 2200, f1: 700, q: 1.4, peak: 0.3 });
    tone(t + 0.005, { type: 'sine', f0: 1500, f1: 900, dur: 0.07, peak: 0.1 });
  },
  uiBack(t) {
    tone(t, { type: 'square', f0: 220, f1: 120, dur: 0.1, peak: 0.09 });
  },
  uiError(t) {
    tone(t, { type: 'sawtooth', f0: 150, dur: 0.1, peak: 0.14 });
    tone(t + 0.1, { type: 'sawtooth', f0: 110, dur: 0.16, peak: 0.14 });
  },

  /* --- deployment --- */
  place(t) {
    // Hull settling into the water: thump, chain rattle, small wash.
    tone(t, { type: 'sine', f0: 110, f1: 44, dur: 0.24, peak: 0.42 });
    filtNoise(t + 0.01, { dur: 0.2, type: 'bandpass', f0: 1600, f1: 420, q: .9, peak: 0.22 });
    filtNoise(t + 0.04, { dur: 0.36, type: 'lowpass', f0: 900, f1: 260, peak: 0.16, rate: 0.7 });
  },
  rotate(t) {
    filtNoise(t, { dur: 0.14, type: 'bandpass', f0: 700, f1: 1900, q: 3, peak: 0.16 });
    tone(t, { type: 'triangle', f0: 260, f1: 420, dur: 0.12, peak: 0.08 });
  },
  invalid(t) {
    tone(t, { type: 'square', f0: 90, dur: 0.13, peak: 0.16 });
  },

  /* --- combat --- */
  fire(t) {
    // Main battery: sharp crack, deep body, rolling tail over the water.
    tone(t, { type: 'sine', f0: 190, f1: 32, dur: 0.55, peak: 0.95 });
    tone(t, { type: 'square', f0: 84, f1: 28, dur: 0.3, peak: 0.35 });
    filtNoise(t, { dur: 0.1, type: 'highpass', f0: 2200, peak: 0.85 });
    filtNoise(t + 0.005, { dur: 0.75, type: 'lowpass', f0: 1400, f1: 180, peak: 0.5, rate: 0.85 });
    withEcho(t + 0.18, (tt, amp) => {
      filtNoise(tt, { dur: 0.5, type: 'lowpass', f0: 620, f1: 140, peak: 0.16 * amp, rate: 0.7 });
    }, { taps: 2, delay: 0.22, decay: 0.45 });
  },
  whistle(t, dur = 0.8) {
    // Shell in flight - descending airy whine.
    const g = ctx.createGain();
    g.connect(sfxGain);
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(1250, t);
    osc.frequency.exponentialRampToValueAtTime(360, t + dur);
    const lfo = ctx.createOscillator();
    const lfoG = ctx.createGain();
    lfo.frequency.value = 7; lfoG.gain.value = 26;
    lfo.connect(lfoG); lfoG.connect(osc.frequency);
    osc.connect(g);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.12, t + dur * 0.45);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.start(t); lfo.start(t);
    osc.stop(t + dur + 0.05); lfo.stop(t + dur + 0.05);
    filtNoise(t, { dur, type: 'bandpass', f0: 2400, f1: 700, q: 2.5, peak: 0.05 });
  },
  splash(t) {
    // Column of water: impact slap then a long falling wash.
    filtNoise(t, { dur: 0.09, type: 'bandpass', f0: 1100, q: 0.8, peak: 0.6 });
    tone(t, { type: 'sine', f0: 260, f1: 70, dur: 0.2, peak: 0.3 });
    filtNoise(t + 0.03, { dur: 0.95, type: 'lowpass', f0: 2600, f1: 380, peak: 0.4, rate: 0.9 });
    filtNoise(t + 0.34, { dur: 0.7, type: 'highpass', f0: 1500, f1: 3200, peak: 0.13, rate: 1.1 });
  },
  explode(t) {
    // Steel taking a shell: crack, fireball, debris rain.
    tone(t, { type: 'sine', f0: 240, f1: 26, dur: 0.85, peak: 1.0 });
    tone(t, { type: 'sawtooth', f0: 130, f1: 34, dur: 0.4, peak: 0.4 });
    filtNoise(t, { dur: 0.14, type: 'highpass', f0: 1800, peak: 0.9 });
    filtNoise(t, { dur: 1.0, type: 'lowpass', f0: 2200, f1: 150, peak: 0.72, rate: 0.8 });
    // metal shrapnel
    for (let i = 0; i < 6; i++) {
      const d = t + 0.06 + Math.random() * 0.5;
      tone(d, { type: 'square', f0: 900 + Math.random() * 2400, f1: 300, dur: 0.05 + Math.random() * 0.07, peak: 0.05 });
    }
    filtNoise(t + 0.25, { dur: 0.8, type: 'bandpass', f0: 3000, f1: 900, q: 0.7, peak: 0.12, rate: 1.3 });
  },
  sink(t) {
    // Hull breaking up then going under.
    LIB.explode(t);
    const groan = ctx.createOscillator();
    const gg = ctx.createGain();
    groan.type = 'sawtooth';
    groan.frequency.setValueAtTime(78, t + 0.2);
    groan.frequency.exponentialRampToValueAtTime(26, t + 2.1);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.setValueAtTime(700, t + 0.2);
    lp.frequency.exponentialRampToValueAtTime(160, t + 2.1);
    groan.connect(lp); lp.connect(gg); gg.connect(sfxGain);
    gg.gain.setValueAtTime(0.0001, t + 0.2);
    gg.gain.exponentialRampToValueAtTime(0.34, t + 0.5);
    gg.gain.exponentialRampToValueAtTime(0.0001, t + 2.2);
    groan.start(t + 0.2); groan.stop(t + 2.3);
    // stressed metal
    for (let i = 0; i < 5; i++) {
      const d = t + 0.4 + i * 0.24 + Math.random() * 0.1;
      filtNoise(d, { dur: 0.3, type: 'bandpass', f0: 380 + Math.random() * 500, q: 8, peak: 0.16 });
    }
    // final gulp of water
    filtNoise(t + 1.5, { dur: 1.1, type: 'lowpass', f0: 900, f1: 130, peak: 0.3, rate: 0.6 });
  },
  incoming(t) {
    // Warning klaxon when the enemy opens fire on you.
    for (let i = 0; i < 2; i++) {
      const s = t + i * 0.42;
      tone(s, { type: 'sawtooth', f0: 340, f1: 470, dur: 0.2, peak: 0.13 });
      tone(s + 0.2, { type: 'sawtooth', f0: 470, f1: 330, dur: 0.2, peak: 0.13 });
    }
  },
  yourTurn(t) {
    // Bosun's call: two clean rising pips.
    tone(t, { type: 'triangle', f0: 660, dur: 0.12, peak: 0.16 });
    tone(t + 0.13, { type: 'triangle', f0: 990, dur: 0.22, peak: 0.16 });
  },
  tick(t) {
    tone(t, { type: 'square', f0: 1200, dur: 0.035, peak: 0.07 });
  },
  tickUrgent(t) {
    tone(t, { type: 'square', f0: 1500, dur: 0.05, peak: 0.13 });
  },

  /* --- match flow --- */
  connect(t) {
    [523.25, 659.25, 783.99].forEach((f, i) => {
      tone(t + i * 0.09, { type: 'triangle', f0: f, dur: 0.22, peak: 0.13 });
    });
  },
  disconnect(t) {
    [660, 495, 330].forEach((f, i) => {
      tone(t + i * 0.12, { type: 'sawtooth', f0: f, dur: 0.25, peak: 0.12 });
    });
  },
  victory(t) {
    // Brass fanfare in D.
    const notes = [[293.66, 0], [440, 0.16], [587.33, 0.32], [880, 0.5, 0.9]];
    for (const [f, off, len = 0.34] of notes) {
      tone(t + off, { type: 'sawtooth', f0: f, dur: len, peak: 0.16, sustain: 0.6, s: len * 0.5, r: 0.3, a: 0.02 });
      tone(t + off, { type: 'square', f0: f / 2, dur: len, peak: 0.07, a: 0.02 });
    }
    filtNoise(t + 0.5, { dur: 1.6, type: 'lowpass', f0: 800, f1: 200, peak: 0.1, rate: 0.7 });
  },
  defeat(t) {
    const notes = [[392, 0], [349.23, 0.3], [293.66, 0.6], [220, 0.95, 1.4]];
    for (const [f, off, len = 0.45] of notes) {
      tone(t + off, { type: 'sawtooth', f0: f, dur: len, peak: 0.14, a: 0.05 });
    }
    filtNoise(t + 0.9, { dur: 2.0, type: 'lowpass', f0: 500, f1: 110, peak: 0.16, rate: 0.55 });
  },
};

/* ---------- public play API ---------- */

let lastPlay = new Map();

export function sfx(name, { delay = 0, throttle = 0 } = {}) {
  if (!ctx || !unlocked) return;
  const fn = LIB[name];
  if (!fn) return;
  if (throttle) {
    const last = lastPlay.get(name) || 0;
    if (performance.now() - last < throttle) return;
    lastPlay.set(name, performance.now());
  }
  try {
    fn(now() + delay);
  } catch (err) {
    console.warn('[audio]', name, err);
  }
}

/** Ambient sea: a slow, very quiet filtered-noise bed. Idempotent. */
let ambience = null;
export function startAmbience() {
  if (!ctx || ambience) return;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer;
  src.loop = true;
  src.playbackRate.value = 0.55;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass'; lp.frequency.value = 420; lp.Q.value = 0.6;
  const g = ctx.createGain();
  g.gain.value = 0.0;
  src.connect(lp); lp.connect(g); g.connect(sfxGain);
  src.start();
  g.gain.setTargetAtTime(0.055, ctx.currentTime, 2.5);

  // Slow swell so the bed breathes instead of sitting flat.
  const lfo = ctx.createOscillator();
  const lfoG = ctx.createGain();
  lfo.frequency.value = 0.07;
  lfoG.gain.value = 130;
  lfo.connect(lfoG); lfoG.connect(lp.frequency);
  lfo.start();

  ambience = { src, g, lfo };
}

export function stopAmbience() {
  if (!ambience) return;
  ambience.g.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.6);
  const a = ambience;
  ambience = null;
  setTimeout(() => { try { a.src.stop(); a.lfo.stop(); } catch { /* already stopped */ } }, 1400);
}

export const audio = { unlockAudio, sfx, startMusic, musicDuck, startAmbience, stopAmbience, isUnlocked };
export default audio;
