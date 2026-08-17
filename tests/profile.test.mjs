import assert from "node:assert/strict";
import test from "node:test";

import {
  ACHIEVEMENTS,
  DEFAULT_KEYBINDINGS,
  createProfileStore
} from "../src/app/profile.js";
import { createGame, stepGame } from "../src/domain/game.js";
import { createRulesForMode, getTemplateIds } from "../src/domain/rules.js";

class MemoryStorage {
  constructor() {
    this.values = new Map();
  }

  getItem(key) {
    return this.values.get(key) ?? null;
  }

  setItem(key, value) {
    this.values.set(key, String(value));
  }
}

test("classic and carver are independent data-driven rule templates", () => {
  const classic = createRulesForMode("classic");
  const carver = createRulesForMode("carver");

  assert.equal(classic.board.visibleHeight, 20);
  assert.equal(classic.sculpting.carveLimit, 2);
  assert.equal(carver.board.visibleHeight, 24);
  assert.equal(carver.sculpting.carveLimit, 4);
  assert.notDeepEqual(getTemplateIds(carver), getTemplateIds(classic));

  const game = createGame({ seed: 123, rules: carver });
  stepGame(game, [], carver);
  assert.equal(game.board.visibleHeight, 24);
  assert.equal(game.activePieces[0].carveLimit, 4);
  assert(getTemplateIds(carver).includes(game.activePieces[0].templateId));
});

test("profile stores independent high scores and persists them", () => {
  const storage = new MemoryStorage();
  const profile = createProfileStore(storage);

  assert.equal(profile.recordScore("classic", 1250), true);
  assert.equal(profile.recordScore("classic", 900), false);
  assert.equal(profile.recordScore("carver", 2100), true);

  const restored = createProfileStore(storage);
  assert.equal(restored.getHighScore("classic"), 1250);
  assert.equal(restored.getHighScore("carver"), 2100);
});

test("achievement events unlock once and persist", () => {
  const storage = new MemoryStorage();
  const profile = createProfileStore(storage);

  const result = profile.processGameEvents("classic", [
    { type: "BLOCK_CARVED", carved: 1, carveLimit: 2 },
    { type: "BLOCK_CARVED", carved: 2, carveLimit: 2 },
    { type: "LINES_CLEARED", count: 4 }
  ], 800);

  assert.deepEqual(
    new Set(result.unlocked.map((achievement) => achievement.id)),
    new Set([
      ACHIEVEMENTS.firstCut.id,
      ACHIEVEMENTS.fullCut.id,
      ACHIEVEMENTS.carvemino.id
    ])
  );

  const restored = createProfileStore(storage).getSnapshot();
  assert.equal(restored.achievements[ACHIEVEMENTS.carvemino.id].unlocked, true);
});

test("rebinding swaps collisions and reset restores defaults", () => {
  const profile = createProfileStore(new MemoryStorage());
  profile.setKeybinding("carve", DEFAULT_KEYBINDINGS.fill);
  let snapshot = profile.getSnapshot();
  assert.equal(snapshot.settings.keybindings.carve, DEFAULT_KEYBINDINGS.fill);
  assert.equal(snapshot.settings.keybindings.fill, DEFAULT_KEYBINDINGS.carve);

  profile.resetKeybindings();
  snapshot = profile.getSnapshot();
  assert.deepEqual(snapshot.settings.keybindings, DEFAULT_KEYBINDINGS);
});