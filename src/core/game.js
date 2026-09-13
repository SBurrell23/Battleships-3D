/* =========================================================
   Match: deployment, turn order, timers, and the bridge between
   the rulebook (board.js), the opponent (net.js / ai.js) and the
   presentation (stage.js).
   ========================================================= */

import { Board, TrackingGrid, buildRoster } from './board.js';
import { AIPlayer, aiThinkDelay, aiName } from './ai.js';
import { COLOR_BY_ID, cellLabel, PROTOCOL_VERSION } from './constants.js';
import { sfx, musicDuck } from './audio.js';

export const PHASE = {
  LOBBY: 'lobby',
  PLACE: 'place',
  WAIT_FOE: 'waitfoe',
  BATTLE: 'battle',
  OVER: 'over',
};

export class Match extends EventTarget {
  constructor({ mode, config, me, foe, net = null, difficulty = 'medium', stage }) {
    super();
    this.mode = mode;               // 'ai' | 'host' | 'join'
    this.config = config;
    this.me = me;                   // { name, colorId }
    this.foe = foe;                 // { name, colorId }
    this.net = net;
    this.stage = stage;
    this.difficulty = difficulty;

    this.phase = PHASE.LOBBY;
    this.myTurn = false;
    this.foeReady = false;
    this.iAmReady = false;
    this.over = false;
    this.winner = null;

    const opts = { allowTouching: config.allowTouching };
    this.myBoard = new Board(config.gridSize, config.fleet, opts);
    this.roster = buildRoster(config.fleet);
    this.foeTracking = new TrackingGrid(config.gridSize, this.roster);

    if (mode === 'ai') {
      this.aiBoard = new Board(config.gridSize, config.fleet, opts);
      if (!this.aiBoard.autoPlace()) {
        // Should be unreachable - the lobby refuses fleets that cannot be laid
        // out - but an unplaceable enemy fleet would be an unwinnable match.
        this.aiBoard = new Board(config.gridSize, config.fleet, { allowTouching: true });
        this.aiBoard.autoPlace();
      }
      this.aiTracking = new TrackingGrid(config.gridSize, this.roster);
      this.ai = new AIPlayer(difficulty);
      this.foe.name = this.foe.name || aiName(difficulty);
    }

    /* placement state */
    this.selected = null;
    this.horizontal = true;

    /* timer */
    this._timerId = null;
    this._deadline = 0;
    this._lastTickSecond = -1;

    /* stats */
    this.stats = { shots: 0, hits: 0, sunk: 0, taken: 0, turns: 0, started: 0 };

    /* serialises the shot animations */
    this._anim = Promise.resolve();
    this._pendingFire = null;

    if (net) this._bindNet();
  }

  emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }
  log(text, kind = '') { this.emit('log', { text, kind }); }

  get myHex() { return (COLOR_BY_ID[this.me.colorId] || COLOR_BY_ID.blue).hex; }
  get foeHex() { return (COLOR_BY_ID[this.foe.colorId] || COLOR_BY_ID.red).hex; }

  /* =====================================================
     Deployment
     ===================================================== */

  begin() {
    this.stage.setup(this.config.gridSize, this.myHex, this.foeHex);
    this.stage.rig.snapTo('place');
    this.setPhase(PHASE.PLACE);
    this.stage.setInteract('place');
    this.selectFirstUnplaced();
    this.log('Deploy your fleet, Admiral.', 'sys');
    this.emit('placement', this.placementState());
  }

  setPhase(p) {
    this.phase = p;
    this.emit('phase', { phase: p });
  }

  placementState() {
    return {
      roster: this.roster.map((r) => ({
        ...r,
        placed: this.myBoard.ships.has(r.uid),
        selected: this.selected === r.uid,
      })),
      placed: this.myBoard.placedCount,
      total: this.myBoard.totalCount,
      complete: this.myBoard.complete,
      horizontal: this.horizontal,
    };
  }

  selectFirstUnplaced() {
    const next = this.roster.find((r) => !this.myBoard.ships.has(r.uid));
    this.selectShip(next ? next.uid : null);
  }

  selectShip(uid) {
    this.selected = uid;
    if (!uid) {
      this.stage.clearGhost();
    } else {
      const entry = this.roster.find((r) => r.uid === uid);
      this.stage.showGhost(entry.size, this.myHex, this.horizontal);
      this._refreshGhostValidity();
    }
    this.emit('placement', this.placementState());
  }

  rotate() {
    this.horizontal = !this.horizontal;
    this.stage.setGhostOrientation(this.horizontal);
    this._refreshGhostValidity();
    sfx('rotate');
    this.emit('placement', this.placementState());
  }

  onHover(cell) {
    this._hover = cell;
    this._refreshGhostValidity();
  }

  _refreshGhostValidity() {
    if (this.phase !== PHASE.PLACE || !this.selected || !this._hover) return;
    const ok = this.myBoard.canPlace(this.selected, this._hover.gx, this._hover.gy, this.horizontal);
    this.stage.setGhostValid(ok);
    this.stage.markHoverValid(ok);
  }

  /** Click on own waters during deployment. */
  placeAt(gx, gy) {
    if (this.phase !== PHASE.PLACE) return;

    // Clicking an anchored hull lifts it again.
    const existing = this.myBoard.shipAt(gx, gy);
    if (existing && (!this.selected || existing.uid === this.selected)) {
      this.horizontal = existing.horizontal;
      this.myBoard.remove(existing.uid);
      this.stage.removeOwnShip(existing.uid);
      this.selectShip(existing.uid);
      sfx('uiBack');
      return;
    }
    if (!this.selected) { sfx('invalid'); return; }

    if (!this.myBoard.place(this.selected, gx, gy, this.horizontal)) {
      sfx('invalid');
      this.emit('toast', { text: 'NO ROOM THERE', kind: 'miss' });
      return;
    }
    const ship = this.myBoard.ships.get(this.selected);
    this.stage.addOwnShip(ship);
    sfx('place');
    this.selectFirstUnplaced();
    this.emit('placement', this.placementState());
  }

  autoPlace() {
    this.myBoard.autoPlace();
    this.stage.clearOwnShips();
    for (const ship of this.myBoard.ships.values()) this.stage.addOwnShip(ship);
    sfx('place');
    this.selectFirstUnplaced();
    this.emit('placement', this.placementState());
  }

  clearPlacement() {
    this.myBoard.clear();
    this.stage.clearOwnShips();
    sfx('uiBack');
    this.selectFirstUnplaced();
    this.emit('placement', this.placementState());
  }

  confirmReady() {
    if (!this.myBoard.complete) { sfx('invalid'); return; }
    this.iAmReady = true;
    this.stage.setInteract('none');
    this.stage.clearGhost();
    this.selected = null;
    sfx('uiHeavy');
    this.emit('placement', this.placementState());

    if (this.mode === 'ai') {
      this.startBattle(Math.random() < 0.5);
      return;
    }
    this.net.send('ready', {});
    if (this.foeReady) {
      this.startBattle(this._firstTurnIsMine);
    } else {
      this.setPhase(PHASE.WAIT_FOE);
      this.log('Fleet anchored. Waiting on the enemy.', 'sys');
    }
  }

  /* =====================================================
     Battle
     ===================================================== */

  startBattle(mineFirst) {
    this.stats.started = Date.now();
    this.setPhase(PHASE.BATTLE);
    this.stage.rig.goTo(mineFirst ? 'foe' : 'own');
    this.emit('banner', { text: 'ENGAGE' });
    sfx('connect');
    this.log('Battle stations. Guns free.', 'sys');
    this.setTurn(mineFirst, true);
  }

  setTurn(mine, first = false) {
    if (this.over) return;
    this.myTurn = mine;
    this.stats.turns++;
    this.stage.setInteract(mine ? 'fire' : 'none');
    this.emit('turn', { mine });
    if (mine) {
      sfx('yourTurn');
      if (!first) this.stage.rig.goTo('foe');
    } else if (this.mode === 'ai') {
      this._queueAIShot();
    }
    this._startTimer();
  }

  _startTimer() {
    this._stopTimer();
    const secs = this.config.turnTimer | 0;
    if (!secs || this.over) { this.emit('timer', { remaining: 0, total: 0 }); return; }
    this._deadline = performance.now() + secs * 1000;
    this._lastTickSecond = -1;
    this._timerId = setInterval(() => this._tick(secs), 100);
    this.emit('timer', { remaining: secs, total: secs });
  }

  _tick(total) {
    const left = Math.max(0, (this._deadline - performance.now()) / 1000);
    this.emit('timer', { remaining: left, total });
    const s = Math.ceil(left);
    if (s !== this._lastTickSecond) {
      this._lastTickSecond = s;
      if (this.myTurn && s <= 5 && s > 0) sfx(s <= 3 ? 'tickUrgent' : 'tick');
    }
    if (left <= 0) {
      this._stopTimer();
      if (this.myTurn && this.phase === PHASE.BATTLE && !this._pendingFire) {
        this.log('Out of time - the gunnery officer fires blind.', 'sys');
        const open = this.foeTracking.openCells();
        if (open.length) {
          const [gx, gy] = open[Math.floor(Math.random() * open.length)];
          this.fireAt(gx, gy);
        }
      }
    }
  }

  _stopTimer() {
    if (this._timerId) clearInterval(this._timerId);
    this._timerId = null;
  }

  /**
   * Freeze the clock while the settings menu is open. Only possible against
   * the A.I. - a live opponent is still playing on their own machine.
   */
  setPaused(on) {
    if (this.mode !== 'ai' || this.over) return;
    if (on) {
      this._paused = true;
      if (this._timerId) {
        this._pausedRemaining = Math.max(0, this._deadline - performance.now());
        this._stopTimer();
      }
    } else {
      this._paused = false;
      if (this._pausedRemaining != null && this.phase === PHASE.BATTLE) {
        this._deadline = performance.now() + this._pausedRemaining;
        this._pausedRemaining = null;
        this._timerId = setInterval(() => this._tick(this.config.turnTimer | 0), 100);
      }
      if (!this.myTurn && this.phase === PHASE.BATTLE && this._aiWaiting) {
        this._aiWaiting = false;
        this._queueAIShot();
      }
    }
  }

  /** Player clicks a tile in enemy waters. */
  fireAt(gx, gy) {
    if (this.phase !== PHASE.BATTLE || !this.myTurn || this.over) return;
    if (this._pendingFire) return;
    if (!this.foeTracking.canFire(gx, gy)) {
      sfx('invalid');
      this.emit('toast', { text: 'ALREADY SWEPT', kind: 'miss' });
      return;
    }
    this._stopTimer();
    this._pendingFire = { gx, gy };
    this.stage.setInteract('none');
    this.stats.shots++;

    if (this.mode === 'ai') {
      const result = this.aiBoard.receiveFire(gx, gy);
      this._resolveMyShot(result);
    } else {
      this.net.send('fire', { gx, gy });
      // The defender answers with the outcome; a stall is handled by onClosed.
    }
  }

  _resolveMyShot(result) {
    this._pendingFire = null;
    this.foeTracking.apply(result);
    if (result.hit) this.stats.hits++;
    if (result.sunk) this.stats.sunk++;

    const label = cellLabel(result.gx, result.gy);
    const sunkShip = result.sunk ? result.ship : null;

    this._anim = this._anim.then(async () => {
      await this.stage.playShot('own', result, { sunkShip });
      if (result.sunk) {
        this.log(`Enemy ${result.ship.name} destroyed at ${label}.`, 'sunk');
        this.emit('toast', { text: `${result.ship.name} SUNK`, kind: 'sunk' });
      } else if (result.hit) {
        this.log(`Direct hit on ${label}.`, 'hit');
        this.emit('toast', { text: 'DIRECT HIT', kind: 'hit' });
      } else {
        this.log(`Shell fell wide at ${label}.`, 'miss');
        this.emit('toast', { text: 'MISS', kind: 'miss' });
      }
      this.emit('status', this.statusSnapshot());

      if (result.defeated) { this._finish(true); return; }
      const again = result.hit && this.config.extraTurnOnHit;
      if (again) this.log('A hit buys you another salvo.', 'sys');
      this.setTurn(again);
    });
  }

  /** An incoming shot lands on our own waters. */
  _resolveIncoming(gx, gy) {
    const result = this.myBoard.receiveFire(gx, gy);
    if (!result.valid) return result;
    if (result.hit) this.stats.taken++;
    const label = cellLabel(gx, gy);
    const sunkShip = result.sunk ? result.ship : null;

    this._anim = this._anim.then(async () => {
      sfx('incoming');
      await this.stage.playShot('foe', result, { sunkShip });
      if (result.sunk) {
        this.log(`Our ${result.ship.name} is lost at ${label}.`, 'sunk');
        this.emit('toast', { text: `${result.ship.name} LOST`, kind: 'sunk' });
      } else if (result.hit) {
        this.log(`We are hit at ${label}.`, 'hit');
      } else {
        this.log(`Enemy shell wide at ${label}.`, 'miss');
      }
      this.emit('status', this.statusSnapshot());

      if (result.defeated) { this._finish(false); return; }
      const again = result.hit && this.config.extraTurnOnHit;
      this.setTurn(!again);
    });
    return result;
  }

  /* ---------------- AI turn ---------------- */

  _queueAIShot() {
    if (this.over) return;
    const delay = aiThinkDelay(this.difficulty);
    setTimeout(() => {
      if (this.over || this.myTurn || this.phase !== PHASE.BATTLE) return;
      if (this._paused) { this._aiWaiting = true; return; }
      const shot = this.ai.chooseShot(this.aiTracking);
      if (!shot) return;
      const [gx, gy] = shot;
      this._stopTimer();
      const result = this._resolveIncoming(gx, gy);
      this.aiTracking.apply(result);
      this.ai.observe(result, this.aiTracking);
    }, delay);
  }

  /* ---------------- finishing ---------------- */

  _finish(won) {
    if (this.over) return;
    this.over = true;
    this.winner = won ? 'me' : 'foe';
    this._stopTimer();
    this.stage.setInteract('none');
    this.setPhase(PHASE.OVER);

    if (this.net) this.net.send('fleet', { ships: this.myBoard.serialize(), resigned: false });

    // Reveal whatever of the enemy fleet is still hidden.
    const reveal = this.mode === 'ai' ? this.aiBoard.serialize() : this._foeFleet;
    if (reveal) this._revealFoeFleet(reveal);

    musicDuck(0.25, 4);
    sfx(won ? 'victory' : 'defeat', { delay: 0.35 });
    this.emit('banner', { text: won ? 'VICTORY' : 'DEFEAT' });
    this.stage.rig.goTo('overview');
    this.emit('over', { won, stats: this.summary(won) });
  }

  _revealFoeFleet(ships) {
    setTimeout(() => this.stage.revealFoeFleet(ships), 900);
  }

  summary(won) {
    const acc = this.stats.shots ? Math.round((this.stats.hits / this.stats.shots) * 100) : 0;
    const mins = this.stats.started ? Math.max(1, Math.round((Date.now() - this.stats.started) / 60000)) : 0;
    return {
      won,
      shots: this.stats.shots,
      hits: this.stats.hits,
      accuracy: acc,
      sunk: this.stats.sunk,
      taken: this.stats.taken,
      minutes: mins,
    };
  }

  statusSnapshot() {
    return { mine: this.myBoard.status(), foe: this.foeTracking.status() };
  }

  /* =====================================================
     Networking
     ===================================================== */

  _bindNet() {
    this._onMsg = (e) => this._handle(e.detail);
    this.net.addEventListener('message', this._onMsg);
    this._onClosed = () => {
      if (this.over) return;
      this.emit('lost', { message: 'The link to your opponent dropped.' });
    };
    this.net.addEventListener('closed', this._onClosed);
  }

  _handle(msg) {
    switch (msg.t) {
      case 'ready':
        this.foeReady = true;
        if (this.iAmReady && this.phase === PHASE.WAIT_FOE) {
          this.startBattle(this._firstTurnIsMine);
        } else if (this.phase === PHASE.PLACE) {
          this.log('Enemy fleet reports ready.', 'sys');
        }
        break;

      case 'fire': {
        if (this.over) break;
        const result = this._resolveIncoming(msg.gx, msg.gy);
        this.net.send('result', {
          gx: msg.gx, gy: msg.gy,
          valid: result.valid, hit: result.hit, sunk: result.sunk,
          ship: result.ship, defeated: result.defeated,
        });
        break;
      }

      case 'result':
        if (this.over) break;
        if (!this._pendingFire) break;
        this._resolveMyShot({
          valid: msg.valid, gx: msg.gx, gy: msg.gy,
          hit: !!msg.hit, sunk: !!msg.sunk, ship: msg.ship || null, defeated: !!msg.defeated,
        });
        break;

      case 'fleet':
        this._foeFleet = msg.ships || [];
        if (this.over) this._revealFoeFleet(this._foeFleet);
        break;

      case 'resign':
        if (this.over) break;
        this.log('The enemy struck their colours.', 'sys');
        this._finish(true);
        break;

      case 'rematch':
        this.emit('rematch', {});
        break;

      default:
        break;
    }
  }

  /** Host decides who shoots first and tells the guest. */
  static rollFirstTurn() { return Math.random() < 0.5; }

  setFirstTurn(mine) { this._firstTurnIsMine = mine; }

  resign() {
    if (this.over) return;
    if (this.net) this.net.send('resign', {});
    this._finish(false);
  }

  destroy() {
    this._stopTimer();
    this.over = true;
    if (this.net && this._onMsg) {
      this.net.removeEventListener('message', this._onMsg);
      this.net.removeEventListener('closed', this._onClosed);
    }
  }
}

export { PROTOCOL_VERSION };
