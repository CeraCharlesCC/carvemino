import { defineRules } from "../domain/rules.js";

export const CARVER_RULESET = defineRules({
  id: "carvemino-carver-rules-v3",
  board: { width: 10, visibleHeight: 24, hiddenHeight: 6 },
  simulation: {
    stepsPerSecond: 60,
    lockDelayWorldTicks: 30,
    operationGraceSteps: 8,
    focusGraceSteps: 2,
    dropCoverageHistoryLength: 48,
    dropPositionSampleCount: 2
  },
  sculpting: { carveLimit: 4, minimumCells: 2, scrapPerCarve: 1, fillCost: 2 },
  progression: {
    linesPerLevel: 4,
    gravityStartWorldTicks: 24,
    gravityStepWorldTicks: 2,
    gravityMinimumWorldTicks: 4,
    spawnStartWorldTicks: 540,
    spawnStepWorldTicks: 60,
    spawnMinimumWorldTicks: 90,
    dropQueueDepth: 2
  },
  scoring: { lineClear: [0, 140, 380, 700, 1200, 1800], carve: 8, fill: 12 },
  pieces: {
    garbageCellValue: 8,
    templates: {
      SLAB: { cells: [[0, 0], [1, 0], [2, 0], [0, 1], [1, 1], [2, 1]], rotations: [0, 1], cellValue: 1 },
      BOOT: { cells: [[0, 0], [0, 1], [0, 2], [1, 1], [1, 2], [2, 2]], rotations: [0, 1, 2, 3], cellValue: 2 },
      STAIR: { cells: [[0, 0], [1, 0], [1, 1], [2, 1], [2, 2], [3, 2]], rotations: [0, 1], cellValue: 3 },
      PLUS: { cells: [[1, 0], [0, 1], [1, 1], [2, 1], [1, 2]], rotations: [0], cellValue: 4 },
      U: { cells: [[0, 0], [2, 0], [0, 1], [1, 1], [2, 1]], rotations: [0, 1, 2, 3], cellValue: 5 },
      P: { cells: [[0, 0], [1, 0], [0, 1], [1, 1], [0, 2]], rotations: [0, 1, 2, 3], cellValue: 6 },
      CRATE: { cells: [[0, 0], [1, 0], [2, 0], [0, 1], [2, 1], [0, 2], [1, 2], [2, 2]], rotations: [0], cellValue: 7 }
    }
  },
  presentation: {
    cellStyles: {
      1: { fill: "#6b9e8f" },
      2: { fill: "#b5a66a" },
      3: { fill: "#8a7b96" },
      4: { fill: "#7a9a6d" },
      5: { fill: "#a6645c" },
      6: { fill: "#6882a3" },
      7: { fill: "#b0864e" },
      8: { fill: "#5a5d55" }
    }
  }
});
