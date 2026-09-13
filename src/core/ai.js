/* =========================================================
   Admiralty A.I.
     easy   - scattershot, loosely follows up on a strike
     medium - parity sweep + orientation-aware hunting
     hard   - full probability density plot over remaining hulls
   ========================================================= */

import { TILE, shipCells } from './board.js';

const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];

export class AIPlayer {
  constructor(difficulty = 'medium') {
    this.difficulty = difficulty;
    this.targetQueue = [];   // medium: candidate follow-up cells
    this.activeHits = [];    // hits belonging to a hull we have not sunk yet
  }

  reset() {
    this.targetQueue = [];
    this.activeHits = [];
  }

  /** Called after every shot the AI takes so it can learn from the result. */
  observe(result, tracking) {
    if (!result.valid) return;
    if (result.hit) {
      this.activeHits.push([result.gx, result.gy]);
      if (result.sunk) {
        // Drop the cells of the hull that just went down; anything left over
        // belongs to a second hull we have already wounded.
        const sunkSet = cellsOfShip(result.ship);
        this.activeHits = this.activeHits.filter(([x, y]) => !sunkSet.has(key(x, y)));
        this.targetQueue = [];
        if (this.activeHits.length) this.rebuildQueue(tracking);
      } else {
        this.pushNeighbours(result.gx, result.gy, tracking);
      }
    }
  }

  pushNeighbours(gx, gy, tracking) {
    for (const [dx, dy] of dirs) {
      const nx = gx + dx, ny = gy + dy;
      if (tracking.canFire(nx, ny) && !this.targetQueue.some(([a, b]) => a === nx && b === ny)) {
        this.targetQueue.push([nx, ny]);
      }
    }
  }

  rebuildQueue(tracking) {
    this.targetQueue = [];
    for (const [x, y] of this.activeHits) this.pushNeighbours(x, y, tracking);
  }

  /** Pick a cell to fire on. Returns [gx, gy] or null if the grid is exhausted. */
  chooseShot(tracking) {
    const open = tracking.openCells();
    if (!open.length) return null;

    switch (this.difficulty) {
      case 'easy':   return this.easyShot(tracking, open);
      case 'hard':   return this.hardShot(tracking, open);
      case 'medium':
      default:       return this.mediumShot(tracking, open);
    }
  }

  /* ---------------- easy ---------------- */
  easyShot(tracking, open) {
    // Follows up on a wounded hull only about half the time, and never
    // works out the hull's orientation.
    this.targetQueue = this.targetQueue.filter(([x, y]) => tracking.canFire(x, y));
    if (this.targetQueue.length && Math.random() < 0.55) {
      const i = Math.floor(Math.random() * this.targetQueue.length);
      return this.targetQueue.splice(i, 1)[0];
    }
    return open[Math.floor(Math.random() * open.length)];
  }

  /* ---------------- medium ---------------- */
  mediumShot(tracking, open) {
    this.targetQueue = this.targetQueue.filter(([x, y]) => tracking.canFire(x, y));

    // Two or more hits in a row: push along that line first.
    if (this.activeHits.length >= 2) {
      const line = this.lineExtensions(tracking);
      if (line.length) return line[Math.floor(Math.random() * line.length)];
    }
    if (this.targetQueue.length) {
      const i = Math.floor(Math.random() * this.targetQueue.length);
      return this.targetQueue.splice(i, 1)[0];
    }

    // Hunt on a parity lattice sized to the smallest hull still afloat.
    const sizes = tracking.remainingSizes();
    const step = Math.max(2, Math.min(...(sizes.length ? sizes : [2])));
    const lattice = open.filter(([x, y]) => (x + y) % step === 0);
    const pool = lattice.length ? lattice : open;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  /** Cells that continue an established run of hits. */
  lineExtensions(tracking) {
    const hits = this.activeHits;
    const sameRow = hits.every(([, y]) => y === hits[0][1]);
    const sameCol = hits.every(([x]) => x === hits[0][0]);
    const out = [];
    if (sameRow && hits.length >= 2) {
      const y = hits[0][1];
      const xs = hits.map(([x]) => x);
      const lo = Math.min(...xs) - 1, hi = Math.max(...xs) + 1;
      if (tracking.canFire(lo, y)) out.push([lo, y]);
      if (tracking.canFire(hi, y)) out.push([hi, y]);
    } else if (sameCol && hits.length >= 2) {
      const x = hits[0][0];
      const ys = hits.map(([, y]) => y);
      const lo = Math.min(...ys) - 1, hi = Math.max(...ys) + 1;
      if (tracking.canFire(x, lo)) out.push([x, lo]);
      if (tracking.canFire(x, hi)) out.push([x, hi]);
    }
    return out;
  }

  /* ---------------- hard ---------------- */
  hardShot(tracking, open) {
    const n = tracking.size;
    const map = this.densityMap(tracking);

    let best = -1;
    let pool = [];
    for (const [x, y] of open) {
      const v = map[y][x];
      if (v > best) { best = v; pool = [[x, y]]; }
      else if (v === best) pool.push([x, y]);
    }
    if (!pool.length || best <= 0) return open[Math.floor(Math.random() * open.length)];
    return pool[Math.floor(Math.random() * pool.length)];
  }

  /**
   * For every hull still afloat, count how many legal placements cover each
   * open cell. Placements that overlap a known unresolved hit are weighted
   * heavily, which makes targeting fall out of the same calculation.
   */
  densityMap(tracking) {
    const n = tracking.size;
    const map = Array.from({ length: n }, () => new Array(n).fill(0));

    // Cells already accounted for by hulls we have sunk are dead ground.
    const dead = new Set();
    for (const s of tracking.sunkShips) for (const k of cellsOfShip(s)) dead.add(k);

    const liveHits = [];
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        if (tracking.shots[y][x] === TILE.HIT && !dead.has(key(x, y))) liveHits.push([x, y]);
      }
    }
    const liveSet = new Set(liveHits.map(([x, y]) => key(x, y)));
    const hunting = liveHits.length > 0;

    for (const size of tracking.remainingSizes()) {
      for (let h = 0; h < 2; h++) {
        const horizontal = h === 0;
        const maxX = horizontal ? n - size : n - 1;
        const maxY = horizontal ? n - 1 : n - size;
        for (let gy = 0; gy <= maxY; gy++) {
          for (let gx = 0; gx <= maxX; gx++) {
            const cells = shipCells(gx, gy, size, horizontal);
            let overlap = 0;
            let legal = true;
            for (const [cx, cy] of cells) {
              const k = key(cx, cy);
              if (dead.has(k)) { legal = false; break; }
              const st = tracking.shots[cy][cx];
              if (st === TILE.MISS) { legal = false; break; }
              if (st === TILE.HIT) {
                if (!liveSet.has(k)) { legal = false; break; }
                overlap++;
              }
            }
            if (!legal) continue;
            if (hunting && overlap === 0) continue;
            const weight = hunting ? Math.pow(14, overlap) : 1;
            for (const [cx, cy] of cells) {
              if (tracking.shots[cy][cx] === TILE.EMPTY) map[cy][cx] += weight;
            }
          }
        }
      }
    }
    return map;
  }
}

function key(x, y) { return `${x},${y}`; }

function cellsOfShip(s) {
  const out = new Set();
  if (!s || s.gx === undefined) return out;
  for (const [x, y] of shipCells(s.gx, s.gy, s.size, s.horizontal)) out.add(key(x, y));
  return out;
}

/** How long the AI "thinks" before firing, in ms. */
export function aiThinkDelay(difficulty) {
  const base = { easy: 900, medium: 750, hard: 620 }[difficulty] ?? 750;
  return base + Math.random() * 550;
}

/** Flavour text for the log when the AI takes a shot. */
export function aiName(difficulty) {
  return { easy: 'ENSIGN', medium: 'COMMANDER', hard: 'ADMIRAL' }[difficulty] || 'COMMANDER';
}
