/* Persisted user settings + a tiny change-event bus. */

const KEY = 'bs3d.settings.v1';

export const DEFAULTS = {
  master: 80,
  music: 55,
  sfx: 85,
  blurMute: 1,

  fpsLimit: 60,
  antialias: 1,
  shadows: 2,      // 0 off | 1 low | 2 high
  water: 2,        // 1 low | 2 med | 3 high
  particles: 2,    // 1 low | 2 med | 3 high
  renderScale: 100,
  shake: 1,
  actionZoom: 1,
  fpsMeter: 0,

  playerName: '',
  playerColor: 'blue',
};

function read() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw);
    const merged = { ...DEFAULTS };
    for (const k of Object.keys(DEFAULTS)) {
      if (parsed[k] !== undefined && typeof parsed[k] === typeof DEFAULTS[k]) merged[k] = parsed[k];
    }
    return merged;
  } catch {
    return { ...DEFAULTS };
  }
}

const state = read();
const listeners = new Set();

export const settings = {
  get(k) { return state[k]; },
  all() { return { ...state }; },

  set(k, v) {
    if (state[k] === v) return;
    state[k] = v;
    persist();
    emit(k, v);
  },

  patch(obj) {
    const changed = [];
    for (const [k, v] of Object.entries(obj)) {
      if (state[k] !== v) { state[k] = v; changed.push(k); }
    }
    if (!changed.length) return;
    persist();
    for (const k of changed) emit(k, state[k]);
  },

  reset() {
    const keepName = state.playerName;
    const keepColor = state.playerColor;
    Object.assign(state, DEFAULTS, { playerName: keepName, playerColor: keepColor });
    persist();
    for (const k of Object.keys(state)) emit(k, state[k]);
  },

  onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
};

function persist() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* private mode */ }
}

function emit(key, value) {
  for (const fn of listeners) {
    try { fn(key, value); } catch (err) { console.error('[settings]', err); }
  }
}

/* Derived helpers used by the renderer. */
export const quality = {
  shadowMapSize() { return [0, 1024, 2048][settings.get('shadows')] || 1024; },
  shadowsOn() { return settings.get('shadows') > 0; },
  waterSegments() { return [0, 180, 260, 360][settings.get('water')] || 260; },
  particleScale() { return [0, 0.5, 1, 1.7][settings.get('particles')] || 1; },
  pixelRatio() {
    const cap = settings.get('renderScale') / 100;
    return Math.min(window.devicePixelRatio || 1, 2) * cap;
  },
  frameInterval() {
    const f = settings.get('fpsLimit');
    return f > 0 ? 1000 / f - 0.4 : 0;
  },
};
