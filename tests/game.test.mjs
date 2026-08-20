import test from "node:test";
import assert from "node:assert/strict";

import { createGameEngine } from "../src/domain/game.js";
import { createMatch, getPlayerGame, stepMatch } from "../src/domain/match.js";
import { defineSurvivalPolicy } from "../src/domain/match/survival.js";
import { defineVersusPolicy } from "../src/domain/match/versus.js";
import { getTemplateBounds, getTemplateCells } from "../src/domain/rules.js";
import { makeTestRules } from "./helpers/rules.mjs";

const enginesByRulesetId = new Map();

function engineForRules(rules) {
  let engine = enginesByRulesetId.get(rules.id);
  if (!engine) {
    engine = createGameEngine(rules);
    enginesByRulesetId.set(rules.id, engine);
  }
  return engine;
}

function engineForState(state) {
  const engine = enginesByRulesetId.get(state.rulesetId);
  if (!engine) throw new Error(`No test engine registered for ${state.rulesetId}`);
  return engine;
}

function createGame({ seed = 1, rules }) {
  return engineForRules(rules).create({ seed });
}

function stepGame(state, commands, rules) {
  return engineForRules(rules).step(state, commands);
}

function getEditableFillCells(state, pieceId) {
  return engineForState(state).getEditableFillCells(state, pieceId);
}

function queueGarbage(state, packet) {
  return engineForState(state).queueGarbage(state, packet);
}

function cancelIncomingGarbage(state, rows) {
  return engineForState(state).cancelIncomingGarbage(state, rows);
}

function snapshotGame(state) {
  return engineForState(state).snapshot(state);
}

function restoreGame(snapshot) {
  const engine = enginesByRulesetId.get(snapshot.rulesetId);
  if (!engine) throw new Error(`No test engine registered for ${snapshot.rulesetId}`);
  return engine.restore(snapshot);
}

function hashGameState(state) {
  return engineForState(state).hash(state);
}

function assertGameState(state) {
  return engineForState(state).assert(state);
}

function viewGame(state) {
  return engineForState(state).view(state);
}

function spawnI(game, rules) {
  game.dropQueue[0].templateId = "I";
  game.dropQueue[0].rotation = 0;
  game.dropQueue[0].x = 3;
  stepGame(game, [], rules);
  assert.equal(game.activePieces.length, 1);
  return game.activePieces[0];
}

function deferSpawns(game) {
  const firstDeferredWorldTick = game.worldTick + 1000;
  const interval = 100;
  game.dropQueue.forEach((plan, index) => {
    plan.spawnAtWorldTick = firstDeferredWorldTick + index * interval;
  });
  game.nextScheduledSpawnWorldTick = firstDeferredWorldTick + game.dropQueue.length * interval;
}

function makePiece(rules, overrides = {}) {
  return {
    id: "test-piece",
    templateId: "I",
    rotation: 0,
    cellValue: 1,
    x: 0,
    y: 0,
    cells: [{ x: 0, y: 0 }],
    carved: 0,
    carveLimit: rules.sculpting.carveLimit,
    restingWorldTicks: 0,
    pendingLock: false,
    spawnIndex: 1,
    committed: false,
    ...overrides
  };
}

function setActivePieces(game, rules, pieces, focusedPieceId = pieces[0]?.id ?? null) {
  game.activePieces = pieces.map((piece, index) => makePiece(rules, {
    spawnIndex: index + 1,
    ...piece
  }));
  game.focusedPieceId = focusedPieceId;
  game.nextSpawnIndex = Math.max(
    game.nextSpawnIndex,
    ...game.activePieces.map((piece) => piece.spawnIndex + 1)
  );
}

function boardIndex(board, x, y) {
  return y * board.width + x;
}

function prepareTwoLineClear(game, rules) {
  const bottom = game.board.height - 1;
  game.worldTick = 1;
  deferSpawns(game);
  for (const y of [bottom - 1, bottom]) {
    for (let x = 1; x < game.board.width; x += 1) {
      game.board.cells[boardIndex(game.board, x, y)] = 1;
    }
  }
  setActivePieces(game, rules, [{
    id: "manual-clear",
    x: 0,
    y: bottom - 1,
    cells: [{ x: 0, y: 0 }, { x: 0, y: 1 }]
  }]);
}

// Engine ownership and presentation contracts.

test("same seed and command stream stays deterministic", () => {
  const rules = makeTestRules();
  const a = createGame({ seed: 123456, rules });
  const b = createGame({ seed: 123456, rules });

  for (let tick = 0; tick < 1200; tick += 1) {
    stepGame(a, [], rules);
    stepGame(b, [], rules);
    assert.equal(hashGameState(a), hashGameState(b), `desync at tick ${tick}`);
    if (a.status !== "playing") break;
  }
});

test("a game state can only be advanced by the engine that created it", () => {
  const rules = makeTestRules();
  const engine = createGameEngine(rules);
  const otherEngine = createGameEngine(rules);
  const game = engine.create({ seed: 99 });

  assert.throws(
    () => otherEngine.step(game, []),
    /not bound to engine/
  );

  const differentRulesEngine = createGameEngine(makeTestRules({ board: { visibleHeight: 21 } }));
  assert.throws(
    () => differentRulesEngine.step(game, []),
    /ruleset mismatch/
  );
});

test("game projection is a complete presentation contract without simulation bookkeeping", () => {
  const rules = makeTestRules();
  const game = createGame({ seed: 101, rules });
  const piece = spawnI(game, rules);
  game.scrap = rules.sculpting.fillCost;
  game.board.cells[boardIndex(game.board, 0, 0)] = 1;
  game.board.cells[boardIndex(game.board, 0, game.board.hiddenHeight)] = rules.pieces.garbageCellValue;
  queueGarbage(game, {
    id: "view-warning",
    rows: 3,
    applyAtWorldTick: game.worldTick + 100,
    seed: 9
  });

  const nextPlan = game.dropQueue[0];
  const expectedFillTargets = getEditableFillCells(game, piece.id);
  const view = viewGame(game);

  assert.deepEqual(Object.keys(view).sort(), [
    "activePieces",
    "board",
    "focusedPiece",
    "gameOverReason",
    "incomingGarbageRows",
    "level",
    "nextPiece",
    "score",
    "scrap",
    "sculpt",
    "status",
    "totalLines"
  ].sort());
  assert.deepEqual(view.board, {
    width: game.board.width,
    height: game.board.visibleHeight,
    cells: view.board.cells
  });
  assert.equal(view.board.cells.length, game.board.width * game.board.visibleHeight);
  assert.deepEqual(view.board.cells[0], rules.presentation.cellStyles[rules.pieces.garbageCellValue]);
  assert(!view.board.cells.some((style) => style?.fill === rules.presentation.cellStyles[1].fill),
    "hidden board rows are not projected");

  assert.deepEqual(Object.keys(view.focusedPiece).sort(), [
    "cells", "id", "pendingLock", "style", "x", "y"
  ]);
  assert.equal(view.focusedPiece.y, piece.y - game.board.hiddenHeight);
  assert.deepEqual(view.focusedPiece.style, rules.presentation.cellStyles[piece.cellValue]);
  for (const internalField of [
    "templateId", "rotation", "cellValue", "carved", "carveLimit",
    "restingWorldTicks", "spawnIndex", "committed"
  ]) {
    assert.equal(Object.hasOwn(view.focusedPiece, internalField), false);
  }

  assert.deepEqual(view.sculpt.carve.targets, piece.cells);
  assert.equal(view.sculpt.carve.remaining, piece.carveLimit - piece.carved);
  assert.equal(view.sculpt.carve.limit, piece.carveLimit);
  assert.equal(view.sculpt.fill.cost, rules.sculpting.fillCost);
  assert.deepEqual(view.sculpt.fill.targets, expectedFillTargets);

  assert.deepEqual(Object.keys(view.nextPiece).sort(), ["cells", "style", "x"]);
  assert.equal(view.nextPiece.x, nextPlan.x);
  assert.deepEqual(view.nextPiece.cells, getTemplateCells(rules, nextPlan.templateId, nextPlan.rotation));
  assert.deepEqual(
    view.nextPiece.style,
    rules.presentation.cellStyles[rules.pieces.templates[nextPlan.templateId].cellValue]
  );
  assert.equal(view.incomingGarbageRows, 3);

  game.scrap = rules.sculpting.fillCost - 1;
  assert.deepEqual(viewGame(game).sculpt.fill.targets, []);
});

// Sculpting and playfield timing.

test("carving may split a piece into disconnected regions", () => {
  const rules = makeTestRules();
  const game = createGame({ seed: 1, rules });
  const piece = spawnI(game, rules);

  stepGame(game, [{ type: "SCULPT", pieceId: piece.id, x: 1, y: 0 }], rules);
  stepGame(game, [{ type: "SCULPT", pieceId: piece.id, x: 2, y: 0 }], rules);

  assert.deepEqual(
    game.activePieces[0].cells,
    [{ x: 0, y: 0 }, { x: 3, y: 0 }]
  );
  assert.equal(game.activePieces.length, 1, "disconnected cells remain one falling object");
  assert.equal(game.scrap, 2);
  assertGameState(game);
});

test("sculpt fills only one empty orthogonal neighbor per command", () => {
  const rules = makeTestRules();
  const game = createGame({ seed: 2, rules });
  const piece = spawnI(game, rules);

  stepGame(game, [{ type: "SCULPT", pieceId: piece.id, x: 1, y: 0 }], rules);
  stepGame(game, [{ type: "SCULPT", pieceId: piece.id, x: 2, y: 0 }], rules);
  assert.equal(game.scrap, 2);

  const editable = getEditableFillCells(game, piece.id);
  assert(editable.some((cell) => cell.x === 1 && cell.y === 0));
  assert(!editable.some((cell) => cell.x === 1 && cell.y === 2));

  stepGame(game, [{ type: "SCULPT", pieceId: piece.id, x: 1, y: 2 }], rules);
  assert.equal(game.scrap, 2, "non-adjacent fill must be rejected");
  assert.equal(game.activePieces[0].cells.length, 2);

  stepGame(game, [{ type: "SCULPT", pieceId: piece.id, x: 1, y: 0 }], rules);
  assert.equal(game.scrap, 0);
  assert.equal(game.activePieces[0].cells.length, 3, "one fill command adds exactly one cell");
  assert(game.activePieces[0].cells.some((cell) => cell.x === 1 && cell.y === 0));
});

test("successful sculpt pauses the whole playfield timeline for the grace window", () => {
  const rules = makeTestRules();
  const game = createGame({ seed: 20, rules });
  game.worldTick = 20;
  deferSpawns(game);
  setActivePieces(game, rules, [
    {
      id: "focus",
      y: 5,
      cells: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }]
    },
    { id: "other", x: 9, y: 5 }
  ]);

  const events = stepGame(game, [{ type: "SCULPT", pieceId: "focus", x: 1, y: 0 }], rules);

  assert.equal(game.activePieces.find((piece) => piece.id === "other").y, 5);
  assert.equal(game.worldTick, 20, "the world clock pauses");
  assert.equal(game.worldHoldSteps, rules.simulation.operationGraceSteps - 1);
  assert(events.some((event) => event.type === "BLOCK_CARVED"));
  assert(!events.some((event) => event.type === "PIECE_MOVED"));

  for (let i = 1; i < rules.simulation.operationGraceSteps; i += 1) {
    stepGame(game, [], rules);
  }
  assert.equal(game.worldTick, 20);
  assert.equal(game.worldHoldSteps, 0);
  assert.equal(game.activePieces.find((piece) => piece.id === "other").y, 5);

  const resumed = stepGame(game, [], rules);
  assert.equal(game.worldTick, 21);
  assert.equal(game.activePieces.find((piece) => piece.id === "other").y, 6);
  assert(resumed.some((event) => event.type === "PIECE_MOVED" && event.pieceId === "other"));
});

test("successful continuous sculpting refreshes the full operation grace", () => {
  const rules = makeTestRules();
  const game = createGame({ seed: 21, rules });
  const piece = spawnI(game, rules);
  deferSpawns(game);

  stepGame(game, [{ type: "SCULPT", pieceId: piece.id, x: 1, y: 0 }], rules);
  assert.equal(game.worldHoldSteps, rules.simulation.operationGraceSteps - 1);

  stepGame(game, [{ type: "SCULPT", pieceId: piece.id, x: 2, y: 0 }], rules);
  assert.equal(
    game.worldHoldSteps,
    rules.simulation.operationGraceSteps - 1,
    "another successful edit refreshes the sculpt hold instead of merely preserving its remainder"
  );
});

test("focus switching adds a short hold but cannot freeze one world tick indefinitely", () => {
  const rules = makeTestRules();
  const game = createGame({ seed: 22, rules });
  game.worldTick = 20;
  deferSpawns(game);
  setActivePieces(game, rules, [
    { id: "first", y: 5 },
    { id: "second", x: 9, y: 5 }
  ]);

  stepGame(game, [{ type: "FOCUS_NEXT" }], rules);
  assert.equal(game.focusedPieceId, "second");
  assert.equal(game.worldTick, 20);
  assert.equal(game.worldHoldSteps, rules.simulation.focusGraceSteps - 1);
  assert.equal(game.lastFocusHoldWorldTick, 20);

  stepGame(game, [{ type: "FOCUS_NEXT" }], rules);
  assert.equal(game.focusedPieceId, "first");
  assert.equal(game.worldTick, 20);
  assert.equal(game.worldHoldSteps, 0, "switching during the hold does not refresh it");

  stepGame(game, [{ type: "FOCUS_NEXT" }], rules);
  assert.equal(game.focusedPieceId, "second");
  assert.equal(game.worldTick, 21, "the same world tick must advance before Focus can pause again");

  stepGame(game, [{ type: "FOCUS_NEXT" }], rules);
  assert.equal(game.worldTick, 21);
  assert.equal(game.lastFocusHoldWorldTick, 21);
});

test("global grace defers scheduled spawns and garbage", () => {
  const rules = makeTestRules({ simulation: { operationGraceSteps: 2 } });
  const game = createGame({ seed: 24, rules });
  game.worldTick = 20;
  game.dropQueue[0].spawnAtWorldTick = 20;
  game.dropQueue[1].spawnAtWorldTick = 1000;
  game.nextScheduledSpawnWorldTick = 1480;
  setActivePieces(game, rules, [{
    id: "focus",
    y: 5,
    cells: [{ x: 0, y: 0 }, { x: 1, y: 0 }],
  }]);
  assert.equal(queueGarbage(game, {
    id: "due-during-hold",
    sourcePlayerId: "opponent",
    rows: 1,
    applyAtWorldTick: 20,
    seed: 7
  }), true);

  const sculpted = stepGame(game, [
    { type: "SCULPT", pieceId: "focus", x: 1, y: 0 }
  ], rules);
  const held = stepGame(game, [], rules);

  assert(![...sculpted, ...held].some((event) => (
    event.type === "PIECE_SPAWNED" || event.type === "GARBAGE_APPLIED"
  )));
  assert.equal(game.worldTick, 20);
  assert.equal(game.dropQueue[0].spawnAtWorldTick, 20);
  assert.equal(game.incomingGarbage.length, 1);

  const resumed = stepGame(game, [], rules);
  assert(resumed.some((event) => event.type === "PIECE_SPAWNED"));
  assert(resumed.some((event) => event.type === "GARBAGE_APPLIED"));
  assert.equal(game.incomingGarbage.length, 0);
});

test("invalid sculpt does not suppress gravity", () => {
  const rules = makeTestRules();
  const game = createGame({ seed: 21, rules });
  game.worldTick = 20;
  deferSpawns(game);
  setActivePieces(game, rules, [
    {
      id: "focus",
      y: 5,
      cells: [{ x: 0, y: 0 }, { x: 1, y: 0 }]
    },
    { id: "other", x: 9, y: 5 }
  ]);

  const events = stepGame(game, [{ type: "SCULPT", pieceId: "focus", x: 5, y: 5 }], rules);

  assert.equal(game.activePieces.find((piece) => piece.id === "other").y, 6);
  assert(!events.some((event) => event.type === "BLOCK_CARVED" || event.type === "BLOCK_FILLED"));
  assert(events.some((event) => event.type === "PIECE_MOVED" && event.pieceId === "other"));
});

// Locking, focus, and hard-drop behavior.

test("natural lock becomes pending while the whole playfield pauses", () => {
  const rules = makeTestRules();
  const game = createGame({ seed: 22, rules });
  const bottom = game.board.height - 1;
  game.worldTick = 20;
  deferSpawns(game);
  setActivePieces(game, rules, [
    {
      id: "locking",
      y: bottom,
      restingWorldTicks: rules.simulation.lockDelayWorldTicks - 1,
      committed: true
    },
    { id: "falling", x: 9, y: 5 }
  ], "falling");

  const events = stepGame(game, [], rules);

  assert(events.some((event) => event.type === "PIECE_LOCK_PENDING"
    && event.pieceId === "locking"));
  assert(!events.some((event) => event.type === "PIECE_LOCKED"));
  assert.equal(game.activePieces.find((piece) => piece.id === "locking").pendingLock, true);
  assert.equal(game.activePieces.find((piece) => piece.id === "falling").y, 5);
  assert.equal(game.worldTick, 20);
  assert(!events.some((event) => event.type === "PIECE_MOVED"));

  for (let i = 1; i < rules.simulation.operationGraceSteps; i += 1) {
    const held = stepGame(game, [], rules);
    assert(!held.some((event) => event.type === "PIECE_LOCKED"));
  }

  const locked = stepGame(game, [], rules);
  assert(locked.some((event) => event.type === "PIECE_LOCKED"
    && event.pieceId === "locking"));
  assert.equal(game.activePieces.find((piece) => piece.id === "falling").y, 5);
  assert.equal(game.worldTick, 20, "lock resolution does not consume world time");
  assert(!locked.some((event) => event.type === "PIECE_SPAWNED"),
    "another useful active piece keeps the scheduled spawn cadence");
});

test("natural lock immediately spawns a replacement when no useful piece remains", () => {
  const rules = makeTestRules();
  const game = createGame({ seed: 28, rules });
  const bottom = game.board.height - 1;
  game.worldTick = 20;
  deferSpawns(game);
  setActivePieces(game, rules, [{
    id: "last-useful",
    y: bottom,
    restingWorldTicks: rules.simulation.lockDelayWorldTicks - 1
  }]);

  stepGame(game, [], rules);
  for (let i = 1; i < rules.simulation.operationGraceSteps; i += 1) {
    const held = stepGame(game, [], rules);
    assert(!held.some((event) => event.type === "PIECE_SPAWNED"));
  }

  const resolved = stepGame(game, [], rules);
  const spawned = resolved.find((event) => event.type === "PIECE_SPAWNED");

  assert(resolved.some((event) => event.type === "PIECE_LOCKED"
    && event.pieceId === "last-useful"));
  assert(spawned, "replacement spawns on the natural-lock resolution step");
  assert.equal(game.focusedPieceId, spawned.pieceId);
  assert.equal(game.worldTick, 20, "replacement spawn does not add post-lock world delay");
  assertGameState(game);
});

test("natural lock without operation grace also spawns a replacement immediately", () => {
  const rules = makeTestRules({ simulation: { operationGraceSteps: 0 } });
  const game = createGame({ seed: 29, rules });
  const bottom = game.board.height - 1;
  game.worldTick = 20;
  deferSpawns(game);
  setActivePieces(game, rules, [{
    id: "instant-lock",
    y: bottom,
    restingWorldTicks: rules.simulation.lockDelayWorldTicks - 1
  }]);

  const events = stepGame(game, [], rules);
  const spawned = events.find((event) => event.type === "PIECE_SPAWNED");

  assert(events.some((event) => event.type === "PIECE_LOCKED"
    && event.pieceId === "instant-lock"));
  assert(spawned);
  assert.equal(game.focusedPieceId, spawned.pieceId);
  assertGameState(game);
});

test("an ordinary gravity landing reaches pending lock without pulse alignment", () => {
  const rules = makeTestRules({
    simulation: { lockDelayWorldTicks: 4, operationGraceSteps: 3 },
    progression: {
      gravity: { type: "linear", start: 2, step: 0, min: 2 },
      spawn: { type: "linear", start: 1000, step: 0, min: 1000 }
    }
  });
  const game = createGame({ seed: 26, rules });
  let pendingEvent = null;

  for (let i = 0; i < 100 && !pendingEvent; i += 1) {
    pendingEvent = stepGame(game, [], rules)
      .find((event) => event.type === "PIECE_LOCK_PENDING") || null;
  }

  assert(pendingEvent, "a naturally falling piece should enter pending lock");
  const pending = game.activePieces.find((piece) => piece.id === pendingEvent.pieceId);
  assert(pending);
  assert.equal(pending.pendingLock, true);
  assert.equal(game.worldHoldSteps, rules.simulation.operationGraceSteps - 1);
});

test("sculpt can edit a pending piece and refreshes the global grace", () => {
  const rules = makeTestRules();
  const game = createGame({ seed: 23, rules });
  const bottom = game.board.height - 1;
  game.worldTick = 20;
  deferSpawns(game);
  setActivePieces(game, rules, [
    {
      id: "editing",
      y: bottom,
      cells: [{ x: 0, y: 0 }, { x: 1, y: 0 }],
      restingWorldTicks: rules.simulation.lockDelayWorldTicks - 1
    },
    { id: "falling", x: 9, y: 5 }
  ]);

  stepGame(game, [], rules);
  assert.equal(game.activePieces.find((piece) => piece.id === "editing").pendingLock, true);

  const events = stepGame(game, [
    { type: "SCULPT", pieceId: "editing", x: 1, y: 0 }
  ], rules);

  const editing = game.activePieces.find((piece) => piece.id === "editing");
  assert(events.some((event) => event.type === "BLOCK_CARVED"));
  assert(editing);
  assert.equal(editing.pendingLock, false);
  assert.equal(editing.restingWorldTicks, 0);
  assert.equal(game.worldHoldSteps, rules.simulation.operationGraceSteps - 1);
  assert.equal(game.activePieces.find((piece) => piece.id === "falling").y, 5);
});

test("hard drop moves the focused piece to its lowest available position", () => {
  const rules = makeTestRules();
  const game = createGame({ seed: 22, rules });
  const piece = spawnI(game, rules);
  const startY = piece.y;

  const events = stepGame(game, [{ type: "HARD_DROP_FOCUSED" }], rules);
  const dropped = game.activePieces.find((active) => active.id === piece.id);

  assert(dropped);
  assert(dropped.y > startY);
  assert.equal(dropped.y, game.board.height - 1);
  assert(events.some((event) => event.type === "PIECE_HARD_DROPPED"
    && event.pieceId === piece.id
    && event.distance === dropped.y - startY));
  assert.equal(dropped.committed, true);
  assert.notEqual(game.focusedPieceId, piece.id, "commit moves focus off the dropped piece");
  assert(events.some((event) => event.type === "PIECE_SPAWNED"
    && event.pieceId === game.focusedPieceId), "commit spawns and focuses a replacement when needed");
  assertGameState(game);
});

test("hard drop cannot move the playfield while an operation grace hold is active", () => {
  const rules = makeTestRules({ simulation: { operationGraceSteps: 3 } });
  const game = createGame({ seed: 27, rules });
  const piece = spawnI(game, rules);

  stepGame(game, [{ type: "SCULPT", pieceId: piece.id, x: 1, y: 0 }], rules);
  const heldWorldTick = game.worldTick;
  const heldY = piece.y;
  assert(game.worldHoldSteps > 0);

  const events = stepGame(game, [{ type: "HARD_DROP_FOCUSED" }], rules);

  assert.equal(piece.y, heldY);
  assert.equal(game.worldTick, heldWorldTick);
  assert(!events.some((event) => event.type === "PIECE_HARD_DROPPED"));
});

test("commit focuses another useful active piece without spawning an extra one", () => {
  const rules = makeTestRules();
  const game = createGame({ seed: 23, rules });
  deferSpawns(game);
  setActivePieces(game, rules, [
    { id: "older", y: 5 },
    { id: "newer", x: 9, y: 3 }
  ]);

  const events = stepGame(game, [{ type: "HARD_DROP_FOCUSED" }], rules);

  assert.equal(game.focusedPieceId, "newer");
  assert.equal(game.activePieces.find((piece) => piece.id === "older").committed, true);
  assert.equal(game.activePieces.find((piece) => piece.id === "newer").y, 4,
    "hard drop does not suppress the gravity pulse");
  assert(!events.some((event) => event.type === "PIECE_SPAWNED"));
});

// Drop planning and garbage behavior.

test("drop planning uses extra samples to avoid covered columns and caps its history", () => {
  const history = Array.from({ length: 5 }, () => ({ templateId: "O", rotation: 0, x: 0 }));

  const planWithSamples = (dropPositionSampleCount) => {
    const rules = makeTestRules({
      simulation: { dropCoverageHistoryLength: history.length, dropPositionSampleCount }
    });
    const game = createGame({ seed: 24, rules });
    game.dropQueue = [];
    game.dropCoverageHistory = history.map((plan) => ({ ...plan }));
    game.random.drops.state = 1;
    game.nextScheduledSpawnWorldTick = game.worldTick + 100;

    stepGame(game, [], rules);

    const plan = game.dropQueue[0];
    const coverage = Array(game.board.width).fill(0);
    for (const historyPlan of history) {
      for (const cell of getTemplateCells(rules, historyPlan.templateId, historyPlan.rotation)) {
        coverage[historyPlan.x + cell.x] += 1;
      }
    }
    const coverageScore = getTemplateCells(rules, plan.templateId, plan.rotation)
      .reduce((sum, cell) => sum + coverage[plan.x + cell.x], 0);
    return { game, plan, coverageScore };
  };

  const singleSample = planWithSamples(1);
  const balanced = planWithSamples(3);
  assert(balanced.coverageScore < singleSample.coverageScore);
  assert.equal(balanced.game.dropCoverageHistory.length, history.length);
  const newestPlan = balanced.game.dropQueue.at(-1);
  assert.deepEqual(
    balanced.game.dropCoverageHistory.at(-1),
    { templateId: newestPlan.templateId, rotation: newestPlan.rotation, x: newestPlan.x }
  );
});

test("template rotation produces normalized unique orientations", () => {
  const rules = makeTestRules();
  assert.deepEqual(getTemplateCells(rules, "I", 1), [
    { x: 0, y: 0 },
    { x: 0, y: 1 },
    { x: 0, y: 2 },
    { x: 0, y: 3 }
  ]);
  assert.deepEqual(getTemplateBounds(rules, "I", 1), { width: 1, height: 4 });
  assert.deepEqual(getTemplateCells(rules, "O", 3), getTemplateCells(rules, "O", 0));
});

test("planned rotation is fixed before spawn and used by the spawned piece", () => {
  const rules = makeTestRules();
  const game = createGame({ seed: 25, rules });
  const plan = game.dropQueue[0];
  plan.templateId = "I";
  plan.rotation = 1;
  plan.x = game.board.width - 1;

  stepGame(game, [], rules);

  const piece = game.activePieces.find((active) => active.id === plan.pieceId);
  assert(piece);
  assert.equal(piece.rotation, 1);
  assert.equal(piece.x, game.board.width - 1);
  assert.deepEqual(piece.cells, getTemplateCells(rules, "I", 1));
  assertGameState(game);
});

test("garbage is queued, cancellable, and duplicate ids are rejected", () => {
  const rules = makeTestRules();
  const game = createGame({ seed: 3, rules });

  assert.equal(queueGarbage(game, {
    id: "g1",
    sourcePlayerId: "opponent",
    rows: 4,
    applyAtWorldTick: 100,
    seed: 99
  }), true);
  assert.equal(queueGarbage(game, {
    id: "g1",
    sourcePlayerId: "opponent",
    rows: 4,
    applyAtWorldTick: 100,
    seed: 99
  }), false);

  const result = cancelIncomingGarbage(game, 2);
  assert.deepEqual(result, { cancelled: 2, remaining: 0 });
  assert.equal(game.incomingGarbage[0].rows, 2);
  assert.equal(queueGarbage(game, { id: "bad-rows", rows: 0, applyAtWorldTick: 1, seed: 1 }), false);
  assert.equal(queueGarbage(game, { id: "bad-tick", rows: 1, applyAtWorldTick: -1, seed: 1 }), false);
  assert.equal(queueGarbage(game, { id: "bad-seed", rows: 1, applyAtWorldTick: 1, seed: -1 }), false);
});

// Snapshot round trips and hostile-input validation.

test("snapshot round trip preserves deterministic hash", () => {
  const rules = makeTestRules();
  const game = createGame({ seed: 4, rules });
  for (let i = 0; i < 120; i += 1) stepGame(game, [], rules);
  const snapshot = snapshotGame(game);
  const restored = restoreGame(snapshot);
  assert.equal(Object.hasOwn(game, "schemaVersion"), false, "live state must not carry snapshot metadata");
  assert.equal(Number.isInteger(snapshot.schemaVersion), true, "snapshots retain their boundary schema version");
  assert.equal(Object.hasOwn(restored, "schemaVersion"), false, "restored live state strips snapshot metadata");
  assert.equal(hashGameState(restored), hashGameState(game));
  assertGameState(restored);
});

test("snapshots contain only random streams consumed by simulation", () => {
  const rules = makeTestRules();
  const snapshot = snapshotGame(createGame({ seed: 27, rules }));
  assert.deepEqual(Object.keys(snapshot.random).sort(), ["drops", "pieces", "rotations"]);

  snapshot.random.garbage = { state: 1 };
  assert.throws(() => restoreGame(snapshot), /snapshot\.random\.garbage is not supported/);
});

test("snapshot round trip preserves a pending lock and global grace", () => {
  const rules = makeTestRules();
  const game = createGame({ seed: 25, rules });
  const bottom = game.board.height - 1;
  game.worldTick = 20;
  deferSpawns(game);
  setActivePieces(game, rules, [{
    id: "pending",
    y: bottom,
    restingWorldTicks: rules.simulation.lockDelayWorldTicks - 1
  }]);

  stepGame(game, [], rules);
  const restored = restoreGame(snapshotGame(game));

  assert.equal(restored.activePieces[0].pendingLock, true);
  assert.equal(restored.worldHoldSteps, rules.simulation.operationGraceSteps - 1);
  assert.equal(hashGameState(restored), hashGameState(game));

  for (let i = 0; i <= rules.simulation.operationGraceSteps; i += 1) {
    assert.deepEqual(stepGame(restored, [], rules), stepGame(game, [], rules));
    assert.equal(hashGameState(restored), hashGameState(game));
  }
});

test("snapshot round trip preserves terminal garbage-push state", () => {
  const rules = makeTestRules();
  const engine = engineForRules(rules);
  const game = engine.create({ seed: 31 });
  engine.step(game, []);
  assert.equal(engine.queueGarbage(game, {
    id: "push-out",
    sourcePlayerId: "remote",
    rows: 2,
    applyAtWorldTick: game.worldTick,
    seed: 17
  }), true);

  engine.step(game, []);
  assert.equal(game.status, "gameover");
  assert.equal(game.gameOverReason, "garbage-pushed-piece-out");
  assert(game.activePieces.some((piece) => piece.cells.some((cell) => piece.y + cell.y < 0)));

  const restored = engine.restore(engine.snapshot(game));
  assert.equal(engine.hash(restored), engine.hash(game));
  assert.equal(restored.gameOverReason, "garbage-pushed-piece-out");
});

test("restore rejects snapshots from a non-current schema instead of migrating them", () => {
  const rules = makeTestRules();
  const snapshot = snapshotGame(createGame({ seed: 26, rules }));
  delete snapshot.stepTick;
  snapshot.version = 1;
  delete snapshot.schemaVersion;

  assert.throws(() => restoreGame(snapshot), /snapshot\.version is not supported|schemaVersion is required/);
});

test("restore rejects malformed or hostile snapshot state before constructing a live game", () => {
  const rules = makeTestRules();
  const engine = engineForRules(rules);
  const game = engine.create({ seed: 28 });
  engine.step(game, []);
  engine.queueGarbage(game, {
    id: "snapshot-garbage",
    sourcePlayerId: "remote",
    rows: 2,
    applyAtWorldTick: 100,
    seed: 44
  });
  const base = engine.snapshot(game);
  const clone = () => JSON.parse(JSON.stringify(base));

  const cases = [
    ["unknown top-level field", (snapshot) => { snapshot.hostile = true; }, /snapshot\.hostile is not supported/],
    ["rules-bound board width", (snapshot) => { snapshot.board.width += 1; }, /must match ruleset width/],
    ["board cell count", (snapshot) => { snapshot.board.cells.pop(); }, /must contain exactly/],
    ["board cell range", (snapshot) => { snapshot.board.cells[0] = 256; }, /snapshot\.board\.cells\[0\]/],
    ["board cell values", (snapshot) => { snapshot.board.cells[0] = 99; }, /unsupported cell value/],
    ["world clock", (snapshot) => { snapshot.worldTick = -1; }, /snapshot\.worldTick/],
    ["score counter", (snapshot) => { snapshot.score = 1.5; }, /snapshot\.score/],
    ["drop queue shape", (snapshot) => { delete snapshot.dropQueue[0].rotation; }, /dropQueue\[0\]\.rotation is required/],
    ["drop queue placement", (snapshot) => { snapshot.dropQueue[0].x = snapshot.board.width; }, /dropQueue\[0\]\.x/],
    ["piece template", (snapshot) => { snapshot.activePieces[0].templateId = "NOPE"; }, /templateId is unknown/],
    ["piece boolean", (snapshot) => { snapshot.activePieces[0].pendingLock = 0; }, /pendingLock must be a boolean/],
    ["random stream range", (snapshot) => { snapshot.random.pieces.state = 0; }, /random\.pieces\.state/],
    ["garbage packet range", (snapshot) => { snapshot.incomingGarbage[0].rows = 0; }, /incomingGarbage\[0\]\.rows/],
    ["duplicate applied garbage ids", (snapshot) => { snapshot.appliedGarbageIds = ["g", "g"]; }, /duplicate id/],
    ["status enum", (snapshot) => { snapshot.status = "paused"; }, /snapshot\.status/],
    ["status reason consistency", (snapshot) => { snapshot.gameOverReason = "spawn-blocked"; }, /must be null while playing/],
    ["level consistency", (snapshot) => { snapshot.level += 1; }, /snapshot\.level must be/],
    ["rolled-back piece id counter", (snapshot) => { snapshot.nextPieceId = 1; }, /must be greater than reserved piece id/],
    ["rolled-back spawn index counter", (snapshot) => { snapshot.nextSpawnIndex = 1; }, /must be greater than reserved spawn index/]
  ];

  for (const [name, mutate, expected] of cases) {
    const snapshot = clone();
    mutate(snapshot);
    assert.throws(() => engine.restore(snapshot), expected, name);
  }
});

test("restore rejects snapshots from a different ruleset", () => {
  const rules = makeTestRules();
  const engine = engineForRules(rules);
  const snapshot = engine.snapshot(engine.create({ seed: 29 }));
  snapshot.rulesetId = "hostile-other-rules";

  assert.throws(
    () => engine.restore(snapshot),
    /Game snapshot ruleset mismatch: expected .* received hostile-other-rules/
  );
});

// Match policy boundaries and multiplayer modes.

test("match policies receive a capability surface instead of mutable match internals", () => {
  const rules = makeTestRules();
  let seen = null;
  const policy = {
    id: "capability-test-policy",
    validatePlayerIds() {},
    createState() {
      return { calls: 0 };
    },
    beforeStep(context) {
      seen = context;
      context.state.calls += 1;
      context.emit({ type: "POLICY_BEFORE_STEP" });
    },
    onGameEvent() {},
    afterStep() {}
  };
  const match = createMatch({
    id: "capability-test",
    playerIds: ["solo"],
    seed: 30,
    rules,
    policy
  });

  const events = stepMatch(match, {});

  assert(seen);
  assert.equal(Object.isFrozen(seen), true);
  assert.equal(Object.isFrozen(seen.playerIds), true);
  assert.equal(Object.hasOwn(seen, "players"), false);
  assert.equal(Object.hasOwn(seen, "engine"), false);
  assert.equal(Object.hasOwn(seen, "policy"), false);
  assert.equal(seen.state, match.policyState);
  assert.equal(seen.state.calls, 1);
  assert.deepEqual(seen.getPlayer("solo"), { id: "solo", status: "playing", worldTick: 1 });
  assert(events.some((event) => event.type === "POLICY_BEFORE_STEP"));
});

test("match policies cannot mutate the validated player roster", () => {
  const rules = makeTestRules();
  let validatedPlayerIds = null;
  const policy = {
    id: "roster-mutation-test-policy",
    validatePlayerIds(playerIds) {
      validatedPlayerIds = playerIds;
      assert.throws(() => { playerIds.length = 0; }, TypeError);
    },
    createState() {
      return {};
    },
    beforeStep() {},
    onGameEvent() {},
    afterStep() {}
  };

  const match = createMatch({
    id: "roster-mutation-test",
    playerIds: ["a", "b"],
    seed: 32,
    rules,
    policy
  });

  assert.equal(Object.isFrozen(validatedPlayerIds), true);
  assert.deepEqual(match.players.map((player) => player.id), ["a", "b"]);
});

test("two-line clear in versus produces queued garbage for the opponent", () => {
  const rules = makeTestRules({
    simulation: { lockDelayWorldTicks: 1, operationGraceSteps: 0 }
  });
  const policy = defineVersusPolicy({
    id: "vs-test-policy",
    lineClearAttackRows: [0, 0, 1, 2, 4],
    garbageWarningWorldTicks: 20,
    cancellation: true
  });
  const match = createMatch({
    id: "vs-test",
    playerIds: ["a", "b"],
    seed: 5,
    rules,
    policy
  });
  const a = getPlayerGame(match, "a");
  prepareTwoLineClear(a, rules);

  const events = stepMatch(match, {});
  const b = getPlayerGame(match, "b");
  assert(events.some((event) => event.type === "ATTACK_GENERATED" && event.playerId === "a"));
  assert(events.some((event) => event.type === "GARBAGE_SENT" && event.targetPlayerId === "b"));
  assert.equal(b.incomingGarbage.length, 1);
  assert.equal(b.incomingGarbage[0].rows, 1);
  assert.equal(b.incomingGarbage[0].applyAtWorldTick, b.worldTick + 20);
});

test("simultaneous versus attacks do not cancel each other by player iteration order", () => {
  const rules = makeTestRules({
    simulation: { lockDelayWorldTicks: 1, operationGraceSteps: 0 }
  });
  const policy = defineVersusPolicy({
    id: "simultaneous-vs-test-policy",
    lineClearAttackRows: [0, 0, 1, 2, 4],
    garbageWarningWorldTicks: 20,
    cancellation: true
  });
  const match = createMatch({
    id: "simultaneous-vs-test",
    playerIds: ["a", "b"],
    seed: 8,
    rules,
    policy
  });
  const a = getPlayerGame(match, "a");
  const b = getPlayerGame(match, "b");
  prepareTwoLineClear(a, rules);
  prepareTwoLineClear(b, rules);

  const events = stepMatch(match, {});

  assert.equal(events.filter((event) => event.type === "ATTACK_GENERATED").length, 2);
  assert.equal(events.filter((event) => event.type === "GARBAGE_SENT").length, 2);
  assert.equal(events.filter((event) => event.type === "GARBAGE_CANCELLED").length, 0);
  assert.equal(a.incomingGarbage.length, 1);
  assert.equal(b.incomingGarbage.length, 1);
  assert.equal(a.incomingGarbage[0].applyAtWorldTick, a.worldTick + 20);
  assert.equal(b.incomingGarbage[0].applyAtWorldTick, b.worldTick + 20);
});

test("survival mode queues deterministic hazard waves", () => {
  const rules = makeTestRules();
  const policy = defineSurvivalPolicy({
    id: "survival-test-policy",
    garbageWarningWorldTicks: 30,
    firstWaveMatchTick: 0,
    waveIntervalMatchTicks: 60,
    rowsPerWaveStepMatchTicks: 120,
    maximumRowsPerWave: 4
  });
  const match = createMatch({
    id: "survival-test",
    playerIds: ["solo"],
    seed: 6,
    rules,
    policy
  });

  const events = stepMatch(match, {});
  const game = getPlayerGame(match, "solo");
  assert(events.some((event) => event.type === "SURVIVAL_WAVE_QUEUED"));
  assert.equal(game.incomingGarbage.length, 1);
  assert.equal(game.incomingGarbage[0].rows, 1);
  assert.equal(game.incomingGarbage[0].applyAtWorldTick, 30);
  assert.equal(match.matchTick, 1);
});

test("match clock advances independently while survival garbage waits on the world clock", () => {
  const rules = makeTestRules();
  const policy = defineSurvivalPolicy({
    id: "clock-semantics-survival-policy",
    garbageWarningWorldTicks: 5,
    firstWaveMatchTick: 0,
    waveIntervalMatchTicks: 1,
    rowsPerWaveStepMatchTicks: 100,
    maximumRowsPerWave: 1
  });
  const match = createMatch({
    id: "clock-semantics-survival",
    playerIds: ["solo"],
    seed: 7,
    rules,
    policy
  });
  const game = getPlayerGame(match, "solo");
  game.worldHoldSteps = 2;

  stepMatch(match, {});
  stepMatch(match, {});

  assert.equal(match.matchTick, 2, "match policy time never pauses with one playfield");
  assert.equal(game.stepTick, 2, "fixed simulation steps still run during a world hold");
  assert.equal(game.worldTick, 0, "the playfield world clock is paused by the hold");
  assert.equal(game.incomingGarbage.length, 2);
  assert.deepEqual(
    game.incomingGarbage.map((packet) => packet.applyAtWorldTick),
    [5, 5],
    "survival waves use match time, but their application deadlines use the target world clock"
  );
});
