import {
  canOccupyWorldCells,
  cellKey,
  compareCells,
  currentFocusedPiece,
  findPiece
} from "./model.js";

const NEIGHBORS = Object.freeze([
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1]
]);

function hasLocalCell(piece, x, y) {
  return piece.cells.some((cell) => cell.x === x && cell.y === y);
}

export function getEditableFillCells(state, pieceId) {
  const piece = findPiece(state, pieceId);
  if (!piece) return [];

  const result = new Map();
  for (const cell of piece.cells) {
    for (const [dx, dy] of NEIGHBORS) {
      const localX = cell.x + dx;
      const localY = cell.y + dy;
      const key = cellKey(localX, localY);
      if (hasLocalCell(piece, localX, localY) || result.has(key)) continue;

      const worldCell = [{ x: piece.x + localX, y: piece.y + localY }];
      if (canOccupyWorldCells(state, worldCell, piece.id)) {
        result.set(key, { x: localX, y: localY });
      }
    }
  }

  return [...result.values()].sort(compareCells);
}

function applyCarve(state, command, rules, events) {
  const piece = currentFocusedPiece(state);
  if (!piece || command.pieceId !== piece.id) return false;
  if (!Number.isInteger(command.x) || !Number.isInteger(command.y)) return false;
  if (!hasLocalCell(piece, command.x, command.y)) return false;
  if (piece.carved >= piece.carveLimit) return false;
  if (piece.cells.length <= rules.sculpting.minimumCells) return false;

  const index = piece.cells.findIndex(
    (cell) => cell.x === command.x && cell.y === command.y
  );
  piece.cells.splice(index, 1);
  piece.cells.sort(compareCells);
  piece.carved += 1;
  piece.restingWorldTicks = 0;
  piece.pendingLock = false;
  state.scrap += rules.sculpting.scrapPerCarve;
  state.score += rules.scoring.carve;

  events.push({
    type: "BLOCK_CARVED",
    pieceId: piece.id,
    cell: { x: command.x, y: command.y },
    carved: piece.carved,
    carveLimit: piece.carveLimit
  });
  events.push({ type: "SCRAP_CHANGED", value: state.scrap });
  events.push({ type: "SCORE_CHANGED", value: state.score });
  return true;
}

function applyFill(state, command, rules, events) {
  const piece = currentFocusedPiece(state);
  if (!piece || command.pieceId !== piece.id) return false;
  if (!Number.isInteger(command.x) || !Number.isInteger(command.y)) return false;
  if (state.scrap < rules.sculpting.fillCost) return false;
  if (hasLocalCell(piece, command.x, command.y)) return false;

  const editable = getEditableFillCells(state, piece.id);
  if (!editable.some((cell) => cell.x === command.x && cell.y === command.y)) return false;

  piece.cells.push({ x: command.x, y: command.y });
  piece.cells.sort(compareCells);
  piece.restingWorldTicks = 0;
  piece.pendingLock = false;
  state.scrap -= rules.sculpting.fillCost;
  state.score += rules.scoring.fill;

  events.push({
    type: "BLOCK_FILLED",
    pieceId: piece.id,
    cell: { x: command.x, y: command.y }
  });
  events.push({ type: "SCRAP_CHANGED", value: state.scrap });
  events.push({ type: "SCORE_CHANGED", value: state.score });
  return true;
}

export function applySculpt(state, command, rules, events) {
  const piece = currentFocusedPiece(state);
  if (!piece || command.pieceId !== piece.id) return false;
  if (!Number.isInteger(command.x) || !Number.isInteger(command.y)) return false;

  return hasLocalCell(piece, command.x, command.y)
    ? applyCarve(state, command, rules, events)
    : applyFill(state, command, rules, events);
}
