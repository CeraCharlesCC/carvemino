import { defineRules } from "../domain/rules.js";

export const CLASSIC_RULESET = defineRules({
  id: "carvemino-classic-rules-v2",
  board: Object.freeze({ width: 10, visibleHeight: 20, hiddenHeight: 4 }),
  simulation: Object.freeze({
    stepsPerSecond: 60,
    lockDelayWorldTicks: 24,
    operationGraceSteps: 8
  }),
  sculpting: Object.freeze({ carveLimit: 2, minimumCells: 1, scrapPerCarve: 1, fillCost: 2 }),
  progression: Object.freeze({
    linesPerLevel: 5,
    gravityStartWorldTicks: 20,
    gravityStepWorldTicks: 2,
    gravityMinimumWorldTicks: 3,
    spawnStartWorldTicks: 480,
    spawnStepWorldTicks: 60,
    spawnMinimumWorldTicks: 60,
    previewCount: 2
  }),
  scoring: Object.freeze({ lineClear: Object.freeze([0, 100, 300, 500, 800]), carve: 5, fill: 10 }),
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
