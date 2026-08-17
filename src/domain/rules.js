import { CLASSIC_TEMPLATE } from "../templates/classic.js";
import { CARVER_TEMPLATE } from "../templates/carver.js";

export const GAME_TEMPLATES = Object.freeze({
  classic: CLASSIC_TEMPLATE,
  carver: CARVER_TEMPLATE
});

const RULE_KEYS = Object.freeze([
  "id",
  "modeId",
  "name",
  "description",
  "board",
  "simulation",
  "sculpting",
  "progression",
  "scoring",
  "attack",
  "garbage",
  "survival",
  "pieces"
]);

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertPlainObject(value, path) {
  if (!isPlainObject(value)) throw new Error(`${path} must be an object`);
}

function assertExactKeys(value, expectedKeys, path) {
  assertPlainObject(value, path);
  const expected = new Set(expectedKeys);
  for (const key of Object.keys(value)) {
    if (!expected.has(key)) throw new Error(`${path}.${key} is not a supported field`);
  }
  for (const key of expectedKeys) {
    if (!Object.hasOwn(value, key)) throw new Error(`${path}.${key} is required`);
  }
}

function assertNonEmptyString(value, path) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${path} must be a non-empty string`);
  }
}

function assertBoolean(value, path) {
  if (typeof value !== "boolean") throw new Error(`${path} must be a boolean`);
}

function assertInteger(value, path, { minimum = Number.MIN_SAFE_INTEGER, maximum = Number.MAX_SAFE_INTEGER } = {}) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    const range = maximum < Number.MAX_SAFE_INTEGER
      ? ` between ${minimum} and ${maximum}`
      : ` >= ${minimum}`;
    throw new Error(`${path} must be an integer${range}`);
  }
}

function assertNumberTable(value, path) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${path} must be a non-empty array`);
  }
  value.forEach((entry, index) => assertInteger(entry, `${path}[${index}]`, { minimum: 0 }));
}

function cloneValue(value) {
  if (Array.isArray(value)) return value.map(cloneValue);
  if (isPlainObject(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, cloneValue(entry)]));
  }
  return value;
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const entry of Object.values(value)) deepFreeze(entry);
  return Object.freeze(value);
}

function mergeOverrideValue(base, override, path) {
  if (Array.isArray(base)) {
    if (!Array.isArray(override)) throw new Error(`${path} must be an array`);
    return cloneValue(override);
  }
  if (isPlainObject(base)) {
    if (!isPlainObject(override)) throw new Error(`${path} must be an object`);
    return mergeOverrides(base, override, path);
  }
  if (typeof override !== typeof base || override === null) {
    throw new Error(`${path} must be a ${typeof base}`);
  }
  return override;
}

function mergeOverrides(base, overrides, path = "rules") {
  assertPlainObject(overrides, `${path} overrides`);
  for (const key of Object.keys(overrides)) {
    if (!Object.hasOwn(base, key)) throw new Error(`${path}.${key} is not a supported override`);
  }

  const result = {};
  for (const [key, baseValue] of Object.entries(base)) {
    result[key] = Object.hasOwn(overrides, key)
      ? mergeOverrideValue(baseValue, overrides[key], `${path}.${key}`)
      : cloneValue(baseValue);
  }
  return result;
}

function validatePieceTemplate(templateId, template) {
  const path = `rules.pieces.templates.${templateId}`;
  assertNonEmptyString(templateId, "piece template id");
  assertExactKeys(template, ["cells", "rotations", "cellValue"], path);

  if (!Array.isArray(template.cells) || template.cells.length === 0) {
    throw new Error(`${path}.cells must be a non-empty array`);
  }
  const cells = new Set();
  template.cells.forEach((cell, index) => {
    if (!Array.isArray(cell) || cell.length !== 2) {
      throw new Error(`${path}.cells[${index}] must be an [x, y] pair`);
    }
    assertInteger(cell[0], `${path}.cells[${index}][0]`);
    assertInteger(cell[1], `${path}.cells[${index}][1]`);
    const key = `${cell[0]},${cell[1]}`;
    if (cells.has(key)) throw new Error(`${path}.cells contains duplicate cell ${key}`);
    cells.add(key);
  });

  if (!Array.isArray(template.rotations) || template.rotations.length === 0) {
    throw new Error(`${path}.rotations must be a non-empty array`);
  }
  const rotations = new Set();
  template.rotations.forEach((rotation, index) => {
    assertInteger(rotation, `${path}.rotations[${index}]`, { minimum: 0, maximum: 3 });
    if (rotations.has(rotation)) throw new Error(`${path}.rotations contains duplicate rotation ${rotation}`);
    rotations.add(rotation);
  });

  assertInteger(template.cellValue, `${path}.cellValue`, { minimum: 1, maximum: 255 });
}

function validateRules(rules) {
  assertExactKeys(rules, RULE_KEYS, "rules");
  assertNonEmptyString(rules.id, "rules.id");
  assertNonEmptyString(rules.modeId, "rules.modeId");
  assertNonEmptyString(rules.name, "rules.name");
  if (typeof rules.description !== "string") throw new Error("rules.description must be a string");

  assertExactKeys(rules.board, ["width", "visibleHeight", "hiddenHeight"], "rules.board");
  assertInteger(rules.board.width, "rules.board.width", { minimum: 1 });
  assertInteger(rules.board.visibleHeight, "rules.board.visibleHeight", { minimum: 1 });
  assertInteger(rules.board.hiddenHeight, "rules.board.hiddenHeight", { minimum: 0 });

  assertExactKeys(
    rules.simulation,
    ["ticksPerSecond", "lockDelayTicks", "operationGraceTicks"],
    "rules.simulation"
  );
  assertInteger(rules.simulation.ticksPerSecond, "rules.simulation.ticksPerSecond", { minimum: 1 });
  assertInteger(rules.simulation.lockDelayTicks, "rules.simulation.lockDelayTicks", { minimum: 0 });
  assertInteger(rules.simulation.operationGraceTicks, "rules.simulation.operationGraceTicks", { minimum: 0 });

  assertExactKeys(
    rules.sculpting,
    ["carveLimit", "minimumCells", "scrapPerCarve", "fillCost"],
    "rules.sculpting"
  );
  assertInteger(rules.sculpting.carveLimit, "rules.sculpting.carveLimit", { minimum: 0 });
  assertInteger(rules.sculpting.minimumCells, "rules.sculpting.minimumCells", { minimum: 1 });
  assertInteger(rules.sculpting.scrapPerCarve, "rules.sculpting.scrapPerCarve", { minimum: 0 });
  assertInteger(rules.sculpting.fillCost, "rules.sculpting.fillCost", { minimum: 0 });

  assertExactKeys(
    rules.progression,
    [
      "linesPerLevel",
      "gravityStartTicks",
      "gravityStepTicks",
      "gravityMinimumTicks",
      "spawnStartTicks",
      "spawnStepTicks",
      "spawnMinimumTicks",
      "previewCount"
    ],
    "rules.progression"
  );
  assertInteger(rules.progression.linesPerLevel, "rules.progression.linesPerLevel", { minimum: 1 });
  assertInteger(rules.progression.gravityStartTicks, "rules.progression.gravityStartTicks", { minimum: 1 });
  assertInteger(rules.progression.gravityStepTicks, "rules.progression.gravityStepTicks", { minimum: 0 });
  assertInteger(rules.progression.gravityMinimumTicks, "rules.progression.gravityMinimumTicks", { minimum: 1 });
  assertInteger(rules.progression.spawnStartTicks, "rules.progression.spawnStartTicks", { minimum: 0 });
  assertInteger(rules.progression.spawnStepTicks, "rules.progression.spawnStepTicks", { minimum: 0 });
  assertInteger(rules.progression.spawnMinimumTicks, "rules.progression.spawnMinimumTicks", { minimum: 1 });
  assertInteger(rules.progression.previewCount, "rules.progression.previewCount", { minimum: 1 });

  assertExactKeys(rules.scoring, ["lineClear", "carve", "fill"], "rules.scoring");
  assertNumberTable(rules.scoring.lineClear, "rules.scoring.lineClear");
  assertInteger(rules.scoring.carve, "rules.scoring.carve", { minimum: 0 });
  assertInteger(rules.scoring.fill, "rules.scoring.fill", { minimum: 0 });

  assertExactKeys(rules.attack, ["lineClear"], "rules.attack");
  assertNumberTable(rules.attack.lineClear, "rules.attack.lineClear");

  assertExactKeys(rules.garbage, ["warningTicks", "cancellation"], "rules.garbage");
  assertInteger(rules.garbage.warningTicks, "rules.garbage.warningTicks", { minimum: 0 });
  assertBoolean(rules.garbage.cancellation, "rules.garbage.cancellation");

  assertExactKeys(
    rules.survival,
    ["firstWaveTick", "waveIntervalTicks", "rowsPerWaveStep", "maximumRowsPerWave"],
    "rules.survival"
  );
  assertInteger(rules.survival.firstWaveTick, "rules.survival.firstWaveTick", { minimum: 0 });
  assertInteger(rules.survival.waveIntervalTicks, "rules.survival.waveIntervalTicks", { minimum: 1 });
  assertInteger(rules.survival.rowsPerWaveStep, "rules.survival.rowsPerWaveStep", { minimum: 1 });
  assertInteger(rules.survival.maximumRowsPerWave, "rules.survival.maximumRowsPerWave", { minimum: 1 });

  assertExactKeys(rules.pieces, ["garbageCellValue", "templates"], "rules.pieces");
  assertInteger(rules.pieces.garbageCellValue, "rules.pieces.garbageCellValue", { minimum: 1, maximum: 255 });
  assertPlainObject(rules.pieces.templates, "rules.pieces.templates");
  const templates = Object.entries(rules.pieces.templates);
  if (templates.length === 0) throw new Error("rules.pieces.templates must contain at least one template");
  for (const [templateId, template] of templates) validatePieceTemplate(templateId, template);
}

export function compileRules(template, overrides = {}) {
  if (!isPlainObject(template)) throw new Error("rules template must be an object");
  validateRules(template);
  const rules = mergeOverrides(template, overrides);
  validateRules(rules);
  return deepFreeze(rules);
}

export function createRules(overrides = {}) {
  return compileRules(CLASSIC_TEMPLATE, overrides);
}

export function createRulesForMode(modeId, overrides = {}) {
  const template = GAME_TEMPLATES[modeId];
  if (!template) throw new Error(`Unknown game mode: ${modeId}`);
  return compileRules(template, overrides);
}

function normalizeRotation(rotation) {
  if (!Number.isInteger(rotation)) throw new Error(`Invalid rotation: ${rotation}`);
  return ((rotation % 4) + 4) % 4;
}

export function getTemplateIds(rules) {
  return Object.keys(rules.pieces.templates);
}

export function getTemplateRotations(rules, templateId) {
  const template = rules.pieces.templates[templateId];
  if (!template) throw new Error(`Unknown template: ${templateId}`);
  return template.rotations;
}

export function getTemplateCellValue(rules, templateId) {
  const template = rules.pieces.templates[templateId];
  if (!template) throw new Error(`Unknown template: ${templateId}`);
  return template.cellValue;
}

export function getGarbageCellValue(rules) {
  return rules.pieces.garbageCellValue;
}

export function getTemplateCells(rules, templateId, rotation) {
  const template = rules.pieces.templates[templateId];
  if (!template) throw new Error(`Unknown template: ${templateId}`);
  const turns = normalizeRotation(rotation);
  let rotated = template.cells.map(([x, y]) => ({ x, y }));

  for (let turn = 0; turn < turns; turn += 1) {
    rotated = rotated.map(({ x, y }) => ({ x: -y, y: x }));
  }

  const minX = Math.min(...rotated.map((cell) => cell.x));
  const minY = Math.min(...rotated.map((cell) => cell.y));
  return rotated
    .map(({ x, y }) => ({ x: x - minX, y: y - minY }))
    .sort((a, b) => a.y - b.y || a.x - b.x);
}

export function getTemplateBounds(rules, templateId, rotation) {
  const cells = getTemplateCells(rules, templateId, rotation);

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