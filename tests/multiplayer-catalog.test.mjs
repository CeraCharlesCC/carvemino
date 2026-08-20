import assert from "node:assert/strict";
import test from "node:test";

import { SINGLEPLAYER_CATALOG, VERSUS_CATALOG } from "../src/app/catalog.js";

test("versus catalog derives each mode from the shared base registry", () => {
  assert.deepEqual(VERSUS_CATALOG.map((mode) => mode.id), ["classic", "carver"]);
  for (const mode of VERSUS_CATALOG) {
    const singleplayer = SINGLEPLAYER_CATALOG.find((candidate) => candidate.id === mode.id);
    assert.ok(singleplayer);
    assert.equal(Object.isFrozen(mode), true);
    assert.equal(Object.isFrozen(mode.rules), true);
    assert.equal(Object.isFrozen(mode.policy), true);
    assert.equal(mode.policy.kind, "versus");
    assert.equal(mode.rules, singleplayer.rules);
    assert.equal(mode.name, `${singleplayer.name} VS`);
    assert.match(mode.rules.id, new RegExp(mode.id));
    assert.match(mode.policy.id, new RegExp(mode.id));
  }
});

test("single-player and versus presentations keep their intended ordering and copy", () => {
  assert.deepEqual(SINGLEPLAYER_CATALOG.map((mode) => mode.id), ["carver", "classic"]);
  assert.deepEqual(VERSUS_CATALOG.map((mode) => mode.id), ["classic", "carver"]);
  assert.notEqual(VERSUS_CATALOG, SINGLEPLAYER_CATALOG);
  assert.equal(VERSUS_CATALOG[0].description, "Classic rules with line-clear attacks and garbage cancellation.");
  assert.equal(SINGLEPLAYER_CATALOG[0].description, "Chunky polyominoes, a taller dig site, and twice the carving budget.");
});
