export function getVersusResultLabel(result, localPlayerId) {
  if (!result) return "MATCH OVER";
  if (result.type === "draw") return "DRAW";
  if (result.type === "winner") return result.winnerId === localPlayerId ? "WIN" : "LOSE";
  return "MATCH OVER";
}

export function getVersusEventLabel(event, localPlayerId) {
  if (!event || !localPlayerId) return null;
  if (event.type === "ATTACK_GENERATED" && event.playerId === localPlayerId) {
    return `ATTACK +${event.rows}`;
  }
  if (event.type === "GARBAGE_SENT" && event.sourcePlayerId === localPlayerId) {
    return `SENT ${event.packet?.rows || 0}`;
  }
  if (event.type === "GARBAGE_CANCELLED" && event.playerId === localPlayerId) {
    return `CANCEL ${event.rows}`;
  }
  return null;
}

export function getSculptAction(view, cursor) {
  const piece = view?.focusedPiece;
  if (!piece || !cursor || !view.sculpt) return null;
  if (view.sculpt.carve.targets.some((cell) => cell.x === cursor.x && cell.y === cursor.y)) {
    return "CARVE";
  }
  if (view.sculpt.fill.targets.some((cell) => cell.x === cursor.x && cell.y === cursor.y)) {
    return "FILL";
  }
  return null;
}

export function isDangerView(view, warningRows = 4) {
  const board = view?.board;
  if (!board || !Array.isArray(board.cells) || board.width <= 0 || board.height <= 0) return false;
  const rows = Math.max(1, Math.min(board.height, Math.floor(Number(warningRows) || 1)));
  return board.cells.slice(0, board.width * rows).some(Boolean);
}

export function getLineClearRows(view, events = []) {
  const board = view?.board;
  if (!board || !Array.isArray(board.cells) || board.width <= 0 || board.height <= 0) return [];

  const occupied = board.cells.map(Boolean);
  const lockedPieceIds = new Set((events || [])
    .filter((event) => event?.type === "PIECE_LOCKED" && event.pieceId)
    .map((event) => event.pieceId));

  for (const piece of view.activePieces || []) {
    if (!lockedPieceIds.has(piece.id)) continue;
    for (const cell of piece.cells || []) {
      const x = piece.x + cell.x;
      const y = piece.y + cell.y;
      if (x < 0 || x >= board.width || y < 0 || y >= board.height) continue;
      occupied[y * board.width + x] = true;
    }
  }

  const rows = [];
  for (let y = 0; y < board.height; y += 1) {
    let full = true;
    for (let x = 0; x < board.width; x += 1) {
      if (!occupied[y * board.width + x]) {
        full = false;
        break;
      }
    }
    if (full) rows.push(y);
  }
  return rows;
}
