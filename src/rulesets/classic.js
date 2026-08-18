import { defineRules } from "../domain/rules.js";

export const CLASSIC_RULESET = defineRules({
  id: "carvemino-classic-rules-v2",
  board: { width: 10, visibleHeight: 20, hiddenHeight: 4 },
  simulation: {
    stepsPerSecond: 60,
    lockDelayWorldTicks: 24,
    operationGraceSteps: 8,
    dropCoverageHistoryLength: 48,
    dropPositionSampleCount: 2
  },
  sculpting: { carveLimit: 2, minimumCells: 1, scrapPerCarve: 1, fillCost: 2 },
  progression: {
    linesPerLevel: 5,
    gravityStartWorldTicks: 20,
    gravityStepWorldTicks: 2,
    gravityMinimumWorldTicks: 3,
    spawnStartWorldTicks: 480,
    spawnStepWorldTicks: 60,
    spawnMinimumWorldTicks: 60,
    dropQueueDepth: 2
  },
  scoring: { lineClear: [0, 100, 300, 500, 800], carve: 5, fill: 10 },
  pieces: {
    garbageCellValue: 8,
    templates: {
      I: { cells: [[0, 0], [1, 0], [2, 0], [3, 0]], rotations: [0, 1], cellValue: 1 },
      O: { cells: [[0, 0], [1, 0], [0, 1], [1, 1]], rotations: [0], cellValue: 2 },
      T: { cells: [[0, 0], [1, 0], [2, 0], [1, 1]], rotations: [0, 1, 2, 3], cellValue: 3 },
      S: { cells: [[1, 0], [2, 0], [0, 1], [1, 1]], rotations: [0, 1], cellValue: 4 },
      Z: { cells: [[0, 0], [1, 0], [1, 1], [2, 1]], rotations: [0, 1], cellValue: 5 },
      J: { cells: [[0, 0], [0, 1], [1, 1], [2, 1]], rotations: [0, 1, 2, 3], cellValue: 6 },
      L: { cells: [[2, 0], [0, 1], [1, 1], [2, 1]], rotations: [0, 1, 2, 3], cellValue: 7 }
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
