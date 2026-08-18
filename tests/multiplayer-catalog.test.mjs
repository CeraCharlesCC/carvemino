import assert from "node:assert/strict";
import test from "node:test";

import { SINGLEPLAYER_CATALOG } from "../src/app/catalog.js";
import {
  MULTIPLAYER_CATALOG,
  getMultiplayerMode,
  isMultiplayerModeId
} from "../src/app/multiplayer-catalog.js";

test("multiplayer catalog pairs each VS ruleset with its versus policy", () => {
  assert.deepEqual(MULTIPLAYER_CATALOG.map((mode) => mode.id), ["classic", "carver"]);
  for (const mode of MULTIPLAYER_CATALOG) {
    assert.equal(Object.isFrozen(mode), true);
    assert.equal(Object.isFrozen(mode.rules), true);
    assert.equal(Object.isFrozen(mode.policy), true);
    assert.equal(mode.policy.kind, "versus");
    assert.match(mode.rules.id, new RegExp(mode.id));
    assert.match(mode.policy.id, new RegExp(mode.id));
  }
});

test("multiplayer catalog is distinct from single-player profile modes", () => {
  assert.notEqual(MULTIPLAYER_CATALOG, SINGLEPLAYER_CATALOG);
  assert.equal(getMultiplayerMode("classic"), MULTIPLAYER_CATALOG[0]);
  assert.equal(isMultiplayerModeId("carver"), true);
  assert.equal(isMultiplayerModeId("missing"), false);
  assert.throws(() => getMultiplayerMode("missing"), /Unknown multiplayer mode/);
});