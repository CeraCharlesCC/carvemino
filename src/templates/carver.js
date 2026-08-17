export const CARVER_TEMPLATE = Object.freeze({
  id: "carvemino-carver-v1",
  modeId: "carver",
  name: "Carver",
  description: "Chunky polyominoes, a taller dig site, and twice the carving budget.",
  board: Object.freeze({ width: 10, visibleHeight: 24, hiddenHeight: 6 }),
  simulation: Object.freeze({ ticksPerSecond: 60, lockDelayTicks: 30 }),
  sculpting: Object.freeze({ carveLimit: 4, minimumCells: 2, scrapPerCarve: 1, fillCost: 2 }),
  progression: Object.freeze({
    linesPerLevel: 4,
    gravityStartTicks: 24,
    gravityStepTicks: 2,
    gravityMinimumTicks: 4,
    spawnStartTicks: 540,
    spawnStepTicks: 60,
    spawnMinimumTicks: 90,
    previewCount: 2
  }),
  scoring: Object.freeze({ lineClear: Object.freeze([0, 140, 380, 700, 1200, 1800]), carve: 8, fill: 12 }),
  attack: Object.freeze({ lineClear: Object.freeze([0, 0, 1, 2, 4, 6]) }),
  garbage: Object.freeze({ warningTicks: 150, cancellation: true }),
  survival: Object.freeze({
    firstWaveTick: 1200,
    waveIntervalTicks: 720,
    rowsPerWaveStep: 1800,
    maximumRowsPerWave: 5
  }),
  pieces: Object.freeze({
    garbageCellValue: 8,
    templates: Object.freeze({
      SLAB: Object.freeze({ cells: Object.freeze([[0, 0], [1, 0], [2, 0], [0, 1], [1, 1], [2, 1]]), rotations: Object.freeze([0, 1]), cellValue: 1 }),
      BOOT: Object.freeze({ cells: Object.freeze([[0, 0], [0, 1], [0, 2], [1, 1], [1, 2], [2, 2]]), rotations: Object.freeze([0, 1, 2, 3]), cellValue: 2 }),
      STAIR: Object.freeze({ cells: Object.freeze([[0, 0], [1, 0], [1, 1], [2, 1], [2, 2], [3, 2]]), rotations: Object.freeze([0, 1]), cellValue: 3 }),
      PLUS: Object.freeze({ cells: Object.freeze([[1, 0], [0, 1], [1, 1], [2, 1], [1, 2]]), rotations: Object.freeze([0]), cellValue: 4 }),
      U: Object.freeze({ cells: Object.freeze([[0, 0], [2, 0], [0, 1], [1, 1], [2, 1]]), rotations: Object.freeze([0, 1, 2, 3]), cellValue: 5 }),
      P: Object.freeze({ cells: Object.freeze([[0, 0], [1, 0], [0, 1], [1, 1], [0, 2]]), rotations: Object.freeze([0, 1, 2, 3]), cellValue: 6 }),
      CRATE: Object.freeze({ cells: Object.freeze([[0, 0], [1, 0], [2, 0], [0, 1], [2, 1], [0, 2], [1, 2], [2, 2]]), rotations: Object.freeze([0]), cellValue: 7 })
    })
  })
});