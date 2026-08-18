import { defineRules } from "../domain/rules.js";
import { CARVEMINO_CELL_STYLES } from "../palette.js";

export const CLASSIC_RULESET = defineRules({
  id: "carvemino-classic-rules-v4",
  board: { width: 10, visibleHeight: 20, hiddenHeight: 4 },
  simulation: {
    stepsPerSecond: 60,
    lockDelayWorldTicks: 24,
    operationGraceSteps: 8,
    focusGraceSteps: 2,
    dropCoverageHistoryLength: 48,
    dropPositionSampleCount: 2
  },
  sculpting: { carveLimit: 2, minimumCells: 1, scrapPerCarve: 1, fillCost: 2 },
  progression: {
    linesPerLevel: 5,
    gravityStartWorldTicks: 20,
    gravityStepWorldTicks: 2,
    gravityMinimumWorldTicks: 6,
    gravityCurve: {
      points: [
        { level: 1, worldTicks: 20 },
        { level: 2, worldTicks: 18 },
        { level: 3, worldTicks: 16 },
        { level: 8, worldTicks: 15 },
        { level: 12, worldTicks: 14 },
        { level: 24, worldTicks: 13 },
        { level: 32, worldTicks: 12 },
        { level: 42, worldTicks: 11 },
        { level: 52, worldTicks: 10 },
        { level: 62, worldTicks: 9 },
        { level: 99, worldTicks: 6 }
      ]
    },
    spawnStartWorldTicks: 480,
    spawnStepWorldTicks: 0,
    spawnMinimumWorldTicks: 150,
    spawnCurve: { endLevel: 99, easeOutExponentMilli: 1500 },
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
    cellStyles: CARVEMINO_CELL_STYLES
  }
});
