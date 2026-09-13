/* Pure grid logic: placement validation, fire resolution, fleet bookkeeping.
   No rendering, no networking - this is the rulebook. */

import { SHIP_BY_ID, SHIP_CLASSES } from './constants.js';

export const TILE = { EMPTY: 0, MISS: 1, HIT: 2 };

/** Expand a fleet config ({carrier:1, destroyer:2}) into concrete hull entries. */
export function buildRoster(fleetCounts) {
  const roster = [];
  for (const cls of SHIP_CLASSES) {
    const n = fleetCounts[cls.id] | 0;
    for (let i = 0; i < n; i++) {
      roster.push({
        uid: `${cls.id}_${i}`,
        classId: cls.id,
        name: n > 1 ? `${cls.name} ${romanize(i + 1)}` : cls.name,
        size: cls.size,
      });
    }
  }
  return roster;
}

function romanize(n) {
  return ['I', 'II', 'III', 'IV', 'V'][n - 1] || String(n);
}

export function totalTiles(fleetCounts) {
  let t = 0;
  for (const cls of SHIP_CLASSES) t += (fleetCounts[cls.id] | 0) * cls.size;
  return t;
}

export function totalHulls(fleetCounts) {
  let t = 0;
  for (const cls of SHIP_CLASSES) t += fleetCounts[cls.id] | 0;
  return t;
}

/** Cells a ship would occupy. horizontal = along +X. */
export function shipCells(gx, gy, size, horizontal) {
  const out = [];
  for (let i = 0; i < size; i++) out.push(horizontal ? [gx + i, gy] : [gx, gy + i]);
  return out;
}

export class Board {
  constructor(gridSize, fleetCounts, { allowTouching = true } = {}) {
    this.size = gridSize;
    this.allowTouching = allowTouching;
    this.roster = buildRoster(fleetCounts);
    /** uid -> { uid, classId, name, size, gx, gy, horizontal, cells, hits:Set, sunk } */
    this.ships = new Map();
    /** occupancy grid: null or ship uid */
    this.occ = Array.from({ length: gridSize }, () => new Array(gridSize).fill(null));
    /** shot grid: TILE.* */
    this.shots = Array.from({ length: gridSize }, () => new Array(gridSize).fill(TILE.EMPTY));
  }

  get placedCount() { return this.ships.size; }
  get totalCount() { return this.roster.length; }
  get complete() { return this.ships.size === this.roster.length; }

  inBounds(gx, gy) {
    return gx >= 0 && gy >= 0 && gx < this.size && gy < this.size;
  }

  /** Can `uid` (size known from roster) sit at gx,gy? Ignores its own current cells. */
  canPlace(uid, gx, gy, horizontal) {
    const entry = this.roster.find((r) => r.uid === uid);
    if (!entry) return false;
    const cells = shipCells(gx, gy, entry.size, horizontal);
    for (const [cx, cy] of cells) {
      if (!this.inBounds(cx, cy)) return false;
      const o = this.occ[cy][cx];
      if (o !== null && o !== uid) return false;
    }
    if (!this.allowTouching) {
      for (const [cx, cy] of cells) {
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = cx + dx, ny = cy + dy;
            if (!this.inBounds(nx, ny)) continue;
            const o = this.occ[ny][nx];
            if (o !== null && o !== uid) return false;
          }
        }
      }
    }
    return true;
  }

  place(uid, gx, gy, horizontal) {
    if (!this.canPlace(uid, gx, gy, horizontal)) return false;
    this.remove(uid);
    const entry = this.roster.find((r) => r.uid === uid);
    const cells = shipCells(gx, gy, entry.size, horizontal);
    const ship = {
      uid, classId: entry.classId, name: entry.name, size: entry.size,
      gx, gy, horizontal, cells, hits: new Set(), sunk: false,
    };
    this.ships.set(uid, ship);
    for (const [cx, cy] of cells) this.occ[cy][cx] = uid;
    return true;
  }

  remove(uid) {
    const ship = this.ships.get(uid);
    if (!ship) return;
    for (const [cx, cy] of ship.cells) if (this.occ[cy][cx] === uid) this.occ[cy][cx] = null;
    this.ships.delete(uid);
  }

  clear() {
    for (const uid of [...this.ships.keys()]) this.remove(uid);
  }

  shipAt(gx, gy) {
    if (!this.inBounds(gx, gy)) return null;
    const uid = this.occ[gy][gx];
    return uid ? this.ships.get(uid) : null;
  }

  /** Randomly place every hull. Returns false if it could not find a layout. */
  autoPlace(rng = Math.random) {
    this.clear();
    // Longest first - much higher success rate on dense grids.
    const order = [...this.roster].sort((a, b) => b.size - a.size);
    const attempt = () => {
      for (const entry of order) {
        let ok = false;
        for (let tries = 0; tries < 600; tries++) {
          const horizontal = rng() < 0.5;
          const maxX = horizontal ? this.size - entry.size : this.size - 1;
          const maxY = horizontal ? this.size - 1 : this.size - entry.size;
          const gx = Math.floor(rng() * (maxX + 1));
          const gy = Math.floor(rng() * (maxY + 1));
          if (this.place(entry.uid, gx, gy, horizontal)) { ok = true; break; }
        }
        if (!ok) return false;
      }
      return true;
    };
    for (let restart = 0; restart < 60; restart++) {
      if (attempt()) return true;
      this.clear();
    }
    return false;
  }

  /** Has this tile already been fired at? */
  alreadyFired(gx, gy) {
    return this.inBounds(gx, gy) && this.shots[gy][gx] !== TILE.EMPTY;
  }

  /**
   * Resolve an incoming shot against this board (this board is the DEFENDER).
   * Returns { valid, gx, gy, hit, sunk, ship, defeated }.
   */
  receiveFire(gx, gy) {
    if (!this.inBounds(gx, gy) || this.alreadyFired(gx, gy)) {
      return { valid: false, gx, gy, hit: false, sunk: false, ship: null, defeated: false };
    }
    const ship = this.shipAt(gx, gy);
    if (!ship) {
      this.shots[gy][gx] = TILE.MISS;
      return { valid: true, gx, gy, hit: false, sunk: false, ship: null, defeated: false };
    }
    this.shots[gy][gx] = TILE.HIT;
    ship.hits.add(`${gx},${gy}`);
    const sunk = ship.hits.size >= ship.size;
    if (sunk) ship.sunk = true;
    return {
      valid: true, gx, gy, hit: true, sunk,
      ship: sunk ? serializeShip(ship) : { uid: ship.uid, classId: ship.classId, name: ship.name, size: ship.size },
      defeated: this.allSunk(),
    };
  }

  allSunk() {
    if (this.ships.size === 0) return false;
    for (const s of this.ships.values()) if (!s.sunk) return false;
    return true;
  }

  aliveShips() {
    return [...this.ships.values()].filter((s) => !s.sunk);
  }

  /** Compact snapshot used for end-of-match reveal / verification. */
  serialize() {
    return [...this.ships.values()].map(serializeShip);
  }

  /** Fleet status used by the HUD pip rows. */
  status() {
    return this.roster.map((r) => {
      const s = this.ships.get(r.uid);
      return {
        uid: r.uid, name: r.name, size: r.size,
        hits: s ? s.hits.size : 0,
        sunk: s ? s.sunk : false,
      };
    });
  }
}

export function serializeShip(s) {
  return { uid: s.uid, classId: s.classId, name: s.name, size: s.size, gx: s.gx, gy: s.gy, horizontal: s.horizontal };
}

/**
 * The attacker's view of the opponent grid. Tracks what we know, nothing more.
 */
export class TrackingGrid {
  constructor(gridSize, roster) {
    this.size = gridSize;
    this.shots = Array.from({ length: gridSize }, () => new Array(gridSize).fill(TILE.EMPTY));
    /** hulls we have sunk, revealed with their true position */
    this.sunkShips = [];
    /** roster we are hunting (names + sizes only) */
    this.roster = roster.map((r) => ({ ...r, sunk: false, hits: 0 }));
  }

  inBounds(gx, gy) {
    return gx >= 0 && gy >= 0 && gx < this.size && gy < this.size;
  }

  canFire(gx, gy) {
    return this.inBounds(gx, gy) && this.shots[gy][gx] === TILE.EMPTY;
  }

  openCells() {
    const out = [];
    for (let y = 0; y < this.size; y++)
      for (let x = 0; x < this.size; x++)
        if (this.shots[y][x] === TILE.EMPTY) out.push([x, y]);
    return out;
  }

  apply(result) {
    if (!result.valid) return;
    this.shots[result.gy][result.gx] = result.hit ? TILE.HIT : TILE.MISS;
    if (result.hit && result.ship) {
      const entry = this.roster.find((r) => r.uid === result.ship.uid);
      if (entry) {
        entry.hits = Math.min(entry.size, entry.hits + 1);
        if (result.sunk) { entry.sunk = true; entry.hits = entry.size; }
      }
      if (result.sunk && result.ship.gx !== undefined) this.sunkShips.push(result.ship);
    }
  }

  status() {
    return this.roster.map((r) => ({ uid: r.uid, name: r.name, size: r.size, hits: r.hits, sunk: r.sunk }));
  }

  remainingSizes() {
    return this.roster.filter((r) => !r.sunk).map((r) => r.size);
  }

  allSunk() {
    return this.roster.length > 0 && this.roster.every((r) => r.sunk);
  }
}
