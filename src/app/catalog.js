import { CARVER_VERSUS_POLICY } from "../match-policies/carver.js";
import { CLASSIC_VERSUS_POLICY } from "../match-policies/classic.js";
import { CARVER_RULESET } from "../rulesets/carver.js";
import { CLASSIC_RULESET } from "../rulesets/classic.js";

function assertPresentation(presentation, kind) {
  if (!presentation || typeof presentation !== "object") {
    throw new Error(`mode.${kind} presentation is required`);
  }
  if (typeof presentation.description !== "string") {
    throw new Error(`mode.${kind}.description must be a string`);
  }
  if (!Number.isInteger(presentation.order) || presentation.order < 0) {
    throw new Error(`mode.${kind}.order must be a non-negative integer`);
  }
}

function defineBaseMode({ id, name, rules, singleplayer, versus }) {
  if (typeof id !== "string" || id.trim() === "") throw new Error("mode.id must be a non-empty string");
  if (typeof name !== "string" || name.trim() === "") throw new Error("mode.name must be a non-empty string");
  if (!rules || typeof rules !== "object" || typeof rules.id !== "string" || !Object.isFrozen(rules)) {
    throw new Error("mode.rules must be an immutable defined ruleset");
  }
  assertPresentation(singleplayer, "singleplayer");
  assertPresentation(versus, "versus");
  if (!versus.policy || typeof versus.policy !== "object" || typeof versus.policy.id !== "string"
      || versus.policy.kind !== "versus" || !Object.isFrozen(versus.policy)) {
    throw new Error("mode.versus.policy must be an immutable versus policy");
  }
  return Object.freeze({
    id,
    name,
    rules,
    singleplayer: Object.freeze({ ...singleplayer }),
    versus: Object.freeze({ ...versus })
  });
}

function defineModeRegistry(definitions) {
  const modes = definitions.map(defineBaseMode);
  const ids = new Set();
  for (const mode of modes) {
    if (ids.has(mode.id)) throw new Error(`Duplicate mode id: ${mode.id}`);
    ids.add(mode.id);
  }
  return Object.freeze(modes);
}

const MODE_REGISTRY = defineModeRegistry([
  {
    id: "carver",
    name: "Carver",
    rules: CARVER_RULESET,
    singleplayer: {
      order: 0,
      description: "Chunky polyominoes, a taller dig site, and twice the carving budget."
    },
    versus: {
      order: 1,
      description: "Carver rules with the matching deterministic versus policy.",
      policy: CARVER_VERSUS_POLICY
    }
  },
  {
    id: "classic",
    name: "Classic",
    rules: CLASSIC_RULESET,
    singleplayer: {
      order: 1,
      description: "The old-school way: familiar minoes with precision carving."
    },
    versus: {
      order: 0,
      description: "Classic rules with line-clear attacks and garbage cancellation.",
      policy: CLASSIC_VERSUS_POLICY
    }
  }
]);

function deriveCatalog(kind) {
  return Object.freeze(
    [...MODE_REGISTRY]
      .sort((a, b) => a[kind].order - b[kind].order)
      .map((mode) => {
        const presentation = mode[kind];
        const shared = {
          id: mode.id,
          name: kind === "versus" ? `${mode.name} VS` : mode.name,
          description: presentation.description,
          rules: mode.rules
        };
        return Object.freeze(kind === "versus" ? { ...shared, policy: presentation.policy } : shared);
      })
  );
}

export const SINGLEPLAYER_CATALOG = deriveCatalog("singleplayer");
export const VERSUS_CATALOG = deriveCatalog("versus");

const SINGLEPLAYER_MODES_BY_ID = new Map(SINGLEPLAYER_CATALOG.map((mode) => [mode.id, mode]));

export function getSingleplayerMode(modeId) {
  const mode = SINGLEPLAYER_MODES_BY_ID.get(modeId);
  if (!mode) throw new Error(`Unknown single-player mode: ${modeId}`);
  return mode;
}

export function isSingleplayerModeId(modeId) {
  return SINGLEPLAYER_MODES_BY_ID.has(modeId);
}
