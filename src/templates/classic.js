export const CLASSIC_TEMPLATE = Object.freeze({
  id: "carvemino-classic-v2",
  modeId: "classic",
  name: "Classic",
  description: "The original Carvemino rules: familiar tetrominoes with precision carving.",
  board: Object.freeze({ width: 10, visibleHeight: 20, hiddenHeight: 4 }),
  simulation: Object.freeze({ ticksPerSecond: 60, lockDelayTicks: 24 }),
  sculpting: Object.freeze({ carveLimit: 2, minimumCells: 1, scrapPerCarve: 1, fillCost: 2 }),
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
  scoring: Object.freeze({ lineClear: Object.freeze([0, 100, 300, 500, 800]), carve: 5, fill: 10 }),
  attack: Object.freeze({ lineClear: Object.freeze([0, 0, 1, 2, 4]) }),
  garbage: Object.freeze({ warningTicks: 120, cancellation: true }),
  survival: Object.freeze({
    firstWaveTick: 900,
    waveIntervalTicks: 600,
    rowsPerWaveStep: 1800,
    maximumRowsPerWave: 5
  }),
  pieces: Object.freeze({
    garbageCellValue: 8,
    templates: Object.freeze({
      I: Object.freeze({ cells: Object.freeze([[0, 0], [1, 0], [2, 0], [3, 0]]), rotations: Object.freeze([0, 1]), cellValue: 1 }),
      O: Object.freeze({ cells: Object.freeze([[0, 0], [1, 0], [0, 1], [1, 1]]), rotations: Object.freeze([0]), cellValue: 2 }),
      T: Object.freeze({ cells: Object.freeze([[0, 0], [1, 0], [2, 0], [1, 1]]), rotations: Object.freeze([0, 1, 2, 3]), cellValue: 3 }),
      S: Object.freeze({ cells: Object.freeze([[1, 0], [2, 0], [0, 1], [1, 1]]), rotations: Object.freeze([0, 1]), cellValue: 4 }),
      Z: Object.freeze({ cells: Object.freeze([[0, 0], [1, 0], [1, 1], [2, 1]]), rotations: Object.freeze([0, 1]), cellValue: 5 }),
      J: Object.freeze({ cells: Object.freeze([[0, 0], [0, 1], [1, 1], [2, 1]]), rotations: Object.freeze([0, 1, 2, 3]), cellValue: 6 }),
      L: Object.freeze({ cells: Object.freeze([[2, 0], [0, 1], [1, 1], [2, 1]]), rotations: Object.freeze([0, 1, 2, 3]), cellValue: 7 })
    })
  })
});