import assert from "node:assert/strict";
import test from "node:test";

import {
  ACHIEVEMENTS,
  DEFAULT_AUDIO_SETTINGS,
  DEFAULT_KEYBINDINGS,
  createProfileStore
} from "../src/app/profile.js";
import { SINGLEPLAYER_CATALOG, getSingleplayerMode } from "../src/app/catalog.js";
import { createGameEngine } from "../src/domain/game.js";
import { getTemplateIds } from "../src/domain/rules.js";

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

test("classic and carver are independent catalog-backed rulesets", () => {
  const classic = getSingleplayerMode("classic").rules;
  const carver = getSingleplayerMode("carver").rules;

  assert.equal(classic.board.visibleHeight, 20);
  assert.equal(classic.sculpting.carveLimit, 2);
  assert.equal(carver.board.visibleHeight, 24);
  assert.equal(carver.sculpting.carveLimit, 4);
  assert.notDeepEqual(getTemplateIds(carver), getTemplateIds(classic));

  const engine = createGameEngine(carver);
  const game = engine.create({ seed: 123 });
  engine.step(game, []);
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

test("profile high scores are catalog-backed and reject unknown mode ids", () => {
  const storage = new MemoryStorage();
  const profile = createProfileStore(storage);
  const expected = Object.fromEntries(SINGLEPLAYER_CATALOG.map((mode) => [mode.id, 0]));
  assert.deepEqual(profile.getSnapshot().highScores, expected);

  assert.equal(profile.recordScore("typo-mode", 9999), false);
  assert.deepEqual(profile.getSnapshot().highScores, expected);
  assert.deepEqual(createProfileStore(storage).getSnapshot().highScores, expected);
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
  profile.setKeybinding("sculpt", DEFAULT_KEYBINDINGS.hardDrop);
  let snapshot = profile.getSnapshot();
  assert.equal(snapshot.settings.keybindings.sculpt, DEFAULT_KEYBINDINGS.hardDrop);
  assert.equal(snapshot.settings.keybindings.hardDrop, DEFAULT_KEYBINDINGS.sculpt);

  profile.resetKeybindings();
  snapshot = profile.getSnapshot();
  assert.deepEqual(snapshot.settings.keybindings, DEFAULT_KEYBINDINGS);
});

test("profiles with a non-current schema are reset instead of migrated", () => {
  const storage = new MemoryStorage();
  storage.setItem("carvemino-profile-v2", JSON.stringify({
    schemaVersion: 1,
    highScores: { classic: 99 },
    achievements: {},
    settings: {
      theme: "default",
      keybindings: DEFAULT_KEYBINDINGS,
      audio: DEFAULT_AUDIO_SETTINGS
    }
  }));

  const snapshot = createProfileStore(storage).getSnapshot();
  assert.equal(snapshot.schemaVersion, 2);
  assert.deepEqual(snapshot.highScores, { classic: 0, carver: 0 });
  assert.deepEqual(snapshot.settings.audio, DEFAULT_AUDIO_SETTINGS);
});

test("unknown fields invalidate the current profile schema instead of being normalized", () => {
  const storage = new MemoryStorage();
  const saved = createProfileStore(new MemoryStorage()).getSnapshot();
  saved.highScores.classic = 99;
  saved.settings.keybindings.restart = "KeyR";
  storage.setItem("carvemino-profile-v2", JSON.stringify(saved));

  const snapshot = createProfileStore(storage).getSnapshot();
  assert.equal(snapshot.highScores.classic, 0);
  assert.deepEqual(snapshot.settings.keybindings, DEFAULT_KEYBINDINGS);
});

test("audio settings persist and clamp volumes", () => {
  const storage = new MemoryStorage();
  const profile = createProfileStore(storage);
  assert.equal(profile.setAudioSetting("masterVolume", 2), true);
  assert.equal(profile.setAudioSetting("musicVolume", -1), true);
  assert.equal(profile.setAudioSetting("sfxVolume", 0.35), true);
  assert.equal(profile.setAudioSetting("musicEnabled", false), true);
  assert.equal(profile.setAudioSetting("sfxEnabled", false), true);
  assert.equal(profile.setAudioSetting("unknown", 1), false);

  const snapshot = createProfileStore(storage).getSnapshot();
  assert.equal(snapshot.settings.audio.masterVolume, 1);
  assert.equal(snapshot.settings.audio.musicVolume, 0);
  assert.equal(snapshot.settings.audio.sfxVolume, 0.35);
  assert.equal(snapshot.settings.audio.musicEnabled, false);
  assert.equal(snapshot.settings.audio.sfxEnabled, false);
});
