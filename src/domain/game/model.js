export function cellKey(x, y) {
  return `${x},${y}`;
}

export function compareCells(a, b) {
  return a.y - b.y || a.x - b.x;
}

function normalizeCells(cells) {
  return cells
    .map((cell) => ({ x: cell.x, y: cell.y }))
    .sort(compareCells);
}

function boardIndex(board, x, y) {
  return y * board.width + x;
}

export function getBoardCell(board, x, y) {
  return board.cells[boardIndex(board, x, y)];
}

export function setBoardCell(board, x, y, value) {
  board.cells[boardIndex(board, x, y)] = value;
}

export function allWorldCells(piece, dx = 0, dy = 0) {
  return piece.cells.map((cell) => ({
    x: piece.x + cell.x + dx,
    y: piece.y + cell.y + dy
  }));
}

function activeCellOccupancy(state, ignoredPieceId = null) {
  const occupied = new Set();
  for (const piece of state.activePieces) {
    if (piece.id === ignoredPieceId) continue;
    for (const cell of piece.cells) {
      occupied.add(cellKey(piece.x + cell.x, piece.y + cell.y));
    }
  }
  return occupied;
}

export function canOccupyWorldCells(state, worldCells, ignoredPieceId = null) {
  const { board } = state;
  const active = activeCellOccupancy(state, ignoredPieceId);
  const seen = new Set();

  for (const cell of worldCells) {
    if (cell.x < 0 || cell.x >= board.width || cell.y < 0 || cell.y >= board.height) {
      return false;
    }
    const key = cellKey(cell.x, cell.y);
    if (seen.has(key)) return false;
    seen.add(key);
    if (getBoardCell(board, cell.x, cell.y) !== 0) return false;
    if (active.has(key)) return false;
  }

  return true;
}

export function canTranslate(state, piece, dx, dy) {
  return canOccupyWorldCells(state, allWorldCells(piece, dx, dy), piece.id);
}

export function supportKindBelow(state, piece) {
  const { board } = state;
  const active = activeCellOccupancy(state, piece.id);
  let hasBoardSupport = false;
  let hasActiveSupport = false;

  for (const cell of piece.cells) {
    const x = piece.x + cell.x;
    const y = piece.y + cell.y + 1;
    if (y >= board.height) {
      hasBoardSupport = true;
      continue;
    }
    if (getBoardCell(board, x, y) !== 0) hasBoardSupport = true;
    if (active.has(cellKey(x, y))) hasActiveSupport = true;
  }

  if (hasBoardSupport) return "board";
  if (hasActiveSupport) return "active";
  return "none";
}

export function pieceBottom(piece) {
  let max = -Infinity;
  for (const cell of piece.cells) {
    max = Math.max(max, piece.y + cell.y);
  }
  return max;
}

export function findPiece(state, pieceId) {
  return state.activePieces.find((piece) => piece.id === pieceId) || null;
}

export function currentFocusedPiece(state) {
  if (!state.focusedPieceId) return null;
  const piece = findPiece(state, state.focusedPieceId);
  return piece && !piece.committed ? piece : null;
}

export function selectFallbackFocus(state) {
  const usefulPieces = state.activePieces.filter((piece) => !piece.committed);
  if (usefulPieces.length === 0) {
    state.focusedPieceId = null;
    return;
  }

  const ordered = [...usefulPieces].sort(
    (a, b) => pieceBottom(b) - pieceBottom(a) || a.spawnIndex - b.spawnIndex
  );
  state.focusedPieceId = ordered[0].id;
}

export function clonePiece(piece) {
  return {
    ...piece,
    pendingLock: Boolean(piece.pendingLock),
    cells: normalizeCells(piece.cells)
  };
}
