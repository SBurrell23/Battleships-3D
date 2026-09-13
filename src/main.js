/* =========================================================
   BATTLESHIPS 3D - application controller.
   Owns screen flow, the lobby handshake and the live match.
   ========================================================= */

import { Stage } from './render/stage.js';
import { UI } from './ui/ui.js';
import { Match, PHASE } from './core/game.js';
import { Net, codeFromURL, inviteURL, normalizeCode, friendlyPeerError } from './core/net.js';
import { COLORS, COLOR_BY_ID, defaultConfig, PROTOCOL_VERSION, DIFFICULTIES } from './core/constants.js';
import { settings } from './core/settings.js';
import { sfx, startAmbience, startMusic } from './core/audio.js';

const app = {
  ui: null,
  stage: null,
  net: null,
  match: null,
  mode: null,          // 'ai' | 'host' | 'join'
  config: defaultConfig(),
  me: { name: 'ADMIRAL', colorId: 'blue' },
  foe: { name: 'ENEMY', colorId: 'red' },
  foeJoined: false,
  rematch: { me: false, foe: false },
};

/* =========================================================
   Boot
   ========================================================= */

function boot() {
  const ui = new UI(callbacks());
  app.ui = ui;
  ui.init();

  ui.bootStatus('BUILDING THE THEATRE');
  const canvas = document.getElementById('gl');
  let stage;
  try {
    stage = new Stage(canvas);
  } catch (err) {
    console.error(err);
    ui.hideBoot();
    ui.fatal('NO GRAPHICS DEVICE', 'WebGL could not start in this browser. Try a different browser, or enable hardware acceleration.');
    return;
  }
  app.stage = stage;

  stage.addEventListener('cell', (e) => onCell(e.detail));
  stage.addEventListener('hover', (e) => app.match && app.match.onHover(e.detail));
  stage.addEventListener('fps', (e) => ui.setFps(e.detail.fps));
  stage.addEventListener('cammode', (e) => ui.setCamMode(e.detail.mode));

  ui.bootStatus('LAUNCHING THE FLEET');
  stage.showcase();
  stage.start();

  bindKeys();
  window.addEventListener('pointerdown', () => { startAmbience(); }, { once: true });

  const invite = codeFromURL();
  setTimeout(() => {
    ui.hideBoot();
    if (invite) {
      openLobby('join');
      document.getElementById('join-code').value = invite;
      ui.setLobbyStatus('INVITE DETECTED - PRESS LINK UP', 'live');
    } else {
      ui.showScreen('title');
    }
  }, 620);
}

/* =========================================================
   Callbacks from the UI
   ========================================================= */

function callbacks() {
  return {
    onNav: (what) => {
      switch (what) {
        case 'ai': openLobby('ai'); break;
        case 'host': openLobby('host'); break;
        case 'join': openLobby('join'); break;
        case 'settings': app.ui.openSettings(!!app.match && app.match.phase !== PHASE.OVER); break;
        case 'help': app.ui.openHelp(); break;
        case 'title': returnToPort(); break;
        default: break;
      }
    },

    onIdentity: () => {
      app.me.name = app.ui.getName();
      app.me.colorId = app.ui.getColor();
      refreshRoster();
      if (app.net && app.net.open) sendHello();
    },

    onConfigChange: (cfg) => {
      if (app.mode === 'join') return;
      app.config = cfg;
      if (app.mode === 'host' && app.net && app.net.open) app.net.send('config', { config: cfg });
      refreshLaunch();
    },

    onFleetValidity: () => refreshLaunch(),

    onConnect: (raw) => doJoin(raw),

    onLaunch: () => launch(),

    onTrayPick: (uid) => app.match && app.match.selectShip(uid),
    onRotate: () => app.match && app.match.rotate(),
    onRandom: () => app.match && app.match.autoPlace(),
    onClear: () => app.match && app.match.clearPlacement(),
    onReady: () => app.match && app.match.confirmReady(),

    onCam: (mode) => {
      app.stage.rig.setMode(mode);
      app.ui.setCamMode(mode);
    },

    onRematch: () => requestRematch(),

    onAbandon: () => {
      app.ui.closeSettings();
      if (app.match) app.match.resign();
    },

    onSettingsOpen: () => { if (app.match) app.match.setPaused(true); },
    onSettingsClose: () => { if (app.match) app.match.setPaused(false); },
  };
}

/* =========================================================
   Lobby
   ========================================================= */

function openLobby(mode) {
  teardownMatch();
  teardownNet();
  app.mode = mode;
  app.foeJoined = false;
  app.rematch = { me: false, foe: false };

  const ui = app.ui;
  app.me.name = ui.getName();
  app.me.colorId = ui.getColor();

  ui.setLobbyMode(mode);
  ui.setTakenColor(null);
  ui.setConfig(app.config);
  ui.showScreen('lobby');
  ui.showHud(null);
  ui.setNetMode(mode !== 'ai');

  if (mode === 'ai') {
    app.foe.colorId = pickFoeColor(app.me.colorId);
    app.foe.name = DIFFICULTIES[ui.getDifficulty()]?.name || 'COMMANDER';
    ui.setLobbyStatus('READY WHEN YOU ARE', 'live');
    ui.setLaunchEnabled(true);
  } else if (mode === 'host') {
    ui.setLobbyStatus('RESERVING A BATTLE CODE...', '');
    ui.setLaunchEnabled(false);
    doHost();
  } else {
    ui.setHostCode(null, null);
    ui.setLobbyStatus('ENTER A BATTLE CODE TO LINK UP', '');
    ui.setLaunchEnabled(false);
  }
  refreshRoster();
}

function pickFoeColor(mine) {
  const c = COLORS.find((x) => x.id !== mine && ['red', 'orange', 'purple', 'green'].includes(x.id));
  return (c || COLORS.find((x) => x.id !== mine)).id;
}

async function doHost() {
  const ui = app.ui;
  const net = new Net();
  app.net = net;
  bindNet(net);
  try {
    const code = await net.host();
    ui.setHostCode(code, inviteURL(code));
    ui.setLobbyStatus('WAITING FOR A CHALLENGER', '');
  } catch (err) {
    console.error(err);
    ui.setLobbyStatus(friendlyPeerError(err).toUpperCase(), 'err');
    sfx('uiError');
  }
}

async function doJoin(raw) {
  const ui = app.ui;
  const code = normalizeCode(raw);
  if (code.length < 4) {
    ui.setLobbyStatus('THAT BATTLE CODE LOOKS TOO SHORT', 'err');
    sfx('uiError');
    return;
  }
  teardownNet();
  const net = new Net();
  app.net = net;
  bindNet(net);
  ui.setLobbyStatus('DIALLING...', '');
  try {
    await net.join(code);
  } catch (err) {
    console.error(err);
    ui.setLobbyStatus((err.message || 'LINK FAILED').toUpperCase(), 'err');
    sfx('uiError');
    teardownNet();
  }
}

function bindNet(net) {
  net.addEventListener('connected', () => {
    sfx('connect');
    app.ui.setLobbyStatus('LINK ESTABLISHED', 'live');
    sendHello();
    if (app.mode === 'host') net.send('config', { config: app.config });
  });

  net.addEventListener('ping', (e) => app.ui.setPing(e.detail.ping));

  net.addEventListener('message', (e) => onLobbyMessage(e.detail));

  net.addEventListener('closed', () => {
    app.ui.setPing(null);
    if (app.match && !app.match.over) return;   // the match layer reports this itself
    app.foeJoined = false;
    refreshRoster();
    refreshLaunch();
    app.ui.setLobbyStatus('THE OTHER SIDE DISCONNECTED', 'err');
    sfx('disconnect');
  });

  net.addEventListener('failed', (e) => {
    app.ui.setLobbyStatus((e.detail.message || 'LINK FAILED').toUpperCase(), 'err');
  });
}

function sendHello() {
  if (!app.net || !app.net.open) return;
  app.net.send('hello', {
    v: PROTOCOL_VERSION,
    name: app.me.name,
    color: app.me.colorId,
  });
}

function onLobbyMessage(msg) {
  switch (msg.t) {
    case 'hello': {
      if (msg.v !== PROTOCOL_VERSION) {
        app.ui.setLobbyStatus('VERSION MISMATCH - BOTH SIDES MUST RELOAD', 'err');
        return;
      }
      app.foe.name = String(msg.name || 'CHALLENGER').slice(0, 14);
      app.foe.colorId = COLOR_BY_ID[msg.color] ? msg.color : 'red';
      app.foeJoined = true;
      app.ui.setTakenColor(app.foe.colorId);

      // Host arbitrates a colour clash so both fleets stay readable.
      if (app.mode === 'host' && app.foe.colorId === app.me.colorId) {
        app.net.send('colorclash', { taken: app.me.colorId });
      }
      app.ui.setLobbyStatus('CHALLENGER LINKED', 'live');
      refreshRoster();
      refreshLaunch();
      break;
    }

    case 'colorclash': {
      const free = COLORS.find((c) => c.id !== msg.taken && c.id !== app.foe.colorId) || COLORS[0];
      app.me.colorId = free.id;
      app.ui.setColor(free.id);
      settings.set('playerColor', free.id);
      app.ui.setLobbyStatus('COLOUR TAKEN - REASSIGNED', '');
      sendHello();
      refreshRoster();
      break;
    }

    case 'config': {
      if (app.mode !== 'join') break;
      app.config = { ...defaultConfig(), ...msg.config };
      app.ui.setConfig(app.config);
      break;
    }

    case 'start': {
      if (app.mode !== 'join') break;
      app.config = { ...defaultConfig(), ...msg.config };
      app.ui.setConfig(app.config);
      startMatch(!msg.hostFirst);
      break;
    }

    case 'rematch': {
      app.rematch.foe = true;
      maybeRematch();
      break;
    }

    default: break;
  }
}

function refreshRoster() {
  const ui = app.ui;
  const meEntry = {
    name: `${app.me.name} (YOU)`,
    color: COLOR_BY_ID[app.me.colorId]?.css,
    status: app.mode === 'host' ? 'HOST' : app.mode === 'join' ? 'CHALLENGER' : 'ADMIRAL',
    ok: true,
  };
  if (app.mode === 'ai') {
    ui.setRoster([meEntry, {
      name: app.foe.name || 'ADMIRALTY A.I.',
      color: COLOR_BY_ID[app.foe.colorId]?.css,
      status: (DIFFICULTIES[ui.getDifficulty()]?.name) || 'A.I.',
      ok: true,
    }]);
    return;
  }
  const foeEntry = app.foeJoined
    ? { name: app.foe.name, color: COLOR_BY_ID[app.foe.colorId]?.css, status: app.mode === 'host' ? 'CHALLENGER' : 'HOST', ok: true }
    : { name: 'Waiting for opponent', status: 'OPEN SLOT', empty: true };
  ui.setRoster([meEntry, foeEntry]);
}

function refreshLaunch() {
  const ui = app.ui;
  if (app.mode === 'ai') { ui.setLaunchEnabled(ui.fleetValid); return; }
  if (app.mode === 'host') {
    ui.setLaunchEnabled(app.foeJoined && ui.fleetValid);
    if (app.foeJoined && ui.fleetValid) ui.setLobbyStatus('CHALLENGER READY - DEPLOY WHEN SET', 'live');
    return;
  }
  ui.setLaunchEnabled(false);
  if (app.foeJoined) ui.setLobbyStatus('LINKED - WAITING FOR THE HOST TO DEPLOY', 'live');
}

/* =========================================================
   Match lifecycle
   ========================================================= */

function launch() {
  if (app.mode === 'ai') {
    app.foe.name = DIFFICULTIES[app.ui.getDifficulty()]?.name || 'COMMANDER';
    app.foe.colorId = pickFoeColor(app.me.colorId);
    startMatch(null);
    return;
  }
  if (app.mode === 'host') {
    if (!app.foeJoined) return;
    const hostFirst = Match.rollFirstTurn();
    app.net.send('start', { config: app.config, hostFirst });
    startMatch(hostFirst);
  }
}

function startMatch(firstTurnIsMine) {
  teardownMatch();
  app.ui.clearLog();
  app.ui.showScreen(null);

  const difficulty = app.ui.getDifficulty();
  const m = new Match({
    mode: app.mode,
    config: app.config,
    me: { ...app.me },
    foe: { ...app.foe },
    net: app.mode === 'ai' ? null : app.net,
    difficulty,
    stage: app.stage,
  });
  app.match = m;
  if (firstTurnIsMine !== null) m.setFirstTurn(firstTurnIsMine);

  bindMatch(m);
  app.ui.setCombatants(app.me, m.foe);
  app.ui.setStatus(m.statusSnapshot());
  app.ui.showHud('place');
  app.ui.setCamMode('free');
  m.begin();
  startMusic();
}

function bindMatch(m) {
  const ui = app.ui;

  m.addEventListener('phase', (e) => {
    const p = e.detail.phase;
    if (p === PHASE.PLACE) {
      ui.showHud('place');
      ui.setPlacementWaiting(false);
    } else if (p === PHASE.WAIT_FOE) {
      ui.setPlacementWaiting(true);
    } else if (p === PHASE.BATTLE) {
      ui.showHud('battle');
      ui.setStatus(m.statusSnapshot());
    } else if (p === PHASE.OVER) {
      ui.showHud('battle');
    }
  });

  m.addEventListener('placement', (e) => ui.setPlacement(e.detail));
  m.addEventListener('status', (e) => ui.setStatus(e.detail));
  m.addEventListener('turn', (e) => ui.setTurn(e.detail.mine));
  m.addEventListener('timer', (e) => ui.setTimer(e.detail.remaining, e.detail.total));
  m.addEventListener('log', (e) => ui.addLog(e.detail.text, e.detail.kind));
  m.addEventListener('toast', (e) => ui.toast(e.detail.text, e.detail.kind));
  m.addEventListener('banner', (e) => ui.banner(e.detail.text));

  m.addEventListener('over', (e) => {
    app.rematch = { me: false, foe: false };
    ui.setTurnLabel(e.detail.won ? 'ENEMY FLEET DESTROYED' : 'OUR FLEET IS LOST');
    setTimeout(() => ui.showResult(e.detail.stats), 2600);
  });

  m.addEventListener('lost', (e) => {
    ui.fatal('SIGNAL LOST', e.detail.message);
  });

  m.addEventListener('rematch', () => {
    app.rematch.foe = true;
    maybeRematch();
  });
}

function onCell(cell) {
  const m = app.match;
  if (!m) return;
  if (m.phase === PHASE.PLACE && cell.side === 'own') m.placeAt(cell.gx, cell.gy);
  else if (m.phase === PHASE.BATTLE && cell.side === 'foe') m.fireAt(cell.gx, cell.gy);
}

function requestRematch() {
  const ui = app.ui;
  if (app.mode === 'ai') {
    app.foe.colorId = pickFoeColor(app.me.colorId);
    startMatch(null);
    return;
  }
  if (!app.net || !app.net.open) {
    ui.fatal('SIGNAL LOST', 'The link to your opponent is gone. Return to port and host a new engagement.');
    return;
  }
  app.rematch.me = true;
  app.net.send('rematch', {});
  ui.setRematchWaiting(true);
  maybeRematch();
}

function maybeRematch() {
  if (!app.rematch.me || !app.rematch.foe) {
    if (app.rematch.foe && !app.rematch.me) app.ui.setRematchWaiting(false);
    return;
  }
  app.rematch = { me: false, foe: false };
  if (app.mode === 'host') {
    const hostFirst = Match.rollFirstTurn();
    app.net.send('start', { config: app.config, hostFirst });
    startMatch(hostFirst);
  }
  // The guest restarts when the host's 'start' arrives.
}

function teardownMatch() {
  if (!app.match) return;
  app.match.destroy();
  app.match = null;
}

function teardownNet() {
  if (!app.net) return;
  app.net.destroy();
  app.net = null;
  app.ui.setPing(null);
}

function returnToPort() {
  teardownMatch();
  teardownNet();
  app.mode = null;
  app.foeJoined = false;
  app.ui.clearFatal();
  app.ui.closeSettings();
  app.ui.closeHelp();
  app.ui.showHud(null);
  app.ui.showScreen('title');
  app.ui.setNetMode(false);
  app.stage.showcase();
}

/* =========================================================
   Keyboard
   ========================================================= */

function bindKeys() {
  window.addEventListener('keydown', (e) => {
    const ui = app.ui;
    if (e.target instanceof HTMLInputElement) {
      if (e.key === 'Escape') e.target.blur();
      return;
    }

    if (e.key === 'Escape') {
      e.preventDefault();
      if (ui.helpOpen) ui.closeHelp();
      else if (ui.settingsOpen) ui.closeSettings();
      else ui.openSettings(!!app.match && app.match.phase !== PHASE.OVER);
      return;
    }
    if (ui.settingsOpen || ui.helpOpen) return;

    const m = app.match;
    switch (e.code) {
      case 'Digit1': camera('overview'); break;
      case 'Digit2': camera('own'); break;
      case 'Digit3': camera('foe'); break;
      case 'Digit4': camera('free'); break;
      case 'KeyR':
        if (m && m.phase === PHASE.PLACE) { e.preventDefault(); m.rotate(); }
        break;
      case 'KeyF':
        if (m && m.phase === PHASE.PLACE) { e.preventDefault(); m.autoPlace(); }
        break;
      case 'Space':
        if (m && m.phase === PHASE.PLACE) { e.preventDefault(); m.confirmReady(); }
        break;
      default: break;
    }
  });
}

function camera(mode) {
  if (!app.stage) return;
  app.stage.rig.setMode(mode);
  app.ui.setCamMode(mode);
  sfx('uiClick');
}

/* =========================================================
   Go
   ========================================================= */

window.addEventListener('error', (e) => {
  console.error('[fatal]', e.error || e.message);
});

/* Debug handle: inspect state or drive frames by hand from the console. */
window.BS3D = app;
app.step = (n = 1, dt = 1 / 60) => { for (let i = 0; i < n; i++) app.stage.frame(dt); };

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
