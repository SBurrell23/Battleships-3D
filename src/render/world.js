/* =========================================================
   World: renderer, sky dome, sun, and the animated ocean.
   Everything here is procedural - no textures are loaded.
   ========================================================= */

import * as THREE from 'three';
import { settings, quality } from '../core/settings.js';
import { WAVE_GLSL, RIPPLE_GLSL, waveHeightAt } from './waves.js';

export const SUN_DIR = new THREE.Vector3(0.42, 0.58, -0.7).normalize();

/* The battle sits in a pocket of clear air; everything past a few hundred
   units dissolves into haze, so the ocean never shows a visible edge. */
const FOG_COLOR = new THREE.Color(0xc6dcec);
const FOG_DENSITY = 0.0024;

/* ---------------------------------------------------------
   Ocean
   --------------------------------------------------------- */

const OCEAN_VERT = /* glsl */`
uniform float uTime;
uniform float uChop;
varying vec3 vWorld;
varying vec3 vNrm;
varying float vHeight;

${WAVE_GLSL}

void main() {
  vec3 wp = (modelMatrix * vec4(position, 1.0)).xyz;
  float h; vec2 dh;
  waveField(wp.xz, uTime, uChop, h, dh);
  wp.y += h;
  vHeight = h;
  vNrm = normalize(vec3(-dh.x, 1.0, -dh.y));
  vWorld = wp;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;

const OCEAN_FRAG = /* glsl */`
uniform vec3  uDeep;
uniform vec3  uShallow;
uniform vec3  uSky;
uniform vec3  uSunDir;
uniform vec3  uSunCol;
uniform vec3  uFogColor;
uniform float uFogDensity;
uniform vec2  uArena;   // radius where haze starts / where it is total
uniform float uTime;
uniform float uChop;
varying vec3 vWorld;
varying vec3 vNrm;
varying float vHeight;

${WAVE_GLSL}
${RIPPLE_GLSL}

float vhash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(vhash(i), vhash(i + vec2(1, 0)), f.x),
             mix(vhash(i + vec2(0, 1)), vhash(i + vec2(1, 1)), f.x), f.y);
}
float foamNoise(vec2 p) {
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 3; i++) { s += a * vnoise(p); p *= 2.17; a *= 0.5; }
  return s;
}

void main() {
  vec3 V = normalize(cameraPosition - vWorld);
  float dist = length(cameraPosition - vWorld);

  // Re-evaluate the surface slope per fragment. Interpolating the vertex
  // normal across a coarse quad smears the sun track into big soft blobs.
  float fh; vec2 fdh;
  waveField(vWorld.xz, uTime, uChop, fh, fdh);

  // Capillary ripples, faded out before they shrink below a pixel.
  float detail = 1.0 - smoothstep(70.0, 300.0, dist);
  vec2 grad = fdh + rippleGrad(vWorld.xz, uTime) * detail;

  vec3 N = normalize(vec3(-grad.x, 1.0, -grad.y));
  // Flatten with range so the high-frequency chop cannot alias into static.
  N = normalize(mix(N, vec3(0.0, 1.0, 0.0), smoothstep(240.0, 900.0, dist)));

  float fres = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 3.4);

  // Crests catch more light than troughs.
  float crest = clamp(fh * 0.55 + 0.5, 0.0, 1.0);
  vec3 col = mix(uDeep, uShallow, crest * 0.65);
  col = mix(col, uSky, fres * 0.66);

  // Light scattering through the thin, steep face of a wave.
  float steep = clamp(1.0 - N.y, 0.0, 1.0);
  float sss = pow(steep, 1.3) * crest;
  col += vec3(0.03, 0.20, 0.19) * sss * 1.5;

  // Sun glitter. Kept tight and fairly dim - a wide hot lobe blows out
  // the whole reflection track and reads as a white hole in the sea.
  vec3 H = normalize(uSunDir + V);
  float ndh = max(dot(N, H), 0.0);
  float near = 1.0 - smoothstep(220.0, 760.0, dist);
  col += uSunCol * pow(ndh, 180.0) * 1.15 * near;
  col += uSunCol * pow(ndh, 22.0) * 0.07;

  // Whitecaps: where a crest is both high and steep, torn up by noise so the
  // foam has a ragged edge instead of a painted-on band.
  float capMask = smoothstep(0.30, 0.86, crest * 0.55 + steep * 2.6);
  if (capMask > 0.001 && detail > 0.001) {
    float n = foamNoise(vWorld.xz * 0.42 + vec2(uTime * 0.09, uTime * -0.06));
    float foam = capMask * smoothstep(0.44, 0.78, n) * detail;
    col = mix(col, vec3(0.87, 0.93, 0.97), clamp(foam, 0.0, 0.85));
  }

  // Two hazes. The first is ordinary aerial perspective from the camera. The
  // second is radial: the engagement sits in a clear pocket of sea and
  // everything beyond it dissolves, so the ocean never shows a visible rim.
  float fogF = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist);
  float radial = smoothstep(uArena.x, uArena.y, length(vWorld.xz));
  col = mix(col, uFogColor, clamp(max(fogF, radial), 0.0, 1.0));

  gl_FragColor = vec4(col, 1.0);
}
`;

/**
 * A plane whose tessellation is dense over the battle area and stretches out
 * toward the horizon. The fine centre matters: the grid overlays evaluate the
 * wave field per-vertex at their own resolution, so if the ocean's quads are
 * coarse its flat interpolation cuts above the true surface and the grid sinks
 * through it. The coarse rim is hidden in fog anyway.
 */
function gradedOceanGeometry(segments, inner = 105, outer = 1500, innerFrac = 0.62) {
  const N = segments;
  const map = (u) => {
    const a = Math.abs(u);
    const s = Math.sign(u);
    if (a <= innerFrac) return s * (a / innerFrac) * inner;
    const t = (a - innerFrac) / (1 - innerFrac);
    return s * (inner + Math.pow(t, 1.9) * (outer - inner));
  };

  const side = N + 1;
  const pos = new Float32Array(side * side * 3);
  let p = 0;
  const axis = new Float32Array(side);
  for (let i = 0; i <= N; i++) axis[i] = map((i / N) * 2 - 1);
  for (let j = 0; j <= N; j++) {
    const z = axis[j];
    for (let i = 0; i <= N; i++) {
      pos[p++] = axis[i];
      pos[p++] = 0;
      pos[p++] = z;
    }
  }

  const idx = new (side * side > 65535 ? Uint32Array : Uint16Array)(N * N * 6);
  let k = 0;
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const a = j * side + i;
      const b = a + 1;
      const c = a + side;
      const d = c + 1;
      idx[k++] = a; idx[k++] = c; idx[k++] = b;
      idx[k++] = b; idx[k++] = c; idx[k++] = d;
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), outer * 1.5);
  return geo;
}

function makeOcean() {
  const geo = gradedOceanGeometry(quality.waterSegments());
  const mat = new THREE.ShaderMaterial({
    vertexShader: OCEAN_VERT,
    fragmentShader: OCEAN_FRAG,
    uniforms: {
      uTime: { value: 0 },
      uChop: { value: 1 },
      uDeep: { value: new THREE.Color(0x10527e) },
      uShallow: { value: new THREE.Color(0x49b3d8) },
      uSky: { value: new THREE.Color(0xbcdcef) },
      uSunDir: { value: SUN_DIR.clone() },
      uSunCol: { value: new THREE.Color(0xfff0d6) },
      uFogColor: { value: FOG_COLOR.clone() },
      uFogDensity: { value: FOG_DENSITY },
      uArena: { value: new THREE.Vector2(110, 330) },
    },
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = false;
  mesh.renderOrder = -10;
  mesh.frustumCulled = false;
  return mesh;
}

/* ---------------------------------------------------------
   Sky dome
   --------------------------------------------------------- */

const SKY_VERT = /* glsl */`
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const SKY_FRAG = /* glsl */`
uniform vec3 uTop;
uniform vec3 uHorizon;
uniform vec3 uBottom;
uniform vec3 uSunDir;
uniform vec3 uSunCol;
uniform vec3 uHaze;
uniform float uTime;
varying vec3 vDir;

float hash(vec3 p){ return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
float noise(vec3 p){
  vec3 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float n = mix(
    mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
    mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y),
    f.z);
  return n;
}
float fbm(vec3 p){
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 4; i++) { s += a * noise(p); p *= 2.03; a *= 0.5; }
  return s;
}

void main() {
  vec3 d = normalize(vDir);
  float h = d.y;

  vec3 col = mix(uHorizon, uTop, pow(clamp(h, 0.0, 1.0), 0.62));
  col = mix(uBottom, col, smoothstep(-0.28, 0.02, h));

  // Sun disc plus bloom.
  float sd = max(dot(d, uSunDir), 0.0);
  col += uSunCol * pow(sd, 900.0) * 3.0;
  col += uSunCol * pow(sd, 12.0) * 0.36;
  col += uSunCol * pow(sd, 3.0) * 0.09;

  // Slow, high overcast so the dome is not a flat gradient.
  if (h > -0.02) {
    vec3 cp = d / max(abs(h) + 0.12, 0.001);
    float c = fbm(cp * 0.55 + vec3(uTime * 0.012, 0.0, uTime * 0.006));
    c = smoothstep(0.52, 0.95, c) * smoothstep(-0.02, 0.30, h);
    vec3 cloudCol = mix(vec3(0.52, 0.57, 0.63), vec3(0.95, 0.93, 0.88), pow(sd, 2.0) * 0.6 + 0.25);
    col = mix(col, cloudCol, c * 0.72);
  }

  // Melt the last few degrees above and below the horizon into the same haze
  // the ocean fades to, so sea and sky meet with no seam.
  col = mix(col, uHaze, smoothstep(0.16, -0.05, h));

  gl_FragColor = vec4(col, 1.0);
}
`;

function makeSky() {
  const geo = new THREE.SphereGeometry(1600, 40, 24);
  const mat = new THREE.ShaderMaterial({
    vertexShader: SKY_VERT,
    fragmentShader: SKY_FRAG,
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      uTop: { value: new THREE.Color(0x2f76b8) },
      uHorizon: { value: new THREE.Color(0xaecfe4) },
      uBottom: { value: new THREE.Color(0x8fb2c8) },
      uHaze: { value: FOG_COLOR.clone() },
      uSunDir: { value: SUN_DIR.clone() },
      uSunCol: { value: new THREE.Color(0xffeccb) },
      uTime: { value: 0 },
    },
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -100;
  return mesh;
}

/* ---------------------------------------------------------
   World
   --------------------------------------------------------- */

export class World {
  constructor(canvas) {
    this.canvas = canvas;
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(FOG_COLOR.getHex(), FOG_DENSITY);

    this.camera = new THREE.PerspectiveCamera(52, 1, 0.6, 3000);
    this.camera.position.set(0, 120, 150);

    this.clock = new THREE.Clock();
    this.time = 0;

    this.renderer = null;
    this._buildRenderer();

    this.sky = makeSky();
    this.scene.add(this.sky);

    this.ocean = makeOcean();
    this.scene.add(this.ocean);

    this._buildLights();

    this.battleGroup = new THREE.Group();
    this.scene.add(this.battleGroup);

    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize);
    this.resize();

    settings.onChange((k) => {
      if (k === 'antialias') this._buildRenderer();
      if (k === 'renderScale') this.resize();
      if (k === 'shadows') this._applyShadowSettings();
      if (k === 'water') this._rebuildOcean();
    });
  }

  _buildRenderer() {
    const old = this.renderer;
    if (old) old.dispose();
    const r = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: !!settings.get('antialias'),
      powerPreference: 'high-performance',
      stencil: false,
      alpha: false,
    });
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.04;
    r.setClearColor(FOG_COLOR, 1);
    this.renderer = r;
    this._applyShadowSettings();
    this.resize();
  }

  _buildLights() {
    this.hemi = new THREE.HemisphereLight(0xbcd6ea, 0x16303f, 1.15);
    this.scene.add(this.hemi);

    this.sun = new THREE.DirectionalLight(0xffe9c8, 2.3);
    this.sun.position.copy(SUN_DIR).multiplyScalar(260);
    this.sun.target.position.set(0, 0, 0);
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    const c = this.sun.shadow.camera;
    c.left = -130; c.right = 130; c.top = 130; c.bottom = -130;
    c.near = 40; c.far = 600;
    this.sun.shadow.bias = -0.0012;
    this.sun.shadow.normalBias = 0.55;

    this.fill = new THREE.DirectionalLight(0x91b8d8, 0.42);
    this.fill.position.set(-90, 70, 120);
    this.scene.add(this.fill);

    this._applyShadowSettings();
  }

  _applyShadowSettings() {
    if (!this.renderer) return;
    const on = quality.shadowsOn();
    this.renderer.shadowMap.enabled = on;
    this.renderer.shadowMap.type = settings.get('shadows') >= 2 ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    if (this.sun) {
      this.sun.castShadow = on;
      const size = quality.shadowMapSize();
      if (this.sun.shadow.mapSize.width !== size) {
        this.sun.shadow.mapSize.set(size, size);
        if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; }
      }
    }
  }

  _rebuildOcean() {
    const old = this.ocean;
    const t = old ? old.material.uniforms.uTime.value : 0;
    const arena = old ? old.material.uniforms.uArena.value.clone() : null;
    this.scene.remove(old);
    old.geometry.dispose();
    old.material.dispose();
    this.ocean = makeOcean();
    this.ocean.material.uniforms.uTime.value = t;
    if (arena) this.ocean.material.uniforms.uArena.value.copy(arena);
    this.scene.add(this.ocean);
  }

  /** Size the clear-water pocket to the theatre currently in play. */
  setArena(clearRadius) {
    this.ocean.material.uniforms.uArena.value.set(clearRadius, clearRadius + 135);
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (this.renderer) {
      this.renderer.setPixelRatio(quality.pixelRatio());
      this.renderer.setSize(w, h, false);
    }
  }

  /** Wave height on the CPU, from the same definition the shader uses. */
  waveHeight(x, z, chop = 1) {
    return waveHeightAt(x, z, this.time, chop);
  }

  update(dt) {
    this.time += dt;
    this.ocean.material.uniforms.uTime.value = this.time;
    this.sky.material.uniforms.uTime.value = this.time;
    this.sky.position.copy(this.camera.position);
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    window.removeEventListener('resize', this._onResize);
    this.renderer.dispose();
  }
}
