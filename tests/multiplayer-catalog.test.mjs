import assert from "node:assert/strict";
import test from "node:test";

import { SINGLEPLAYER_CATALOG, VERSUS_CATALOG } from "../src/app/catalog.js";

test("versus catalog derives each mode from the shared base registry", () => {
  assert.deepEqual(
    new Set(VERSUS_CATALOG.map((mode) => mode.id)),
    new Set(SINGLEPLAYER_CATALOG.map((mode) => mode.id))
  );
  for (const mode of VERSUS_CATALOG) {
    const singleplayer = SINGLEPLAYER_CATALOG.find((candidate) => candidate.id === mode.id);
    assert.ok(singleplayer);
    assert.equal(Object.isFrozen(mode), true);
    assert.equal(Object.isFrozen(mode.rules), true);
    assert.equal(Object.isFrozen(mode.policy), true);
    assert.equal(mode.policy.kind, "versus");
    assert.equal(mode.rules.id, singleplayer.rules.id);
    assert.equal(mode.name, `${singleplayer.name} VS`);
    assert.match(mode.rules.id, new RegExp(mode.id));
    assert.match(mode.policy.id, new RegExp(mode.id));
  }
});

test("single-player and versus catalogs expose independent, usable presentation metadata", () => {
  assert.notEqual(VERSUS_CATALOG, SINGLEPLAYER_CATALOG);
  for (const mode of [...SINGLEPLAYER_CATALOG, ...VERSUS_CATALOG]) {
    assert.equal(typeof mode.name, "string");
    assert(mode.name.trim().length > 0);
    assert.equal(typeof mode.description, "string");
    assert(mode.description.trim().length > 0);
  }
});
