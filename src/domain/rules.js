const RULE_KEYS = Object.freeze([
  "id",
  "board",
  "simulation",
  "sculpting",
  "progression",
  "scoring",
  "pieces",
  "presentation"
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

function assertCellStyle(style, path) {
  assertExactKeys(style, ["fill"], path);
  assertNonEmptyString(style.fill, `${path}.fill`);
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

  assertExactKeys(rules.board, ["width", "visibleHeight", "hiddenHeight"], "rules.board");
  assertInteger(rules.board.width, "rules.board.width", { minimum: 1 });
  assertInteger(rules.board.visibleHeight, "rules.board.visibleHeight", { minimum: 1 });
  assertInteger(rules.board.hiddenHeight, "rules.board.hiddenHeight", { minimum: 0 });

  assertExactKeys(
    rules.simulation,
    [
      "stepsPerSecond",
      "lockDelayWorldTicks",
      "operationGraceSteps",
      "dropCoverageHistoryLength",
      "dropPositionSampleCount"
    ],
    "rules.simulation"
  );
  assertInteger(rules.simulation.stepsPerSecond, "rules.simulation.stepsPerSecond", { minimum: 1 });
  assertInteger(rules.simulation.lockDelayWorldTicks, "rules.simulation.lockDelayWorldTicks", { minimum: 0 });
  assertInteger(rules.simulation.operationGraceSteps, "rules.simulation.operationGraceSteps", { minimum: 0 });
  assertInteger(
    rules.simulation.dropCoverageHistoryLength,
    "rules.simulation.dropCoverageHistoryLength",
    { minimum: 1 }
  );
  assertInteger(
    rules.simulation.dropPositionSampleCount,
    "rules.simulation.dropPositionSampleCount",
    { minimum: 1 }
  );

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
      "gravityStartWorldTicks",
      "gravityStepWorldTicks",
      "gravityMinimumWorldTicks",
      "spawnStartWorldTicks",
      "spawnStepWorldTicks",
      "spawnMinimumWorldTicks",
      "dropQueueDepth"
    ],
    "rules.progression"
  );
  assertInteger(rules.progression.linesPerLevel, "rules.progression.linesPerLevel", { minimum: 1 });
  assertInteger(rules.progression.gravityStartWorldTicks, "rules.progression.gravityStartWorldTicks", { minimum: 1 });
  assertInteger(rules.progression.gravityStepWorldTicks, "rules.progression.gravityStepWorldTicks", { minimum: 0 });
  assertInteger(rules.progression.gravityMinimumWorldTicks, "rules.progression.gravityMinimumWorldTicks", { minimum: 1 });
  assertInteger(rules.progression.spawnStartWorldTicks, "rules.progression.spawnStartWorldTicks", { minimum: 0 });
  assertInteger(rules.progression.spawnStepWorldTicks, "rules.progression.spawnStepWorldTicks", { minimum: 0 });
  assertInteger(rules.progression.spawnMinimumWorldTicks, "rules.progression.spawnMinimumWorldTicks", { minimum: 1 });
  assertInteger(rules.progression.dropQueueDepth, "rules.progression.dropQueueDepth", { minimum: 1 });

  assertExactKeys(rules.scoring, ["lineClear", "carve", "fill"], "rules.scoring");
  assertNumberTable(rules.scoring.lineClear, "rules.scoring.lineClear");
  assertInteger(rules.scoring.carve, "rules.scoring.carve", { minimum: 0 });
  assertInteger(rules.scoring.fill, "rules.scoring.fill", { minimum: 0 });

  assertExactKeys(rules.pieces, ["garbageCellValue", "templates"], "rules.pieces");
  assertInteger(rules.pieces.garbageCellValue, "rules.pieces.garbageCellValue", { minimum: 1, maximum: 255 });
  assertPlainObject(rules.pieces.templates, "rules.pieces.templates");
  const templates = Object.entries(rules.pieces.templates);
  if (templates.length === 0) throw new Error("rules.pieces.templates must contain at least one template");
  for (const [templateId, template] of templates) validatePieceTemplate(templateId, template);

  const boardHeight = rules.board.visibleHeight + rules.board.hiddenHeight;
  for (const [templateId, template] of templates) {
    for (const rotation of template.rotations) {
      const bounds = getTemplateBounds(rules, templateId, rotation);
      if (bounds.width > rules.board.width || bounds.height > boardHeight) {
        throw new Error(
          `rules.pieces.templates.${templateId} rotation ${rotation} has bounds `
          + `${bounds.width}x${bounds.height} that do not fit rules.board `
          + `${rules.board.width}x${boardHeight}`
        );
      }
    }
  }

  assertExactKeys(rules.presentation, ["cellStyles"], "rules.presentation");
  assertPlainObject(rules.presentation.cellStyles, "rules.presentation.cellStyles");
  for (const [cellValue, style] of Object.entries(rules.presentation.cellStyles)) {
    const numericValue = Number(cellValue);
    if (!Number.isInteger(numericValue)
        || numericValue < 1
        || numericValue > 255
        || String(numericValue) !== cellValue) {
      throw new Error(`rules.presentation.cellStyles.${cellValue} must use an integer cell value between 1 and 255`);
    }
    assertCellStyle(style, `rules.presentation.cellStyles.${cellValue}`);
  }

  const styledCellValues = new Set([
    rules.pieces.garbageCellValue,
    ...templates.map(([, template]) => template.cellValue)
  ]);
  for (const cellValue of styledCellValues) {
    if (!Object.hasOwn(rules.presentation.cellStyles, String(cellValue))) {
      throw new Error(`rules.presentation.cellStyles.${cellValue} is required for used cell value ${cellValue}`);
    }
  }
}

export function defineRules(definition) {
  if (!isPlainObject(definition)) throw new Error("rules definition must be an object");
  const rules = cloneValue(definition);
  validateRules(rules);
  return deepFreeze(rules);
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

export function gravityIntervalWorldTicksForLevel(rules, level) {
  const p = rules.progression;
  return Math.max(
    p.gravityMinimumWorldTicks,
    p.gravityStartWorldTicks - (level - 1) * p.gravityStepWorldTicks
  );
}

export function spawnIntervalWorldTicksForLevel(rules, level) {
  const p = rules.progression;
  return Math.max(
    p.spawnMinimumWorldTicks,
    p.spawnStartWorldTicks - (level - 1) * p.spawnStepWorldTicks
  );
}

export function scoreForLineClear(rules, count, level) {
  const table = rules.scoring.lineClear;
  const base = table[Math.min(count, table.length - 1)] || 0;
  return base * level;
}
