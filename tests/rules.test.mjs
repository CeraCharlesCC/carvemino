import assert from "node:assert/strict";
import test from "node:test";

import { SINGLEPLAYER_CATALOG, getSingleplayerMode } from "../src/app/catalog.js";
import {
  defineRules,
  gravityIntervalWorldTicksForLevel,
  spawnIntervalWorldTicksForLevel
} from "../src/domain/rules.js";
import { CARVER_RULESET } from "../src/rulesets/carver.js";
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

  const invalidDropSamples = mutableCopy(CLASSIC_RULESET);
  invalidDropSamples.simulation.dropPositionSampleCount = 0;
  assert.throws(
    () => defineRules(invalidDropSamples),
    /rules\.simulation\.dropPositionSampleCount must be an integer >= 1/
  );

  const invalidFocusGrace = mutableCopy(CLASSIC_RULESET);
  invalidFocusGrace.simulation.focusGraceSteps = -1;
  assert.throws(
    () => defineRules(invalidFocusGrace),
    /rules\.simulation\.focusGraceSteps must be an integer >= 0/
  );

  const missingCellStyle = mutableCopy(CLASSIC_RULESET);
  delete missingCellStyle.presentation.cellStyles[1];
  assert.throws(
    () => defineRules(missingCellStyle),
    /rules\.presentation\.cellStyles\.1 is required for used cell value 1/
  );
});

test("classic spawn cadence eases smoothly toward 2.5 seconds at level 99", () => {
  const seconds = (level) => spawnIntervalWorldTicksForLevel(CLASSIC_RULESET, level) / 60;

  assert.equal(seconds(1), 8);
  assert.equal(seconds(99), 2.5);
  assert.equal(seconds(120), 2.5, "levels beyond the curve endpoint stay capped");

  assert(seconds(10) > 7.2 && seconds(10) < 7.3);
  assert(seconds(20) > 6.4 && seconds(20) < 6.6);
  assert(seconds(50) > 4.4 && seconds(50) < 4.5);
  assert(seconds(80) > 2.9 && seconds(80) < 3.0);

  let previous = spawnIntervalWorldTicksForLevel(CLASSIC_RULESET, 1);
  for (let level = 2; level <= 99; level += 1) {
    const current = spawnIntervalWorldTicksForLevel(CLASSIC_RULESET, level);
    assert(current <= previous, `spawn interval must not increase at level ${level}`);
    previous = current;
  }

  const tenLevelDrop = (startLevel) => (
    spawnIntervalWorldTicksForLevel(CLASSIC_RULESET, startLevel)
    - spawnIntervalWorldTicksForLevel(CLASSIC_RULESET, startLevel + 10)
  );
  assert(tenLevelDrop(1) > tenLevelDrop(31));
  assert(tenLevelDrop(31) > tenLevelDrop(61));
  assert(tenLevelDrop(61) > tenLevelDrop(81));
});

test("gravity follows each ruleset's configured curve and floor", () => {
  for (const rules of [CLASSIC_RULESET, CARVER_RULESET]) {
    const points = rules.progression.gravityCurve.points;

    for (const point of points) {
      assert.equal(
        gravityIntervalWorldTicksForLevel(rules, point.level),
        point.worldTicks,
        `gravity must pass through the configured point at level ${point.level}`
      );
    }

    for (let index = 1; index < points.length; index += 1) {
      const lower = points[index - 1];
      const upper = points[index];
      const midpointLevel = Math.floor((lower.level + upper.level) / 2);
      const progress = (midpointLevel - lower.level) / (upper.level - lower.level);
      const expected = Math.ceil(
        lower.worldTicks + (upper.worldTicks - lower.worldTicks) * progress
      );
      assert.equal(
        gravityIntervalWorldTicksForLevel(rules, midpointLevel),
        expected,
        `gravity must interpolate the configured curve at level ${midpointLevel}`
      );
    }

    const lastPoint = points.at(-1);
    assert.equal(
      gravityIntervalWorldTicksForLevel(rules, lastPoint.level + 21),
      rules.progression.gravityMinimumWorldTicks,
      "levels beyond the curve endpoint must stay at the configured floor"
    );

    let previous = gravityIntervalWorldTicksForLevel(rules, 1);
    for (let level = 2; level <= lastPoint.level + 21; level += 1) {
      const current = gravityIntervalWorldTicksForLevel(rules, level);
      assert(current <= previous, `gravity interval must not increase at level ${level}`);
      assert(
        current >= rules.progression.gravityMinimumWorldTicks,
        `gravity interval must respect its floor at level ${level}`
      );
      previous = current;
    }
  }
});

test("rules definitions reject piece rotations that cannot fit the configured board", () => {
  const tooNarrow = mutableCopy(CLASSIC_RULESET);
  tooNarrow.board.width = 3;
  assert.throws(
    () => defineRules(tooNarrow),
    /templates\.I rotation 0 has bounds 4x1 that do not fit rules\.board 3x24/
  );

  const tooShort = mutableCopy(CLASSIC_RULESET);
  tooShort.board.visibleHeight = 3;
  tooShort.board.hiddenHeight = 0;
  assert.throws(
    () => defineRules(tooShort),
    /templates\.I rotation 1 has bounds 1x4 that do not fit rules\.board 10x3/
  );
});

test("single-player catalog resolves registered modes and rejects unknown ids", () => {
  for (const mode of SINGLEPLAYER_CATALOG) {
    assert.equal(getSingleplayerMode(mode.id), mode);
  }
  assert.throws(() => getSingleplayerMode("unknown"), /Unknown single-player mode/);
});
