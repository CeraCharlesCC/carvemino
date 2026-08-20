import assert from "node:assert/strict";
import test from "node:test";

import { getSingleplayerMode } from "../src/app/catalog.js";
import { GameRuntime } from "../src/app/runtime.js";
import { createGameSession } from "../src/domain/game.js";

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
    const session = createGameSession({ seed: 1, rules });
    const { game } = session;
    const runtime = new GameRuntime({ session });

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

test("single-player frames do not compute or publish a state hash", () => {
  const metadata = [];
  let hashCalls = 0;
  const session = {
    engine: { stepsPerSecond: 60 },
    game: { status: "gameover" },
    step: () => [],
    view: () => ({ status: "gameover" }),
    hash() {
      hashCalls += 1;
      return "deadbeef";
    }
  };
  const runtime = new GameRuntime({
    session,
    onFrame(_view, meta) {
      metadata.push(meta);
    }
  });

  runtime.running = true;
  runtime.frame(0);

  assert.equal(hashCalls, 0);
  assert.equal(metadata.length, 1);
  assert.deepEqual(metadata[0], { interpolation: 0 });
});

test("runtime replay commands are indexed by the fixed-step clock", () => {
  const rules = getSingleplayerMode("classic").rules;
  const session = createGameSession({ seed: 2, rules });
  const { game } = session;
  const runtime = new GameRuntime({ session });

  runtime.command({ type: "FOCUS_NEXT" });
  runtime.runOneTick();

  const replay = runtime.exportReplay();
  assert.equal(game.stepTick, 1);
  assert.equal(replay.seed, 2);
  assert.equal(replay.rulesetId, rules.id);
  assert.deepEqual(replay.commands, [{ stepTick: 0, type: "FOCUS_NEXT" }]);
  assert.equal(Object.hasOwn(replay.commands[0], "tick"), false);
});
