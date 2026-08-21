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

test("rules definitions reject invalid shapes and semantic values", () => {
  const cases = [
    ["mode metadata", (rules) => { rules.modeId = "classic"; }, /rules\.modeId is not a supported field/],
    ["unknown field", (rules) => { rules.simulation.lockDelayTickz = 1; }, /rules\.simulation\.lockDelayTickz is not a supported field/],
    ["missing required section", (rules) => { delete rules.pieces; }, /rules\.pieces is required/],
    ["invalid tick rate", (rules) => { rules.simulation.stepsPerSecond = 0; }, /rules\.simulation\.stepsPerSecond must be an integer >= 1/],
    ["invalid rotation", (rules) => { rules.pieces.templates.I.rotations = [0, 4]; }, /rules\.pieces\.templates\.I\.rotations\[1\] must be an integer between 0 and 3/],
    ["invalid drop samples", (rules) => { rules.simulation.dropPositionSampleCount = 0; }, /rules\.simulation\.dropPositionSampleCount must be an integer >= 1/],
    ["invalid focus grace", (rules) => { rules.simulation.focusGraceSteps = -1; }, /rules\.simulation\.focusGraceSteps must be an integer >= 0/],
    ["missing used cell style", (rules) => { delete rules.presentation.cellStyles[1]; }, /rules\.presentation\.cellStyles\.1 is required for used cell value 1/],
    ["curve-only field on gravity", (rules) => { rules.progression.gravity.step = 1; }, /rules\.progression\.gravity\.step is not a supported field/],
    [
      "curve-only field on linear spawn",
      (rules) => {
        rules.progression.spawn = { type: "linear", start: 540, step: 60, min: 90 };
        rules.progression.spawn.points = [{ level: 1, worldTicks: 480 }];
      },
      /rules\.progression\.spawn\.points is not a supported field/,
      CARVER_RULESET
    ],
    ["rotation wider than board", (rules) => { rules.board.width = 3; }, /templates\.I rotation 0 has bounds 4x1 that do not fit rules\.board 3x23/],
    ["rotation taller than board", (rules) => {
      rules.board.visibleHeight = 3;
      rules.board.hiddenHeight = 0;
    }, /templates\.I rotation 1 has bounds 1x4 that do not fit rules\.board 10x3/]
  ];

  for (const [name, mutate, expected, base = CLASSIC_RULESET] of cases) {
    const definition = mutableCopy(base);
    mutate(definition);
    assert.throws(() => defineRules(definition), expected, name);
  }
});

test("progression uses mutually exclusive discriminated gravity and spawn models", () => {
  assert.equal(CLASSIC_RULESET.progression.gravity.type, "curve");
  assert.equal(CLASSIC_RULESET.progression.spawn.type, "curve");
  assert.equal(CARVER_RULESET.progression.gravity.type, "curve");
  assert.equal(CARVER_RULESET.progression.spawn.type, "curve");

  for (const rules of [CLASSIC_RULESET, CARVER_RULESET]) {
    assert.equal(Object.hasOwn(rules.progression, "gravityStartWorldTicks"), false);
    assert.equal(Object.hasOwn(rules.progression, "gravityStepWorldTicks"), false);
    assert.equal(Object.hasOwn(rules.progression, "gravityMinimumWorldTicks"), false);
    assert.equal(Object.hasOwn(rules.progression, "spawnStartWorldTicks"), false);
    assert.equal(Object.hasOwn(rules.progression, "spawnStepWorldTicks"), false);
    assert.equal(Object.hasOwn(rules.progression, "spawnMinimumWorldTicks"), false);
  }

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

test("carver spawn cadence ramps concurrency gradually through level 22", () => {
  const seconds = (level) => spawnIntervalWorldTicksForLevel(CARVER_RULESET, level) / 60;

  assert.equal(seconds(1), 9);
  assert.equal(seconds(22), 1.5);
  assert.equal(seconds(99), 1.5, "levels beyond the curve endpoint stay capped");

  assert(seconds(7) > 4.5 && seconds(7) < 4.6);
  assert(seconds(11) > 2.8 && seconds(11) < 2.9);
  assert(seconds(15) > 1.8 && seconds(15) < 2.0);
  assert(seconds(19) > 1.5 && seconds(19) < 1.6);

  let previous = spawnIntervalWorldTicksForLevel(CARVER_RULESET, 1);
  for (let level = 2; level <= 22; level += 1) {
    const current = spawnIntervalWorldTicksForLevel(CARVER_RULESET, level);
    assert(current <= previous, `spawn interval must not increase at level ${level}`);
    previous = current;
  }
});

test("gravity follows each ruleset's configured curve and floor", () => {
  for (const rules of [CLASSIC_RULESET, CARVER_RULESET]) {
    const points = rules.progression.gravity.points;

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
      lastPoint.worldTicks,
      "levels beyond the curve endpoint must stay at the configured floor"
    );

    let previous = gravityIntervalWorldTicksForLevel(rules, 1);
    for (let level = 2; level <= lastPoint.level + 21; level += 1) {
      const current = gravityIntervalWorldTicksForLevel(rules, level);
      assert(current <= previous, `gravity interval must not increase at level ${level}`);
      assert(
        current >= lastPoint.worldTicks,
        `gravity interval must respect its floor at level ${level}`
      );
      previous = current;
    }
  }
});

test("single-player catalog resolves registered modes and rejects unknown ids", () => {
  for (const mode of SINGLEPLAYER_CATALOG) {
    assert.equal(getSingleplayerMode(mode.id), mode);
  }
  assert.throws(() => getSingleplayerMode("unknown"), /Unknown single-player mode/);
});
