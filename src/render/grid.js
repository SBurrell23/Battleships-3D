/* =========================================================
   A battle grid: floating steel boom frame, a targeting overlay
   painted onto the moving water, corner lights, edge labels and
   the physical hit/miss markers.
   ========================================================= */

import * as THREE from 'three';
import { CELL, boardCenterZ } from '../core/constants.js';
import { TILE } from '../core/board.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { WAVE_GLSL } from './waves.js';

const GRID_VERT = /* glsl */`
uniform float uTime;
uniform float uChop;
uniform float uLift;
varying vec2 vUv;
varying vec3 vWorld;
${WAVE_GLSL}
void main() {
  vUv = uv;
  vec3 wp = (modelMatrix * vec4(position, 1.0)).xyz;
  float h; vec2 dh;
  waveField(wp.xz, uTime, uChop, h, dh);
  wp.y += h + uLift;
  vWorld = wp;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;

const GRID_FRAG = /* glsl */`
precision highp float;
uniform float uN;          // cells per side
uniform vec3  uColor;      // fleet colour
uniform float uTime;
uniform vec2  uHover;      // texture-space cell, (-1,-1) when none
uniform float uHoverOk;
uniform float uScan;       // 0..1 sonar sweep strength
uniform float uFade;
uniform sampler2D uState;  // per-cell state, R channel: 0 empty / 1 miss / 2 hit
varying vec2 vUv;
varying vec3 vWorld;

void main() {
  vec2 g = vUv * uN;
  vec2 cell = floor(g);
  vec2 f = fract(g);

  // Lines are measured in pixels, not in cell units, so they keep a constant
  // on-screen weight however steeply the water is tilted away from us.
  vec2 gw = max(fwidth(g), vec2(1e-5));
  vec2 dd = abs(fract(g - 0.5) - 0.5) / gw;
  float line = 1.0 - smoothstep(0.0, 1.0, min(dd.x, dd.y) - 0.55);

  vec2 de = (min(vUv, 1.0 - vUv) * uN) / gw;
  float border = 1.0 - smoothstep(0.0, 1.0, min(de.x, de.y) - 2.4);

  // per-cell state
  float st = texture2D(uState, (cell + 0.5) / uN).r * 255.0;
  float isMiss = step(0.5, st) * (1.0 - step(1.5, st));
  float isHit  = step(1.5, st);

  vec3 col = uColor;
  // A faint wash inside the boom separates the arena from open sea. Keep it
  // very low or the overlay reads as a solid pane hovering over the water.
  // The lattice itself is drawn strongly so the fleet colour is unmistakable.
  float a = 0.045 + line * 0.66 + border * 0.9;

  // miss: cool pale wash with a ring
  float r = length(f - 0.5);
  if (isMiss > 0.5) {
    col = mix(col, vec3(0.78, 0.88, 0.96), 0.9);
    a = max(a, 0.20);
    float ring = smoothstep(0.34, 0.31, r) * smoothstep(0.22, 0.26, r);
    a = max(a, ring * 0.45);
  }

  // hit: hot core that breathes
  if (isHit > 0.5) {
    float pulse = 0.62 + 0.38 * sin(uTime * 3.4 + cell.x * 1.7 + cell.y * 2.3);
    col = mix(vec3(1.0, 0.45, 0.13), vec3(1.0, 0.86, 0.4), pulse * 0.45);
    a = max(a, 0.34 + pulse * 0.22);
    float ring = smoothstep(0.44, 0.40, r);
    a = max(a, ring * (0.22 + pulse * 0.16));
  }

  // hover: filled cell plus gunnery brackets
  if (uHover.x >= 0.0 && abs(cell.x - uHover.x) < 0.5 && abs(cell.y - uHover.y) < 0.5) {
    vec3 hc = mix(vec3(1.0, 0.25, 0.2), uColor, uHoverOk);
    float corner = step(0.72, max(abs(f.x - 0.5), abs(f.y - 0.5)) * 2.0)
                 * step(max(abs(f.x - 0.5), abs(f.y - 0.5)) * 2.0, 1.0)
                 * step(0.28, 1.0 - min(abs(f.x - 0.5), abs(f.y - 0.5)) * 2.0);
    col = mix(col, hc, 0.9);
    a = max(a, 0.22 + corner * 0.5 + (0.10 + 0.06 * sin(uTime * 6.0)));
  }

  // sonar sweep across the enemy grid while you hold the initiative
  if (uScan > 0.001) {
    float sweep = fract(uTime * 0.28);
    float band = smoothstep(0.06, 0.0, abs(vUv.y - sweep));
    col = mix(col, vec3(0.6, 1.0, 0.85), band * 0.55);
    a = max(a, band * 0.22 * uScan);
  }

  a *= uFade;
  if (a < 0.004) discard;
  gl_FragColor = vec4(col, a);
}
`;

/* ---------------- marker meshes (shared geometry) ---------------- */

const boltGeo = new THREE.SphereGeometry(0.13, 6, 5);

/* Markers are drawn as two instanced pools per board, so a grid full of
   shots still costs two draw calls instead of one per peg. Their two-tone
   look is baked into vertex colours since instances cannot vary materials. */
function markerGeometry(bodyHex, ringHex) {
  const peg = new THREE.CylinderGeometry(0.30, 0.38, 1.05, 10).translate(0, 0.55, 0);
  const cap = new THREE.SphereGeometry(0.34, 10, 7).translate(0, 1.06, 0);
  const ring = new THREE.TorusGeometry(0.66, 0.16, 6, 14).rotateX(Math.PI / 2).translate(0, 0.1, 0);
  const parts = [[peg, bodyHex], [cap, bodyHex], [ring, ringHex]];
  for (const [geo, hex] of parts) {
    const c = new THREE.Color(hex);
    const n = geo.attributes.position.count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.deleteAttribute('uv');
  }
  const merged = mergeGeometries(parts.map((p) => p[0]), false);
  for (const [geo] of parts) geo.dispose();
  merged.userData.shared = true;
  return merged;
}

const MISS_GEO = markerGeometry(0xd9e6ef, 0x8fa4b3);
const HIT_GEO = markerGeometry(0xc0281c, 0x2a1512);
const MARKER_MAT = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.18 });
const FRAME_MAT = new THREE.MeshStandardMaterial({ color: 0x39434c, roughness: 0.62, metalness: 0.55 });
const BOLT_MAT = new THREE.MeshStandardMaterial({ color: 0x8c9aa6, roughness: 0.34, metalness: 0.85 });

/* Scratch objects reused every frame by the boom update. */
const _m4 = new THREE.Matrix4();
const _quat = new THREE.Quaternion();
const _v3 = new THREE.Vector3();
const _v3b = new THREE.Vector3();
const _euler = new THREE.Euler();

/* ---------------- contact shadow ----------------
   The ocean is a custom shader and does not take shadow maps, so each hull
   gets a soft dark decal that rides the swell underneath it. */

let hullShadowTex = null;
function hullShadowTexture() {
  if (hullShadowTex) return hullShadowTex;
  const s = 128;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(0,0,0,0.85)');
  g.addColorStop(0.45, 'rgba(0,0,0,0.55)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, s, s);
  hullShadowTex = new THREE.CanvasTexture(c);
  hullShadowTex.userData.shared = true;
  return hullShadowTex;
}

const shadowPlane = new THREE.PlaneGeometry(1, 1);
shadowPlane.rotateX(-Math.PI / 2);
shadowPlane.userData.shared = true;

function makeHullShadow(length, beam) {
  const mat = new THREE.MeshBasicMaterial({
    map: hullShadowTexture(), transparent: true, opacity: 0.5,
    depthWrite: false, color: 0x000000,
  });
  const m = new THREE.Mesh(shadowPlane, mat);
  m.scale.set(length * 1.25, 1, beam * 3.4);
  m.renderOrder = 6;
  return m;
}

/* ---------------- labels ---------------- */

function labelSprite(text, cssColor) {
  const s = 72;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const x = c.getContext('2d');
  x.clearRect(0, 0, s, s);
  x.font = 'bold 44px "Share Tech Mono", monospace';
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.shadowColor = 'rgba(0,0,0,0.9)';
  x.shadowBlur = 8;
  x.fillStyle = cssColor;
  x.fillText(text, s / 2, s / 2 + 2);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({
    map: tex, transparent: true, depthTest: true, depthWrite: false, sizeAttenuation: true,
  }));
  spr.scale.set(2.1, 2.1, 1);
  return spr;
}

/* =========================================================
   BoardView
   ========================================================= */

export class BoardView {
  /**
   * @param {'own'|'foe'} side
   * @param {number} n grid size
   * @param {number} hex fleet colour
   */
  constructor(side, n, hex) {
    this.side = side;
    this.n = n;
    this.hex = hex;
    this.sign = side === 'own' ? 1 : -1;
    this.S = n * CELL;

    this.group = new THREE.Group();
    this.group.position.set(0, 0, boardCenterZ(n) * this.sign);

    this._buildOverlay();
    this._buildFrame();
    this._buildLabels();

    /** Invisible collision plane used by the raycaster. */
    const pickGeo = new THREE.PlaneGeometry(this.S, this.S);
    pickGeo.rotateX(-Math.PI / 2);
    const pickMat = new THREE.MeshBasicMaterial();
    pickMat.visible = false;
    this.picker = new THREE.Mesh(pickGeo, pickMat);
    this.picker.userData.boardSide = side;
    this.group.add(this.picker);

    this.markers = [];            // { mesh, gx, gy, kind }
    this.shipViews = new Map();   // uid -> { group, ship, sinking }
    this.hover = null;
  }

  /* ---- local geometry helpers ---- */

  localX(gx) { return (gx - (this.n - 1) / 2) * CELL; }
  localZ(gy) { return (gy - (this.n - 1) / 2) * CELL * this.sign; }

  /** World-space centre of a cell. */
  worldOf(gx, gy, y = 0) {
    return new THREE.Vector3(
      this.localX(gx),
      y,
      this.group.position.z + this.localZ(gy),
    );
  }

  /** Texture row for a grid row (the overlay UV runs the other way on own waters). */
  texRow(gy) { return this.side === 'own' ? this.n - 1 - gy : gy; }

  /** Convert a world point to grid coords. Returns null when off-board. */
  pick(point) {
    const lx = point.x;
    const lz = point.z - this.group.position.z;
    const half = (this.n - 1) / 2;
    const gx = Math.round(lx / CELL + half);
    const gy = Math.round(lz / (CELL * this.sign) + half);
    if (gx < 0 || gy < 0 || gx >= this.n || gy >= this.n) return null;
    return { gx, gy };
  }

  /* ---- overlay ---- */

  _buildOverlay() {
    const seg = Math.max(24, this.n * 5);
    const geo = new THREE.PlaneGeometry(this.S, this.S, seg, seg);
    geo.rotateX(-Math.PI / 2);

    const data = new Uint8Array(this.n * this.n);
    const tex = new THREE.DataTexture(data, this.n, this.n, THREE.RedFormat, THREE.UnsignedByteType);
    tex.minFilter = tex.magFilter = THREE.NearestFilter;
    tex.needsUpdate = true;
    this.stateData = data;
    this.stateTex = tex;

    this.overlayMat = new THREE.ShaderMaterial({
      vertexShader: GRID_VERT,
      fragmentShader: GRID_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      uniforms: {
        uTime: { value: 0 },
        uChop: { value: 1 },
        // Small constant clearance. The overlay samples the swell at a much
        // finer resolution than the ocean mesh, so without a lift it dips
        // under the ocean's flat interpolation and flickers in and out.
        uLift: { value: 0.22 },
        uN: { value: this.n },
        uColor: { value: new THREE.Color(this.hex) },
        uHover: { value: new THREE.Vector2(-1, -1) },
        uHoverOk: { value: 1 },
        uScan: { value: 0 },
        uFade: { value: 1 },
        uState: { value: tex },
      },
    });
    this.overlay = new THREE.Mesh(geo, this.overlayMat);
    this.overlay.renderOrder = 5;
    this.overlay.frustumCulled = false;
    this.group.add(this.overlay);
  }

  /**
   * Teach a standard material to ride the swell. The board group carries only
   * a translation, so a vertex's world XZ is its model XZ plus that offset and
   * a world-space Y nudge can be added straight onto `transformed`.
   */
  _waveDisplace(mat) {
    const u = this.boomUniforms;
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = u.uTime;
      shader.uniforms.uChop = u.uChop;
      shader.uniforms.uBoardZ = u.uBoardZ;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>
uniform float uTime;
uniform float uChop;
uniform float uBoardZ;
${WAVE_GLSL}`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
{
  vec2 wxz = vec2(transformed.x, transformed.z + uBoardZ);
  float wh; vec2 wdh;
  waveField(wxz, uTime, uChop, wh, wdh);
  transformed.y += wh;
}`)
        .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
{
  vec2 nxz = vec2(position.x, position.z + uBoardZ);
  float nh; vec2 ndh;
  waveField(nxz, uTime, uChop, nh, ndh);
  objectNormal = normalize(objectNormal + vec3(-ndh.x, 0.0, -ndh.y) * max(objectNormal.y, 0.0));
}`);
    };
    // The board offset MUST be a uniform, not baked into the source: both
    // boards share this cache key, so three compiles the shader once and the
    // second board would otherwise inherit the first board's patch of sea.
    mat.customProgramCacheKey = () => 'bs3d-boom-wave';
  }

  /* ---- floating boom frame ---- */

  _buildFrame() {
    const half = this.S / 2;
    const t = 1.3;           // boom thickness
    const out = half + 2.4;  // frame sits just outside the play area
    const frame = new THREE.Group();

    const accentSpec = {
      color: this.hex, roughness: 0.4, metalness: 0.35,
      emissive: this.hex, emissiveIntensity: 0.35,
    };
    // Two copies: one rides the boom's wave shader, one stays undisplaced for
    // parts that are positioned from JS.
    const accent = new THREE.MeshStandardMaterial(accentSpec);
    const accentPlain = new THREE.MeshStandardMaterial(accentSpec);
    this.accentMats = [accent, accentPlain];

    /* Each side of the boom is ONE continuous beam, finely segmented along its
       length and bent by the same wave field the ocean uses. Displacing it in
       the vertex shader keeps it a single unbroken line that ripples with the
       swell, rather than a row of separate floats bobbing out of step. */
    this.boomUniforms = {
      uTime: { value: 0 },
      uChop: { value: 1 },
      uBoardZ: { value: boardCenterZ(this.n) * this.sign },
    };

    const span = out * 2 + t;
    const segs = Math.max(24, Math.ceil(span / 1.1));
    const beams = (h, w, y, shrink = 0) => {
      const parts = [];
      for (const along of ['x', 'z']) {
        for (const sign of [1, -1]) {
          const g = new THREE.BoxGeometry(span - shrink, h, w, segs, 1, 1);
          if (along === 'z') g.rotateY(Math.PI / 2);
          g.translate(along === 'x' ? 0 : sign * out, y, along === 'x' ? sign * out : 0);
          parts.push(g);
        }
      }
      const merged = mergeGeometries(parts, false);
      for (const g of parts) g.dispose();
      return merged;
    };

    const boltRing = () => {
      const step = 3.0;
      const count = Math.max(4, Math.round(span / step));
      const parts = [];
      for (const along of ['x', 'z']) {
        for (const sign of [1, -1]) {
          for (let i = 0; i < count; i++) {
            const u = -span / 2 + (i + 0.5) * (span / count);
            for (const off of [0.56, -0.56]) {
              const g = boltGeo.clone();
              g.translate(
                along === 'x' ? u : sign * out + off,
                1.0,
                along === 'x' ? sign * out + off : u,
              );
              parts.push(g);
            }
          }
        }
      }
      const merged = mergeGeometries(parts, false);
      for (const g of parts) g.dispose();
      return merged;
    };

    // Lighter than the hull steel so the barrier reads against dark water.
    this.boomMat = FRAME_MAT.clone();
    this.boomMat.color.setHex(0x6e7b88);
    this.postMat = FRAME_MAT.clone();
    this.postMat.color.setHex(0x6e7b88);
    this.boomBoltMat = BOLT_MAT.clone();
    for (const mat of [this.boomMat, accent, this.boomBoltMat]) {
      this._waveDisplace(mat);
    }

    /* Freeboard matters more than it looks. The boom rides the water at its
       own position, but the sea a couple of units either side can be most of
       a metre higher, so a low barrier gets swallowed by its neighbouring
       crests. Standing the deck well clear keeps the outline unbroken. */
    this.boomParts = [];
    for (const [geo, mat] of [
      [beams(2.7, t, 0.05), this.boomMat],
      [beams(0.24, t * 0.66, 1.47), accent],
      [boltRing(), this.boomBoltMat],
    ]) {
      const mesh = new THREE.Mesh(geo, mat);
      // The shadow pass would not see the displacement, so skip it - the boom
      // only ever shadows water, which takes no shadow map anyway.
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      frame.add(mesh);
      this.boomParts.push(mesh);
    }

    // Corner posts with signal lamps.
    this.lamps = [];
    this.posts = [];
    for (const sx of [1, -1]) {
      for (const sz of [1, -1]) {
        const post = new THREE.Group();
        // Posts are placed on the swell from JS, so they must NOT use the
        // boom material - its vertex shader would displace them a second time,
        // and from the post's own local origin at that.
        const p = new THREE.Mesh(new THREE.CylinderGeometry(0.58, 0.74, 4.2, 10), this.postMat);
        p.position.y = 0.9;
        post.add(p);
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.72, 0.12, 6, 14), accentPlain);
        ring.rotation.x = Math.PI / 2;
        ring.position.y = 2.6;
        post.add(ring);
        const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.34, 10, 8), new THREE.MeshStandardMaterial({
          color: this.hex, emissive: this.hex, emissiveIntensity: 2.2, roughness: 0.3,
        }));
        lamp.position.y = 3.2;
        post.add(lamp);
        this.lamps.push(lamp);
        post.position.set(sx * out, 0, sz * out);
        frame.add(post);
        this.posts.push(post);
      }
    }

    // Posts are rigid and positioned on the CPU, so they can cast normally.
    for (const post of this.posts) {
      post.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    }
    this.frame = frame;
    this.group.add(frame);
  }

  /* ---- edge labels ---- */

  _buildLabels() {
    // Plain white on both axes: the fleet colour already marks the board, and
    // coloured coordinates are harder to read at a glance against the water.
    const g = new THREE.Group();
    const y = 2.6;
    const gap = CELL * 0.5 + 3.2;
    for (let i = 0; i < this.n; i++) {
      const col = labelSprite(String.fromCharCode(65 + i), '#ffffff');
      col.position.set(this.localX(i), y, this.localZ(0) - this.sign * gap);
      g.add(col);

      const row = labelSprite(String(i + 1), '#ffffff');
      row.position.set(this.localX(0) - gap, y, this.localZ(i));
      g.add(row);
    }
    this.labels = g;
    this.group.add(g);
  }

  /* ---- state ---- */

  setCell(gx, gy, tile) {
    const row = this.texRow(gy);
    this.stateData[row * this.n + gx] = tile;
    this.stateTex.needsUpdate = true;
  }

  setHover(cellOrNull, valid = true) {
    this.hover = cellOrNull;
    const u = this.overlayMat.uniforms;
    if (!cellOrNull) {
      u.uHover.value.set(-1, -1);
    } else {
      u.uHover.value.set(cellOrNull.gx, this.texRow(cellOrNull.gy));
      u.uHoverOk.value = valid ? 1 : 0;
    }
  }

  setScan(on) {
    this.overlayMat.uniforms.uScan.value = on ? 1 : 0;
  }

  setAccent(hex) {
    this.hex = hex;
    this.overlayMat.uniforms.uColor.value.setHex(hex);
    for (const m of this.accentMats || []) { m.color.setHex(hex); m.emissive.setHex(hex); }
    for (const l of this.lamps) { l.material.color.setHex(hex); l.material.emissive.setHex(hex); }
  }

  /* ---- markers ---- */

  _markerPool(kind) {
    if (!this.pools) this.pools = {};
    if (this.pools[kind]) return this.pools[kind];
    const cap = this.n * this.n;
    const im = new THREE.InstancedMesh(kind === 'hit' ? HIT_GEO : MISS_GEO, MARKER_MAT, cap);
    im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    im.castShadow = true;
    im.receiveShadow = true;
    im.frustumCulled = false;
    im.count = 0;
    this.group.add(im);
    this.pools[kind] = im;
    return im;
  }

  addMarker(gx, gy, kind) {
    const pool = this._markerPool(kind);
    const slot = pool.count;
    if (slot >= pool.instanceMatrix.count) return null;
    pool.count = slot + 1;
    const rec = {
      kind, slot, gx, gy, t: 0,
      x: this.localX(gx), z: this.localZ(gy),
      spin: (Math.random() - 0.5) * 0.6,
    };
    this.markers.push(rec);
    return rec;
  }

  /** Reveal a sunk hull on this board (used for the enemy grid). */
  revealShip(shipData, buildFn) {
    if (this.shipViews.has(shipData.uid)) return this.shipViews.get(shipData.uid);
    const rec = this.addShip(shipData, buildFn);
    rec.revealed = true;
    return rec;
  }

  /** Position an already-built ship group onto its cells. */
  placeShipGroup(g, ship) {
    const cx = (ship.gx + (ship.horizontal ? (ship.size - 1) / 2 : 0));
    const cy = (ship.gy + (ship.horizontal ? 0 : (ship.size - 1) / 2));
    g.position.set(this.localX(cx), 0, this.localZ(cy));
    // Hull length runs along +X; vertical ships rotate a quarter turn.
    g.rotation.y = ship.horizontal ? 0 : (Math.PI / 2) * this.sign;
    if (!g.parent) this.group.add(g);
    return g;
  }

  addShip(ship, buildFn) {
    const g = buildFn(ship.classId, ship.size, this.hex);
    this.placeShipGroup(g, ship);
    const shadow = makeHullShadow(g.userData.length, g.userData.beam);
    shadow.position.copy(g.position);
    shadow.rotation.y = g.rotation.y;
    this.group.add(shadow);
    const rec = { group: g, shadow, ship, sinking: 0, revealed: false };
    this.shipViews.set(ship.uid, rec);
    return rec;
  }

  removeShip(uid) {
    const rec = this.shipViews.get(uid);
    if (!rec) return;
    this.group.remove(rec.group);
    disposeTree(rec.group);
    if (rec.shadow) { this.group.remove(rec.shadow); rec.shadow.material.dispose(); }
    this.shipViews.delete(uid);
  }

  clearShips() {
    for (const uid of [...this.shipViews.keys()]) this.removeShip(uid);
  }

  clearMarkers() {
    this.markers.length = 0;
    if (this.pools) for (const kind of Object.keys(this.pools)) this.pools[kind].count = 0;
    this.stateData.fill(TILE.EMPTY);
    this.stateTex.needsUpdate = true;
  }

  reset() {
    this.clearShips();
    this.clearMarkers();
    this.setHover(null);
  }

  /** Start the sinking animation for a hull. */
  sinkShip(uid) {
    const rec = this.shipViews.get(uid);
    if (!rec || rec.sinking) return;
    rec.sinking = 0.0001;
    rec.rollDir = Math.random() < 0.5 ? 1 : -1;
  }

  /** Advance the boom's wave clock and float the corner posts to match. */
  _updateBoom(world) {
    this.boomUniforms.uTime.value = world.time;
    const cz = this.group.position.z;
    for (const post of this.posts) {
      post.position.y = world.waveHeight(post.position.x, post.position.z + cz);
    }
  }

  /* ---- per-frame ---- */

  update(dt, world) {
    const u = this.overlayMat.uniforms;
    u.uTime.value = world.time;

    // Markers pop in, then ride the swell.
    if (this.markers.length) {
      const cz = this.group.position.z;
      const m4 = _m4, q = _quat, v = _v3, sc = _v3b, e = _euler;
      for (const mk of this.markers) {
        mk.t += dt;
        const grow = Math.min(1, mk.t * 4.5);
        const pop = 1 + Math.sin(Math.min(1, mk.t * 3.2) * Math.PI) * 0.25;
        const s = Math.max(0.001, grow * pop);
        v.set(mk.x, world.waveHeight(mk.x, mk.z + cz), mk.z);
        e.set(
          Math.cos(world.time * 0.9 + mk.gy) * 0.09,
          0,
          Math.sin(world.time * 1.1 + mk.gx) * 0.09 + mk.spin * 0.1,
        );
        q.setFromEuler(e);
        sc.setScalar(s);
        m4.compose(v, q, sc);
        this.pools[mk.kind].setMatrixAt(mk.slot, m4);
      }
      for (const kind of Object.keys(this.pools)) {
        this.pools[kind].instanceMatrix.needsUpdate = true;
      }
    }

    // Ships bob, and sinking hulls roll under.
    for (const rec of this.shipViews.values()) {
      const g = rec.group;
      const wx = g.position.x;
      const wz = g.position.z + this.group.position.z;
      if (rec.sinking) {
        // Hulls settle into a listing, half-drowned wreck rather than vanishing,
        // so the board keeps a visible record of what has already gone down.
        rec.sinking = Math.min(1, rec.sinking + dt / 4.2);
        const k = rec.sinking;
        const bob = world.waveHeight(wx, wz) * 0.35;
        g.position.y = -(k * k) * 2.5 + bob * (1 - k * 0.5);
        const roll = rec.rollDir * k * 1.02;
        if (rec.ship.horizontal) g.rotation.z = roll; else g.rotation.x = roll * this.sign;
        g.rotation.y = (rec.ship.horizontal ? 0 : (Math.PI / 2) * this.sign) + k * 0.16 * rec.rollDir;
      } else {
        const h = world.waveHeight(wx, wz);
        const h2 = world.waveHeight(wx + 3, wz + 3);
        g.position.y = h * 0.85;
        const pitch = (h2 - h) * 0.06;
        g.rotation.z = Math.sin(world.time * 0.7 + wx * 0.05) * 0.022 + pitch;
        g.rotation.x = Math.cos(world.time * 0.55 + wz * 0.05) * 0.018;
      }
      if (rec.shadow) {
        rec.shadow.position.y = g.position.y + 0.12;
        rec.shadow.material.opacity = rec.sinking ? Math.max(0, 0.5 - rec.sinking) : 0.5;
      }
    }

    this._updateBoom(world);

    // Corner lamps breathe.
    const pulse = 1.6 + Math.sin(world.time * 1.6) * 0.6;
    for (const l of this.lamps) l.material.emissiveIntensity = pulse;
  }

  dispose() {
    disposeTree(this.group);
    this.stateTex.dispose();
  }
}

export function disposeTree(root) {
  root.traverse((o) => {
    if (o.isMesh || o.isLineSegments || o.isSprite) {
      if (o.geometry && !SHARED_GEOMETRY.has(o.geometry) && !o.geometry.userData.shared) o.geometry.dispose();
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        if (!m) continue;
        if (SHARED_MATERIALS.has(m) || m.userData.shared) continue;
        if (m.map && m.map.isCanvasTexture && !m.map.userData.shared) m.map.dispose();
        m.dispose();
      }
    }
  });
}

/* Geometry and materials reused across many objects must survive disposal. */
const SHARED_GEOMETRY = new Set([MISS_GEO, HIT_GEO, boltGeo, shadowPlane]);
const SHARED_MATERIALS = new Set([MARKER_MAT, FRAME_MAT, BOLT_MAT]);

export function registerSharedMaterial(m) { SHARED_MATERIALS.add(m); }
export function registerSharedGeometry(g) { SHARED_GEOMETRY.add(g); }
