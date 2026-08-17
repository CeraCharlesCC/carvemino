import { CARVER_RULESET } from "../rulesets/carver.js";
import { CLASSIC_RULESET } from "../rulesets/classic.js";

function defineMode({ id, name, description, rules }) {
  if (typeof id !== "string" || id.trim() === "") throw new Error("mode.id must be a non-empty string");
  if (typeof name !== "string" || name.trim() === "") throw new Error("mode.name must be a non-empty string");
  if (typeof description !== "string") throw new Error("mode.description must be a string");
  if (!rules || typeof rules !== "object" || typeof rules.id !== "string" || !Object.isFrozen(rules)) {
    throw new Error("mode.rules must be an immutable defined ruleset");
  }
  return Object.freeze({ id, name, description, rules });
}

function defineCatalog(definitions) {
  const modes = definitions.map(defineMode);
  const ids = new Set();
  for (const mode of modes) {
    if (ids.has(mode.id)) throw new Error(`Duplicate single-player mode id: ${mode.id}`);
    ids.add(mode.id);
  }
  return Object.freeze(modes);
}

export const SINGLEPLAYER_CATALOG = defineCatalog([
  {
    id: "classic",
    name: "Classic",
    description: "The original Carvemino rules: familiar minoes with precision carving.",
    rules: CLASSIC_RULESET
  },
  {
    id: "carver",
    name: "Carver",
    description: "Chunky polyominoes, a taller dig site, and twice the carving budget.",
    rules: CARVER_RULESET
  }
]);

const SINGLEPLAYER_MODES_BY_ID = new Map(SINGLEPLAYER_CATALOG.map((mode) => [mode.id, mode]));

export function getSingleplayerMode(modeId) {
  const mode = SINGLEPLAYER_MODES_BY_ID.get(modeId);
  if (!mode) throw new Error(`Unknown single-player mode: ${modeId}`);
  return mode;
}

export function isSingleplayerModeId(modeId) {
  return SINGLEPLAYER_MODES_BY_ID.has(modeId);
}
