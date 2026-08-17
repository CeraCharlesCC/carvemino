export const PIECE_TEMPLATES = Object.freeze({
  I: Object.freeze([[0, 0], [1, 0], [2, 0], [3, 0]]),
  O: Object.freeze([[0, 0], [1, 0], [0, 1], [1, 1]]),
  T: Object.freeze([[0, 0], [1, 0], [2, 0], [1, 1]]),
  S: Object.freeze([[1, 0], [2, 0], [0, 1], [1, 1]]),
  Z: Object.freeze([[0, 0], [1, 0], [1, 1], [2, 1]]),
  J: Object.freeze([[0, 0], [0, 1], [1, 1], [2, 1]]),
  L: Object.freeze([[2, 0], [0, 1], [1, 1], [2, 1]])
});

export const TEMPLATE_IDS = Object.freeze(Object.keys(PIECE_TEMPLATES));

export const TEMPLATE_ROTATIONS = Object.freeze({
  I: Object.freeze([0, 1]),
  O: Object.freeze([0]),
  T: Object.freeze([0, 1, 2, 3]),
  S: Object.freeze([0, 1]),
  Z: Object.freeze([0, 1]),
  J: Object.freeze([0, 1, 2, 3]),
  L: Object.freeze([0, 1, 2, 3])
});

export const TEMPLATE_CELL_VALUES = Object.freeze({
  I: 1,
  O: 2,
  T: 3,
  S: 4,
  Z: 5,
  J: 6,
  L: 7,
  GARBAGE: 8
});

export const STANDARD_RULES = Object.freeze({
  id: "carvemino-standard-v1",
  board: Object.freeze({
    width: 10,
    visibleHeight: 20,
    hiddenHeight: 4
  }),
  simulation: Object.freeze({
    ticksPerSecond: 60,
    lockDelayTicks: 24
  }),
  sculpting: Object.freeze({
    carveLimit: 2,
    minimumCells: 1,
    scrapPerCarve: 1,
    fillCost: 2
  }),
  progression: Object.freeze({
    linesPerLevel: 5,
    gravityStartTicks: 20,
    gravityStepTicks: 2,
    gravityMinimumTicks: 3,
    spawnStartTicks: 480,
    spawnStepTicks: 60,
    spawnMinimumTicks: 60,
    previewCount: 2
  }),
  scoring: Object.freeze({
    lineClear: Object.freeze([0, 100, 300, 500, 800]),
    carve: 5,
    fill: 10
  }),
  attack: Object.freeze({
    lineClear: Object.freeze([0, 0, 1, 2, 4])
  }),
  garbage: Object.freeze({
    warningTicks: 120,
    cancellation: true
  }),
  survival: Object.freeze({
    firstWaveTick: 900,
    waveIntervalTicks: 600,
    rowsPerWaveStep: 1800,
    maximumRowsPerWave: 5
  })
});

function mergeValue(base, override) {
  if (override === undefined) return base;
  if (Array.isArray(base)) return Array.isArray(override) ? [...override] : [...base];
  if (base && typeof base === "object") {
    const result = {};
    const keys = new Set([...Object.keys(base), ...Object.keys(override || {})]);
    for (const key of keys) {
      result[key] = mergeValue(base[key], override ? override[key] : undefined);
    }
    return result;
  }
  return override;
}

export function createRules(overrides = {}) {
  return mergeValue(STANDARD_RULES, overrides);
}

function normalizeRotation(rotation) {
  if (!Number.isInteger(rotation)) throw new Error(`Invalid rotation: ${rotation}`);
  return ((rotation % 4) + 4) % 4;
}

export function getTemplateCells(templateId, rotation = 0) {
  const cells = PIECE_TEMPLATES[templateId];
  if (!cells) throw new Error(`Unknown template: ${templateId}`);
  const turns = normalizeRotation(rotation);
  let rotated = cells.map(([x, y]) => ({ x, y }));

  for (let turn = 0; turn < turns; turn += 1) {
    rotated = rotated.map(({ x, y }) => ({ x: -y, y: x }));
  }

  const minX = Math.min(...rotated.map((cell) => cell.x));
  const minY = Math.min(...rotated.map((cell) => cell.y));
  return rotated
    .map(({ x, y }) => ({ x: x - minX, y: y - minY }))
    .sort((a, b) => a.y - b.y || a.x - b.x);
}

export function getTemplateBounds(templateId, rotation = 0) {
  const cells = getTemplateCells(templateId, rotation);

  let maxX = 0;
  let maxY = 0;
  for (const cell of cells) {
    maxX = Math.max(maxX, cell.x);
    maxY = Math.max(maxY, cell.y);
  }
  return { width: maxX + 1, height: maxY + 1 };
}

export function gravityIntervalForLevel(rules, level) {
  const p = rules.progression;
  return Math.max(
    p.gravityMinimumTicks,
    p.gravityStartTicks - (level - 1) * p.gravityStepTicks
  );
}

export function spawnIntervalForLevel(rules, level) {
  const p = rules.progression;
  return Math.max(
    p.spawnMinimumTicks,
    p.spawnStartTicks - (level - 1) * p.spawnStepTicks
  );
}

export function scoreForLineClear(rules, count, level) {
  const table = rules.scoring.lineClear;
  const base = table[Math.min(count, table.length - 1)] || 0;
  return base * level;
}

export function attackForLineClear(rules, count) {
  const table = rules.attack.lineClear;
  return table[Math.min(count, table.length - 1)] || 0;
}