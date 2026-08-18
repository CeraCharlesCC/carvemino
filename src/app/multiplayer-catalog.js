import { CARVER_VERSUS_POLICY } from "../match-policies/carver.js";
import { CLASSIC_VERSUS_POLICY } from "../match-policies/classic.js";
import { CARVER_RULESET } from "../rulesets/carver.js";
import { CLASSIC_RULESET } from "../rulesets/classic.js";

function defineMode({ id, name, description, rules, policy }) {
  if (typeof id !== "string" || id.trim() === "") throw new Error("mode.id must be a non-empty string");
  if (typeof name !== "string" || name.trim() === "") throw new Error("mode.name must be a non-empty string");
  if (typeof description !== "string") throw new Error("mode.description must be a string");
  if (!rules || typeof rules !== "object" || typeof rules.id !== "string" || !Object.isFrozen(rules)) {
    throw new Error("mode.rules must be an immutable defined ruleset");
  }
  if (!policy || typeof policy !== "object" || typeof policy.id !== "string"
      || policy.kind !== "versus" || !Object.isFrozen(policy)) {
    throw new Error("mode.policy must be an immutable versus policy");
  }
  return Object.freeze({ id, name, description, rules, policy });
}

function defineCatalog(definitions) {
  const modes = definitions.map(defineMode);
  const ids = new Set();
  for (const mode of modes) {
    if (ids.has(mode.id)) throw new Error(`Duplicate multiplayer mode id: ${mode.id}`);
    ids.add(mode.id);
  }
  return Object.freeze(modes);
}

export const MULTIPLAYER_CATALOG = defineCatalog([
  {
    id: "classic",
    name: "Classic VS",
    description: "Classic rules with line-clear attacks and garbage cancellation.",
    rules: CLASSIC_RULESET,
    policy: CLASSIC_VERSUS_POLICY
  },
  {
    id: "carver",
    name: "Carver VS",
    description: "Carver rules with the matching deterministic versus policy.",
    rules: CARVER_RULESET,
    policy: CARVER_VERSUS_POLICY
  }
]);

const MULTIPLAYER_MODES_BY_ID = new Map(MULTIPLAYER_CATALOG.map((mode) => [mode.id, mode]));

export function getMultiplayerMode(modeId) {
  const mode = MULTIPLAYER_MODES_BY_ID.get(modeId);
  if (!mode) throw new Error(`Unknown multiplayer mode: ${modeId}`);
  return mode;
}

export function isMultiplayerModeId(modeId) {
  return MULTIPLAYER_MODES_BY_ID.has(modeId);
}