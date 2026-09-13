/* =========================================================
   The single definition of the sea surface.
   The GLSL and the CPU-side height query are both generated
   from WAVES, so the ocean, the grid overlays and anything
   floating on the water can never drift out of sync.
   ========================================================= */

/**
 * [dirX, dirZ, amplitude, wavelength, speed, sharpen]
 *
 * `sharpen` bends a plain sine toward a trochoid: 1 leaves it alone, higher
 * values narrow the crests and broaden the troughs, which is what real swell
 * does and what stops the surface reading as rolling plastic. The shaping is
 * purely vertical - a true Gerstner wave also drags the surface sideways,
 * which would shear the battle grids painted on top of it.
 */
export const WAVES = [
  [1.00, 0.22, 0.62, 52.0, 0.52, 1.75],
  [-0.55, 1.00, 0.44, 37.0, 0.63, 1.70],
  [0.72, -0.78, 0.28, 23.0, 0.92, 1.50],
  [-0.95, -0.18, 0.18, 14.5, 1.25, 1.35],
  [0.28, 1.00, 0.12, 9.0, 1.70, 1.15],
  [-0.35, -0.90, 0.08, 6.0, 2.15, 1.0],
  [0.90, 0.45, 0.05, 3.8, 2.70, 1.0],
];

/* A slow domain warp breaks the sine sets up so the surface never reads as
   corrugated metal. Its own gradient is small enough to leave out of the
   analytic normal. */
const WARP_AMP = 3.4;
const WARP_FX = 0.031;
const WARP_FZ = 0.036;
const WARP_SPEED = 0.19;

const norm = ([dx, dz, a, l, s, k = 1]) => {
  const m = Math.hypot(dx, dz) || 1;
  return [dx / m, dz / m, a, l, s, k];
};

export const WAVES_N = WAVES.map(norm);

const f = (v) => (Number.isInteger(v) ? v.toFixed(1) : String(v));

const WARP_GLSL = /* glsl */`
  vec2 p = p0 + vec2(
    sin(p0.y * ${f(WARP_FZ)} + t * ${f(WARP_SPEED)}),
    sin(p0.x * ${f(WARP_FX)} - t * ${f(WARP_SPEED * 0.83)})
  ) * ${f(WARP_AMP)};
`;

/** GLSL source defining `void waveField(vec2 p, float t, float chop, out float h, out vec2 dh)`. */
export const WAVE_GLSL = /* glsl */`
void waveField(vec2 p0, float t, float chop, out float h, out vec2 dh) {
${WARP_GLSL}
  h = 0.0; dh = vec2(0.0);
${WAVES_N.map(([dx, dz, a, l, s, k]) => {
  const w = ((Math.PI * 2) / l).toFixed(6);
  return `  {
    float x = (p.x * ${f(dx)} + p.y * ${f(dz)}) * ${w} + t * ${f(s)};
    float a = ${f(a)} * chop;
    float u = 0.5 * (sin(x) + 1.0);
    h  += a * (2.0 * pow(u, ${f(k)}) - 1.0);
    dh += vec2(${f(dx)}, ${f(dz)}) * (${w} * a * ${f(k)} * pow(u, ${f(k)} - 1.0) * cos(x));
  }`;
}).join('\n')}
}
`;

/**
 * Fine capillary ripples. These never touch the geometry - they only perturb
 * the shading normal, which is what breaks the specular up into thousands of
 * glints instead of one smooth plastic sheen.
 */
const RIPPLES = [
  [0.86, 0.51, 0.030, 2.6, 3.10],
  [-0.42, 0.91, 0.020, 1.55, 4.20],
  [0.36, -0.93, 0.013, 0.95, 5.40],
];

export const RIPPLE_GLSL = /* glsl */`
vec2 rippleGrad(vec2 p, float t) {
  vec2 g = vec2(0.0);
${RIPPLES.map(([dx, dz, a, l, s]) => {
  const w = ((Math.PI * 2) / l).toFixed(6);
  return `  g += vec2(${f(dx)}, ${f(dz)}) * (${w} * ${f(a)} * cos((p.x * ${f(dx)} + p.y * ${f(dz)}) * ${w} + t * ${f(s)}));`;
}).join('\n')}
  return g;
}
`;

/** Same surface, evaluated on the CPU. */
export function waveHeightAt(x, z, t, chop = 1) {
  const px = x + Math.sin(z * WARP_FZ + t * WARP_SPEED) * WARP_AMP;
  const pz = z + Math.sin(x * WARP_FX - t * WARP_SPEED * 0.83) * WARP_AMP;
  let h = 0;
  for (const [dx, dz, a, l, s, k] of WAVES_N) {
    const w = (Math.PI * 2) / l;
    const u = 0.5 * (Math.sin((px * dx + pz * dz) * w + t * s) + 1);
    h += a * chop * (2 * Math.pow(u, k) - 1);
  }
  return h;
}

/** Peak-to-trough reach of the swell, used to keep floating art above water. */
export const WAVE_MAX = WAVES_N.reduce((s, w) => s + w[2], 0);
