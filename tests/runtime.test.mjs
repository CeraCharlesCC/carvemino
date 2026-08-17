import assert from "node:assert/strict";
import test from "node:test";

import { getSingleplayerMode } from "../src/app/catalog.js";
import { GameRuntime } from "../src/app/runtime.js";
import { createGame } from "../src/domain/game.js";

test("runtime stops scheduling frames after game over", () => {
  const previousRequest = globalThis.requestAnimationFrame;
  const previousCancel = globalThis.cancelAnimationFrame;
  const callbacks = [];
  globalThis.requestAnimationFrame = (callback) => {
    callbacks.push(callback);
    return callbacks.length;
  };
  globalThis.cancelAnimationFrame = () => {};

  try {
    const rules = getSingleplayerMode("classic").rules;
    const game = createGame({ seed: 1, rules });
    const runtime = new GameRuntime({ game, rules });

    runtime.start();
    assert.equal(callbacks.length, 1);
    game.status = "gameover";
    callbacks.shift()(0);

    assert.equal(runtime.running, false);
    assert.equal(runtime.frameHandle, null);
    assert.equal(callbacks.length, 0);
  } finally {
    globalThis.requestAnimationFrame = previousRequest;
    globalThis.cancelAnimationFrame = previousCancel;
  }
});

test("runtime replay commands are indexed by the fixed-step clock", () => {
  const rules = getSingleplayerMode("classic").rules;
  const game = createGame({ seed: 2, rules });
  const runtime = new GameRuntime({ game, rules });

  runtime.command({ type: "FOCUS_NEXT" });
  runtime.runOneTick();

  const replay = runtime.exportReplay(2);
  assert.equal(game.stepTick, 1);
  assert.deepEqual(replay.commands, [{ stepTick: 0, type: "FOCUS_NEXT" }]);
  assert.equal(Object.hasOwn(replay.commands[0], "tick"), false);
});
