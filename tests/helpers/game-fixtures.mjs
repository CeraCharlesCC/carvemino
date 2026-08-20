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

export function prepareTwoLineClear(game, rules) {
  const bottom = game.board.height - 1;
  game.worldTick = 1;
  deferSpawns(game);
  for (const y of [bottom - 1, bottom]) {
    for (let x = 1; x < game.board.width; x += 1) {
      game.board.cells[boardIndex(game.board, x, y)] = 1;
    }
  }
  game.activePieces = [{
    id: "manual-clear",
    templateId: "I",
    rotation: 0,
    cellValue: 1,
    x: 0,
    y: bottom - 1,
    cells: [{ x: 0, y: 0 }, { x: 0, y: 1 }],
    carved: 0,
    carveLimit: rules.sculpting.carveLimit,
    restingWorldTicks: 0,
    pendingLock: false,
    spawnIndex: 1,
    committed: false
  }];
  game.focusedPieceId = "manual-clear";
  game.nextSpawnIndex = Math.max(game.nextSpawnIndex, 2);
}