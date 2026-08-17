import assert from "node:assert/strict";
import test from "node:test";

import { GameRuntime } from "../src/app/runtime.js";
import { createGame } from "../src/domain/game.js";
import { createRulesForMode } from "../src/domain/rules.js";

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
    const rules = createRulesForMode("classic");
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
