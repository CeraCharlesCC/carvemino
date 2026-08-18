import {
  gravityIntervalWorldTicksForLevel,
  scoreForLineClear
} from "../rules.js";
import {
  canTranslate,
  currentFocusedPiece,
  findPiece,
  getBoardCell,
  pieceBottom,
  selectFallbackFocus,
  setBoardCell,
  supportKindBelow
} from "./model.js";
import { applySculpt } from "./sculpt.js";
import {
  bringNextSpawnForward,
  maintainDropQueue,
  spawnDuePieces
} from "./drop-planner.js";
import { applyScheduledGarbage } from "./garbage.js";

function cycleFocus(state, direction, events) {
  const usefulPieces = state.activePieces.filter((piece) => !piece.committed);
  if (usefulPieces.length === 0) {
    state.focusedPieceId = null;
    return false;
  }

  const ordered = [...usefulPieces].sort((a, b) => a.spawnIndex - b.spawnIndex);
  const current = ordered.findIndex((piece) => piece.id === state.focusedPieceId);
  const base = current >= 0 ? current : 0;
  const next = (base + direction + ordered.length) % ordered.length;
  const nextId = ordered[next].id;

  if (state.focusedPieceId !== nextId) {
    state.focusedPieceId = nextId;
    events.push({ type: "FOCUS_CHANGED", pieceId: nextId });
    return true;
  }
  return false;
}

function focusNextUsefulPieceAfter(state, piece, events) {
  const ordered = state.activePieces
    .filter((candidate) => !candidate.committed && candidate.id !== piece.id)
    .sort((a, b) => a.spawnIndex - b.spawnIndex);

  if (ordered.length === 0) {
    state.focusedPieceId = null;
    return false;
  }

  const next = ordered.find((candidate) => candidate.spawnIndex > piece.spawnIndex) || ordered[0];
  state.focusedPieceId = next.id;
  events.push({ type: "FOCUS_CHANGED", pieceId: next.id });
  return true;
}

function applyHardDrop(state, rules, events) {
  const piece = currentFocusedPiece(state);
  if (!piece) return;

  let distance = 0;
  while (canTranslate(state, piece, 0, distance + 1)) {
    distance += 1;
  }

  piece.y += distance;
  piece.restingWorldTicks = 0;
  piece.pendingLock = false;
  piece.committed = true;
  events.push({
    type: "PIECE_HARD_DROPPED",
    pieceId: piece.id,
    distance,
    x: piece.x,
    y: piece.y
  });

  if (focusNextUsefulPieceAfter(state, piece, events)) return;

  maintainDropQueue(state, rules, events);
  bringNextSpawnForward(state);
  spawnDuePieces(state, rules, events);
}

function applyCommands(state, commands, rules, events) {
  if (state.status !== "playing") return;

  for (const command of commands) {
    if (!command || typeof command.type !== "string") continue;
    switch (command.type) {
      case "FOCUS_NEXT":
        if (cycleFocus(state, 1, events)) startFocusWorldHold(state, rules);
        break;
      case "FOCUS_PREVIOUS":
        if (cycleFocus(state, -1, events)) startFocusWorldHold(state, rules);
        break;
      case "SCULPT":
        if (applySculpt(state, command, rules, events)) refreshWorldHold(state, rules);
        break;
      case "HARD_DROP_FOCUSED":
        if (state.worldHoldSteps === 0) applyHardDrop(state, rules, events);
        break;
      default:
        break;
    }
  }

}

function applyGravity(state, rules, events) {
  const interval = gravityIntervalWorldTicksForLevel(rules, state.level);
  if (state.worldTick % interval !== 0) return;

  const ordered = [...state.activePieces].sort(
    (a, b) => pieceBottom(b) - pieceBottom(a) || a.spawnIndex - b.spawnIndex
  );

  for (const piece of ordered) {
    if (!findPiece(state, piece.id)) continue;
    if (!canTranslate(state, piece, 0, 1)) continue;
    piece.y += 1;
    piece.restingWorldTicks = 0;
    events.push({ type: "PIECE_MOVED", pieceId: piece.id, x: piece.x, y: piece.y });
  }
}

function operationGraceSteps(rules) {
  return rules.simulation.operationGraceSteps;
}

function startFocusWorldHold(state, rules) {
  const focusGraceSteps = rules.simulation.focusGraceSteps;
  if (focusGraceSteps <= 0) return;
  if (state.worldHoldSteps > 0) return;
  if (state.lastFocusHoldWorldTick === state.worldTick) return;
  state.worldHoldSteps = focusGraceSteps;
  state.lastFocusHoldWorldTick = state.worldTick;
}

function refreshWorldHold(state, rules) {
  state.worldHoldSteps = Math.max(state.worldHoldSteps, operationGraceSteps(rules));
}

function clearCompletedLines(state) {
  const { board } = state;
  const fullRows = [];
  for (let y = 0; y < board.height; y += 1) {
    let full = true;
    for (let x = 0; x < board.width; x += 1) {
      if (getBoardCell(board, x, y) === 0) {
        full = false;
        break;
      }
    }
    if (full) fullRows.push(y);
  }

  if (fullRows.length === 0) return 0;

  const full = new Set(fullRows);
  const newCells = new Uint8Array(board.width * board.height);
  let writeY = board.height - 1;
  for (let readY = board.height - 1; readY >= 0; readY -= 1) {
    if (full.has(readY)) continue;
    for (let x = 0; x < board.width; x += 1) {
      newCells[writeY * board.width + x] = getBoardCell(board, x, readY);
    }
    writeY -= 1;
  }
  board.cells = newCells;
  return fullRows.length;
}

function lockPiece(state, piece, events) {
  const locksAboveVisibleField = piece.cells.some(
    (cell) => piece.y + cell.y < state.board.hiddenHeight
  );
  for (const cell of piece.cells) {
    const x = piece.x + cell.x;
    const y = piece.y + cell.y;
    setBoardCell(state.board, x, y, piece.cellValue);
  }

  const index = state.activePieces.findIndex((candidate) => candidate.id === piece.id);
  if (index >= 0) state.activePieces.splice(index, 1);
  events.push({ type: "PIECE_LOCKED", pieceId: piece.id });
  if (state.focusedPieceId === piece.id) selectFallbackFocus(state);

  if (locksAboveVisibleField) {
    state.status = "gameover";
    state.gameOverReason = "lock-topout";
    events.push({ type: "GAME_OVER", reason: state.gameOverReason });
  }
}

function resolveLineClearRewards(state, rules, cleared, events) {
  if (cleared <= 0) return;
  state.totalLines += cleared;
  const scoreGain = scoreForLineClear(rules, cleared, state.level);
  state.score += scoreGain;
  events.push({ type: "LINES_CLEARED", count: cleared, totalLines: state.totalLines });
  events.push({ type: "SCORE_CHANGED", value: state.score });

  const nextLevel = 1 + Math.floor(state.totalLines / rules.progression.linesPerLevel);
  if (nextLevel !== state.level) {
    state.level = nextLevel;
    events.push({ type: "LEVEL_CHANGED", level: state.level });
  }
}

function resolveLocks(state, pieces, rules, events) {
  let lockedAny = false;
  for (const piece of pieces) {
    if (!findPiece(state, piece.id)) continue;
    if (canTranslate(state, piece, 0, 1)) continue;
    if (supportKindBelow(state, piece) === "active") continue;
    lockPiece(state, piece, events);
    lockedAny = true;
    if (state.status !== "playing") break;
  }

  if (lockedAny && state.status === "playing") {
    const cleared = clearCompletedLines(state);
    resolveLineClearRewards(state, rules, cleared, events);
  }
  return lockedAny;
}

function replenishAfterNaturalLock(state, rules, events) {
  if (state.status !== "playing") return;
  maintainDropQueue(state, rules, events);
  if (state.activePieces.some((piece) => !piece.committed)) return;
  bringNextSpawnForward(state);
  spawnDuePieces(state, rules, events);
}

function beginDueNaturalLocks(state, rules, events) {
  const ordered = [...state.activePieces].sort(
    (a, b) => pieceBottom(b) - pieceBottom(a) || a.spawnIndex - b.spawnIndex
  );
  const due = ordered.filter((piece) => (
    !piece.pendingLock
    && !canTranslate(state, piece, 0, 1)
    && supportKindBelow(state, piece) !== "active"
    && piece.restingWorldTicks + 1 >= rules.simulation.lockDelayWorldTicks
  ));
  if (due.length === 0) return false;

  if (operationGraceSteps(rules) === 0) {
    if (resolveLocks(state, due, rules, events)) {
      replenishAfterNaturalLock(state, rules, events);
    }
    return true;
  }

  for (const piece of due) {
    piece.restingWorldTicks = rules.simulation.lockDelayWorldTicks;
    piece.pendingLock = true;
    events.push({ type: "PIECE_LOCK_PENDING", pieceId: piece.id });
  }
  refreshWorldHold(state, rules);
  return true;
}

function finalizePendingLocks(state, rules, events) {
  const ordered = [...state.activePieces]
    .filter((piece) => piece.pendingLock)
    .sort((a, b) => pieceBottom(b) - pieceBottom(a) || a.spawnIndex - b.spawnIndex);
  if (ordered.length === 0) return false;

  const toLock = [];
  for (const piece of ordered) {
    piece.pendingLock = false;
    if (canTranslate(state, piece, 0, 1) || supportKindBelow(state, piece) === "active") {
      piece.restingWorldTicks = 0;
    } else {
      toLock.push(piece);
    }
  }
  return resolveLocks(state, toLock, rules, events);
}

function updateResting(state) {
  const ordered = [...state.activePieces].sort(
    (a, b) => pieceBottom(b) - pieceBottom(a) || a.spawnIndex - b.spawnIndex
  );

  for (const piece of ordered) {
    if (canTranslate(state, piece, 0, 1)) {
      piece.restingWorldTicks = 0;
      piece.pendingLock = false;
      continue;
    }

    const support = supportKindBelow(state, piece);
    if (support === "active") {
      piece.restingWorldTicks = 0;
      piece.pendingLock = false;
      continue;
    }

    piece.restingWorldTicks += 1;
  }
}


export function stepGameState(state, commands, rules) {
  const events = [];
  if (state.status !== "playing") return events;
  state.stepTick += 1;

  applyCommands(state, commands || [], rules, events);

  if (state.worldHoldSteps > 0) {
    state.worldHoldSteps -= 1;
    return events;
  }

  if (finalizePendingLocks(state, rules, events)) {
    replenishAfterNaturalLock(state, rules, events);
    return events;
  }

  if (beginDueNaturalLocks(state, rules, events)) {
    if (state.worldHoldSteps > 0) state.worldHoldSteps -= 1;
    return events;
  }

  applyScheduledGarbage(state, rules, events);
  if (state.status !== "playing") return events;

  spawnDuePieces(state, rules, events);
  if (state.status !== "playing") return events;

  applyGravity(state, rules, events);
  updateResting(state);
  if (state.status === "playing") maintainDropQueue(state, rules, events);
  state.worldTick += 1;
  return events;
}
