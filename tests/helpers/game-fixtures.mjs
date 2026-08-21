export function boardIndex(board, x, y) {
  return y * board.width + x;
}

export function deferSpawns(game) {
  const firstDeferredWorldTick = game.worldTick + 1000;
  const interval = 100;
  game.dropQueue.forEach((plan, index) => {
    plan.spawnAtWorldTick = firstDeferredWorldTick + index * interval;
  });
  game.nextScheduledSpawnWorldTick = firstDeferredWorldTick + game.dropQueue.length * interval;
}

export function makeTestPiece(rules, overrides = {}) {
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

export function setActivePieces(game, rules, pieces, focusedPieceId = pieces[0]?.id ?? null) {
  game.activePieces = pieces.map((piece, index) => makeTestPiece(rules, {
    spawnIndex: index + 1,
    ...piece
  }));
  game.focusedPieceId = focusedPieceId;
  game.nextSpawnIndex = Math.max(
    game.nextSpawnIndex,
    ...game.activePieces.map((piece) => piece.spawnIndex + 1)
  );
}

export function prepareActiveWorld(game, rules, pieces, {
  worldTick = 20,
  focusedPieceId = pieces[0]?.id ?? null
} = {}) {
  game.worldTick = worldTick;
  deferSpawns(game);
  setActivePieces(game, rules, pieces, focusedPieceId);
}

export function resetDropPlanner(game, { placements, pressure, spawnDelay = 100 } = {}) {
  game.dropQueue = [];
  if (placements) game.dropPositionMemory.placements = placements.map((plan) => ({ ...plan }));
  if (pressure) game.dropPositionMemory.pressure = [...pressure];
  game.nextScheduledSpawnWorldTick = game.worldTick + spawnDelay;
}

export function prepareTwoLineClear(game, rules) {
  const bottom = game.board.height - 1;
  for (const y of [bottom - 1, bottom]) {
    for (let x = 1; x < game.board.width; x += 1) {
      game.board.cells[boardIndex(game.board, x, y)] = 1;
    }
  }
  prepareActiveWorld(game, rules, [{
    id: "manual-clear",
    x: 0,
    y: bottom - 1,
    cells: [{ x: 0, y: 0 }, { x: 0, y: 1 }],
  }], { worldTick: 1, focusedPieceId: "manual-clear" });
}
