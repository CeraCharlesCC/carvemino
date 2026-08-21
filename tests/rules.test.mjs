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
    ["invalid drop samples", (rules) => { rules.simulation.dropPosition.sampleCount = 0; }, /rules\.simulation\.dropPosition\.sampleCount must be an integer >= 1/],
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

test("carver drop placement mixes pressure balancing with occasional raw randomness", () => {
  const strategy = CARVER_RULESET.simulation.dropPosition;
  assert.equal(strategy.type, "leaky-coverage");
  assert(strategy.sampleCount > 1, "balancing should compare multiple candidates");
  assert(strategy.decayNumerator > 0 && strategy.decayNumerator < strategy.decayDenominator,
    "historical pressure should decay without disappearing immediately");
  assert(strategy.pressurePerCell > 0);
  assert(strategy.rawRandomNumerator > 0 && strategy.rawRandomNumerator < strategy.rawRandomDenominator,
    "the escape hatch should be possible without dominating placement");
});

test("curve progression follows fixed examples without mirroring the implementation formula", () => {
  const rules = {
    progression: {
      gravity: {
        type: "curve",
        points: [
          { level: 1, worldTicks: 20 },
          { level: 5, worldTicks: 12 },
          { level: 9, worldTicks: 8 }
        ]
      },
      spawn: {
        type: "curve",
        start: 600,
        min: 120,
        endLevel: 11,
        easeOutExponentMilli: 2000
      }
    }
  };

  assert.equal(gravityIntervalWorldTicksForLevel(rules, 1), 20);
  assert.equal(gravityIntervalWorldTicksForLevel(rules, 3), 16);
  assert.equal(gravityIntervalWorldTicksForLevel(rules, 5), 12);
  assert.equal(gravityIntervalWorldTicksForLevel(rules, 7), 10);
  assert.equal(gravityIntervalWorldTicksForLevel(rules, 20), 8);

  assert.equal(spawnIntervalWorldTicksForLevel(rules, 1), 600);
  assert.equal(spawnIntervalWorldTicksForLevel(rules, 6), 240);
  assert.equal(spawnIntervalWorldTicksForLevel(rules, 11), 120);
  assert.equal(spawnIntervalWorldTicksForLevel(rules, 20), 120);
});

test("configured progression curves remain monotonic and respect their configured floors", () => {
  for (const rules of [CLASSIC_RULESET, CARVER_RULESET]) {
    const gravityPoints = rules.progression.gravity.points;

    for (const point of gravityPoints) {
      assert.equal(
        gravityIntervalWorldTicksForLevel(rules, point.level),
        point.worldTicks,
        `gravity must pass through the configured point at level ${point.level}`
      );
    }

    const lastPoint = gravityPoints.at(-1);
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

    const spawn = rules.progression.spawn;
    const spawnFloor = spawn.min;
    previous = spawnIntervalWorldTicksForLevel(rules, 1);
    for (let level = 2; level <= spawn.endLevel + 21; level += 1) {
      const current = spawnIntervalWorldTicksForLevel(rules, level);
      assert(current <= previous, `spawn interval must not increase at level ${level}`);
      assert(current >= spawnFloor, `spawn interval must respect its floor at level ${level}`);
      previous = current;
    }
    assert.equal(spawnIntervalWorldTicksForLevel(rules, spawn.endLevel + 21), spawnFloor);
  }
});

test("single-player catalog resolves registered modes and rejects unknown ids", () => {
  for (const mode of SINGLEPLAYER_CATALOG) {
    assert.equal(getSingleplayerMode(mode.id), mode);
  }
  assert.throws(() => getSingleplayerMode("unknown"), /Unknown single-player mode/);
});
