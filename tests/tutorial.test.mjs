import assert from "node:assert/strict";
import test from "node:test";

import { SINGLEPLAYER_CATALOG } from "../src/app/catalog.js";
import { GameRuntime } from "../src/app/runtime.js";
import { prepareTutorialRun } from "../src/app/tutorial-run.js";
import {
  FIRST_RUN_TUTORIAL_STORAGE_KEY,
  PROFILE_STORAGE_KEY,
  STARTUP_MANUAL_STORAGE_KEY,
  TUTORIAL_SEED
} from "../src/config.js";
import { createGameSession } from "../src/domain/game.js";
import {
  FIRST_RUN_STAGES,
  TUTORIAL_CLEAR_READING_DELAY_MS,
  createFirstRunTutorialStore,
  createTutorialCoordinator
} from "../src/ui/first-run-tutorial.js";
import { replaceGlobal } from "./helpers/globals.mjs";

function memoryStorage(entries = []) {
  const values = new Map(entries);
  return {
    values,
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, String(value)); }
  };
}

test("first-run state migrates legacy/manual and existing-profile installations to complete", () => {
  for (const entries of [
    [[STARTUP_MANUAL_STORAGE_KEY, "1"]],
    [[PROFILE_STORAGE_KEY, "{existing-profile}"]]
  ]) {
    const storage = memoryStorage(entries);
    const state = createFirstRunTutorialStore(storage);
    assert.equal(state.getStage(), FIRST_RUN_STAGES.complete);
    assert.equal(state.shouldShowMenuControls(), false);
    assert.equal(state.shouldOfferTutorial(), false);
    assert.equal(storage.values.get(FIRST_RUN_TUTORIAL_STORAGE_KEY), FIRST_RUN_STAGES.complete);
  }
});

test("fresh installs show menu controls once, then offer the tutorial only on first singleplayer request", () => {
  const storage = memoryStorage();
  const state = createFirstRunTutorialStore(storage);
  assert.equal(state.getStage(), FIRST_RUN_STAGES.fresh);
  assert.equal(state.shouldShowMenuControls(), true);
  assert.equal(state.shouldOfferTutorial(), false);

  state.acknowledgeMenu();
  assert.equal(state.shouldShowMenuControls(), false);
  assert.equal(state.shouldOfferTutorial(), true);

  state.acceptTutorial();
  assert.equal(state.getStage(), FIRST_RUN_STAGES.tutorialOfferResolved);
  assert.equal(state.shouldOfferTutorial(), false);

  state.completeTutorial();
  assert.equal(state.getStage(), FIRST_RUN_STAGES.complete);
});

test("declining the tutorial permanently resolves the one-time offer", () => {
  const storage = memoryStorage();
  const state = createFirstRunTutorialStore(storage);
  state.acknowledgeMenu();
  state.declineTutorial();
  assert.equal(state.getStage(), FIRST_RUN_STAGES.complete);
  assert.equal(state.shouldOfferTutorial(), false);

  const reloaded = createFirstRunTutorialStore(storage);
  assert.equal(reloaded.getStage(), FIRST_RUN_STAGES.complete);
  assert.equal(reloaded.shouldOfferTutorial(), false);
});

test("an interrupted accepted tutorial is treated as a resolved offer on next launch", () => {
  const storage = memoryStorage([[FIRST_RUN_TUTORIAL_STORAGE_KEY, FIRST_RUN_STAGES.tutorialOfferResolved]]);
  const state = createFirstRunTutorialStore(storage);
  assert.equal(state.getStage(), FIRST_RUN_STAGES.complete);
  assert.equal(state.shouldOfferTutorial(), false);
  assert.equal(storage.values.get(FIRST_RUN_TUTORIAL_STORAGE_KEY), FIRST_RUN_STAGES.complete);
});

test("tutorial run starts with a visible piece and leads to a line clear in both singleplayer rulesets", () => {
  assert.equal(TUTORIAL_SEED, 0x434d3934);
  for (const mode of SINGLEPLAYER_CATALOG) {
    const session = createGameSession({ seed: TUTORIAL_SEED, rules: mode.rules });
    const plan = prepareTutorialRun(session);
    let view = session.view();
    assert(view.focusedPiece, `${mode.id}: tutorial setup should spawn a focused piece`);
    assert(view.focusedPiece.y >= 6, `${mode.id}: tutorial piece should already be clearly visible below the guide`);

    for (const [index, target] of plan.cutTargets.entries()) {
      const events = session.step([{
        type: "SCULPT",
        pieceId: view.focusedPiece.id,
        x: target.x,
        y: target.y
      }]);
      assert(events.some((event) => event.type === "BLOCK_CARVED"), `${mode.id}: cut ${index + 1} should succeed`);
      view = session.view();
    }

    assert(view.scrap >= view.sculpt.fill.cost, `${mode.id}: two cuts should fund a fill`);
    const fillEvents = session.step([{
      type: "SCULPT",
      pieceId: view.focusedPiece.id,
      x: plan.fillTarget.x,
      y: plan.fillTarget.y
    }]);
    assert(fillEvents.some((event) => event.type === "BLOCK_FILLED"), `${mode.id}: fill should succeed`);

    while (session.game.worldHoldSteps > 0) session.step([]);
    const dropEvents = session.step([{ type: "HARD_DROP_FOCUSED" }]);
    assert(dropEvents.some((event) => event.type === "PIECE_HARD_DROPPED"), `${mode.id}: hard drop should succeed`);

    let cleared = false;
    for (let index = 0; index < 120 && !cleared; index += 1) {
      cleared = session.step([]).some((event) => event.type === "LINES_CLEARED");
    }
    assert.equal(cleared, true, `${mode.id}: tutorial drop should complete and clear a row`);
    assert.equal(session.view().totalLines, 1, `${mode.id}: tutorial should demonstrate the clear reward`);
  }
});

test("tutorial milestones advance on successful outcomes, never on invalid or unrelated activity", () => {
  const guides = [];
  let completed = 0;
  let released = 0;
  let releaseTask = null;
  let releaseDelay = null;
  const plan = {
    moveTarget: { x: 1, y: 0 },
    cutTargets: [{ x: 1, y: 0 }, { x: 0, y: 0 }],
    fillTarget: { x: 2, y: 0 }
  };
  const tutorial = createTutorialCoordinator({
    onGuide: (guide) => guides.push(guide),
    onRelease: () => { released += 1; },
    onComplete: () => { completed += 1; },
    scheduleRelease(task, delay) {
      releaseTask = task;
      releaseDelay = delay;
      return 42;
    }
  });

  tutorial.start(plan);
  assert.equal(tutorial.getStep(), "move");
  assert.equal(tutorial.handleAction("sculpt"), false);
  assert.equal(tutorial.getStep(), "move");
  assert.equal(tutorial.handleAction("cursorRight", { cursor: { x: 0, y: 0 } }), false);
  assert.equal(tutorial.handleAction("cursorRight", { cursor: plan.moveTarget }), true);
  assert.equal(tutorial.getStep(), "cut");

  tutorial.handleEvents([{ type: "BLOCK_CARVED", cell: { x: 9, y: 9 } }]);
  assert.equal(tutorial.getStep(), "cut");
  tutorial.handleEvents([{ type: "BLOCK_CARVED", cell: plan.cutTargets[0] }]);
  assert.equal(tutorial.getStep(), "moveSecond");
  assert.equal(tutorial.handleAction("cursorLeft", { cursor: { x: 9, y: 9 } }), false);
  assert.equal(tutorial.handleAction("cursorLeft", { cursor: plan.cutTargets[1] }), true);
  assert.equal(tutorial.getStep(), "cutAgain");
  tutorial.handleEvents([{ type: "BLOCK_CARVED", cell: plan.cutTargets[1] }]);
  assert.equal(tutorial.getStep(), "moveFill");
  assert.equal(tutorial.handleAction("cursorRight", { cursor: plan.fillTarget }), true);
  assert.equal(tutorial.getStep(), "fill");

  tutorial.handleEvents([{ type: "BLOCK_FILLED", cell: { x: 9, y: 9 } }]);
  assert.equal(tutorial.getStep(), "fill");
  tutorial.handleEvents([{ type: "BLOCK_FILLED", cell: plan.fillTarget }]);
  assert.equal(tutorial.getStep(), "drop");
  tutorial.handleEvents([{ type: "PIECE_HARD_DROPPED" }]);
  assert.equal(tutorial.getStep(), "clear");
  assert.equal(released, 0, "the completed row should remain visible while the player reads");
  assert.equal(releaseDelay, TUTORIAL_CLEAR_READING_DELAY_MS);
  releaseTask();
  assert.equal(released, 1);
  assert.equal(completed, 0);
  tutorial.handleEvents([{ type: "PIECE_LOCKED" }, { type: "LINES_CLEARED", count: 1 }]);
  assert.equal(completed, 1);
  assert.equal(tutorial.getStep(), null, "line clear should end the guided state immediately");
  tutorial.handleEvents([{ type: "LINES_CLEARED", count: 1 }]);
  assert.equal(completed, 1, "later normal-game clears must not complete the tutorial twice");
  assert.deepEqual(guides.map(({ step }) => step), [
    "move", "cut", "move-second", "cut-again", "move-fill", "fill", "drop", "clear"
  ]);
  assert.deepEqual(guides.map(({ messageKey }) => messageKey), [
    "tutorial.guide.move",
    "tutorial.guide.cut",
    "tutorial.guide.moveSecond",
    "tutorial.guide.cutAgain",
    "tutorial.guide.moveFill",
    "tutorial.guide.fill",
    "tutorial.guide.drop",
    "tutorial.guide.clear"
  ]);
  assert.deepEqual(
    guides.map(({ control }) => control),
    ["move", "sculpt", "move", "sculpt", "move", "sculpt", "drop", null]
  );

  tutorial.stop();
  tutorial.handleEvents([{ type: "LINES_CLEARED" }]);
  assert.equal(tutorial.getStep(), null, "abandoned tutorials must not react to later normal-game events");
  assert.equal(completed, 1);
});

test("tutorial drop holds the stepped GameRuntime for seven seconds before the line clear", (t) => {
  replaceGlobal(t, "requestAnimationFrame", () => 77);
  replaceGlobal(t, "cancelAnimationFrame", () => {});

  const mode = SINGLEPLAYER_CATALOG[0];
  const session = createGameSession({ seed: TUTORIAL_SEED, rules: mode.rules });
  const runtime = new GameRuntime({ session });
  runtime.runOneTick();
  assert.equal(runtime.running, false, "guided setup should remain stepped");

  let completed = 0;
  let releaseTask = null;
  const plan = {
    moveTarget: { x: 1, y: 0 },
    cutTargets: [{ x: 1, y: 0 }, { x: 0, y: 0 }],
    fillTarget: { x: 2, y: 0 }
  };
  const tutorial = createTutorialCoordinator({
    onRelease: () => runtime.start(),
    onComplete: () => { completed += 1; },
    scheduleRelease(task, delay) {
      assert.equal(delay, 7000);
      releaseTask = task;
      return 43;
    }
  });
  tutorial.start(plan);
  tutorial.handleAction("cursorRight", { cursor: plan.moveTarget });
  tutorial.handleEvents([{ type: "BLOCK_CARVED", cell: plan.cutTargets[0] }]);
  tutorial.handleAction("cursorLeft", { cursor: plan.cutTargets[1] });
  tutorial.handleEvents([{ type: "BLOCK_CARVED", cell: plan.cutTargets[1] }]);
  tutorial.handleAction("cursorRight", { cursor: plan.fillTarget });
  tutorial.handleEvents([{ type: "BLOCK_FILLED", cell: plan.fillTarget }]);
  tutorial.handleEvents([{ type: "PIECE_HARD_DROPPED" }]);

  assert.equal(runtime.running, false, "the completed tutorial row should pause for seven seconds");
  releaseTask();
  assert.equal(runtime.running, true);
  assert.equal(runtime.frameHandle, 77);
  assert.equal(completed, 0);
  tutorial.handleEvents([{ type: "LINES_CLEARED", count: 1 }]);
  assert.equal(completed, 1);
  runtime.stop();
});
