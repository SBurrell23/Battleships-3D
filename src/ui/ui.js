/* =========================================================
   DOM layer. Pure view + input reporting - it never touches
   the rulebook or the network directly.
   ========================================================= */

import { paintIcons } from './icons.js';
import { COLORS, COLOR_BY_ID, SHIP_CLASSES, DIFFICULTIES, defaultConfig } from '../core/constants.js';
import { totalTiles, totalHulls, Board } from '../core/board.js';
import { settings } from '../core/settings.js';
import { sfx, unlockAudio } from '../core/audio.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const KEYS = [
  [['1'], 'Overview camera'],
  [['2'], 'Your waters'],
  [['3'], 'Enemy waters'],
  [['4'], 'Free camera'],
  [['R'], 'Rotate hull during deployment'],
  [['F'], 'Auto-deploy the fleet'],
  [['Space'], 'Confirm / ready up'],
  [['Esc'], 'Settings'],
  [['Drag'], 'Orbit the theatre'],
  [['R-Drag'], 'Pan the theatre'],
  [['Wheel'], 'Zoom in and out'],
  [['W', 'A', 'S', 'D'], 'Fly in free camera'],
  [['Q', 'E'], 'Descend / climb in free camera'],
  [['Shift'], 'Hold to fly faster'],
];

export class UI {
  constructor(callbacks = {}) {
    this.cb = callbacks;
    this.config = defaultConfig();
    this.rulesLocked = false;
    this.takenColor = null;
    this._pipCache = { mine: null, foe: null };
    this._logCount = 0;
  }

  /* =====================================================
     Boot
     ===================================================== */

  init() {
    paintIcons();
    this._buildColors();
    this._buildFleetEditor();
    this._buildKeys();
    this._bindNav();
    this._bindLobby();
    this._bindPlacement();
    this._bindBattle();
    this._bindSettings();
    this._syncSettingsUI();

    const savedName = settings.get('playerName');
    if (savedName) $('#player-name').value = savedName;
    this.setColor(settings.get('playerColor') || 'blue');

    // Any pointer or key press is a good enough gesture to start audio.
    const kick = () => { unlockAudio(); };
    window.addEventListener('pointerdown', kick, { once: true });
    window.addEventListener('keydown', kick, { once: true });
  }

  hideBoot() {
    const b = $('#boot');
    b.classList.add('gone');
    document.body.classList.remove('booting');
    setTimeout(() => { b.hidden = true; }, 600);
  }

  bootStatus(t) { $('#boot-status').textContent = t; }

  /* =====================================================
     Screens
     ===================================================== */

  showScreen(name) {
    for (const id of ['title', 'lobby', 'over']) {
      $(`#screen-${id}`).hidden = (id !== name);
    }
  }

  showHud(name) {
    $('#hud-place').hidden = name !== 'place';
    $('#hud-battle').hidden = name !== 'battle';
    $('#net-badge').hidden = !(name === 'battle' && this._netMode);
  }

  setNetMode(on) {
    this._netMode = on;
    $('#net-badge').hidden = !on;
  }

  setPing(ms) {
    const el = $('#net-ping');
    if (!el) return;
    el.textContent = ms == null ? '--' : `${ms}ms`;
    $('#net-badge').classList.toggle('bad', ms != null && ms > 240);
  }

  _bindNav() {
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-nav]');
      if (!btn) return;
      sfx('uiClick');
      this.cb.onNav?.(btn.dataset.nav);
    });
    document.addEventListener('pointerover', (e) => {
      const b = e.target.closest('.steel-btn, .icon-btn, .cam-btn, .seg button, .swatch, .tabs button, .stepper button, .tray-item');
      if (b) sfx('uiHover', { throttle: 40 });
    });
  }

  /* =====================================================
     Lobby
     ===================================================== */

  setLobbyMode(mode) {
    this.lobbyMode = mode;
    $('#lobby-host-box').hidden = mode !== 'host';
    $('#lobby-join-box').hidden = mode !== 'join';
    $('#lobby-ai-box').hidden = mode !== 'ai';
    $('#lobby-title').textContent = {
      ai: 'SINGLE COMBAT', host: 'HOST ENGAGEMENT', join: 'JOIN ENGAGEMENT',
    }[mode] || 'ENGAGEMENT SETUP';
    $('#ai-diff-hint').textContent = DIFFICULTIES[this.getDifficulty()]?.blurb || '';
    const locked = mode === 'join';
    this.lockRules(locked);
    $('#rules-lock').hidden = !locked;
    $('#btn-launch').querySelector('span').textContent = mode === 'join' ? 'AWAITING HOST' : 'DEPLOY FLEET';
  }

  lockRules(locked) {
    this.rulesLocked = locked;
    for (const id of ['#opt-grid', '#opt-timer', '#opt-extra', '#opt-touch']) {
      $(id).classList.toggle('locked', locked);
    }
    $('#fleet-editor').classList.toggle('locked', locked);
    $$('#fleet-editor button').forEach((b) => { b.disabled = locked; });
  }

  setHostCode(code, link) {
    $('#host-code').textContent = code || '--------';
    $('#host-link').textContent = link || '—';
    this._inviteLink = link;
    this._code = code;
  }

  setLobbyStatus(text, kind = '') {
    const el = $('#lobby-status');
    el.textContent = text;
    el.className = `status-line ${kind}`;
  }

  setLaunchEnabled(on) { $('#btn-launch').disabled = !on; }

  setRoster(entries) {
    const ul = $('#roster');
    ul.innerHTML = '';
    for (const e of entries) {
      const li = document.createElement('li');
      if (e.empty) li.classList.add('empty');
      const flag = document.createElement('span');
      flag.className = 'flagchip';
      flag.style.setProperty('--c', e.color || '#4a5560');
      const name = document.createElement('span');
      name.className = 'rn';
      name.textContent = e.name;
      const st = document.createElement('span');
      st.className = `rs ${e.ok ? 'ok' : ''}`;
      st.textContent = e.status;
      li.append(flag, name, st);
      ul.append(li);
    }
  }

  getName() {
    const v = $('#player-name').value.trim();
    return v || 'ADMIRAL';
  }

  getDifficulty() { return $('#ai-difficulty').dataset.value; }

  getConfig() { return JSON.parse(JSON.stringify(this.config)); }

  setConfig(cfg) {
    this.config = JSON.parse(JSON.stringify(cfg));
    this._setSeg('#opt-grid', String(cfg.gridSize));
    this._setSeg('#opt-timer', String(cfg.turnTimer));
    this._setSeg('#opt-extra', cfg.extraTurnOnHit ? '1' : '0');
    this._setSeg('#opt-touch', cfg.allowTouching ? '1' : '0');
    this._renderFleetEditor();
  }

  _bindLobby() {
    this._seg('#ai-difficulty', (v) => {
      $('#ai-diff-hint').textContent = DIFFICULTIES[v]?.blurb || '';
    });
    this._seg('#opt-grid', (v) => { this.config.gridSize = +v; this._fleetChanged(); });
    this._seg('#opt-timer', (v) => { this.config.turnTimer = +v; this._pushConfig(); });
    this._seg('#opt-extra', (v) => { this.config.extraTurnOnHit = v === '1'; this._pushConfig(); });
    this._seg('#opt-touch', (v) => { this.config.allowTouching = v === '1'; this._pushConfig(); });

    $('#btn-copy-code').addEventListener('click', () => this._copy(this._code, 'BATTLE CODE COPIED'));
    $('#btn-copy-link').addEventListener('click', () => this._copy(this._inviteLink, 'INVITE LINK COPIED'));

    $('#btn-connect').addEventListener('click', () => {
      sfx('uiHeavy');
      this.cb.onConnect?.($('#join-code').value);
    });
    $('#join-code').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { sfx('uiHeavy'); this.cb.onConnect?.(e.target.value); }
    });
    $('#join-code').addEventListener('input', (e) => {
      e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    });

    $('#player-name').addEventListener('input', (e) => {
      settings.set('playerName', e.target.value.trim());
      this.cb.onIdentity?.();
    });

    $('#btn-launch').addEventListener('click', () => {
      sfx('uiHeavy');
      this.cb.onLaunch?.();
    });
  }

  async _copy(text, msg) {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      this.setLobbyStatus(msg, 'live');
      sfx('uiHeavy');
    } catch {
      this.setLobbyStatus('COPY BLOCKED - SELECT THE TEXT MANUALLY', 'err');
      sfx('uiError');
    }
  }

  /* ---- colours ---- */

  _buildColors() {
    const wrap = $('#color-picker');
    wrap.innerHTML = '';
    for (const c of COLORS) {
      const b = document.createElement('button');
      b.className = 'swatch';
      b.dataset.color = c.id;
      b.style.background = `linear-gradient(160deg, ${c.css}, ${shade(c.css, -34)})`;
      b.title = c.name;
      b.addEventListener('click', () => {
        if (b.classList.contains('taken')) { sfx('uiError'); return; }
        sfx('uiClick');
        this.setColor(c.id);
        settings.set('playerColor', c.id);
        this.cb.onIdentity?.();
      });
      wrap.append(b);
    }
  }

  setColor(id) {
    this.colorId = id;
    $$('#color-picker .swatch').forEach((b) => b.classList.toggle('on', b.dataset.color === id));
    document.documentElement.style.setProperty('--team', COLOR_BY_ID[id]?.css || '#3d83d6');
  }

  getColor() { return this.colorId; }

  /** Grey out the colour the opponent took, and bounce us off it if needed. */
  setTakenColor(id) {
    this.takenColor = id;
    $$('#color-picker .swatch').forEach((b) => {
      b.classList.toggle('taken', !!id && b.dataset.color === id && b.dataset.color !== this.colorId);
    });
  }

  /* ---- fleet editor ---- */

  _buildFleetEditor() {
    this._renderFleetEditor();
  }

  _renderFleetEditor() {
    const wrap = $('#fleet-editor');
    wrap.innerHTML = '';
    for (const cls of SHIP_CLASSES) {
      const n = this.config.fleet[cls.id] | 0;
      const row = document.createElement('div');
      row.className = 'fleet-row';

      const name = document.createElement('span');
      name.className = 'fr-name';
      name.textContent = cls.name;

      const cells = document.createElement('span');
      cells.className = 'fr-cells';
      for (let i = 0; i < cls.size; i++) cells.append(document.createElement('i'));

      const count = document.createElement('span');
      count.className = 'fr-count';
      count.textContent = `×${n}`;

      const stepper = document.createElement('span');
      stepper.className = 'stepper';
      const minus = document.createElement('button');
      minus.textContent = '−';
      minus.disabled = n <= 0 || this.rulesLocked;
      const plus = document.createElement('button');
      plus.textContent = '+';
      plus.disabled = n >= cls.max || this.rulesLocked;
      minus.addEventListener('click', () => this._bumpFleet(cls.id, -1));
      plus.addEventListener('click', () => this._bumpFleet(cls.id, +1));
      stepper.append(minus, plus);

      row.append(name, cells, count, stepper);
      wrap.append(row);
    }
    this._updateFleetSummary();
  }

  _bumpFleet(id, d) {
    if (this.rulesLocked) return;
    const cls = SHIP_CLASSES.find((c) => c.id === id);
    const next = Math.max(0, Math.min(cls.max, (this.config.fleet[id] | 0) + d));
    if (next === this.config.fleet[id]) return;
    this.config.fleet[id] = next;
    sfx('uiClick');
    this._fleetChanged();
  }

  _fleetChanged() {
    this._renderFleetEditor();
    this._pushConfig();
  }

  _pushConfig() {
    this._updateFleetSummary();
    this.cb.onConfigChange?.(this.getConfig());
  }

  _updateFleetSummary() {
    const hulls = totalHulls(this.config.fleet);
    const tiles = totalTiles(this.config.fleet);
    const area = this.config.gridSize * this.config.gridSize;
    const density = Math.round((tiles / area) * 100);
    $('#fleet-count').textContent = `${hulls} HULL${hulls === 1 ? '' : 'S'}`;
    $('#fleet-tiles').textContent = `${tiles} TILES`;
    $('#fleet-density').textContent = `${density}% COVER`;

    const warn = $('#fleet-warn');
    const longest = Math.max(0, ...SHIP_CLASSES.filter((c) => this.config.fleet[c.id] > 0).map((c) => c.size));
    if (hulls === 0) {
      warn.textContent = 'A fleet needs at least one hull.';
      warn.className = 'hint warn';
      this._fleetValid = false;
    } else if (longest > this.config.gridSize) {
      warn.textContent = 'A hull is longer than the grid. Reduce the fleet or enlarge the grid.';
      warn.className = 'hint warn';
      this._fleetValid = false;
    } else if (!this._fleetFits()) {
      warn.textContent = 'This fleet will not fit in these waters. Enlarge the grid, drop a hull, or allow hulls to touch.';
      warn.className = 'hint warn';
      this._fleetValid = false;
    } else if (density > 38) {
      warn.textContent = 'Very crowded waters - expect long, grinding engagements.';
      warn.className = 'hint warn';
      this._fleetValid = true;
    } else {
      warn.textContent = '';
      warn.className = 'hint';
      this._fleetValid = true;
    }
    this.cb.onFleetValidity?.(this._fleetValid);
  }

  /**
   * Density heuristics are unreliable once hulls may not touch, so the only
   * honest test is to actually lay the fleet out. A handful of attempts is
   * cheap and tells us whether a human could ever deploy it.
   */
  _fleetFits() {
    const key = `${this.config.gridSize}|${this.config.allowTouching}|${SHIP_CLASSES.map((c) => this.config.fleet[c.id] | 0).join(',')}`;
    if (this._fitKey === key) return this._fitResult;
    let ok = false;
    for (let i = 0; i < 3 && !ok; i++) {
      const b = new Board(this.config.gridSize, this.config.fleet, { allowTouching: this.config.allowTouching });
      ok = b.autoPlace();
    }
    this._fitKey = key;
    this._fitResult = ok;
    return ok;
  }

  get fleetValid() { return this._fleetValid !== false; }

  /* =====================================================
     Placement
     ===================================================== */

  _bindPlacement() {
    $('#btn-rotate').addEventListener('click', () => { sfx('uiClick'); this.cb.onRotate?.(); });
    $('#btn-random').addEventListener('click', () => { sfx('uiClick'); this.cb.onRandom?.(); });
    $('#btn-clear').addEventListener('click', () => { sfx('uiClick'); this.cb.onClear?.(); });
    $('#btn-ready').addEventListener('click', () => { this.cb.onReady?.(); });
  }

  setPlacement(state) {
    const list = $('#tray-list');
    list.innerHTML = '';
    for (const r of state.roster) {
      const li = document.createElement('li');
      li.className = `tray-item${r.selected ? ' on' : ''}${r.placed ? ' done' : ''}`;
      const name = document.createElement('span');
      name.className = 'ti-name';
      name.textContent = r.name;
      const cells = document.createElement('span');
      cells.className = 'ti-cells';
      for (let i = 0; i < r.size; i++) cells.append(document.createElement('i'));
      li.append(name, cells);
      li.addEventListener('click', () => { sfx('uiClick'); this.cb.onTrayPick?.(r.uid); });
      list.append(li);
    }
    $('#place-progress').textContent = `${state.placed} / ${state.total} HULLS ANCHORED`;
    $('#btn-ready').disabled = !state.complete;
    $('#place-note').textContent = state.complete
      ? 'Fleet anchored. Confirm when ready.'
      : (state.horizontal ? 'Orientation: BROADSIDE (press R)' : 'Orientation: COLUMN (press R)');
  }

  setPlacementWaiting(on) {
    $('#place-note').textContent = on ? 'Waiting on the enemy fleet...' : '';
    $('#btn-ready').disabled = on;
  }

  /* =====================================================
     Battle HUD
     ===================================================== */

  _bindBattle() {
    $$('.cam-btn').forEach((b) => {
      b.addEventListener('click', () => { sfx('uiClick'); this.cb.onCam?.(b.dataset.cam); });
    });
    $('#btn-rematch').addEventListener('click', () => { sfx('uiHeavy'); this.cb.onRematch?.(); });
  }

  setCamMode(mode) {
    $$('.cam-btn').forEach((b) => b.classList.toggle('on', b.dataset.cam === mode));
  }

  setCombatants(me, foe) {
    $('#you-name').textContent = me.name;
    $('#foe-name').textContent = foe.name;
    $('#you-flag').style.setProperty('--c', COLOR_BY_ID[me.colorId]?.css || '#3d83d6');
    $('#foe-flag').style.setProperty('--c', COLOR_BY_ID[foe.colorId]?.css || '#d6423c');
  }

  setStatus(snapshot) {
    this._renderPips('#you-pips', snapshot.mine);
    this._renderPips('#foe-pips', snapshot.foe);
  }

  _renderPips(sel, list) {
    const wrap = $(sel);
    const sig = list.map((s) => `${s.hits}/${s.size}${s.sunk ? 'x' : ''}`).join('|');
    if (wrap.dataset.sig === sig) return;
    wrap.dataset.sig = sig;
    wrap.innerHTML = '';
    for (const s of list) {
      const p = document.createElement('span');
      p.className = `pip${s.sunk ? ' sunk' : ''}`;
      p.title = `${s.name} (${s.hits}/${s.size})`;
      for (let i = 0; i < s.size; i++) {
        const i2 = document.createElement('i');
        if (i < s.hits) i2.className = 'hit';
        p.append(i2);
      }
      wrap.append(p);
    }
  }

  setTurn(mine) {
    const l = $('#turn-label');
    l.textContent = mine ? 'YOUR SALVO' : 'ENEMY SALVO';
    l.className = `turn-label ${mine ? 'you' : 'foe'} pulse`;
    setTimeout(() => l.classList.remove('pulse'), 720);
    $('#plate-you').classList.toggle('active', mine);
    $('#plate-foe').classList.toggle('active', !mine);
    $('#fire-prompt').hidden = !mine;
  }

  setTurnLabel(text) {
    const l = $('#turn-label');
    l.textContent = text;
    l.className = 'turn-label';
    $('#fire-prompt').hidden = true;
  }

  setTimer(remaining, total) {
    const shell = $('.timer-shell');
    const fill = $('#timer-fill');
    const txt = $('#timer-text');
    if (!total) {
      fill.style.transform = 'scaleX(1)';
      txt.textContent = 'NO TIME LIMIT';
      shell.className = 'timer-shell';
      return;
    }
    const k = Math.max(0, Math.min(1, remaining / total));
    fill.style.transform = `scaleX(${k})`;
    txt.textContent = `${Math.ceil(remaining)}s`;
    shell.className = `timer-shell${k < 0.18 ? ' crit' : k < 0.4 ? ' low' : ''}`;
  }

  addLog(text, kind = '') {
    const log = $('#log');
    const line = document.createElement('div');
    line.className = `log-line ${kind}`;
    const n = String(++this._logCount).padStart(3, '0');
    line.innerHTML = `<span>${n}</span> <b></b>`;
    line.querySelector('b').textContent = text;
    log.prepend(line);
    while (log.children.length > 14) log.lastChild.remove();
  }

  clearLog() { $('#log').innerHTML = ''; this._logCount = 0; }

  toast(text, kind = '') {
    const wrap = $('#toast-wrap');
    const t = document.createElement('div');
    t.className = `toast ${kind}`;
    t.textContent = text;
    wrap.append(t);
    setTimeout(() => t.remove(), 2000);
  }

  banner(text) {
    const b = $('#banner');
    $('#banner-text').textContent = text;
    b.hidden = false;
    clearTimeout(this._bannerTimer);
    this._bannerTimer = setTimeout(() => { b.hidden = true; }, 1950);
    // Re-trigger the entry animation on repeat calls.
    const inner = $('.banner-inner');
    inner.style.animation = 'none';
    void inner.offsetWidth;
    inner.style.animation = '';
  }

  /* =====================================================
     Result
     ===================================================== */

  showResult(s) {
    const panel = $('.result-panel');
    panel.classList.toggle('lose', !s.won);
    $('#result-title').textContent = s.won ? 'VICTORY' : 'DEFEAT';
    $('#result-sub').textContent = s.won
      ? 'ENEMY FLEET SENT TO THE DEEP'
      : 'OUR COLOURS HAVE FALLEN';
    const stats = [
      ['SHOTS FIRED', s.shots],
      ['DIRECT HITS', s.hits],
      ['ACCURACY', `${s.accuracy}%`],
      ['HULLS SUNK', s.sunk],
    ];
    const wrap = $('#result-stats');
    wrap.innerHTML = '';
    for (const [label, val] of stats) {
      const d = document.createElement('div');
      d.className = 'rstat';
      const b = document.createElement('b');
      b.textContent = val;
      const sp = document.createElement('span');
      sp.textContent = label;
      d.append(b, sp);
      wrap.append(d);
    }
    $('#result-wait').hidden = true;
    $('#btn-rematch').disabled = false;
    this.showScreen('over');
  }

  setRematchWaiting(on) {
    $('#result-wait').hidden = !on;
    $('#btn-rematch').disabled = on;
  }

  /* =====================================================
     Settings + overlays
     ===================================================== */

  _bindSettings() {
    $('#settings-tabs').addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      sfx('uiClick');
      $$('#settings-tabs button').forEach((x) => x.classList.toggle('on', x === b));
      $$('.tab-body').forEach((x) => { x.hidden = x.dataset.tab !== b.dataset.tab; });
    });

    $('#btn-close-settings').addEventListener('click', () => this.closeSettings());
    $('#btn-resume').addEventListener('click', () => this.closeSettings());
    $('#btn-close-help').addEventListener('click', () => { sfx('uiBack'); $('#overlay-help').hidden = true; });
    $('#btn-abandon').addEventListener('click', () => { sfx('uiHeavy'); this.cb.onAbandon?.(); });
    $('#btn-reset-settings').addEventListener('click', () => {
      sfx('uiHeavy');
      settings.reset();
      this._syncSettingsUI();
    });

    const slider = (id, key, out) => {
      const el = $(id);
      el.addEventListener('input', () => {
        settings.set(key, +el.value);
        $(out).textContent = el.value;
      });
    };
    slider('#s-master', 'master', '#o-master');
    slider('#s-music', 'music', '#o-music');
    slider('#s-sfx', 'sfx', '#o-sfx');
    slider('#s-scale', 'renderScale', '#o-scale');

    this._seg('#s-blurmute', (v) => settings.set('blurMute', +v));
    this._seg('#s-fps', (v) => settings.set('fpsLimit', +v));
    this._seg('#s-aa', (v) => settings.set('antialias', +v));
    this._seg('#s-shadow', (v) => settings.set('shadows', +v));
    this._seg('#s-water', (v) => settings.set('water', +v));
    this._seg('#s-particles', (v) => settings.set('particles', +v));
    this._seg('#s-shake', (v) => settings.set('shake', +v));
    this._seg('#s-zoom', (v) => settings.set('actionZoom', +v));
    this._seg('#s-fpsmeter', (v) => {
      settings.set('fpsMeter', +v);
      $('#fps-meter').hidden = !+v;
    });
  }

  _syncSettingsUI() {
    const set = (id, key, out) => {
      $(id).value = settings.get(key);
      if (out) $(out).textContent = settings.get(key);
    };
    set('#s-master', 'master', '#o-master');
    set('#s-music', 'music', '#o-music');
    set('#s-sfx', 'sfx', '#o-sfx');
    set('#s-scale', 'renderScale', '#o-scale');
    this._setSeg('#s-blurmute', String(settings.get('blurMute')));
    this._setSeg('#s-fps', String(settings.get('fpsLimit')));
    this._setSeg('#s-aa', String(settings.get('antialias')));
    this._setSeg('#s-shadow', String(settings.get('shadows')));
    this._setSeg('#s-water', String(settings.get('water')));
    this._setSeg('#s-particles', String(settings.get('particles')));
    this._setSeg('#s-shake', String(settings.get('shake')));
    this._setSeg('#s-zoom', String(settings.get('actionZoom')));
    this._setSeg('#s-fpsmeter', String(settings.get('fpsMeter')));
    $('#fps-meter').hidden = !settings.get('fpsMeter');
  }

  openSettings(canAbandon) {
    $('#btn-abandon').hidden = !canAbandon;
    $('#overlay-settings').hidden = false;
    sfx('uiHeavy');
    this.cb.onSettingsOpen?.();
  }

  closeSettings() {
    if ($('#overlay-settings').hidden) return;
    $('#overlay-settings').hidden = true;
    sfx('uiBack');
    this.cb.onSettingsClose?.();
  }

  get settingsOpen() { return !$('#overlay-settings').hidden; }

  openHelp() { $('#overlay-help').hidden = false; sfx('uiHeavy'); }
  closeHelp() { $('#overlay-help').hidden = true; }
  get helpOpen() { return !$('#overlay-help').hidden; }

  setFps(v) {
    const el = $('#fps-meter');
    if (el.hidden) return;
    el.textContent = String(v).padStart(2, '0');
    el.style.color = v >= 55 ? '#4fae62' : v >= 30 ? '#e0a020' : '#c83a2a';
  }

  fatal(title, msg) {
    $('#fatal-title').textContent = title;
    $('#fatal-msg').textContent = msg;
    $('#fatal').hidden = false;
    sfx('disconnect');
  }

  clearFatal() { $('#fatal').hidden = true; }

  /* =====================================================
     helpers
     ===================================================== */

  _seg(sel, onChange) {
    const wrap = $(sel);
    wrap.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b || wrap.classList.contains('locked')) return;
      sfx('uiClick');
      this._setSeg(sel, b.dataset.val);
      onChange(b.dataset.val);
    });
  }

  _setSeg(sel, val) {
    const wrap = $(sel);
    if (!wrap) return;
    wrap.dataset.value = val;
    $$('button', wrap).forEach((b) => b.classList.toggle('on', b.dataset.val === val));
  }

  _buildKeys() {
    const ul = $('#keylist');
    ul.innerHTML = '';
    for (const [keys, desc] of KEYS) {
      const li = document.createElement('li');
      const kk = document.createElement('span');
      kk.className = 'kk';
      for (const k of keys) {
        const kbd = document.createElement('kbd');
        kbd.textContent = k;
        kk.append(kbd);
      }
      const d = document.createElement('span');
      d.className = 'kd';
      d.textContent = desc;
      li.append(kk, d);
      ul.append(li);
    }
  }
}

/* Lighten or darken a hex colour by a percentage. */
function shade(hex, pct) {
  const n = parseInt(hex.slice(1), 16);
  const f = (v) => Math.max(0, Math.min(255, Math.round(v + (pct / 100) * 255)));
  return `#${((1 << 24) + (f((n >> 16) & 255) << 16) + (f((n >> 8) & 255) << 8) + f(n & 255)).toString(16).slice(1)}`;
}
