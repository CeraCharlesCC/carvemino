import { defineRules } from "../domain/rules.js";
import { CARVEMINO_CELL_STYLES } from "../palette.js";

export const CARVER_RULESET = defineRules({
  id: "carvemino-carver-rules-v4",
  board: { width: 10, visibleHeight: 24, hiddenHeight: 6 },
  simulation: {
    stepsPerSecond: 60,
    lockDelayWorldTicks: 30,
    operationGraceSteps: 8,
    focusGraceSteps: 2,
    dropCoverageHistoryLength: 48,
    dropPositionSampleCount: 2
  },
  sculpting: { carveLimit: 3, minimumCells: 3, scrapPerCarve: 1, fillCost: 2 },
  progression: {
    linesPerLevel: 4,
    gravity: {
      type: "curve",
      points: [
        { level: 1, worldTicks: 24 },
        { level: 2, worldTicks: 22 },
        { level: 3, worldTicks: 20 },
        { level: 8, worldTicks: 19 },
        { level: 12, worldTicks: 18 },
        { level: 16, worldTicks: 17 },
        { level: 20, worldTicks: 16 },
        { level: 24, worldTicks: 15 },
        { level: 28, worldTicks: 14 },
        { level: 32, worldTicks: 13 },
        { level: 36, worldTicks: 12 },
        { level: 40, worldTicks: 11 },
        { level: 44, worldTicks: 10 },
        { level: 50, worldTicks: 9 },
        { level: 99, worldTicks: 6 }
      ]
    },
    spawn: { type: "linear", start: 540, step: 60, min: 90 },
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
    cellStyles: CARVEMINO_CELL_STYLES
  }
});
