/* =========================================================
   Procedural warship models. Every hull is generated from its
   class and length - no external meshes.
   Local frame: length along +X (bow at +X), beam along Z,
   waterline at y = 0.
   ========================================================= */

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CELL } from '../core/constants.js';

/* ---------------- shared materials ---------------- */

const MATS = {
  hull:    new THREE.MeshStandardMaterial({ color: 0x59646f, roughness: 0.55, metalness: 0.45 }),
  hullLow: new THREE.MeshStandardMaterial({ color: 0x3a444d, roughness: 0.72, metalness: 0.34 }),
  deck:    new THREE.MeshStandardMaterial({ color: 0x76808a, roughness: 0.86, metalness: 0.16 }),
  deckDark:new THREE.MeshStandardMaterial({ color: 0x4a535c, roughness: 0.9, metalness: 0.12 }),
  steel:   new THREE.MeshStandardMaterial({ color: 0x8a949e, roughness: 0.45, metalness: 0.6 }),
  dark:    new THREE.MeshStandardMaterial({ color: 0x272e34, roughness: 0.7, metalness: 0.35 }),
  glass:   new THREE.MeshStandardMaterial({ color: 0x8fc4dd, roughness: 0.16, metalness: 0.65, emissive: 0x12303d, emissiveIntensity: 0.5 }),
  rust:    new THREE.MeshStandardMaterial({ color: 0x6d4326, roughness: 0.95, metalness: 0.1 }),
};

/* These are reused by every hull, so the scene teardown must not dispose them. */
for (const m of Object.values(MATS)) m.userData.shared = true;

const accentCache = new Map();
function accentMat(hex) {
  if (!accentCache.has(hex)) {
    const m = new THREE.MeshStandardMaterial({
      color: hex, roughness: 0.42, metalness: 0.3,
      emissive: hex, emissiveIntensity: 0.42,
    });
    m.userData.shared = true;
    accentCache.set(hex, m);
  }
  return accentCache.get(hex);
}

/* ---------------- primitives ---------------- */

const boxGeo = new THREE.BoxGeometry(1, 1, 1);
const cylGeo = new THREE.CylinderGeometry(1, 1, 1, 14);
const coneGeo = new THREE.ConeGeometry(1, 1, 14);
const sphGeo = new THREE.SphereGeometry(1, 14, 10);
for (const g of [boxGeo, cylGeo, coneGeo, sphGeo]) g.userData.shared = true;

function box(w, h, d, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(boxGeo, mat);
  m.scale.set(w, h, d);
  m.position.set(x, y, z);
  return m;
}
function cyl(r, h, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(cylGeo, mat);
  m.scale.set(r, h, r);
  m.position.set(x, y, z);
  return m;
}
function cone(r, h, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(coneGeo, mat);
  m.scale.set(r, h, r);
  m.position.set(x, y, z);
  return m;
}
function sphere(r, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(sphGeo, mat);
  m.scale.setScalar(r);
  m.position.set(x, y, z);
  return m;
}

/* ---------------- hull ---------------- */

function buildHull(L, W, freeboard, draft, submarine = false) {
  const shape = new THREE.Shape();
  const halfW = W / 2;
  const bow = L / 2;
  const stern = -L / 2;

  if (submarine) {
    // Cigar plan, rounded at both ends.
    shape.moveTo(stern + L * 0.04, 0);
    shape.bezierCurveTo(stern, halfW * 0.9, stern + L * 0.2, halfW, stern + L * 0.42, halfW);
    shape.lineTo(bow - L * 0.3, halfW);
    shape.bezierCurveTo(bow - L * 0.08, halfW * 0.92, bow, halfW * 0.35, bow, 0);
    shape.bezierCurveTo(bow, -halfW * 0.35, bow - L * 0.08, -halfW * 0.92, bow - L * 0.3, -halfW);
    shape.lineTo(stern + L * 0.42, -halfW);
    shape.bezierCurveTo(stern + L * 0.2, -halfW, stern, -halfW * 0.9, stern + L * 0.04, 0);
  } else {
    shape.moveTo(bow, 0);
    shape.bezierCurveTo(bow - L * 0.05, halfW * 0.55, bow - L * 0.16, halfW * 0.95, bow - L * 0.26, halfW);
    shape.lineTo(stern + L * 0.10, halfW);
    shape.bezierCurveTo(stern + L * 0.02, halfW, stern, halfW * 0.88, stern, halfW * 0.62);
    shape.lineTo(stern, -halfW * 0.62);
    shape.bezierCurveTo(stern, -halfW * 0.88, stern + L * 0.02, -halfW, stern + L * 0.10, -halfW);
    shape.lineTo(bow - L * 0.26, -halfW);
    shape.bezierCurveTo(bow - L * 0.16, -halfW * 0.95, bow - L * 0.05, -halfW * 0.55, bow, 0);
  }

  const depth = freeboard + draft;
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelThickness: Math.min(0.45, depth * 0.2),
    bevelSize: Math.min(0.34, W * 0.14),
    bevelSegments: 2,
    curveSegments: 8,
  });
  geo.rotateX(-Math.PI / 2);     // length -> X, beam -> Z, height -> Y
  geo.translate(0, -draft, 0);   // waterline at y = 0
  geo.computeVertexNormals();
  return geo;
}

/* ---------------- fittings ---------------- */

function turret(scale, accent, facing = 1) {
  const g = new THREE.Group();
  g.add(cyl(0.44 * scale, 0.16 * scale, MATS.steel, 0, 0.08 * scale, 0));
  const house = box(0.86 * scale, 0.42 * scale, 0.72 * scale, MATS.hull, 0, 0.36 * scale, 0);
  g.add(house);
  g.add(box(0.62 * scale, 0.07 * scale, 0.58 * scale, accent, 0, 0.60 * scale, 0));
  for (const dz of [-0.17, 0.17]) {
    const b = box(0.92 * scale, 0.1 * scale, 0.1 * scale, MATS.dark, facing * 0.68 * scale, 0.36 * scale, dz * scale);
    g.add(b);
  }
  return g;
}

function funnel(scale, accent, raked = true) {
  const g = new THREE.Group();
  const body = cyl(0.26 * scale, 1.0 * scale, MATS.hull, 0, 0.5 * scale, 0);
  if (raked) body.rotation.z = -0.16;
  g.add(body);
  const band = cyl(0.29 * scale, 0.16 * scale, accent, 0, 0.78 * scale, 0);
  if (raked) { band.rotation.z = -0.16; band.position.x = 0.125 * scale; }
  g.add(band);
  const cap = cyl(0.28 * scale, 0.08 * scale, MATS.dark, 0, 1.0 * scale, 0);
  if (raked) { cap.rotation.z = -0.16; cap.position.x = 0.16 * scale; }
  g.add(cap);
  return g;
}

function mast(h, mat) {
  const g = new THREE.Group();
  g.add(cyl(0.05, h, mat, 0, h / 2, 0));
  g.add(box(0.06, 0.06, h * 0.34, mat, 0, h * 0.72, 0));
  g.add(box(0.06, 0.06, h * 0.22, mat, 0, h * 0.88, 0));
  return g;
}

function bridgeTower(scale, accent, tiers = 3) {
  const g = new THREE.Group();
  let w = 1.15 * scale, d = 0.86 * scale, y = 0;
  for (let i = 0; i < tiers; i++) {
    const h = (0.46 - i * 0.05) * scale;
    g.add(box(w, h, d, i === 0 ? MATS.hull : MATS.steel, 0, y + h / 2, 0));
    if (i === tiers - 1) {
      g.add(box(w * 0.82, h * 0.42, d * 1.02, MATS.glass, 0, y + h * 0.62, 0));
    }
    y += h;
    w *= 0.78; d *= 0.8;
  }
  g.add(box(w * 1.4, 0.06 * scale, d * 1.4, accent, 0, y + 0.03 * scale, 0));
  return g;
}

function railing(L, W, y, mat) {
  const g = new THREE.Group();
  const n = Math.max(4, Math.round(L / 0.9));
  for (let i = 0; i <= n; i++) {
    const x = -L / 2 + (i / n) * L;
    g.add(box(0.045, 0.3, 0.045, mat, x, y + 0.15, W / 2));
    g.add(box(0.045, 0.3, 0.045, mat, x, y + 0.15, -W / 2));
  }
  g.add(box(L, 0.035, 0.035, mat, 0, y + 0.3, W / 2));
  g.add(box(L, 0.035, 0.035, mat, 0, y + 0.3, -W / 2));
  return g;
}

/* ---------------- class builders ---------------- */

function buildCarrier(L, W, accent) {
  const g = new THREE.Group();
  const freeboard = 1.35, draft = 1.0;
  const hull = new THREE.Mesh(buildHull(L, W, freeboard, draft), MATS.hull);
  g.add(hull);

  // Flight deck overhangs the hull on both sides.
  const dW = W * 1.5, dL = L * 0.985;
  g.add(box(dL, 0.2, dW, MATS.deckDark, 0, freeboard + 0.1, 0));
  // deck centreline stripe + landing threshold bars
  g.add(box(dL * 0.66, 0.03, 0.22, MATS.deck, -dL * 0.05, freeboard + 0.215, 0));
  for (let i = 0; i < 5; i++) {
    g.add(box(0.5, 0.03, dW * 0.09, MATS.deck, -dL * 0.40 + i * 0.0, freeboard + 0.215, -dW * 0.30 + i * (dW * 0.15)));
  }
  // deck edge trim in fleet colours
  g.add(box(dL, 0.07, 0.16, accent, 0, freeboard + 0.17, dW / 2 - 0.08));
  g.add(box(dL, 0.07, 0.16, accent, 0, freeboard + 0.17, -dW / 2 + 0.08));

  // Island, starboard side.
  const isl = new THREE.Group();
  isl.add(box(L * 0.16, 0.7, W * 0.34, MATS.hull, 0, 0.35, 0));
  isl.add(box(L * 0.12, 0.34, W * 0.28, MATS.steel, 0, 0.87, 0));
  isl.add(box(L * 0.1, 0.16, W * 0.26, MATS.glass, 0, 0.9, 0));
  isl.add(box(L * 0.14, 0.05, W * 0.3, accent, 0, 1.06, 0));
  const f = funnel(0.62, accent, false);
  f.position.set(-L * 0.05, 1.04, 0);
  isl.add(f);
  const m = mast(1.5, MATS.dark);
  m.position.set(L * 0.04, 1.04, 0);
  isl.add(m);
  isl.position.set(L * 0.06, freeboard + 0.2, dW * 0.30);
  g.add(isl);

  // Aircraft parked aft.
  for (let i = 0; i < 3; i++) {
    const p = new THREE.Group();
    p.add(box(0.62, 0.1, 0.16, MATS.steel, 0, 0, 0));
    p.add(box(0.16, 0.08, 0.72, MATS.steel, 0.02, 0.02, 0));
    p.add(box(0.12, 0.18, 0.05, MATS.steel, -0.26, 0.1, 0));
    p.scale.setScalar(0.85);
    p.position.set(-L * 0.34 - i * 0.1, freeboard + 0.26, -dW * 0.22 + i * (dW * 0.22));
    p.rotation.y = -0.3 + i * 0.2;
    g.add(p);
  }
  return g;
}

function buildBattleship(L, W, accent) {
  const g = new THREE.Group();
  const freeboard = 1.5, draft = 1.15;
  g.add(new THREE.Mesh(buildHull(L, W, freeboard, draft), MATS.hull));
  g.add(box(L * 0.94, 0.14, W * 0.86, MATS.deck, 0, freeboard + 0.06, 0));
  // sheer stripe
  g.add(box(L * 0.95, 0.13, 0.1, accent, 0, freeboard - 0.16, W / 2 - 0.05));
  g.add(box(L * 0.95, 0.13, 0.1, accent, 0, freeboard - 0.16, -W / 2 + 0.05));

  const deckY = freeboard + 0.13;
  const sc = W * 0.72;

  // Forward superfiring pair.
  const t1 = turret(sc, accent, 1); t1.position.set(L * 0.30, deckY, 0); g.add(t1);
  const bar = box(L * 0.14, 0.22, W * 0.5, MATS.hull, L * 0.16, deckY + 0.11, 0); g.add(bar);
  const t2 = turret(sc * 0.95, accent, 1); t2.position.set(L * 0.16, deckY + 0.22, 0); g.add(t2);
  // Aft turret.
  const t3 = turret(sc * 0.95, accent, -1); t3.position.set(-L * 0.32, deckY, 0); g.add(t3);

  const tower = bridgeTower(W * 0.82, accent, 4);
  tower.position.set(-L * 0.01, deckY, 0);
  g.add(tower);
  const mm = mast(W * 1.5, MATS.dark);
  mm.position.set(-L * 0.07, deckY + W * 0.9, 0);
  g.add(mm);

  const f1 = funnel(W * 0.8, accent); f1.position.set(-L * 0.14, deckY, 0); g.add(f1);
  const f2 = funnel(W * 0.7, accent); f2.position.set(-L * 0.23, deckY, 0); g.add(f2);

  // Secondary mounts along the beam.
  for (const sx of [0.05, -0.06]) {
    for (const sz of [1, -1]) {
      g.add(cyl(0.13, 0.18, MATS.steel, L * sx, deckY + 0.09, sz * W * 0.34));
      g.add(box(0.36, 0.06, 0.06, MATS.dark, L * sx + 0.2, deckY + 0.16, sz * W * 0.34));
    }
  }
  g.add(railing(L * 0.5, W * 0.78, deckY, MATS.dark));
  return g;
}

function buildCruiser(L, W, accent) {
  const g = new THREE.Group();
  const freeboard = 1.35, draft = 1.0;
  g.add(new THREE.Mesh(buildHull(L, W, freeboard, draft), MATS.hull));
  g.add(box(L * 0.94, 0.13, W * 0.84, MATS.deck, 0, freeboard + 0.055, 0));
  g.add(box(L * 0.95, 0.11, 0.09, accent, 0, freeboard - 0.14, W / 2 - 0.05));
  g.add(box(L * 0.95, 0.11, 0.09, accent, 0, freeboard - 0.14, -W / 2 + 0.05));

  const deckY = freeboard + 0.12;
  const sc = W * 0.66;
  const t1 = turret(sc, accent, 1); t1.position.set(L * 0.30, deckY, 0); g.add(t1);
  const t2 = turret(sc * 0.9, accent, -1); t2.position.set(-L * 0.31, deckY, 0); g.add(t2);

  const tower = bridgeTower(W * 0.76, accent, 3);
  tower.position.set(L * 0.07, deckY, 0);
  g.add(tower);
  const mm = mast(W * 1.9, MATS.dark);
  mm.position.set(L * 0.0, deckY + W * 0.62, 0);
  g.add(mm);

  const f1 = funnel(W * 0.82, accent); f1.position.set(-L * 0.08, deckY, 0); g.add(f1);
  // Torpedo tubes amidships.
  for (const sz of [1, -1]) {
    g.add(box(W * 0.5, 0.16, 0.16, MATS.dark, -L * 0.18, deckY + 0.12, sz * W * 0.2));
  }
  g.add(cyl(0.22, 0.12, MATS.steel, -L * 0.18, deckY + 0.06, 0));
  g.add(railing(L * 0.46, W * 0.76, deckY, MATS.dark));
  return g;
}

function buildSubmarine(L, W, accent) {
  const g = new THREE.Group();
  const freeboard = 0.62, draft = 1.05;
  const hull = new THREE.Mesh(buildHull(L, W * 0.86, freeboard, draft, true), MATS.hullLow);
  g.add(hull);
  // Rounded casing along the spine.
  const casing = cyl(W * 0.3, L * 0.82, MATS.hullLow, -L * 0.02, freeboard * 0.45, 0);
  casing.rotation.z = Math.PI / 2;
  g.add(casing);
  const nose = cone(W * 0.3, L * 0.2, MATS.hullLow, L * 0.48, freeboard * 0.45, 0);
  nose.rotation.z = -Math.PI / 2;
  g.add(nose);

  // Conning tower.
  const ct = new THREE.Group();
  ct.add(box(L * 0.2, 0.56, W * 0.34, MATS.hull, 0, 0.28, 0));
  ct.add(box(L * 0.21, 0.07, W * 0.36, accent, 0, 0.58, 0));
  ct.add(box(L * 0.1, 0.14, W * 0.3, MATS.glass, L * 0.02, 0.42, 0));
  // periscopes
  ct.add(cyl(0.045, 0.75, MATS.dark, -L * 0.03, 0.9, 0.07));
  ct.add(cyl(0.04, 0.58, MATS.dark, -L * 0.055, 0.82, -0.08));
  // dive planes
  ct.add(box(0.14, 0.05, W * 0.8, MATS.steel, 0, 0.36, 0));
  ct.position.set(L * 0.06, freeboard * 0.45 + W * 0.22, 0);
  g.add(ct);

  // Deck gun forward.
  g.add(cyl(0.17, 0.12, MATS.steel, L * 0.26, freeboard * 0.45 + W * 0.26, 0));
  g.add(box(0.52, 0.07, 0.07, MATS.dark, L * 0.4, freeboard * 0.45 + W * 0.3, 0));

  // Stern planes + screw.
  g.add(box(0.5, 0.06, W * 0.95, MATS.steel, -L * 0.44, -0.18, 0));
  g.add(box(0.5, W * 0.7, 0.06, MATS.steel, -L * 0.44, -0.1, 0));
  return g;
}

function buildDestroyer(L, W, accent) {
  const g = new THREE.Group();
  const freeboard = 1.2, draft = 0.85;
  g.add(new THREE.Mesh(buildHull(L, W, freeboard, draft), MATS.hull));
  g.add(box(L * 0.94, 0.12, W * 0.82, MATS.deck, 0, freeboard + 0.05, 0));
  g.add(box(L * 0.95, 0.1, 0.08, accent, 0, freeboard - 0.13, W / 2 - 0.05));
  g.add(box(L * 0.95, 0.1, 0.08, accent, 0, freeboard - 0.13, -W / 2 + 0.05));

  const deckY = freeboard + 0.11;
  const t1 = turret(W * 0.6, accent, 1); t1.position.set(L * 0.28, deckY, 0); g.add(t1);

  const tower = bridgeTower(W * 0.72, accent, 3);
  tower.position.set(L * 0.02, deckY, 0);
  g.add(tower);
  const mm = mast(W * 1.8, MATS.dark);
  mm.position.set(-L * 0.04, deckY + W * 0.56, 0);
  g.add(mm);

  const f1 = funnel(W * 0.78, accent); f1.position.set(-L * 0.16, deckY, 0); g.add(f1);
  // Depth charge racks at the stern.
  for (const sz of [1, -1]) {
    for (let i = 0; i < 3; i++) {
      g.add(cyl(0.09, 0.2, MATS.rust, -L * 0.34 - i * 0.22, deckY + 0.1, sz * W * 0.22));
    }
  }
  g.add(box(W * 0.44, 0.14, 0.14, MATS.dark, -L * 0.2, deckY + 0.11, 0));
  return g;
}

const BUILDERS = {
  carrier: buildCarrier,
  battleship: buildBattleship,
  cruiser: buildCruiser,
  submarine: buildSubmarine,
  destroyer: buildDestroyer,
};

/**
 * Collapse a freshly built hull into one mesh per material.
 *
 * The models are assembled from dozens of small primitives - a battleship
 * alone is around fifty meshes once its railings are counted - and at five
 * hulls a side that is several hundred draw calls before a shot is fired.
 * Baking each material's parts into a single buffer cuts that to a handful.
 */
function flattenByMaterial(group) {
  group.updateMatrixWorld(true);
  const buckets = new Map();
  const originals = [];

  group.traverse((o) => {
    if (!o.isMesh || o.isInstancedMesh || !o.geometry) return;
    originals.push(o);
    // Hulls come from ExtrudeGeometry (non-indexed) while the fittings are
    // indexed primitives; mergeGeometries refuses a mixed set, so drop every
    // index up front.
    const src = o.geometry;
    const geo = src.index ? src.toNonIndexed() : src.clone();
    geo.applyMatrix4(o.matrixWorld);
    // Merging needs identical attribute sets; drop anything exotic.
    for (const name of Object.keys(geo.attributes)) {
      if (!['position', 'normal', 'uv'].includes(name)) geo.deleteAttribute(name);
    }
    if (!geo.attributes.uv) {
      const n = geo.attributes.position.count;
      geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
    }
    geo.clearGroups();
    if (!buckets.has(o.material)) buckets.set(o.material, []);
    buckets.get(o.material).push(geo);
  });

  for (const o of originals) o.removeFromParent();

  const out = new THREE.Group();
  for (const [mat, geos] of buckets) {
    const merged = geos.length === 1 ? geos[0] : mergeGeometries(geos, false);
    if (!merged) { for (const g of geos) out.add(new THREE.Mesh(g, mat)); continue; }
    if (geos.length > 1) for (const g of geos) g.dispose();
    const mesh = new THREE.Mesh(merged, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    out.add(mesh);
  }
  // Keep any non-mesh children (there are none today, but be safe).
  for (const child of [...group.children]) out.add(child);
  return out;
}

/* ---------------- public API ---------------- */

/**
 * Build a warship.
 * @param {string} classId one of SHIP_CLASSES ids
 * @param {number} size    hull length in grid cells
 * @param {number} hex     fleet accent colour
 */
export function buildShip(classId, size, hex) {
  const accent = accentMat(hex);
  const L = size * CELL * 0.9;
  const W = CELL * (classId === 'carrier' ? 0.52 : classId === 'submarine' ? 0.5 : 0.56);
  const build = BUILDERS[classId] || buildDestroyer;
  const raw = build(L, W, accent);

  // Ensign at the stern.
  raw.add(cyl(0.04, 1.0, MATS.dark, -L * 0.47, 1.1, 0));
  raw.add(box(0.03, 0.34, 0.52, accent, -L * 0.47, 1.45, 0.27));

  const g = flattenByMaterial(raw);
  g.traverse((o) => {
    if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; }
  });

  g.userData = {
    classId, size, length: L, beam: W,
    /** Local X of the centre of hull cell i (0 = stern-most cell). */
    cellX: (i) => -L / 2 + (i + 0.5) * (L / size),
    accentHex: hex,
  };
  return g;
}

/** A low-detail silhouette used for the placement ghost. */
export function buildGhost(size, hex) {
  const L = size * CELL * 0.9;
  const W = CELL * 0.56;
  const mat = new THREE.MeshBasicMaterial({
    color: hex, transparent: true, opacity: 0.34, depthWrite: false,
  });
  const geo = buildHull(L, W, 1.3, 0.5);
  const m = new THREE.Mesh(geo, mat);
  const g = new THREE.Group();
  g.add(m);

  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(geo, 32),
    new THREE.LineBasicMaterial({ color: hex, transparent: true, opacity: 0.95 }),
  );
  g.add(edges);
  g.userData.setValid = (ok) => {
    const c = ok ? hex : 0xff3b30;
    mat.color.setHex(c);
    edges.material.color.setHex(c);
  };
  return g;
}

export const SHIP_MATERIALS = MATS;
