import assert from "node:assert/strict";
import test from "node:test";

import { createAudioEngine } from "../src/audio/engine.js";

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

class FakeAudioParam {
  constructor() {
    this.values = [];
  }

  cancelScheduledValues(time) {
    this.values.push(["cancel", time]);
  }

  setValueAtTime(value, time) {
    this.values.push(["set", value, time]);
  }

  setTargetAtTime(value, time, constant) {
    this.values.push(["target", value, time, constant]);
  }

  exponentialRampToValueAtTime(value, time) {
    this.values.push(["ramp", value, time]);
  }
}

class FakeGain {
  constructor() {
    this.gain = new FakeAudioParam();
  }

  connect() {}
  disconnect() {}
}

class FakeOscillator {
  constructor() {
    this.frequency = new FakeAudioParam();
    this.type = "sine";
  }

  connect(target) {
    this.output = target;
  }
  disconnect() {}
  start() {}
  stop() {}
}

class FakeAudioContext {
  constructor() {
    this.currentTime = 10;
    this.state = "running";
    this.destination = {};
    this.oscillators = [];
  }

  createGain() {
    return new FakeGain();
  }

  createOscillator() {
    const oscillator = new FakeOscillator();
    this.oscillators.push(oscillator);
    return oscillator;
  }

  close() {}
}

function playedFrequencies(context) {
  return context.oscillators.map((oscillator) =>
    oscillator.frequency.values.find(([kind]) => kind === "set")?.[1]
  );
}

function playedPeaks(context) {
  return context.oscillators.map((oscillator) => {
    const envelope = oscillator.output;
    return envelope?.gain.values.find(([kind]) => kind === "ramp")?.[1];
  });
}

test("audio engine owns menu interaction beeps", () => {
  const context = new FakeAudioContext();
  const engine = createAudioEngine({ contextFactory: () => context });

  engine.setScreen("menu");
  engine.handleUiEvent("select");
  engine.handleUiEvent("confirm");
  engine.handleUiEvent("back");

  assert.deepEqual(playedFrequencies(context), [520, 330, 660, 440, 260]);
  assert.equal(engine.getState().lifecycle, "menu");
  assert.equal(engine.getState().music.scene, "menu");
});

test("sound effects use the boosted overall peak gain", () => {
  const context = new FakeAudioContext();
  const engine = createAudioEngine({ contextFactory: () => context });

  engine.handleUiEvent("select");

  assert.deepEqual(playedPeaks(context), [0.0576]);
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
  const context = new FakeAudioContext();
  const engine = createAudioEngine({
    contextFactory: () => context,
    musicController: createSilentMusicController()
  });

  engine.startGame({ modeId: "classic" });
  engine.handleGameEvents([
    { type: "PIECE_LOCKED", pieceId: 1 },
    { type: "LINES_CLEARED", count: 2 },
    { type: "LEVEL_CHANGED", level: 2 }
  ]);
  const clearFrequencies = playedFrequencies(context);
  assert(clearFrequencies.includes(480));
  assert(clearFrequencies.includes(660));
  assert(!clearFrequencies.includes(150));

  const beforeGameOver = context.oscillators.length;
  engine.handleGameEvents([
    { type: "BLOCK_CARVED" },
    { type: "PIECE_LOCKED" },
    { type: "GAME_OVER", reason: "lock-topout" }
  ]);
  const gameOverFrequencies = playedFrequencies(context).slice(beforeGameOver);
  assert.deepEqual(gameOverFrequencies, [420, 315, 210]);
});

test("muted SFX does not create an AudioContext", () => {
  let contextCreations = 0;
  const engine = createAudioEngine({
    contextFactory() {
      contextCreations += 1;
      return new FakeAudioContext();
    }
  });

  engine.setSettings({ sfxEnabled: false });
  engine.handleUiEvent("confirm");
  engine.handleGameEvents([{ type: "BLOCK_CARVED" }]);

  assert.equal(contextCreations, 0);
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
