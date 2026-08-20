import { defineRules } from "../../src/domain/rules.js";
import { CLASSIC_RULESET } from "../../src/rulesets/classic.js";

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (isPlainObject(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, clone(entry)]));
  }
  return value;
}

function merge(base, overrides) {
  const result = clone(base);
  for (const [key, override] of Object.entries(overrides)) {
    const replacesDiscriminatedVariant = isPlainObject(result[key])
      && isPlainObject(override)
      && Object.hasOwn(override, "type")
      && result[key].type !== override.type;
    result[key] = isPlainObject(result[key]) && isPlainObject(override) && !replacesDiscriminatedVariant
      ? merge(result[key], override)
      : clone(override);
  }
  return result;
}

export function makeTestRules(overrides = {}) {
  const definition = merge(CLASSIC_RULESET, overrides);
  definition.id = `test-rules:${JSON.stringify(overrides)}`;
  return defineRules(definition);
}
