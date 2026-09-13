/* =========================================================
   Stage: owns the 3D world, both battle grids, the effects
   system and the frame loop. The match layer drives it through
   a small command API and listens for pick/hover events.
   ========================================================= */

import * as THREE from 'three';
import { World } from './world.js';
import { CameraRig } from './camera.js';
import { FX } from './fx.js';
import { BoardView } from './grid.js';
import { buildShip, buildGhost } from './ships.js';
import { CELL, boardCenterZ, COLOR_BY_ID } from '../core/constants.js';
import { TILE, Board } from '../core/board.js';
import { settings, quality } from '../core/settings.js';
import { sfx, musicDuck } from '../core/audio.js';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export class Stage extends EventTarget {
  constructor(canvas) {
    super();
    this.world = new World(canvas);
    this.fx = new FX(this.world.scene, this.world);
    this.rig = new CameraRig(this.world.camera, canvas);

    this.boards = { own: null, foe: null };
    this.ghost = null;
    this.hover = null;
    this.interact = 'none';   // 'none' | 'place' | 'fire'
    this.ray = new THREE.Raycaster();

    this.running = false;
    this._acc = 0;
    this._last = 0;
    this._fpsAcc = 0;
    this._fpsFrames = 0;
    this.fps = 0;

    this.rig.addEventListener('pick', (e) => this._onPick(e.detail));
    this.rig.addEventListener('mode', (e) => {
      this.dispatchEvent(new CustomEvent('cammode', { detail: e.detail }));
    });

    this._loop = this._loop.bind(this);
  }

  /* ---------------- lifecycle ---------------- */

  start() {
    if (this.running) return;
    this.running = true;
    this._last = performance.now();
    requestAnimationFrame(this._loop);
  }

  stop() { this.running = false; }

  _loop(now) {
    if (!this.running) return;
    requestAnimationFrame(this._loop);

    const interval = quality.frameInterval();
    const elapsed = now - this._last;
    if (interval > 0 && elapsed < interval) return;
    this._last = now;

    this.frame(Math.min(0.05, elapsed / 1000));

    this._fpsAcc += elapsed;
    this._fpsFrames++;
    if (this._fpsAcc >= 480) {
      this.fps = Math.round((this._fpsFrames * 1000) / this._fpsAcc);
      this._fpsAcc = 0; this._fpsFrames = 0;
      this.dispatchEvent(new CustomEvent('fps', { detail: { fps: this.fps } }));
    }
  }

  /** Advance and draw exactly one frame. Also used to drive automated tests. */
  frame(dt) {
    this.world.update(dt);
    this.fx.update(dt, this.world.camera);
    this.rig.update(dt, this.fx, this.world.time);
    for (const b of Object.values(this.boards)) if (b) b.update(dt, this.world);
    this._updateHover();
    this.world.render();
  }

  /* ---------------- board setup ---------------- */

  setup(gridSize, myHex, foeHex) {
    this.teardown();
    this.boards.own = new BoardView('own', gridSize, myHex);
    this.boards.foe = new BoardView('foe', gridSize, foeHex);
    this.world.battleGroup.add(this.boards.own.group, this.boards.foe.group);
    this.rig.setGrid(gridSize);
    this.gridSize = gridSize;
    this.world.setArena(boardCenterZ(gridSize) + (gridSize * CELL) / 2 + 14);
  }

  teardown() {
    for (const key of ['own', 'foe']) {
      const b = this.boards[key];
      if (!b) continue;
      this.world.battleGroup.remove(b.group);
      b.dispose();
      this.boards[key] = null;
    }
    this.clearGhost();
    this.fx.clear();
  }

  setColors(myHex, foeHex) {
    if (this.boards.own) this.boards.own.setAccent(myHex);
    if (this.boards.foe) this.boards.foe.setAccent(foeHex);
  }

  reset() {
    for (const b of Object.values(this.boards)) if (b) b.reset();
    this.fx.clear();
  }

  /* ---------------- interaction ---------------- */

  setInteract(mode) {
    this.interact = mode;
    document.body.classList.toggle('crosshair', mode === 'fire');
    if (mode !== 'place') this.clearGhost();
    if (this.boards.foe) this.boards.foe.setScan(mode === 'fire');
    if (mode === 'none') {
      for (const b of Object.values(this.boards)) if (b) b.setHover(null);
      this.hover = null;
    }
  }

  /** The board the player may interact with right now. */
  get activeSide() {
    if (this.interact === 'place') return 'own';
    if (this.interact === 'fire') return 'foe';
    return null;
  }

  _raycastBoard(ndc) {
    const side = this.activeSide;
    if (!side || !this.boards[side]) return null;
    this.ray.setFromCamera(ndc, this.world.camera);
    const hits = this.ray.intersectObject(this.boards[side].picker, false);
    if (!hits.length) return null;
    const cell = this.boards[side].pick(hits[0].point);
    return cell ? { side, ...cell } : null;
  }

  _updateHover() {
    const ndc = this.rig.pointerNDC();
    if (!ndc || this.interact === 'none' || this.rig.dragging) {
      if (this.hover) {
        for (const b of Object.values(this.boards)) if (b) b.setHover(null);
        this.hover = null;
        if (this.ghost) this.ghost.visible = false;
        this.dispatchEvent(new CustomEvent('hover', { detail: null }));
      }
      return;
    }
    const cell = this._raycastBoard(ndc);
    if (!cell && this.ghost) this.ghost.visible = false;
    const same = cell && this.hover && cell.gx === this.hover.gx && cell.gy === this.hover.gy && cell.side === this.hover.side;
    if (same) {
      if (this.interact === 'place' && this.ghost) this._positionGhost(cell);
      return;
    }
    this.hover = cell;
    const board = this.boards[this.activeSide];
    if (board) board.setHover(cell ? { gx: cell.gx, gy: cell.gy } : null, this.hoverValid !== false);
    if (cell && this.interact === 'place' && this.ghost) this._positionGhost(cell);
    this.dispatchEvent(new CustomEvent('hover', { detail: cell }));
    if (cell) sfx('uiHover', { throttle: 70 });
  }

  _onPick(ndc) {
    if (this.interact === 'none') return;
    const cell = this._raycastBoard(ndc);
    if (!cell) return;
    this.dispatchEvent(new CustomEvent('cell', { detail: cell }));
  }

  markHoverValid(valid) {
    this.hoverValid = valid;
    const board = this.boards[this.activeSide];
    if (board && this.hover) board.setHover({ gx: this.hover.gx, gy: this.hover.gy }, valid);
  }

  /* ---------------- placement ---------------- */

  showGhost(size, hex, horizontal) {
    this.clearGhost();
    this.ghost = buildGhost(size, hex);
    this.ghost.userData.size = size;
    this.ghost.userData.horizontal = horizontal;
    this.world.battleGroup.add(this.ghost);
    this.ghost.visible = false;
  }

  setGhostOrientation(horizontal) {
    if (!this.ghost) return;
    this.ghost.userData.horizontal = horizontal;
    if (this.hover) this._positionGhost(this.hover);
  }

  setGhostValid(ok) {
    if (this.ghost && this.ghost.userData.setValid) this.ghost.userData.setValid(ok);
  }

  _positionGhost(cell) {
    const b = this.boards.own;
    if (!b || !this.ghost) return;
    const { size, horizontal } = this.ghost.userData;
    const cx = cell.gx + (horizontal ? (size - 1) / 2 : 0);
    const cy = cell.gy + (horizontal ? 0 : (size - 1) / 2);
    this.ghost.visible = true;
    this.ghost.position.set(
      b.localX(cx),
      1.1 + Math.sin(this.world.time * 2.4) * 0.18,
      b.group.position.z + b.localZ(cy),
    );
    this.ghost.rotation.y = horizontal ? 0 : Math.PI / 2;
  }

  clearGhost() {
    if (!this.ghost) return;
    this.world.battleGroup.remove(this.ghost);
    this.ghost.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
    this.ghost = null;
  }

  addOwnShip(ship) {
    return this.boards.own.addShip(ship, buildShip);
  }

  removeOwnShip(uid) {
    this.boards.own.removeShip(uid);
  }

  clearOwnShips() {
    this.boards.own.clearShips();
  }

  /* ---------------- combat choreography ---------------- */

  /**
   * World point a shot should launch from, on `side`, aimed at `targetPos`.
   *
   * Only your own guns fire from a real hull. Enemy salvoes always launch from
   * a randomly chosen tile of their grid: sourcing them from their actual ships
   * would quietly hand you their fleet layout.
   */
  _originFor(side, targetPos) {
    const b = this.boards[side];
    const cz = b.group.position.z;

    if (side === 'own') {
      let best = null;
      let bestD = Infinity;
      for (const rec of b.shipViews.values()) {
        if (rec.sinking) continue;
        const p = new THREE.Vector3(rec.group.position.x, 2.4, rec.group.position.z + cz);
        const d = p.distanceTo(targetPos);
        if (d < bestD) { bestD = d; best = p; }
      }
      if (best) return best;
    }

    const n = this.gridSize;
    const p = b.worldOf(Math.floor(Math.random() * n), Math.floor(Math.random() * n), 2.6);
    return new THREE.Vector3(p.x, 2.6, p.z);
  }

  /**
   * Full shot sequence.
   * @param {'own'|'foe'} shooter which board fires
   * @param {object} result from Board.receiveFire / network
   * @param {object} opts { sunkShip, onImpact }
   */
  async playShot(shooter, result, opts = {}) {
    const targetSide = shooter === 'own' ? 'foe' : 'own';
    const tBoard = this.boards[targetSide];
    if (!tBoard) return;

    const targetPos = tBoard.worldOf(result.gx, result.gy, 0.4);
    const origin = this._originFor(shooter, targetPos);
    const dir = targetPos.clone().sub(origin).setY(0).normalize();

    // Muzzle blast, then swing the camera toward the gun.
    this.fx.muzzle(origin.clone().addScaledVector(dir, 2.2).setY(2.6), dir.clone().setY(0.35));
    sfx('fire');
    musicDuck(0.45, 1.6);
    this.rig.punch(origin.clone().lerp(targetPos, 0.22), { hold: 0.34, strength: 0.55 });

    const flight = 1.05 + Math.random() * 0.12;
    await wait(150);
    sfx('whistle', { delay: 0 });

    await new Promise((resolve) => {
      this.fx.fireShell(origin.clone().setY(3.2), targetPos, {
        duration: flight,
        onImpact: resolve,
      });
      // Track the shell in for the last stretch of its arc.
      setTimeout(() => this.rig.punch(targetPos, { hold: 1.5, strength: 1 }), flight * 620);
    });

    if (result.hit) {
      this.fx.explode(targetPos, result.sunk ? 1.25 : 1.0);
      sfx('explode');
      tBoard.setCell(result.gx, result.gy, TILE.HIT);
      if (targetSide === 'foe') tBoard.addMarker(result.gx, result.gy, 'hit');
      this.fx.addBurn(targetPos.clone().setY(0.8), targetSide === 'foe' ? 0.6 : 0.75);
    } else {
      this.fx.splash(targetPos, 1);
      sfx('splash');
      tBoard.setCell(result.gx, result.gy, TILE.MISS);
      tBoard.addMarker(result.gx, result.gy, 'miss');
    }

    if (opts.onImpact) opts.onImpact();

    if (result.sunk && opts.sunkShip) {
      await wait(340);
      const rec = targetSide === 'foe'
        ? tBoard.revealShip(opts.sunkShip, buildShip)
        : tBoard.shipViews.get(opts.sunkShip.uid);
      const centre = tBoard.worldOf(
        opts.sunkShip.gx + (opts.sunkShip.horizontal ? (opts.sunkShip.size - 1) / 2 : 0),
        opts.sunkShip.gy + (opts.sunkShip.horizontal ? 0 : (opts.sunkShip.size - 1) / 2),
        0.6,
      );
      this.rig.punch(centre, { hold: 2.4, strength: 1.15 });
      this.fx.sinkBurst(centre, opts.sunkShip.size * CELL * 0.5);
      sfx('sink');
      musicDuck(0.3, 3.2);
      if (rec) tBoard.sinkShip(opts.sunkShip.uid);
      // Leave the wreck burning on the water for a beat.
      for (let i = 0; i < opts.sunkShip.size; i++) {
        const cx = opts.sunkShip.gx + (opts.sunkShip.horizontal ? i : 0);
        const cy = opts.sunkShip.gy + (opts.sunkShip.horizontal ? 0 : i);
        const p = tBoard.worldOf(cx, cy, 0.7);
        // Every other tile burns - a fire on all five cells of a carrier
        // turns the wreck into an unreadable wall of smoke.
        if (i % 2 === 0) this.fx.addBurn(p, 0.7);
        tBoard.setCell(cx, cy, TILE.HIT);
      }
      await wait(900);
    } else {
      await wait(360);
    }

    this.rig.releasePunch();
  }

  /** Surface the enemy hulls that were never found, faded out. */
  revealFoeFleet(ships) {
    const board = this.boards.foe;
    if (!board || !ships) return;
    for (const s of ships) {
      if (board.shipViews.has(s.uid)) continue;
      const rec = board.revealShip(s, buildShip);
      if (!rec) continue;
      rec.group.traverse((o) => {
        if (!o.isMesh || !o.material) return;
        // Clone first so the shared fleet materials are not made translucent.
        o.material = o.material.clone();
        o.material.userData.shared = false;
        o.material.transparent = true;
        o.material.opacity = 0.55;
        o.castShadow = false;
      });
    }
  }

  /** Drop a marker without any animation (used when rebuilding state). */
  applyShotSilently(side, gx, gy, hit) {
    const b = this.boards[side];
    if (!b) return;
    b.setCell(gx, gy, hit ? TILE.HIT : TILE.MISS);
    b.addMarker(gx, gy, hit ? 'hit' : 'miss');
  }

  /* ---------------- showcase (title screen) ---------------- */

  showcase() {
    const n = 10;
    this.setup(n, COLOR_BY_ID.blue.hex, COLOR_BY_ID.red.hex);
    const fleet = { carrier: 1, battleship: 1, cruiser: 1, submarine: 1, destroyer: 1 };
    for (const side of ['own', 'foe']) {
      const b = new Board(n, fleet, { allowTouching: true });
      b.autoPlace();
      for (const ship of b.ships.values()) this.boards[side].addShip(ship, buildShip);
    }
    // A little smoke on the horizon sells the scene as a live theatre.
    const p = this.boards.foe.worldOf(2, 6, 0.6);
    this.fx.addBurn(p, 0.55);
    this.setInteract('none');
    this.rig.startCinematic();
    this.rig.target.copy(this.rig.desiredTarget);
    this.rig.radius = this.rig.desiredRadius;
    this.rig.phi = this.rig.desiredPhi;
    this.rig.theta = this.rig.desiredTheta;
  }
}
