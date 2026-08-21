import assert from "node:assert/strict";
import test from "node:test";

import { getSingleplayerMode } from "../src/app/catalog.js";
import { GameRuntime } from "../src/app/runtime.js";
import { createGameSession } from "../src/domain/game.js";
import { replaceGlobal } from "./helpers/globals.mjs";

test("runtime stops scheduling frames after game over", (t) => {
  const callbacks = [];
  replaceGlobal(t, "requestAnimationFrame", (callback) => {
    callbacks.push(callback);
    return callbacks.length;
  });
  replaceGlobal(t, "cancelAnimationFrame", () => {});

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

test("runtime event batches include views from immediately before and after their tick", () => {
  let value = 0;
  const batches = [];
  const session = {
    engine: { stepsPerSecond: 60 },
    game: { status: "playing" },
    step() {
      value += 1;
      return [{ type: "VALUE_CHANGED" }];
    },
    view: () => ({ value })
  };
  const runtime = new GameRuntime({
    session,
    onEvents(events, _game, feedbackViews) {
      batches.push({ events, feedbackViews });
    }
  });

  runtime.runOneTick();

  assert.equal(batches.length, 1);
  assert.deepEqual(batches[0].events, [{ type: "VALUE_CHANGED" }]);
  assert.deepEqual(batches[0].feedbackViews.beforeView, { value: 0 });
  assert.deepEqual(batches[0].feedbackViews.afterView, { value: 1 });
  assert(Object.isFrozen(batches[0].feedbackViews));
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
