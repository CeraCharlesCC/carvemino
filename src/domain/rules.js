import { CLASSIC_TEMPLATE } from "../templates/classic.js";
import { CARVER_TEMPLATE } from "../templates/carver.js";

export const GAME_TEMPLATES = Object.freeze({
  classic: CLASSIC_TEMPLATE,
  carver: CARVER_TEMPLATE
});

function mergeValue(base, override) {
  if (override === undefined) return base;
  if (Array.isArray(base)) return Array.isArray(override) ? [...override] : [...base];
  if (base && typeof base === "object") {
    const result = {};
    const keys = new Set([...Object.keys(base), ...Object.keys(override || {})]);
    for (const key of keys) {
      result[key] = mergeValue(base[key], override ? override[key] : undefined);
    }
    return result;
  }
  return override;
}

function validateRules(rules) {
  if (!rules.id) throw new Error("rules template requires an id");
  if (!rules.board || !Number.isInteger(rules.board.width) || rules.board.width <= 0) {
    throw new Error("rules template requires a positive board width");
  }
  if (!rules.pieces || !rules.pieces.templates || Object.keys(rules.pieces.templates).length === 0) {
    throw new Error("rules template requires at least one piece template");
  }
  for (const [templateId, template] of Object.entries(rules.pieces.templates)) {
    if (!Array.isArray(template.cells) || template.cells.length === 0) {
      throw new Error(`piece template ${templateId} requires cells`);
    }
    if (!Array.isArray(template.rotations) || template.rotations.length === 0) {
      throw new Error(`piece template ${templateId} requires rotations`);
    }
  }
  return rules;
}

export function createRulesFromTemplate(template, overrides = {}) {
  if (!template || typeof template !== "object") throw new Error("template is required");
  return validateRules(mergeValue(template, overrides));
}

export function createRules(overrides = {}) {
  return createRulesFromTemplate(CLASSIC_TEMPLATE, overrides);
}

export function createRulesForMode(modeId, overrides = {}) {
  const template = GAME_TEMPLATES[modeId];
  if (!template) throw new Error(`Unknown game mode: ${modeId}`);
  return createRulesFromTemplate(template, overrides);
}

export const STANDARD_RULES = createRules();

// Backwards-compatible exports for integrations that still inspect the classic set.
export const PIECE_TEMPLATES = Object.freeze(Object.fromEntries(
  Object.entries(STANDARD_RULES.pieces.templates).map(([id, template]) => [id, template.cells])
));
export const TEMPLATE_IDS = Object.freeze(Object.keys(PIECE_TEMPLATES));
export const TEMPLATE_ROTATIONS = Object.freeze(Object.fromEntries(
  Object.entries(STANDARD_RULES.pieces.templates).map(([id, template]) => [id, template.rotations])
));
export const TEMPLATE_CELL_VALUES = Object.freeze({
  ...Object.fromEntries(
    Object.entries(STANDARD_RULES.pieces.templates).map(([id, template]) => [id, template.cellValue])
  ),
  GARBAGE: STANDARD_RULES.pieces.garbageCellValue
});

function normalizeRotation(rotation) {
  if (!Number.isInteger(rotation)) throw new Error(`Invalid rotation: ${rotation}`);
  return ((rotation % 4) + 4) % 4;
}

function resolveTemplateArgs(rulesOrTemplateId, templateIdOrRotation, maybeRotation) {
  if (typeof rulesOrTemplateId === "string") {
    return {
      rules: STANDARD_RULES,
      templateId: rulesOrTemplateId,
      rotation: templateIdOrRotation ?? 0
    };
  }
  return {
    rules: rulesOrTemplateId,
    templateId: templateIdOrRotation,
    rotation: maybeRotation ?? 0
  };
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

export function getTemplateCells(rulesOrTemplateId, templateIdOrRotation, maybeRotation) {
  const { rules, templateId, rotation } = resolveTemplateArgs(
    rulesOrTemplateId,
    templateIdOrRotation,
    maybeRotation
  );
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

export function getTemplateBounds(rulesOrTemplateId, templateIdOrRotation, maybeRotation) {
  const { rules, templateId, rotation } = resolveTemplateArgs(
    rulesOrTemplateId,
    templateIdOrRotation,
    maybeRotation
  );
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