/* Shared constants: world scale, fleet definitions, palettes. */

export const PROTOCOL_VERSION = 3;

/* ---- world scale (three.js units) ---- */
export const CELL = 4;            // one grid tile is 4x4 units
export const STRAIT = 30;         // open water between the two grids
export const SEA_LEVEL = 0;

/** Distance from world origin to the centre of each grid. */
export function boardCenterZ(gridSize) {
  return (gridSize * CELL) / 2 + STRAIT / 2;
}

/** World position of the centre of a tile. side: 'own' (+Z) or 'foe' (-Z). */
export function cellToWorld(side, gx, gy, gridSize) {
  const half = (gridSize - 1) / 2;
  const cz = boardCenterZ(gridSize) * (side === 'own' ? 1 : -1);
  return {
    x: (gx - half) * CELL,
    z: cz + (gy - half) * CELL * (side === 'own' ? 1 : -1),
  };
}

/** Inverse of cellToWorld - returns fractional grid coords (may be off-board). */
export function worldToCell(side, wx, wz, gridSize) {
  const half = (gridSize - 1) / 2;
  const cz = boardCenterZ(gridSize) * (side === 'own' ? 1 : -1);
  return {
    gx: Math.round(wx / CELL + half),
    gy: Math.round(((wz - cz) / (CELL * (side === 'own' ? 1 : -1))) + half),
  };
}

/* ---- fleet ---- */
export const SHIP_CLASSES = [
  { id: 'carrier',    name: 'CARRIER',    size: 5, max: 2, def: 1 },
  { id: 'battleship', name: 'BATTLESHIP', size: 4, max: 3, def: 1 },
  { id: 'cruiser',    name: 'CRUISER',    size: 3, max: 3, def: 1 },
  { id: 'submarine',  name: 'SUBMARINE',  size: 3, max: 3, def: 1 },
  { id: 'destroyer',  name: 'DESTROYER',  size: 2, max: 4, def: 1 },
];

export const SHIP_BY_ID = Object.fromEntries(SHIP_CLASSES.map((s) => [s.id, s]));

export function defaultFleet() {
  const f = {};
  for (const s of SHIP_CLASSES) f[s.id] = s.def;
  return f;
}

/* ---- player colours ---- */
export const COLORS = [
  { id: 'red',    name: 'CRIMSON', hex: 0xd6423c, css: '#d6423c' },
  { id: 'blue',   name: 'AZURE',   hex: 0x3d83d6, css: '#3d83d6' },
  { id: 'green',  name: 'JADE',    hex: 0x3faf63, css: '#3faf63' },
  { id: 'orange', name: 'EMBER',   hex: 0xe0832c, css: '#e0832c' },
  { id: 'purple', name: 'VIOLET',  hex: 0x9b5ad8, css: '#9b5ad8' },
  { id: 'yellow', name: 'SIGNAL',  hex: 0xe3c62e, css: '#e3c62e' },
];
export const COLOR_BY_ID = Object.fromEntries(COLORS.map((c) => [c.id, c]));

export function otherColor(id) {
  return (COLORS.find((c) => c.id !== id) || COLORS[1]).id;
}

/* ---- match config ---- */
export const GRID_SIZES = [8, 10, 12];
export const TIMER_OPTIONS = [0, 15, 30, 60];

export function defaultConfig() {
  return {
    gridSize: 10,
    fleet: defaultFleet(),
    turnTimer: 30,
    extraTurnOnHit: false,
    allowTouching: true,
  };
}

/** Column letters A..L, row numbers 1..n */
export function cellLabel(gx, gy) {
  return String.fromCharCode(65 + gx) + (gy + 1);
}

export const DIFFICULTIES = {
  easy:   { name: 'ENSIGN',    blurb: 'Fires at random and only loosely follows up on strikes.' },
  medium: { name: 'COMMANDER', blurb: 'Sweeps methodically and hunts down any hull it wounds.' },
  hard:   { name: 'ADMIRAL',   blurb: 'Runs a probability plot of your fleet. Shows no mercy.' },
};
