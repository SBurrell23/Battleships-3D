/* =========================================================
   Combat effects: shell tracers, water columns, fireballs,
   shockwaves, debris, persistent fire and smoke, screen shake.
   All particles are pooled and updated on the CPU.
   ========================================================= */

import * as THREE from 'three';
import { quality, settings } from '../core/settings.js';

/* ---------------- sprite textures (generated) ---------------- */

function radialTexture(stops, size = 128) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [off, col] of stops) g.addColorStop(off, col);
  x.fillStyle = g;
  x.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function smokeTexture(size = 128) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const x = c.getContext('2d');
  const h = size / 2;

  // Start from a solid soft core so the puff always reads as a rounded mass,
  // then break the edge up with satellite blobs. A purely random scatter can
  // land off-centre and leave every puff wearing the same crescent.
  const core = x.createRadialGradient(h, h, 0, h, h, h * 0.72);
  core.addColorStop(0, 'rgba(255,255,255,0.95)');
  core.addColorStop(0.55, 'rgba(255,255,255,0.55)');
  core.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = core;
  x.fillRect(0, 0, size, size);

  x.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 26; i++) {
    // Blob centres cluster toward the middle (mean of two uniforms).
    const a = Math.random() * Math.PI * 2;
    const rad = ((Math.random() + Math.random()) / 2) * h * 0.62;
    const px = h + Math.cos(a) * rad;
    const py = h + Math.sin(a) * rad;
    const r = size * (0.10 + Math.random() * 0.13);
    const g = x.createRadialGradient(px, py, 0, px, py, r);
    g.addColorStop(0, 'rgba(255,255,255,0.16)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g;
    x.beginPath(); x.arc(px, py, r, 0, Math.PI * 2); x.fill();
  }

  // Fade the outer edge so the quad never shows a hard border.
  x.globalCompositeOperation = 'destination-in';
  const m = x.createRadialGradient(h, h, size * 0.06, h, h, h);
  m.addColorStop(0, 'rgba(0,0,0,1)');
  m.addColorStop(0.62, 'rgba(0,0,0,0.85)');
  m.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = m;
  x.fillRect(0, 0, size, size);

  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/* ---------------- particle field ---------------- */

const PARTICLE_VERT = /* glsl */`
attribute float aSize;
attribute float aAlpha;
attribute vec3 aColor;
attribute float aRot;
varying vec3 vColor;
varying float vAlpha;
varying float vRot;
uniform float uScale;
void main() {
  vColor = aColor;
  vAlpha = aAlpha;
  vRot = aRot;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  // aSize is a diameter in world units; uScale converts it to framebuffer pixels.
  gl_PointSize = clamp(aSize * (uScale / max(0.001, -mv.z)), 1.0, 1024.0);
  gl_Position = projectionMatrix * mv;
}
`;

const PARTICLE_FRAG = /* glsl */`
uniform sampler2D uMap;
varying vec3 vColor;
varying float vAlpha;
varying float vRot;
void main() {
  vec2 uv = gl_PointCoord - 0.5;
  float s = sin(vRot), c = cos(vRot);
  uv = vec2(uv.x * c - uv.y * s, uv.x * s + uv.y * c) + 0.5;
  vec4 t = texture2D(uMap, uv);
  float a = t.a * vAlpha;
  if (a < 0.004) discard;
  gl_FragColor = vec4(vColor * t.rgb, a);
}
`;

class ParticleField {
  constructor(max, map, blending) {
    this.max = max;
    this.count = 0;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.rot = new Float32Array(max);
    this.spin = new Float32Array(max);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.grow = new Float32Array(max);
    this.fadeIn = new Float32Array(max);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aRot', new THREE.BufferAttribute(this.rot, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setDrawRange(0, 0);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    this.geo = geo;

    this.mat = new THREE.ShaderMaterial({
      vertexShader: PARTICLE_VERT,
      fragmentShader: PARTICLE_FRAG,
      uniforms: { uMap: { value: map }, uScale: { value: 900 } },
      transparent: true,
      depthWrite: false,
      blending,
    });
    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 20;
  }

  spawn(o) {
    let i = this.count;
    if (i >= this.max) {
      // Recycle the oldest slot rather than dropping the effect entirely.
      i = this._oldest();
      if (i < 0) return;
    } else {
      this.count++;
    }
    const i3 = i * 3;
    this.pos[i3] = o.x; this.pos[i3 + 1] = o.y; this.pos[i3 + 2] = o.z;
    this.vel[i3] = o.vx || 0; this.vel[i3 + 1] = o.vy || 0; this.vel[i3 + 2] = o.vz || 0;
    const c = o.color;
    this.col[i3] = c.r; this.col[i3 + 1] = c.g; this.col[i3 + 2] = c.b;
    this.size[i] = o.size;
    this.alpha[i] = o.fadeIn ? 0 : (o.alpha ?? 1);
    this.rot[i] = o.rot ?? Math.random() * Math.PI * 2;
    this.spin[i] = o.spin ?? (Math.random() - 0.5) * 1.4;
    this.life[i] = 0;
    this.maxLife[i] = o.life;
    this.grav[i] = o.gravity ?? 0;
    this.drag[i] = o.drag ?? 0.4;
    this.grow[i] = o.grow ?? 0;
    this.fadeIn[i] = o.fadeIn ?? 0;
    return i;
  }

  _oldest() {
    let best = -1, bestRatio = -1;
    for (let i = 0; i < this.count; i++) {
      const r = this.life[i] / this.maxLife[i];
      if (r > bestRatio) { bestRatio = r; best = i; }
    }
    return best;
  }

  update(dt) {
    let n = this.count;
    for (let i = 0; i < n; i++) {
      this.life[i] += dt;
      if (this.life[i] >= this.maxLife[i]) {
        // swap-remove
        n--;
        if (i !== n) this._copy(n, i);
        this.count = n;
        i--;
        continue;
      }
      const i3 = i * 3;
      const d = Math.max(0, 1 - this.drag[i] * dt);
      this.vel[i3] *= d;
      this.vel[i3 + 1] = this.vel[i3 + 1] * d + this.grav[i] * dt;
      this.vel[i3 + 2] *= d;
      this.pos[i3] += this.vel[i3] * dt;
      this.pos[i3 + 1] += this.vel[i3 + 1] * dt;
      this.pos[i3 + 2] += this.vel[i3 + 2] * dt;

      const t = this.life[i] / this.maxLife[i];
      const fin = this.fadeIn[i];
      let a;
      if (fin > 0 && t < fin) a = t / fin;
      else a = 1 - (t - (fin || 0)) / (1 - (fin || 0));
      this.alpha[i] = Math.max(0, a * a);
      this.size[i] += this.grow[i] * dt;
      this.rot[i] += this.spin[i] * dt;
    }
    this.count = n;
    this.geo.setDrawRange(0, n);
    if (n > 0) {
      this.geo.attributes.position.needsUpdate = true;
      this.geo.attributes.aColor.needsUpdate = true;
      this.geo.attributes.aSize.needsUpdate = true;
      this.geo.attributes.aAlpha.needsUpdate = true;
      this.geo.attributes.aRot.needsUpdate = true;
    }
  }

  _copy(from, to) {
    const f3 = from * 3, t3 = to * 3;
    for (let k = 0; k < 3; k++) {
      this.pos[t3 + k] = this.pos[f3 + k];
      this.vel[t3 + k] = this.vel[f3 + k];
      this.col[t3 + k] = this.col[f3 + k];
    }
    this.size[to] = this.size[from];
    this.alpha[to] = this.alpha[from];
    this.rot[to] = this.rot[from];
    this.spin[to] = this.spin[from];
    this.life[to] = this.life[from];
    this.maxLife[to] = this.maxLife[from];
    this.grav[to] = this.grav[from];
    this.drag[to] = this.drag[from];
    this.grow[to] = this.grow[from];
    this.fadeIn[to] = this.fadeIn[from];
  }

  clear() { this.count = 0; this.geo.setDrawRange(0, 0); }
}

/* ---------------- colours ---------------- */

const C = {
  fireHot: new THREE.Color(0xfff3c4),
  fireMid: new THREE.Color(0xffa02a),
  fireLow: new THREE.Color(0xd33a12),
  smokeDark: new THREE.Color(0x41464c),
  smokeLight: new THREE.Color(0x9aa2aa),
  water: new THREE.Color(0xdff0fb),
  waterDeep: new THREE.Color(0x8fc0da),
  spark: new THREE.Color(0xffd88a),
  steel: new THREE.Color(0x555f68),
};

function jitter(v) { return (Math.random() - 0.5) * v; }

/* =========================================================
   FX
   ========================================================= */

export class FX {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;

    const q = quality.particleScale();
    const cap = (n) => Math.max(64, Math.round(n * Math.max(0.5, q)));

    // Tight falloff: a wide, soft glow makes overlapping puffs merge into one
    // flat orange disc instead of a billowing fireball.
    this.glowTex = radialTexture([
      [0, 'rgba(255,255,255,1)'], [0.16, 'rgba(255,236,190,0.78)'],
      [0.34, 'rgba(255,150,50,0.30)'], [0.62, 'rgba(200,60,10,0.07)'], [1, 'rgba(120,20,0,0)'],
    ]);
    this.dotTex = radialTexture([
      [0, 'rgba(255,255,255,1)'], [0.45, 'rgba(255,255,255,0.6)'], [1, 'rgba(255,255,255,0)'],
    ], 64);
    this.smokeTex = smokeTexture();

    this.sparks = new ParticleField(cap(1400), this.dotTex, THREE.AdditiveBlending);
    this.fire = new ParticleField(cap(900), this.glowTex, THREE.AdditiveBlending);
    this.smoke = new ParticleField(cap(900), this.smokeTex, THREE.NormalBlending);
    this.water = new ParticleField(cap(1100), this.dotTex, THREE.NormalBlending);

    for (const f of [this.smoke, this.water, this.fire, this.sparks]) scene.add(f.points);

    /* shockwave rings */
    this.rings = [];
    this.ringGeo = new THREE.RingGeometry(0.62, 1, 40);
    this.ringGeo.rotateX(-Math.PI / 2);
    this.ringGeo.userData.shared = true;

    /* flash lights */
    this.lights = [];
    for (let i = 0; i < 4; i++) {
      const l = new THREE.PointLight(0xffa040, 0, 90, 2);
      l.visible = false;
      scene.add(l);
      this.lights.push({ light: l, t: 0, dur: 0, peak: 0 });
    }

    /* in-flight shells */
    this.shells = [];
    this.shellGeo = new THREE.SphereGeometry(0.34, 8, 6);
    this.shellGeo.userData.shared = true;
    this.shellMat = new THREE.MeshBasicMaterial({ color: 0xffd9a0 });
    this.shellMat.userData.shared = true;

    /* persistent burn sites */
    this.burns = [];

    this.shakeAmount = 0;
    this.shakeTime = 0;
  }

  /* ---------------- utility ---------------- */

  shake(amount, duration = 0.55) {
    if (!settings.get('shake')) return;
    this.shakeAmount = Math.max(this.shakeAmount, amount);
    this.shakeTime = Math.max(this.shakeTime, duration);
  }

  flash(pos, intensity, distance, color, dur = 0.35) {
    const slot = this.lights.find((l) => !l.light.visible) || this.lights[0];
    slot.light.position.copy(pos);
    slot.light.color.setHex(color);
    slot.light.distance = distance;
    slot.light.visible = true;
    slot.peak = intensity;
    slot.dur = dur;
    slot.t = 0;
  }

  ring(pos, maxR, dur, color, opacity = 0.8, thickness = 1) {
    const mat = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const m = new THREE.Mesh(this.ringGeo, mat);
    m.position.copy(pos);
    m.scale.setScalar(0.4);
    m.renderOrder = 18;
    this.scene.add(m);
    this.rings.push({ mesh: m, t: 0, dur, maxR, opacity, thickness });
  }

  /* ---------------- shell in flight ---------------- */

  /**
   * Launch a shell on a ballistic arc.
   * @returns {Promise<void>} resolves on impact
   */
  fireShell(from, to, { duration = 1.15, arc = 1, onImpact = null } = {}) {
    const mesh = new THREE.Mesh(this.shellGeo, this.shellMat);
    mesh.position.copy(from);
    this.scene.add(mesh);

    const glowMat = new THREE.SpriteMaterial({
      map: this.glowTex, color: 0xffc070, transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.9,
    });
    const glow = new THREE.Sprite(glowMat);
    glow.scale.setScalar(3.2);
    mesh.add(glow);

    const dist = from.distanceTo(to);
    const height = Math.max(16, dist * 0.30) * arc;

    const shell = {
      mesh, from: from.clone(), to: to.clone(), t: 0,
      dur: duration, height, onImpact, trail: 0,
    };
    this.shells.push(shell);
    return shell;
  }

  /* ---------------- impacts ---------------- */

  /** Miss: a tall column of water and a spreading ring. */
  splash(pos, scale = 1) {
    const q = quality.particleScale();
    const n = Math.round(46 * scale * q);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * 1.5 * scale;
      const up = 11 + Math.random() * 15 * scale;
      this.water.spawn({
        x: pos.x + Math.cos(a) * r, y: pos.y + 0.3, z: pos.z + Math.sin(a) * r,
        vx: Math.cos(a) * (1.4 + Math.random() * 5.5) * scale,
        vy: up,
        vz: Math.sin(a) * (1.4 + Math.random() * 5.5) * scale,
        color: Math.random() < 0.62 ? C.water : C.waterDeep,
        size: (0.55 + Math.random() * 1.5) * scale,
        life: 0.85 + Math.random() * 0.85,
        gravity: -26, drag: 0.32, grow: 0.7,
      });
    }
    // dense core column
    const core = Math.round(16 * scale * q);
    for (let i = 0; i < core; i++) {
      this.water.spawn({
        x: pos.x + jitter(1.1), y: pos.y + i * 0.55, z: pos.z + jitter(1.1),
        vx: jitter(1.4), vy: 16 + Math.random() * 8, vz: jitter(1.4),
        color: C.water, size: (2.2 + Math.random() * 2.2) * scale,
        life: 0.55 + Math.random() * 0.5, gravity: -20, drag: 0.9, grow: 2.4,
      });
    }
    // mist that lingers
    for (let i = 0; i < Math.round(10 * q); i++) {
      this.smoke.spawn({
        x: pos.x + jitter(3), y: pos.y + 1 + Math.random() * 3, z: pos.z + jitter(3),
        vx: jitter(2), vy: 1.2 + Math.random(), vz: jitter(2),
        color: C.water, size: 3.8 + Math.random() * 3.4, alpha: 0.5,
        life: 1.5 + Math.random(), drag: 0.8, grow: 3.0, fadeIn: 0.12,
      });
    }
    this.ring(new THREE.Vector3(pos.x, 0.35, pos.z), 12 * scale, 1.1, 0xbfe4f7, 0.55);
    this.flash(new THREE.Vector3(pos.x, 6, pos.z), 12, 46, 0xbfe0f5, 0.18);
    this.shake(0.55 * scale, 0.35);
  }

  /** Hit: fireball, shockwave, debris, and a smoke plume. */
  explode(pos, scale = 1) {
    const q = quality.particleScale();

    // Fireball: a small white-hot core inside a looser envelope of embers.
    for (let i = 0; i < Math.round(10 * scale * q); i++) {
      this.fire.spawn({
        x: pos.x + jitter(0.9), y: pos.y + 0.7 + jitter(0.8), z: pos.z + jitter(0.9),
        vx: jitter(7), vy: 3 + Math.random() * 6, vz: jitter(7),
        color: C.fireHot,
        size: (1.4 + Math.random() * 1.3) * scale,
        life: 0.13 + Math.random() * 0.14,
        gravity: 4, drag: 3.2, grow: 4.0,
      });
    }
    const nf = Math.round(64 * scale * q);
    for (let i = 0; i < nf; i++) {
      const a = Math.random() * Math.PI * 2;
      const el = Math.random() * Math.PI * 0.5;
      const sp = (7 + Math.random() * 22) * scale;
      this.fire.spawn({
        x: pos.x + jitter(1.6), y: pos.y + 0.6 + jitter(1.3), z: pos.z + jitter(1.6),
        vx: Math.cos(a) * Math.cos(el) * sp,
        vy: Math.sin(el) * sp * 1.25 + 3,
        vz: Math.sin(a) * Math.cos(el) * sp,
        color: Math.random() < 0.42 ? C.fireMid : C.fireLow,
        size: (1.0 + Math.random() * 2.0) * scale,
        life: 0.26 + Math.random() * 0.42,
        gravity: 5, drag: 2.7, grow: 2.2,
      });
    }
    // sparks and shrapnel
    const ns = Math.round(60 * scale * q);
    for (let i = 0; i < ns; i++) {
      const a = Math.random() * Math.PI * 2;
      const el = Math.random() * Math.PI * 0.62;
      const sp = (14 + Math.random() * 40) * scale;
      this.sparks.spawn({
        x: pos.x, y: pos.y + 0.8, z: pos.z,
        vx: Math.cos(a) * Math.cos(el) * sp,
        vy: Math.sin(el) * sp + 6,
        vz: Math.sin(a) * Math.cos(el) * sp,
        color: Math.random() < 0.25 ? C.steel : C.spark,
        size: 0.16 + Math.random() * 0.34,
        life: 0.5 + Math.random() * 1.3,
        gravity: -30, drag: 0.12,
      });
    }
    // Smoke plume. Kept thin and short-lived - a dense column parks itself
    // over the tiles you are trying to read.
    const nm = Math.round(13 * scale * q);
    for (let i = 0; i < nm; i++) {
      this.smoke.spawn({
        x: pos.x + jitter(2.4), y: pos.y + 1 + Math.random() * 2.5, z: pos.z + jitter(2.4),
        vx: jitter(4), vy: 4.2 + Math.random() * 5.5, vz: jitter(4),
        color: Math.random() < 0.45 ? C.smokeDark : C.smokeLight,
        size: (1.8 + Math.random() * 2.2) * scale, alpha: 0.3,
        life: 1.4 + Math.random() * 1.5,
        drag: 0.55, grow: 1.5, gravity: 1.4, fadeIn: 0.1,
      });
    }
    // water thrown up around the hull
    for (let i = 0; i < Math.round(18 * scale * q); i++) {
      const a = Math.random() * Math.PI * 2;
      this.water.spawn({
        x: pos.x + Math.cos(a) * 2, y: 0.4, z: pos.z + Math.sin(a) * 2,
        vx: Math.cos(a) * (6 + Math.random() * 9), vy: 7 + Math.random() * 8, vz: Math.sin(a) * (6 + Math.random() * 9),
        color: C.water, size: 0.85 + Math.random() * 1.3,
        life: 0.7 + Math.random() * 0.6, gravity: -24, drag: 0.4, grow: 1.0,
      });
    }

    this.ring(new THREE.Vector3(pos.x, 0.4, pos.z), 17 * scale, 0.75, 0xffb066, 0.9);
    this.ring(new THREE.Vector3(pos.x, 0.4, pos.z), 26 * scale, 1.25, 0xff7a33, 0.34);
    this.flash(new THREE.Vector3(pos.x, 4, pos.z), 70 * scale, 110, 0xffa040, 0.45);
    this.shake(1.5 * scale, 0.75);
  }

  /** A hull going under: chained blasts, a boiling patch, a heavy plume. */
  sinkBurst(pos, length = 12) {
    const q = quality.particleScale();
    this.explode(pos, 1.5);
    for (let i = 0; i < 5; i++) {
      const off = new THREE.Vector3(
        pos.x + jitter(length * 0.8), pos.y, pos.z + jitter(length * 0.8),
      );
      setTimeout(() => this.explode(off, 0.75 + Math.random() * 0.5), 180 + i * 230);
    }
    for (let i = 0; i < Math.round(30 * q); i++) {
      this.smoke.spawn({
        x: pos.x + jitter(length), y: 1 + Math.random() * 3, z: pos.z + jitter(length),
        vx: jitter(3), vy: 2.6 + Math.random() * 4, vz: jitter(3),
        color: Math.random() < 0.5 ? C.smokeDark : C.smokeLight,
        size: 2.4 + Math.random() * 2.6, alpha: 0.34,
        life: 2.6 + Math.random() * 2.4, drag: 0.42, grow: 1.4, gravity: 1.1, fadeIn: 0.14,
      });
    }
    this.shake(2.4, 1.3);
  }

  /** Muzzle blast at the firing ship. */
  muzzle(pos, dir) {
    const q = quality.particleScale();
    const d = dir.clone().normalize();
    for (let i = 0; i < Math.round(26 * q); i++) {
      const sp = 16 + Math.random() * 34;
      this.fire.spawn({
        x: pos.x, y: pos.y, z: pos.z,
        vx: d.x * sp + jitter(9), vy: d.y * sp + jitter(6) + 2, vz: d.z * sp + jitter(9),
        color: Math.random() < 0.5 ? C.fireHot : C.fireMid,
        size: 1.5 + Math.random() * 2.2, life: 0.18 + Math.random() * 0.3,
        drag: 3.4, grow: 4.4,
      });
    }
    for (let i = 0; i < Math.round(12 * q); i++) {
      this.smoke.spawn({
        x: pos.x + d.x * 2, y: pos.y + 0.4, z: pos.z + d.z * 2,
        vx: d.x * (5 + Math.random() * 9) + jitter(3), vy: 1.6 + Math.random() * 2.4, vz: d.z * (5 + Math.random() * 9) + jitter(3),
        color: C.smokeLight, size: 2.4 + Math.random() * 2.6, alpha: 0.5,
        life: 1.6 + Math.random() * 1.4, drag: 0.9, grow: 2.0, fadeIn: 0.08,
      });
    }
    this.flash(pos, 42, 70, 0xffb060, 0.16);
    this.shake(0.7, 0.3);
  }

  /* ---------------- persistent burn sites ---------------- */

  /**
   * A burning tile. Fires die down over `ttl` seconds - an eternally smoking
   * grid ends up as an opaque screen you cannot aim through.
   */
  addBurn(pos, strength = 1, ttl = 24) {
    const rec = { pos: pos.clone(), strength, base: strength, ttl, age: 0, acc: Math.random() * 0.2 };
    this.burns.push(rec);
    if (this.burns.length > 14) this.burns.shift();
    return rec;
  }

  removeBurn(rec) {
    const i = this.burns.indexOf(rec);
    if (i >= 0) this.burns.splice(i, 1);
  }

  clearBurns() { this.burns.length = 0; }

  _updateBurns(dt) {
    const q = quality.particleScale();
    // Late in a match there can be many burning tiles; thin the emission rate
    // so the particle budget is shared rather than blown on the first few.
    const rate = (8 * q) / Math.max(1, this.burns.length / 5);
    for (let i = this.burns.length - 1; i >= 0; i--) {
      const b = this.burns[i];
      b.age += dt;
      if (b.age >= b.ttl) { this.burns.splice(i, 1); continue; }
      b.strength = b.base * (1 - b.age / b.ttl);
      b.acc += dt * rate * b.strength;
      while (b.acc >= 1) {
        b.acc -= 1;
        const hot = Math.random() < 0.55;
        this.fire.spawn({
          x: b.pos.x + jitter(1.5), y: b.pos.y + 0.4 + Math.random(), z: b.pos.z + jitter(1.5),
          vx: jitter(1.6), vy: 3.4 + Math.random() * 4.4, vz: jitter(1.6),
          color: hot ? C.fireMid : C.fireLow,
          size: (0.8 + Math.random() * 1.4) * b.strength,
          life: 0.4 + Math.random() * 0.5, drag: 1.4, grow: 1.3, gravity: 4,
        });
        if (Math.random() < 0.22) {
          this.smoke.spawn({
            x: b.pos.x + jitter(1.6), y: b.pos.y + 1.6, z: b.pos.z + jitter(1.6),
            vx: jitter(1.6) + 1.2, vy: 3.2 + Math.random() * 2.6, vz: jitter(1.6),
            color: C.smokeDark, size: 1.1 + Math.random() * 1.4, alpha: 0.2,
            life: 1.8 + Math.random() * 1.4, drag: 0.5, grow: 1.0, gravity: 0.6, fadeIn: 0.18,
          });
        }
        if (Math.random() < 0.25) {
          this.sparks.spawn({
            x: b.pos.x + jitter(1), y: b.pos.y + 1, z: b.pos.z + jitter(1),
            vx: jitter(4), vy: 5 + Math.random() * 7, vz: jitter(4),
            color: C.spark, size: 0.12 + Math.random() * 0.2,
            life: 0.5 + Math.random() * 0.8, gravity: -10, drag: 0.5,
          });
        }
      }
    }
  }

  /* ---------------- frame ---------------- */

  update(dt, camera) {
    /* Point sizes are given in world units, so the world-to-pixel factor has
       to track the framebuffer height and the vertical field of view. */
    if (camera) {
      const h = this.world.renderer.domElement.height || window.innerHeight;
      const scale = h / (2 * Math.tan((camera.fov * Math.PI) / 360));
      for (const f of [this.sparks, this.fire, this.smoke, this.water]) {
        f.mat.uniforms.uScale.value = scale;
      }
    }

    /* shells */
    for (let i = this.shells.length - 1; i >= 0; i--) {
      const s = this.shells[i];
      s.t += dt;
      const k = Math.min(1, s.t / s.dur);
      const p = s.mesh.position;
      p.lerpVectors(s.from, s.to, k);
      p.y += Math.sin(k * Math.PI) * s.height;

      s.trail += dt * 70 * quality.particleScale();
      while (s.trail >= 1 && k < 0.99) {
        s.trail -= 1;
        this.smoke.spawn({
          x: p.x + jitter(0.4), y: p.y + jitter(0.4), z: p.z + jitter(0.4),
          vx: jitter(1.4), vy: 0.7 + Math.random(), vz: jitter(1.4),
          color: C.smokeLight, size: 0.5 + Math.random() * 0.7, alpha: 0.4,
          life: 0.7 + Math.random() * 0.7, drag: 0.9, grow: 1.2, fadeIn: 0.12,
        });
      }

      if (k >= 1) {
        this.scene.remove(s.mesh);
        s.mesh.traverse((o) => { if (o.isSprite) o.material.dispose(); });
        this.shells.splice(i, 1);
        if (s.onImpact) s.onImpact();
      }
    }

    /* rings */
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.t += dt;
      const k = r.t / r.dur;
      if (k >= 1) {
        this.scene.remove(r.mesh);
        r.mesh.material.dispose();
        this.rings.splice(i, 1);
        continue;
      }
      const e = 1 - Math.pow(1 - k, 2.4);
      r.mesh.scale.setScalar(0.4 + e * r.maxR);
      r.mesh.material.opacity = r.opacity * (1 - k) * (1 - k);
    }

    /* flash lights */
    for (const l of this.lights) {
      if (!l.light.visible) continue;
      l.t += dt;
      const k = l.t / l.dur;
      if (k >= 1) { l.light.visible = false; l.light.intensity = 0; continue; }
      l.light.intensity = l.peak * Math.pow(1 - k, 2.2);
    }

    this._updateBurns(dt);

    this.sparks.update(dt);
    this.fire.update(dt);
    this.smoke.update(dt);
    this.water.update(dt);

    /* shake decay */
    if (this.shakeTime > 0) {
      this.shakeTime -= dt;
      this.shakeAmount *= Math.pow(0.02, dt);
      if (this.shakeTime <= 0) { this.shakeAmount = 0; this.shakeTime = 0; }
    }
  }

  /** Current shake offset, applied by the camera rig. */
  shakeOffset(out, time) {
    const a = this.shakeAmount;
    if (a <= 0.0001) { out.set(0, 0, 0); return out; }
    out.set(
      Math.sin(time * 47.3) * a + Math.sin(time * 91.7) * a * 0.5,
      Math.sin(time * 61.1) * a * 0.8 + Math.sin(time * 113.3) * a * 0.4,
      Math.cos(time * 53.9) * a,
    );
    return out;
  }

  clear() {
    for (const f of [this.sparks, this.fire, this.smoke, this.water]) f.clear();
    for (const s of this.shells) this.scene.remove(s.mesh);
    this.shells.length = 0;
    for (const r of this.rings) { this.scene.remove(r.mesh); r.mesh.material.dispose(); }
    this.rings.length = 0;
    for (const l of this.lights) { l.light.visible = false; l.light.intensity = 0; }
    this.clearBurns();
    this.shakeAmount = 0;
    this.shakeTime = 0;
  }
}
