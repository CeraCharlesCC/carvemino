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

  definition.simulation.lockDelayWorldTicks = 1;
  assert.notEqual(rules.simulation.lockDelayWorldTicks, 1);
  assert.equal(Object.isFrozen(rules), true);
  assert.equal(Object.isFrozen(rules.simulation), true);
  assert.equal(Object.isFrozen(rules.pieces.templates.I.cells), true);
  assert.equal(Object.isFrozen(rules.presentation.cellStyles[1]), true);
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
  delete incomplete.pieces;

  assert.throws(
    () => defineRules(incomplete),
    /rules\.pieces is required/
  );
});

test("rules definitions reject invalid semantic values", () => {
  const invalidTickRate = mutableCopy(CLASSIC_RULESET);
  invalidTickRate.simulation.stepsPerSecond = 0;
  assert.throws(
    () => defineRules(invalidTickRate),
    /rules\.simulation\.stepsPerSecond must be an integer >= 1/
  );

  const invalidRotation = mutableCopy(CLASSIC_RULESET);
  invalidRotation.pieces.templates.I.rotations = [0, 4];
  assert.throws(
    () => defineRules(invalidRotation),
    /rules\.pieces\.templates\.I\.rotations\[1\] must be an integer between 0 and 3/
  );

  const missingCellStyle = mutableCopy(CLASSIC_RULESET);
  delete missingCellStyle.presentation.cellStyles[1];
  assert.throws(
    () => defineRules(missingCellStyle),
    /rules\.presentation\.cellStyles\.1 is required for used cell value 1/
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
    assert.equal(Object.hasOwn(mode.rules, "attack"), false);
    assert.equal(Object.hasOwn(mode.rules, "garbage"), false);
    assert.equal(Object.hasOwn(mode.rules, "survival"), false);
  }
  assert.throws(() => getSingleplayerMode("unknown"), /Unknown single-player mode/);
});
