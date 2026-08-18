import { defineRules } from "../domain/rules.js";

export const CARVER_RULESET = defineRules({
  id: "carvemino-carver-rules-v2",
  board: Object.freeze({ width: 10, visibleHeight: 24, hiddenHeight: 6 }),
  simulation: Object.freeze({
    stepsPerSecond: 60,
    lockDelayWorldTicks: 30,
    operationGraceSteps: 8
  }),
  sculpting: Object.freeze({ carveLimit: 4, minimumCells: 2, scrapPerCarve: 1, fillCost: 2 }),
  progression: Object.freeze({
    linesPerLevel: 4,
    gravityStartWorldTicks: 24,
    gravityStepWorldTicks: 2,
    gravityMinimumWorldTicks: 4,
    spawnStartWorldTicks: 540,
    spawnStepWorldTicks: 60,
    spawnMinimumWorldTicks: 90,
    dropQueueDepth: 2
  }),
  scoring: Object.freeze({ lineClear: Object.freeze([0, 140, 380, 700, 1200, 1800]), carve: 8, fill: 12 }),
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
  }),
  presentation: Object.freeze({
    cellStyles: Object.freeze({
      1: Object.freeze({ fill: "#6b9e8f" }),
      2: Object.freeze({ fill: "#b5a66a" }),
      3: Object.freeze({ fill: "#8a7b96" }),
      4: Object.freeze({ fill: "#7a9a6d" }),
      5: Object.freeze({ fill: "#a6645c" }),
      6: Object.freeze({ fill: "#6882a3" }),
      7: Object.freeze({ fill: "#b0864e" }),
      8: Object.freeze({ fill: "#5a5d55" })
    })
  })
});
