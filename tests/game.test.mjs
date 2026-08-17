import test from "node:test";
import assert from "node:assert/strict";

import {
  assertGameState,
  cancelIncomingGarbage,
  createGame,
  getEditableFillCells,
  hashGameState,
  queueGarbage,
  restoreGame,
  snapshotGame,
  stepGame
} from "../src/domain/game.js";
import { createMatch, getPlayerGame, stepMatch } from "../src/domain/match.js";
import { createRules, getTemplateBounds, getTemplateCells } from "../src/domain/rules.js";

function spawnI(game, rules) {
  game.dropQueue[0].templateId = "I";
  game.dropQueue[0].rotation = 0;
  game.dropQueue[0].x = 3;
  stepGame(game, [], rules);
  assert.equal(game.activePieces.length, 1);
  return game.activePieces[0];
}

function boardIndex(board, x, y) {
  return y * board.width + x;
}

test("same seed and command stream stays deterministic", () => {
  const rules = createRules();
  const a = createGame({ seed: 123456, rules });
  const b = createGame({ seed: 123456, rules });

  for (let tick = 0; tick < 1200; tick += 1) {
    stepGame(a, [], rules);
    stepGame(b, [], rules);
    assert.equal(hashGameState(a), hashGameState(b), `desync at tick ${tick}`);
    if (a.status !== "playing") break;
  }
});

test("carving may split a piece into disconnected regions", () => {
  const rules = createRules();
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
  const rules = createRules();
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
  const rules = createRules();
  const game = createGame({ seed: 20, rules });
  game.tick = 20;
  game.dropQueue.forEach((plan, index) => { plan.spawnTick = 1000 + index * 100; });
  game.nextScheduledSpawnTick = 1480;
  game.activePieces = [
    {
      id: "focus",
      templateId: "I",
      cellValue: 1,
      x: 0,
      y: 5,
      cells: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }],
      carved: 0,
      carveLimit: 2,
      restingTicks: 0,
      spawnIndex: 1,
      committed: false
    },
    {
      id: "other",
      templateId: "I",
      cellValue: 1,
      x: 9,
      y: 5,
      cells: [{ x: 0, y: 0 }],
      carved: 0,
      carveLimit: 2,
      restingTicks: 0,
      spawnIndex: 2,
      committed: false
    }
  ];
  game.focusedPieceId = "focus";

  const events = stepGame(game, [{ type: "SCULPT", pieceId: "focus", x: 1, y: 0 }], rules);

  assert.equal(game.activePieces.find((piece) => piece.id === "other").y, 5);
  assert.equal(game.tick, 20, "the world clock pauses");
  assert.equal(game.worldHoldTicks, rules.simulation.operationGraceTicks - 1);
  assert(events.some((event) => event.type === "BLOCK_CARVED"));
  assert(!events.some((event) => event.type === "PIECE_MOVED"));

  for (let i = 1; i < rules.simulation.operationGraceTicks; i += 1) {
    stepGame(game, [], rules);
  }
  assert.equal(game.tick, 20);
  assert.equal(game.worldHoldTicks, 0);
  assert.equal(game.activePieces.find((piece) => piece.id === "other").y, 5);

  const resumed = stepGame(game, [], rules);
  assert.equal(game.tick, 21);
  assert.equal(game.activePieces.find((piece) => piece.id === "other").y, 6);
  assert(resumed.some((event) => event.type === "PIECE_MOVED" && event.pieceId === "other"));
});

test("global grace defers scheduled spawns and garbage", () => {
  const rules = createRules({ simulation: { operationGraceTicks: 2 } });
  const game = createGame({ seed: 24, rules });
  game.tick = 20;
  game.dropQueue[0].spawnTick = 20;
  game.dropQueue[1].spawnTick = 1000;
  game.nextScheduledSpawnTick = 1480;
  game.activePieces = [{
    id: "focus",
    templateId: "I",
    cellValue: 1,
    x: 0,
    y: 5,
    cells: [{ x: 0, y: 0 }, { x: 1, y: 0 }],
    carved: 0,
    carveLimit: 2,
    restingTicks: 0,
    spawnIndex: 1,
    committed: false
  }];
  game.focusedPieceId = "focus";
  assert.equal(queueGarbage(game, {
    id: "due-during-hold",
    sourcePlayerId: "opponent",
    rows: 1,
    applyTick: 20,
    seed: 7
  }), true);

  const sculpted = stepGame(game, [
    { type: "SCULPT", pieceId: "focus", x: 1, y: 0 }
  ], rules);
  const held = stepGame(game, [], rules);

  assert(![...sculpted, ...held].some((event) => (
    event.type === "PIECE_SPAWNED" || event.type === "GARBAGE_APPLIED"
  )));
  assert.equal(game.tick, 20);
  assert.equal(game.dropQueue[0].spawnTick, 20);
  assert.equal(game.incomingGarbage.length, 1);

  const resumed = stepGame(game, [], rules);
  assert(resumed.some((event) => event.type === "PIECE_SPAWNED"));
  assert(resumed.some((event) => event.type === "GARBAGE_APPLIED"));
  assert.equal(game.incomingGarbage.length, 0);
});

test("invalid sculpt does not suppress gravity", () => {
  const rules = createRules();
  const game = createGame({ seed: 21, rules });
  game.tick = 20;
  game.dropQueue.forEach((plan, index) => { plan.spawnTick = 1000 + index * 100; });
  game.nextScheduledSpawnTick = 1480;
  game.activePieces = [
    {
      id: "focus",
      templateId: "I",
      cellValue: 1,
      x: 0,
      y: 5,
      cells: [{ x: 0, y: 0 }, { x: 1, y: 0 }],
      carved: 0,
      carveLimit: 2,
      restingTicks: 0,
      spawnIndex: 1,
      committed: false
    },
    {
      id: "other",
      templateId: "I",
      cellValue: 1,
      x: 9,
      y: 5,
      cells: [{ x: 0, y: 0 }],
      carved: 0,
      carveLimit: 2,
      restingTicks: 0,
      spawnIndex: 2,
      committed: false
    }
  ];
  game.focusedPieceId = "focus";

  const events = stepGame(game, [{ type: "SCULPT", pieceId: "focus", x: 5, y: 5 }], rules);

  assert.equal(game.activePieces.find((piece) => piece.id === "other").y, 6);
  assert(!events.some((event) => event.type === "BLOCK_CARVED" || event.type === "BLOCK_FILLED"));
  assert(events.some((event) => event.type === "PIECE_MOVED" && event.pieceId === "other"));
});

test("natural lock becomes pending while the whole playfield pauses", () => {
  const rules = createRules();
  const game = createGame({ seed: 22, rules });
  const bottom = game.board.height - 1;
  game.tick = 20;
  game.dropQueue.forEach((plan, index) => { plan.spawnTick = 1000 + index * 100; });
  game.nextScheduledSpawnTick = 1480;
  game.activePieces = [
    {
      id: "locking",
      templateId: "I",
      cellValue: 1,
      x: 0,
      y: bottom,
      cells: [{ x: 0, y: 0 }],
      carved: 0,
      carveLimit: 2,
      restingTicks: rules.simulation.lockDelayTicks - 1,
      spawnIndex: 1,
      committed: true
    },
    {
      id: "falling",
      templateId: "I",
      cellValue: 1,
      x: 9,
      y: 5,
      cells: [{ x: 0, y: 0 }],
      carved: 0,
      carveLimit: 2,
      restingTicks: 0,
      spawnIndex: 2,
      committed: false
    }
  ];
  game.focusedPieceId = "falling";

  const events = stepGame(game, [], rules);

  assert(events.some((event) => event.type === "PIECE_LOCK_PENDING"
    && event.pieceId === "locking"));
  assert(!events.some((event) => event.type === "PIECE_LOCKED"));
  assert.equal(game.activePieces.find((piece) => piece.id === "locking").pendingLock, true);
  assert.equal(game.activePieces.find((piece) => piece.id === "falling").y, 5);
  assert.equal(game.tick, 20);
  assert(!events.some((event) => event.type === "PIECE_MOVED"));

  for (let i = 1; i < rules.simulation.operationGraceTicks; i += 1) {
    const held = stepGame(game, [], rules);
    assert(!held.some((event) => event.type === "PIECE_LOCKED"));
  }

  const locked = stepGame(game, [], rules);
  assert(locked.some((event) => event.type === "PIECE_LOCKED"
    && event.pieceId === "locking"));
  assert.equal(game.activePieces.find((piece) => piece.id === "falling").y, 5);
  assert.equal(game.tick, 20, "lock resolution does not consume world time");
});

test("an ordinary gravity landing reaches pending lock without pulse alignment", () => {
  const rules = createRules({
    simulation: { lockDelayTicks: 4, operationGraceTicks: 3 },
    progression: {
      gravityStartTicks: 2,
      gravityStepTicks: 0,
      gravityMinimumTicks: 2,
      spawnStartTicks: 1000,
      spawnStepTicks: 0,
      spawnMinimumTicks: 1000
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
  assert.equal(game.worldHoldTicks, rules.simulation.operationGraceTicks - 1);
});

test("sculpt can edit a pending piece and refreshes the global grace", () => {
  const rules = createRules();
  const game = createGame({ seed: 23, rules });
  const bottom = game.board.height - 1;
  game.tick = 20;
  game.dropQueue.forEach((plan, index) => { plan.spawnTick = 1000 + index * 100; });
  game.nextScheduledSpawnTick = 1480;
  game.activePieces = [
    {
      id: "editing",
      templateId: "I",
      cellValue: 1,
      x: 0,
      y: bottom,
      cells: [{ x: 0, y: 0 }, { x: 1, y: 0 }],
      carved: 0,
      carveLimit: 2,
      restingTicks: rules.simulation.lockDelayTicks - 1,
      spawnIndex: 1,
      committed: false
    },
    {
      id: "falling",
      templateId: "I",
      cellValue: 1,
      x: 9,
      y: 5,
      cells: [{ x: 0, y: 0 }],
      carved: 0,
      carveLimit: 2,
      restingTicks: 0,
      spawnIndex: 2,
      committed: false
    }
  ];
  game.focusedPieceId = "editing";

  stepGame(game, [], rules);
  assert.equal(game.activePieces.find((piece) => piece.id === "editing").pendingLock, true);

  const events = stepGame(game, [
    { type: "SCULPT", pieceId: "editing", x: 1, y: 0 }
  ], rules);

  const editing = game.activePieces.find((piece) => piece.id === "editing");
  assert(events.some((event) => event.type === "BLOCK_CARVED"));
  assert(editing);
  assert.equal(editing.pendingLock, false);
  assert.equal(editing.restingTicks, 0);
  assert.equal(game.worldHoldTicks, rules.simulation.operationGraceTicks - 1);
  assert.equal(game.activePieces.find((piece) => piece.id === "falling").y, 5);
});

test("hard drop moves the focused piece to its lowest available position", () => {
  const rules = createRules();
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

test("commit focuses another useful active piece without spawning an extra one", () => {
  const rules = createRules();
  const game = createGame({ seed: 23, rules });
  game.dropQueue.forEach((plan) => { plan.spawnTick = 1000; });
  game.nextScheduledSpawnTick = 1480;
  game.activePieces = [
    {
      id: "older",
      templateId: "I",
      cellValue: 1,
      x: 0,
      y: 5,
      cells: [{ x: 0, y: 0 }],
      carved: 0,
      carveLimit: 2,
      restingTicks: 0,
      spawnIndex: 1,
      committed: false
    },
    {
      id: "newer",
      templateId: "I",
      cellValue: 1,
      x: 9,
      y: 3,
      cells: [{ x: 0, y: 0 }],
      carved: 0,
      carveLimit: 2,
      restingTicks: 0,
      spawnIndex: 2,
      committed: false
    }
  ];
  game.focusedPieceId = "older";

  const events = stepGame(game, [{ type: "HARD_DROP_FOCUSED" }], rules);

  assert.equal(game.focusedPieceId, "newer");
  assert.equal(game.activePieces.find((piece) => piece.id === "older").committed, true);
  assert.equal(game.activePieces.find((piece) => piece.id === "newer").y, 4,
    "hard drop does not suppress the gravity pulse");
  assert(!events.some((event) => event.type === "PIECE_SPAWNED"));
});

test("drop planning balances between two sampled positions over a 48-drop history", () => {
  const rules = createRules();
  const game = createGame({ seed: 24, rules });
  game.dropQueue = [];
  game.dropCoverageHistory = Array.from({ length: 48 }, (_, index) => ({
    templateId: "O",
    rotation: 0,
    x: [2, 4, 6][index % 3]
  }));
  const historyBeforePlanning = game.dropCoverageHistory.map((historyPlan) => ({ ...historyPlan }));
  game.random.drops.state = 1;
  game.nextScheduledSpawnTick = game.tick + 100;

  stepGame(game, [], rules);

  const plan = game.dropQueue[0];
  const maxX = game.board.width - getTemplateBounds(rules, plan.templateId, plan.rotation).width;
  let randomState = 1;
  const sampledXs = Array.from({ length: 2 }, () => {
    randomState ^= randomState << 13;
    randomState ^= randomState >>> 17;
    randomState ^= randomState << 5;
    randomState >>>= 0;
    if (randomState === 0) randomState = 1;
    return randomState % (maxX + 1);
  });
  const coverage = Array(game.board.width).fill(0);
  for (const historyPlan of historyBeforePlanning) {
    for (const cell of getTemplateCells(rules, historyPlan.templateId, historyPlan.rotation)) {
      coverage[historyPlan.x + cell.x] += 1;
    }
  }
  const cells = getTemplateCells(rules, plan.templateId, plan.rotation);
  const score = (x) => cells.reduce((sum, cell) => sum + coverage[x + cell.x], 0);
  const expectedX = score(sampledXs[1]) < score(sampledXs[0]) ? sampledXs[1] : sampledXs[0];

  assert.equal(plan.x, expectedX);
  assert.equal(game.dropCoverageHistory.length, 48);
});

test("template rotation produces normalized unique orientations", () => {
  const rules = createRules();
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
  const rules = createRules();
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
  const rules = createRules();
  const game = createGame({ seed: 3, rules });

  assert.equal(queueGarbage(game, {
    id: "g1",
    sourcePlayerId: "opponent",
    rows: 4,
    applyTick: 100,
    seed: 99
  }), true);
  assert.equal(queueGarbage(game, {
    id: "g1",
    sourcePlayerId: "opponent",
    rows: 4,
    applyTick: 100,
    seed: 99
  }), false);

  const result = cancelIncomingGarbage(game, 2);
  assert.deepEqual(result, { cancelled: 2, remaining: 0 });
  assert.equal(game.incomingGarbage[0].rows, 2);
});

test("snapshot round trip preserves deterministic hash", () => {
  const rules = createRules();
  const game = createGame({ seed: 4, rules });
  for (let i = 0; i < 120; i += 1) stepGame(game, [], rules);
  const restored = restoreGame(snapshotGame(game));
  assert.equal(hashGameState(restored), hashGameState(game));
  assertGameState(restored);
});

test("snapshot round trip preserves a pending lock and global grace", () => {
  const rules = createRules();
  const game = createGame({ seed: 25, rules });
  const bottom = game.board.height - 1;
  game.tick = 20;
  game.dropQueue.forEach((plan, index) => { plan.spawnTick = 1000 + index * 100; });
  game.activePieces = [{
    id: "pending",
    templateId: "I",
    rotation: 0,
    cellValue: 1,
    x: 0,
    y: bottom,
    cells: [{ x: 0, y: 0 }],
    carved: 0,
    carveLimit: 2,
    restingTicks: rules.simulation.lockDelayTicks - 1,
    pendingLock: false,
    spawnIndex: 1,
    committed: false
  }];
  game.focusedPieceId = "pending";

  stepGame(game, [], rules);
  const restored = restoreGame(snapshotGame(game));

  assert.equal(restored.activePieces[0].pendingLock, true);
  assert.equal(restored.worldHoldTicks, rules.simulation.operationGraceTicks - 1);
  assert.equal(hashGameState(restored), hashGameState(game));

  for (let i = 0; i <= rules.simulation.operationGraceTicks; i += 1) {
    assert.deepEqual(stepGame(restored, [], rules), stepGame(game, [], rules));
    assert.equal(hashGameState(restored), hashGameState(game));
  }
});

test("restore rejects snapshots from a non-current schema instead of migrating them", () => {
  const rules = createRules();
  const snapshot = snapshotGame(createGame({ seed: 26, rules }));
  delete snapshot.simulationTick;
  snapshot.version = 1;
  delete snapshot.schemaVersion;

  assert.throws(() => restoreGame(snapshot), /snapshot\.version is not supported|schemaVersion is required/);
});

test("two-line clear in versus produces queued garbage for the opponent", () => {
  const rules = createRules({
    simulation: { lockDelayTicks: 1, operationGraceTicks: 0 },
    garbage: { warningTicks: 20 }
  });
  const match = createMatch({
    id: "vs-test",
    mode: "versus",
    playerIds: ["a", "b"],
    seed: 5,
    rules
  });
  const a = getPlayerGame(match, "a");
  const bottom = a.board.height - 1;

  a.tick = 1;
  a.dropQueue.forEach((plan, index) => { plan.spawnTick = 1000 + index * 100; });
  for (const y of [bottom - 1, bottom]) {
    for (let x = 1; x < a.board.width; x += 1) {
      a.board.cells[boardIndex(a.board, x, y)] = 1;
    }
  }
  a.activePieces = [{
    id: "manual",
    templateId: "I",
    cellValue: 1,
    x: 0,
    y: bottom - 1,
    cells: [{ x: 0, y: 0 }, { x: 0, y: 1 }],
    carved: 0,
    carveLimit: 2,
    restingTicks: 0,
    spawnIndex: 1
  }];
  a.focusedPieceId = "manual";

  const events = stepMatch(match, {});
  const b = getPlayerGame(match, "b");
  assert(events.some((event) => event.type === "ATTACK_GENERATED" && event.playerId === "a"));
  assert(events.some((event) => event.type === "GARBAGE_SENT" && event.targetPlayerId === "b"));
  assert.equal(b.incomingGarbage.length, 1);
  assert.equal(b.incomingGarbage[0].rows, 1);
});

test("survival mode queues deterministic hazard waves", () => {
  const rules = createRules({
    garbage: { warningTicks: 30 },
    survival: {
      firstWaveTick: 0,
      waveIntervalTicks: 60,
      rowsPerWaveStep: 120,
      maximumRowsPerWave: 4
    }
  });
  const match = createMatch({
    id: "survival-test",
    mode: "survival",
    playerIds: ["solo"],
    seed: 6,
    rules
  });

  const events = stepMatch(match, {});
  const game = getPlayerGame(match, "solo");
  assert(events.some((event) => event.type === "SURVIVAL_WAVE_QUEUED"));
  assert.equal(game.incomingGarbage.length, 1);
  assert.equal(game.incomingGarbage[0].rows, 1);
});
