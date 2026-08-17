import assert from "node:assert/strict";
import test from "node:test";

import { CLASSIC_TEMPLATE } from "../src/templates/classic.js";
import { compileRules, createRules } from "../src/domain/rules.js";

test("rules compilation accepts valid partial overrides and freezes the result", () => {
  const rules = createRules({
    simulation: { lockDelayTicks: 1 },
    scoring: { carve: 12 }
  });

  assert.equal(rules.simulation.lockDelayTicks, 1);
  assert.equal(rules.simulation.ticksPerSecond, CLASSIC_TEMPLATE.simulation.ticksPerSecond);
  assert.equal(rules.scoring.carve, 12);
  assert.equal(Object.isFrozen(rules), true);
  assert.equal(Object.isFrozen(rules.simulation), true);
  assert.equal(Object.isFrozen(rules.pieces.templates.I.cells), true);
});

test("rules compilation rejects unknown override fields", () => {
  assert.throws(
    () => createRules({ simulation: { lockDelayTickz: 1 } }),
    /rules\.simulation\.lockDelayTickz is not a supported override/
  );
  assert.throws(
    () => createRules({ mystery: true }),
    /rules\.mystery is not a supported override/
  );
});

test("rules compilation rejects override type mismatches", () => {
  assert.throws(
    () => createRules({ board: { width: "10" } }),
    /rules\.board\.width must be a number/
  );
  assert.throws(
    () => createRules({ scoring: { lineClear: 100 } }),
    /rules\.scoring\.lineClear must be an array/
  );
});

test("rules compilation validates the complete template shape", () => {
  const incomplete = { ...CLASSIC_TEMPLATE };
  delete incomplete.garbage;

  assert.throws(
    () => compileRules(incomplete),
    /rules\.garbage is required/
  );
});

test("rules compilation rejects invalid semantic values", () => {
  assert.throws(
    () => createRules({ simulation: { ticksPerSecond: 0 } }),
    /rules\.simulation\.ticksPerSecond must be an integer >= 1/
  );
  assert.throws(
    () => createRules({ pieces: { templates: { I: { rotations: [0, 4] } } } }),
    /rules\.pieces\.templates\.I\.rotations\[1\] must be an integer between 0 and 3/
  );
});