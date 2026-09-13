/* =========================================================
   Camera rig: orbit presets, free flight, action zoom, shake.
   Also owns pointer input and reports clean click/hover events.
   ========================================================= */

import * as THREE from 'three';
import { CELL, boardCenterZ } from '../core/constants.js';
import { settings } from '../core/settings.js';

const PHI_MIN = 0.10;
const PHI_MAX = 1.36;
const R_MIN = 24;
const R_MAX = 340;
const DRAG_SLOP = 5;

export class CameraRig extends EventTarget {
  constructor(camera, canvas) {
    super();
    this.camera = camera;
    this.canvas = canvas;

    this.target = new THREE.Vector3(0, 0, 0);
    this.desiredTarget = new THREE.Vector3(0, 0, 0);
    this.radius = 140;
    this.desiredRadius = 140;
    this.phi = 0.58;
    this.desiredPhi = 0.58;
    this.theta = 0;
    this.desiredTheta = 0;

    this.mode = 'overview';
    this.cinematic = false;
    this.snap = 7.5;        // smoothing rate

    this.gridSize = 10;
    this.presets = {};
    this.setGrid(10);

    this.focus = { pos: new THREE.Vector3(), w: 0, want: 0, hold: 0 };

    this.keys = new Set();
    this.pointer = new THREE.Vector2(-2, -2);
    this.pointerInside = false;
    this.dragging = null;
    this.enabled = true;
    this.inputLocked = false;

    this._shakeOff = new THREE.Vector3();
    this._tmp = new THREE.Vector3();
    this._bind();
  }

  /* ---------------- presets ---------------- */

  setGrid(n) {
    this.gridSize = n;
    const S = n * CELL;
    const cz = boardCenterZ(n);
    // A three-quarter view foreshortens the far half of the theatre, so the
    // overview is aimed past the origin and sits high enough that the near
    // edge of your own grid still clears the bottom of the frame.
    this.presets = {
      overview: { target: new THREE.Vector3(0, 0, -cz * 0.22), radius: S * 3.0 + 58, phi: 0.40, theta: 0 },
      own:      { target: new THREE.Vector3(0, 0, cz), radius: S * 1.15 + 16, phi: 0.66, theta: 0 },
      foe:      { target: new THREE.Vector3(0, 0, -cz), radius: S * 1.15 + 16, phi: 0.66, theta: 0 },
      place:    { target: new THREE.Vector3(0, 0, cz), radius: S * 1.1 + 14, phi: 0.46, theta: 0 },
    };
  }

  /** Jump straight to a preset with no transition. */
  snapTo(name) {
    this.goTo(name);
    this.target.copy(this.desiredTarget);
    this.radius = this.desiredRadius;
    this.phi = this.desiredPhi;
    this.theta = this.desiredTheta;
    this._apply(0);
  }

  goTo(name) {
    const p = this.presets[name];
    this.mode = name;
    this.cinematic = false;
    if (!p) return;              // 'free' keeps the current framing
    this.desiredTarget.copy(p.target);
    this.desiredRadius = p.radius;
    this.desiredPhi = p.phi;
    this.desiredTheta = p.theta;
    this.dispatchEvent(new CustomEvent('mode', { detail: { mode: name } }));
  }

  setMode(name) {
    if (name === 'free') {
      this.mode = 'free';
      this.cinematic = false;
      this.desiredTarget.copy(this.target);
      this.desiredRadius = this.radius;
      this.desiredPhi = this.phi;
      this.desiredTheta = this.theta;
      this.dispatchEvent(new CustomEvent('mode', { detail: { mode: 'free' } }));
      return;
    }
    this.goTo(name);
  }

  /** Slow, low idle orbit for the title screen - ships on the skyline. */
  startCinematic() {
    const S = this.gridSize * CELL;
    this.desiredTarget.set(0, 10, boardCenterZ(this.gridSize) * 0.2);
    this.desiredRadius = S * 2.0 + 20;
    this.desiredPhi = 1.28;
    this.desiredTheta = 0.5;
    this.cinematic = true;
    this.mode = 'cinematic';
  }

  /* ---------------- action zoom ---------------- */

  /** Push the framing toward a world point for a moment. */
  punch(pos, { hold = 0.9, strength = 1 } = {}) {
    if (!settings.get('actionZoom')) return;
    this.focus.pos.copy(pos);
    this.focus.want = strength;
    this.focus.hold = hold;
  }

  releasePunch() {
    this.focus.want = 0;
    this.focus.hold = 0;
  }

  /* ---------------- input ---------------- */

  _bind() {
    const c = this.canvas;
    c.addEventListener('contextmenu', (e) => e.preventDefault());

    c.addEventListener('pointerdown', (e) => {
      if (!this.enabled) return;
      c.setPointerCapture(e.pointerId);
      this.dragging = {
        id: e.pointerId, button: e.button,
        x: e.clientX, y: e.clientY,
        sx: e.clientX, sy: e.clientY,
        moved: false,
      };
      this._updatePointer(e);
    });

    c.addEventListener('pointermove', (e) => {
      this._updatePointer(e);
      const d = this.dragging;
      if (!d || d.id !== e.pointerId || !this.enabled) return;
      const dx = e.clientX - d.x;
      const dy = e.clientY - d.y;
      d.x = e.clientX; d.y = e.clientY;
      if (!d.moved && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) > DRAG_SLOP) {
        d.moved = true;
        document.body.classList.add('grabbing');
      }
      if (!d.moved) return;

      if (d.button === 2 || d.button === 1 || (d.button === 0 && e.shiftKey)) {
        this._pan(dx, dy);
      } else {
        this._orbit(dx, dy);
      }
    });

    const end = (e) => {
      const d = this.dragging;
      if (!d || d.id !== e.pointerId) return;
      this.dragging = null;
      document.body.classList.remove('grabbing');
      try { c.releasePointerCapture(e.pointerId); } catch { /* already released */ }
      if (!d.moved && d.button === 0 && this.enabled && !this.inputLocked) {
        this.dispatchEvent(new CustomEvent('pick', { detail: { x: this.pointer.x, y: this.pointer.y } }));
      }
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);

    c.addEventListener('pointerleave', () => { this.pointerInside = false; });
    c.addEventListener('pointerenter', () => { this.pointerInside = true; });

    c.addEventListener('wheel', (e) => {
      if (!this.enabled) return;
      e.preventDefault();
      const k = Math.exp(e.deltaY * 0.0012);
      this.desiredRadius = THREE.MathUtils.clamp(this.desiredRadius * k, R_MIN, R_MAX);
    }, { passive: false });

    window.addEventListener('keydown', (e) => {
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  _updatePointer(e) {
    const r = this.canvas.getBoundingClientRect();
    this.pointer.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    this.pointer.y = -((e.clientY - r.top) / r.height) * 2 + 1;
    this.pointerInside = true;
  }

  _orbit(dx, dy) {
    this.desiredTheta -= dx * 0.0055;
    this.desiredPhi = THREE.MathUtils.clamp(this.desiredPhi - dy * 0.0045, PHI_MIN, PHI_MAX);
    this.cinematic = false;
  }

  _pan(dx, dy) {
    const scale = this.radius * 0.0016;
    const right = this._tmp.set(Math.cos(this.theta), 0, -Math.sin(this.theta));
    this.desiredTarget.addScaledVector(right, -dx * scale);
    const fwd = new THREE.Vector3(-Math.sin(this.theta), 0, -Math.cos(this.theta));
    this.desiredTarget.addScaledVector(fwd, -dy * scale);
    this._clampTarget();
    this.cinematic = false;
    if (this.mode !== 'free') this.setMode('free');
  }

  _clampTarget() {
    const lim = this.gridSize * CELL * 2 + 90;
    this.desiredTarget.x = THREE.MathUtils.clamp(this.desiredTarget.x, -lim, lim);
    this.desiredTarget.z = THREE.MathUtils.clamp(this.desiredTarget.z, -lim, lim);
    this.desiredTarget.y = THREE.MathUtils.clamp(this.desiredTarget.y, -8, 70);
  }

  _freeFly(dt) {
    const k = this.keys;
    let fx = 0, fz = 0, fy = 0;
    if (k.has('KeyW') || k.has('ArrowUp')) fz += 1;
    if (k.has('KeyS') || k.has('ArrowDown')) fz -= 1;
    if (k.has('KeyA') || k.has('ArrowLeft')) fx -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) fx += 1;
    if (k.has('KeyE')) fy += 1;
    if (k.has('KeyQ')) fy -= 1;
    if (!fx && !fz && !fy) return;

    const boost = (k.has('ShiftLeft') || k.has('ShiftRight')) ? 2.6 : 1;
    const speed = (18 + this.radius * 0.28) * boost * dt;
    const fwd = new THREE.Vector3(-Math.sin(this.theta), 0, -Math.cos(this.theta));
    const right = new THREE.Vector3(Math.cos(this.theta), 0, -Math.sin(this.theta));
    this.desiredTarget.addScaledVector(fwd, fz * speed);
    this.desiredTarget.addScaledVector(right, fx * speed);
    this.desiredTarget.y += fy * speed;
    this._clampTarget();
  }

  /* ---------------- frame ---------------- */

  update(dt, fx, time) {
    if (this.mode === 'free') this._freeFly(dt);

    if (this.cinematic) {
      this.desiredTheta += dt * 0.055;
      this.desiredPhi += Math.sin(time * 0.13) * dt * 0.02;
    }

    // Action zoom rises fast and releases slowly.
    if (this.focus.hold > 0) {
      this.focus.hold -= dt;
      if (this.focus.hold <= 0) this.focus.want = 0;
    }
    const fRate = this.focus.want > this.focus.w ? 5.5 : 1.8;
    this.focus.w += (this.focus.want - this.focus.w) * (1 - Math.exp(-fRate * dt));

    const s = 1 - Math.exp(-this.snap * dt);
    this.target.lerp(this.desiredTarget, s);
    this.radius += (this.desiredRadius - this.radius) * s;
    this.phi += (this.desiredPhi - this.phi) * s;
    this.theta += (this.desiredTheta - this.theta) * s;

    this._apply(fx ? fx.shakeAmount : 0, fx, time);
  }

  _apply(shakeAmount, fx, time = 0) {
    const w = this.focus.w;
    const t = this._tmp.copy(this.target);
    if (w > 0.001) t.lerp(this.focus.pos, w * 0.62);
    const r = this.radius * (1 - w * 0.34);

    const sp = Math.sin(this.phi);
    const px = t.x + r * sp * Math.sin(this.theta);
    const py = t.y + r * Math.cos(this.phi);
    const pz = t.z + r * sp * Math.cos(this.theta);

    this.camera.position.set(px, Math.max(4, py), pz);
    this.camera.lookAt(t);

    if (fx && shakeAmount > 0.0001) {
      fx.shakeOffset(this._shakeOff, time);
      this.camera.position.add(this._shakeOff);
      this.camera.rotateZ(this._shakeOff.x * 0.012);
    }
  }

  /** Screen-space pointer, or null when the cursor is off-canvas. */
  pointerNDC() {
    return this.pointerInside ? this.pointer : null;
  }
}
