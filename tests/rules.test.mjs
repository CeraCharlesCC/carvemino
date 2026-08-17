import assert from "node:assert/strict";
import test from "node:test";

import { SINGLEPLAYER_CATALOG, getSingleplayerMode } from "../src/app/catalog.js";
import { defineRules } from "../src/domain/rules.js";
import { CLASSIC_RULESET } from "../src/rulesets/classic.js";

function mutableCopy(value) {
  return JSON.parse(JSON.stringify(value));
}

test("rules definitions are validated, detached, and deeply frozen", () => {
  const definition = mutableCopy(CLASSIC_RULESET);
  definition.id = "test-rules-v1";
  const rules = defineRules(definition);

  definition.simulation.lockDelayTicks = 1;
  assert.notEqual(rules.simulation.lockDelayTicks, 1);
  assert.equal(Object.isFrozen(rules), true);
  assert.equal(Object.isFrozen(rules.simulation), true);
  assert.equal(Object.isFrozen(rules.pieces.templates.I.cells), true);
});

test("rules definitions reject mode metadata and unknown fields", () => {
  const withModeMetadata = mutableCopy(CLASSIC_RULESET);
  withModeMetadata.modeId = "classic";
  assert.throws(
    () => defineRules(withModeMetadata),
    /rules\.modeId is not a supported field/
  );

  const withUnknownField = mutableCopy(CLASSIC_RULESET);
  withUnknownField.simulation.lockDelayTickz = 1;
  assert.throws(
    () => defineRules(withUnknownField),
    /rules\.simulation\.lockDelayTickz is not a supported field/
  );
});

test("rules definitions validate the complete shape", () => {
  const incomplete = mutableCopy(CLASSIC_RULESET);
  delete incomplete.garbage;

  assert.throws(
    () => defineRules(incomplete),
    /rules\.garbage is required/
  );
});

test("rules definitions reject invalid semantic values", () => {
  const invalidTickRate = mutableCopy(CLASSIC_RULESET);
  invalidTickRate.simulation.ticksPerSecond = 0;
  assert.throws(
    () => defineRules(invalidTickRate),
    /rules\.simulation\.ticksPerSecond must be an integer >= 1/
  );

  const invalidRotation = mutableCopy(CLASSIC_RULESET);
  invalidRotation.pieces.templates.I.rotations = [0, 4];
  assert.throws(
    () => defineRules(invalidRotation),
    /rules\.pieces\.templates\.I\.rotations\[1\] must be an integer between 0 and 3/
  );
});

test("single-player catalog owns mode identity and points at complete rulesets", () => {
  assert.equal(Object.isFrozen(SINGLEPLAYER_CATALOG), true);
  assert.deepEqual(SINGLEPLAYER_CATALOG.map((mode) => mode.id), ["classic", "carver"]);
  assert.equal(new Set(SINGLEPLAYER_CATALOG.map((mode) => mode.id)).size, SINGLEPLAYER_CATALOG.length);
  assert.equal(new Set(SINGLEPLAYER_CATALOG.map((mode) => mode.rules.id)).size, SINGLEPLAYER_CATALOG.length);

  for (const mode of SINGLEPLAYER_CATALOG) {
    assert.equal(getSingleplayerMode(mode.id), mode);
    assert.equal(Object.hasOwn(mode.rules, "modeId"), false);
    assert.equal(Object.hasOwn(mode.rules, "name"), false);
    assert.equal(Object.hasOwn(mode.rules, "description"), false);
  }
  assert.throws(() => getSingleplayerMode("unknown"), /Unknown single-player mode/);
});
