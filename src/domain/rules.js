import { defineCodec, shape as s } from "../codec.js";

const rulesObject = (fields) => s.object(fields, { unsupportedMessage: "is not a supported field" });
const nonEmptyString = s.string({ nonEmpty: true });
const nonNegativeInteger = s.integer({ minimum: 0 });
const positiveInteger = s.integer({ minimum: 1 });
const byteInteger = s.integer({ minimum: 1, maximum: 255 });
const coordinate = s.integer();
const cell = s.tuple([coordinate, coordinate]);
const gravityPoint = rulesObject({ level: positiveInteger, worldTicks: positiveInteger });

const dropPositionStrategy = s.discriminatedUnion("type", {
  "recent-coverage": rulesObject({
    type: s.literal("recent-coverage"),
    historyLength: positiveInteger,
    sampleCount: positiveInteger
  }),
  "leaky-coverage": rulesObject({
    type: s.literal("leaky-coverage"),
    sampleCount: positiveInteger,
    decayNumerator: nonNegativeInteger,
    decayDenominator: positiveInteger,
    pressurePerCell: positiveInteger,
    rawRandomNumerator: nonNegativeInteger,
    rawRandomDenominator: positiveInteger
  })
});

const gravityProgression = s.discriminatedUnion("type", {
  linear: rulesObject({
    type: s.literal("linear"),
    start: positiveInteger,
    step: nonNegativeInteger,
    min: positiveInteger
  }),
  curve: rulesObject({
    type: s.literal("curve"),
    points: s.array(gravityPoint, { minimumLength: 2 })
  })
});

const spawnProgression = s.discriminatedUnion("type", {
  linear: rulesObject({
    type: s.literal("linear"),
    start: nonNegativeInteger,
    step: nonNegativeInteger,
    min: positiveInteger
  }),
  curve: rulesObject({
    type: s.literal("curve"),
    start: nonNegativeInteger,
    min: positiveInteger,
    endLevel: s.integer({ minimum: 2 }),
    easeOutExponentMilli: s.integer({ minimum: 1000 })
  })
});

const pieceTemplate = rulesObject({
  cells: s.array(cell, { minimumLength: 1 }),
  rotations: s.array(s.integer({ minimum: 0, maximum: 3 }), { minimumLength: 1 }),
  cellValue: byteInteger
});

const RULES_CODEC = defineCodec(rulesObject({
  id: nonEmptyString,
  board: rulesObject({
    width: positiveInteger,
    visibleHeight: positiveInteger,
    hiddenHeight: nonNegativeInteger
  }),
  simulation: rulesObject({
    stepsPerSecond: positiveInteger,
    lockDelayWorldTicks: nonNegativeInteger,
    operationGraceSteps: nonNegativeInteger,
    focusGraceSteps: nonNegativeInteger,
    dropPosition: dropPositionStrategy
  }),
  sculpting: rulesObject({
    carveLimit: nonNegativeInteger,
    minimumCells: positiveInteger,
    scrapPerCarve: nonNegativeInteger,
    fillCost: nonNegativeInteger
  }),
  progression: rulesObject({
    linesPerLevel: positiveInteger,
    gravity: gravityProgression,
    spawn: spawnProgression,
    dropQueueDepth: positiveInteger
  }),
  scoring: rulesObject({
    lineClear: s.array(nonNegativeInteger, { minimumLength: 1 }),
    carve: nonNegativeInteger,
    fill: nonNegativeInteger
  }),
  pieces: rulesObject({
    garbageCellValue: byteInteger,
    templates: s.record(pieceTemplate, { key: nonEmptyString, minimumEntries: 1 })
  }),
  presentation: rulesObject({
    cellStyles: s.record(rulesObject({ fill: nonEmptyString }))
  })
}));

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const entry of Object.values(value)) deepFreeze(entry);
  return Object.freeze(value);
}

function validatePieceTemplate(templateId, template) {
  const path = `rules.pieces.templates.${templateId}`;
  const cells = new Set();
  template.cells.forEach((cell) => {
    const key = `${cell[0]},${cell[1]}`;
    if (cells.has(key)) throw new Error(`${path}.cells contains duplicate cell ${key}`);
    cells.add(key);
  });

  const rotations = new Set();
  template.rotations.forEach((rotation) => {
    if (rotations.has(rotation)) throw new Error(`${path}.rotations contains duplicate rotation ${rotation}`);
    rotations.add(rotation);
  });
}

function validateRules(rules) {
  const dropPosition = rules.simulation.dropPosition;
  if (dropPosition.type === "leaky-coverage") {
    if (dropPosition.decayNumerator >= dropPosition.decayDenominator) {
      throw new Error(
        "rules.simulation.dropPosition.decayNumerator must be less than decayDenominator"
      );
    }
    if (dropPosition.rawRandomNumerator > dropPosition.rawRandomDenominator) {
      throw new Error(
        "rules.simulation.dropPosition.rawRandomNumerator must not exceed rawRandomDenominator"
      );
    }
  }

  const gravity = rules.progression.gravity;
  if (gravity.type === "curve") {
    let previousLevel = 0;
    let previousWorldTicks = Number.MAX_SAFE_INTEGER;
    gravity.points.forEach((point, index) => {
      const path = `rules.progression.gravity.points[${index}]`;
      if (point.level <= previousLevel) {
        throw new Error(`${path}.level must be greater than the previous point's level`);
      }
      if (point.worldTicks > previousWorldTicks) {
        throw new Error(`${path}.worldTicks must not exceed the previous point's worldTicks`);
      }
      previousLevel = point.level;
      previousWorldTicks = point.worldTicks;
    });
    if (gravity.points[0].level !== 1) {
      throw new Error("rules.progression.gravity.points must start at level 1");
    }
  } else if (gravity.min > gravity.start) {
    throw new Error("rules.progression.gravity.min must not exceed gravity.start");
  }

  const spawn = rules.progression.spawn;
  if (spawn.min > spawn.start) {
    throw new Error("rules.progression.spawn.min must not exceed spawn.start");
  }

  const templates = Object.entries(rules.pieces.templates);
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

  for (const cellValue of Object.keys(rules.presentation.cellStyles)) {
    const numericValue = Number(cellValue);
    if (!Number.isInteger(numericValue)
        || numericValue < 1
        || numericValue > 255
        || String(numericValue) !== cellValue) {
      throw new Error(`rules.presentation.cellStyles.${cellValue} must use an integer cell value between 1 and 255`);
    }
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
  const rules = RULES_CODEC.parse(definition, "rules");
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
  const gravity = rules.progression.gravity;
  if (gravity.type === "curve") {
    const points = gravity.points;
    const normalizedLevel = Math.max(1, level);
    for (let index = 1; index < points.length; index += 1) {
      const upper = points[index];
      if (normalizedLevel > upper.level) continue;
      const lower = points[index - 1];
      const progress = (normalizedLevel - lower.level) / (upper.level - lower.level);
      return Math.ceil(lower.worldTicks + (upper.worldTicks - lower.worldTicks) * progress);
    }
    return points[points.length - 1].worldTicks;
  }
  return Math.max(
    gravity.min,
    gravity.start - (level - 1) * gravity.step
  );
}

export function spawnIntervalWorldTicksForLevel(rules, level) {
  const spawn = rules.progression.spawn;
  if (spawn.type === "curve") {
    const clampedLevel = Math.max(1, Math.min(spawn.endLevel, level));
    const t = (clampedLevel - 1) / (spawn.endLevel - 1);
    const exponent = spawn.easeOutExponentMilli / 1000;
    const progress = 1 - Math.pow(1 - t, exponent);
    const curvedTicks = spawn.start + (spawn.min - spawn.start) * progress;
    return Math.max(spawn.min, Math.ceil(curvedTicks));
  }
  return Math.max(
    spawn.min,
    spawn.start - (level - 1) * spawn.step
  );
}

export function scoreForLineClear(rules, count, level) {
  const table = rules.scoring.lineClear;
  const base = table[Math.min(count, table.length - 1)] || 0;
  return base * level;
}
