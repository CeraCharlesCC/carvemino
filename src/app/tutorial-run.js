function sameCell(a, b) {
  return Boolean(a && b && a.x === b.x && a.y === b.y);
}

function focusedStatePiece(session) {
  return session.game.activePieces.find((piece) => piece.id === session.game.focusedPieceId) || null;
}

function chooseCutTargets(piece) {
  const bottomY = Math.max(...piece.cells.map((cell) => cell.y));
  const preferred = piece.cells.filter((cell) => cell.y < bottomY);
  const candidates = preferred.length >= 2 ? preferred : piece.cells;
  if (candidates.length < 2) throw new Error("Tutorial piece needs at least two carve targets");

  const start = piece.cells[0];
  const first = candidates.find((cell) => !sameCell(cell, start)) || candidates[0];
  const second = candidates.find((cell) => !sameCell(cell, first)) || candidates[1];
  return [{ ...first }, { ...second }];
}

function planSculptedShape(session, cutTargets, originalBottomY) {
  // Ask a restored sandbox copy of the real engine for legal sculpt results rather
  // than duplicating sculpt rules in tutorial-only planning code.
  const planner = session.engine.restore(session.snapshot());
  for (const target of cutTargets) {
    session.engine.step(planner, [{
      type: "SCULPT",
      pieceId: planner.focusedPieceId,
      x: target.x,
      y: target.y
    }]);
  }
  const targets = session.engine.view(planner).sculpt.fill.targets;
  const target = targets.find((cell) => cell.y < originalBottomY) || targets[0];
  if (!target) throw new Error("Tutorial piece needs a legal fill target after two cuts");
  session.engine.step(planner, [{
    type: "SCULPT",
    pieceId: planner.focusedPieceId,
    x: target.x,
    y: target.y
  }]);
  const finalPiece = planner.activePieces.find((candidate) => candidate.id === planner.focusedPieceId);
  if (!finalPiece) throw new Error("Tutorial piece disappeared while planning the sculpted shape");
  return {
    fillTarget: { ...target },
    finalCells: finalPiece.cells.map((cell) => ({ ...cell }))
  };
}

function primeFocusedPieceIntoView(session) {
  const maxSteps = session.engine.stepsPerSecond * 8;
  const targetVisibleY = Math.max(6, Math.floor(session.game.board.visibleHeight * 0.28));
  for (let index = 0; index < maxSteps; index += 1) {
    const piece = focusedStatePiece(session);
    if (piece && piece.y >= session.game.board.hiddenHeight + targetVisibleY) return piece;
    session.step([]);
  }
  throw new Error("Tutorial piece did not enter the visible field in time");
}

function prepareLineClear(session, piece, finalCells) {
  const bottomLocalY = Math.max(...finalCells.map((cell) => cell.y));
  const landingColumns = new Set(
    finalCells
      .filter((cell) => cell.y === bottomLocalY)
      .map((cell) => piece.x + cell.x)
  );
  const rowY = session.game.board.height - 1;
  // Prime only the cells outside the planned landing footprint so completing the
  // guided sculpt and drop deterministically demonstrates a real line clear.
  for (let x = 0; x < session.game.board.width; x += 1) {
    if (!landingColumns.has(x)) {
      session.game.board.cells[rowY * session.game.board.width + x] = piece.cellValue;
    }
  }
}

export function prepareTutorialRun(session) {
  if (!session?.engine || !session?.game) throw new Error("game session is required");
  const piece = primeFocusedPieceIntoView(session);
  const bottomLocalY = Math.max(...piece.cells.map((cell) => cell.y));
  const cutTargets = chooseCutTargets(piece);
  const { fillTarget, finalCells } = planSculptedShape(session, cutTargets, bottomLocalY);
  prepareLineClear(session, piece, finalCells);

  return Object.freeze({
    moveTarget: Object.freeze({ ...cutTargets[0] }),
    cutTargets: Object.freeze(cutTargets.map((cell) => Object.freeze({ ...cell }))),
    fillTarget: Object.freeze(fillTarget)
  });
}