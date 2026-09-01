import assert from "node:assert/strict";
import test from "node:test";

import { createAudioEngine } from "../src/audio/engine.js";
import { DEFAULT_AUDIO_SETTINGS } from "../src/config.js";
import { FakeAudioContext } from "./helpers/web-audio.mjs";

function createSilentMusicController() {
  let scene = "silent";
  let intensity = 1;
  return {
    attach() {},
    setScene(nextScene) { scene = nextScene; },
    setIntensity(nextIntensity) { intensity = nextIntensity; },
    stop() { scene = "silent"; },
    dispose() { scene = "silent"; },
    getState() { return { scene, intensity, attached: false }; }
  };
}

function createCueRecorder() {
  const cues = [];
  return {
    cues,
    cueProvider(name) {
      cues.push(name);
      return [];
    }
  };
}

test("audio engine starts from the shared application defaults", () => {
  const engine = createAudioEngine({ contextFactory: () => null });
  assert.deepEqual(engine.getState().settings, DEFAULT_AUDIO_SETTINGS);
});

test("audio engine routes menu interaction cues without pinning their tuning", () => {
  const recorder = createCueRecorder();
  const engine = createAudioEngine({
    contextFactory: () => null,
    musicController: createSilentMusicController(),
    cueProvider: recorder.cueProvider
  });

  engine.setScreen("menu");
  engine.handleUiEvent("select");
  engine.handleUiEvent("confirm");
  engine.handleUiEvent("back");

  assert.deepEqual(recorder.cues, ["menu-select", "menu-confirm", "menu-back"]);
  assert.equal(engine.getState().lifecycle, "menu");
  assert.equal(engine.getState().music.scene, "menu");
});

test("audio engine renders every tone supplied for a semantic cue", () => {
  const context = new FakeAudioContext();
  const engine = createAudioEngine({
    contextFactory: () => context,
    musicController: createSilentMusicController(),
    cueProvider(name) {
      assert.equal(name, "menu-confirm");
      return [
        { frequency: 330, duration: 0.04 },
        { frequency: 660, duration: 0.05 }
      ];
    }
  });

  engine.handleUiEvent("confirm");

  assert.equal(context.oscillators.length, 2);
});

test("audio lifecycle routes gameplay state and level into the BGM controller", () => {
  const engine = createAudioEngine({ contextFactory: () => null });

  engine.startGame({ modeId: "carver", level: 2 });
  assert.equal(engine.getState().lifecycle, "playing");
  assert.equal(engine.getState().music.scene, "gameplay");
  assert.equal(engine.getState().music.intensity, 2);

  engine.pauseGame();
  assert.equal(engine.getState().music.scene, "paused");

  engine.resumeGame();
  assert.equal(engine.getState().music.scene, "gameplay");

  engine.handleGameEvents([{ type: "LEVEL_CHANGED", level: 4 }]);
  assert.equal(engine.getState().music.intensity, 4);

  engine.handleGameEvents([{ type: "GAME_OVER", reason: "lock-topout" }]);
  assert.equal(engine.getState().lifecycle, "gameover");
  assert.equal(engine.getState().music.scene, "gameover");

  engine.setScreen("options");
  assert.equal(engine.getState().lifecycle, "menu");
  assert.equal(engine.getState().music.scene, "menu");
});

test("line clears coalesce the lock sound and game over supersedes other cues", () => {
  const recorder = createCueRecorder();
  const engine = createAudioEngine({
    contextFactory: () => null,
    musicController: createSilentMusicController(),
    cueProvider: recorder.cueProvider
  });

  engine.startGame({ modeId: "classic" });
  engine.handleGameEvents([
    { type: "PIECE_LOCKED", pieceId: 1 },
    { type: "LINES_CLEARED", count: 2 },
    { type: "LEVEL_CHANGED", level: 2 }
  ]);
  assert.deepEqual(
    recorder.cues,
    ["line-clear-2", "level-up"],
    "a line clear replaces the ordinary lock cue"
  );

  recorder.cues.length = 0;
  engine.handleGameEvents([
    { type: "BLOCK_CARVED" },
    { type: "PIECE_LOCKED" },
    { type: "GAME_OVER", reason: "lock-topout" }
  ]);
  assert.deepEqual(
    recorder.cues,
    ["game-over"],
    "game over suppresses lower-priority gameplay cues"
  );
});

test("fully muted audio does not create an AudioContext", () => {
  let contextCreations = 0;
  const engine = createAudioEngine({
    contextFactory() {
      contextCreations += 1;
      return new FakeAudioContext();
    }
  });

  engine.setSettings({ sfxEnabled: false, musicEnabled: false });
  engine.handleUiEvent("confirm");
  engine.handleGameEvents([{ type: "BLOCK_CARVED" }]);

  assert.equal(contextCreations, 0);
});

test("menu BGM can unlock from a menu interaction even when SFX is muted", () => {
  let contextCreations = 0;
  const context = new FakeAudioContext();
  const engine = createAudioEngine({
    contextFactory() {
      contextCreations += 1;
      return context;
    }
  });

  engine.setSettings({ sfxEnabled: false, musicEnabled: true, musicVolume: 0.5 });
  engine.setScreen("menu");
  engine.handleUiEvent("select");

  assert.equal(contextCreations, 1);
  assert.equal(engine.getState().music.scene, "menu");
  assert.equal(engine.getState().music.playing, true);
  engine.dispose();
});

test("gameplay can create the audio graph for music even when SFX is muted", () => {
  let contextCreations = 0;
  const engine = createAudioEngine({
    contextFactory() {
      contextCreations += 1;
      return new FakeAudioContext();
    },
    musicController: createSilentMusicController()
  });

  engine.setSettings({ sfxEnabled: false, musicEnabled: true, musicVolume: 0.5 });
  engine.startGame({ modeId: "classic", level: 1 });

  assert.equal(contextCreations, 1);
  assert.equal(engine.getState().music.scene, "gameplay");
});
