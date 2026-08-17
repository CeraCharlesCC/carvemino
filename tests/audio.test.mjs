import assert from "node:assert/strict";
import test from "node:test";

import { createAudioEngine } from "../src/audio/engine.js";

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

  connect() {}
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

test("audio lifecycle follows game state while BGM remains content-free", () => {
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
  const engine = createAudioEngine({ contextFactory: () => context });

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