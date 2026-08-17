import {
  attackForLineClear,
  getGarbageCellValue,
  getTemplateBounds,
  getTemplateCellValue,
  getTemplateCells,
  getTemplateIds,
  getTemplateRotations,
  gravityIntervalForLevel,
  scoreForLineClear,
  spawnIntervalForLevel
} from "./rules.js";

const NEIGHBORS = Object.freeze([
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1]
]);

const DROP_COVERAGE_HISTORY_LIMIT = 48;
const DROP_POSITION_CHOICES = 2;
const GAME_SCHEMA_VERSION = 1;

function hashSeed(seed, salt) {
  let x = (seed ^ salt) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x7feb352d);
  x = Math.imul(x ^ (x >>> 15), 0x846ca68b);
  return (x ^ (x >>> 16)) >>> 0 || 1;
}

function nextRandomU32(stream) {
  let x = stream.state >>> 0 || 1;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  stream.state = x >>> 0 || 1;
  return stream.state;
}

function randomInt(stream, maxExclusive) {
  if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) {
    throw new Error("maxExclusive must be a positive integer");
  }
  return nextRandomU32(stream) % maxExclusive;
}

function cellKey(x, y) {
  return `${x},${y}`;
}

function compareCells(a, b) {
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

function getBoardCell(board, x, y) {
  return board.cells[boardIndex(board, x, y)];
}

function setBoardCell(board, x, y, value) {
  board.cells[boardIndex(board, x, y)] = value;
}

function allWorldCells(piece, dx = 0, dy = 0) {
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

function canOccupyWorldCells(state, worldCells, ignoredPieceId = null) {
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

function canTranslate(state, piece, dx, dy) {
  return canOccupyWorldCells(state, allWorldCells(piece, dx, dy), piece.id);
}

function supportKindBelow(state, piece) {
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

function pieceBottom(piece) {
  let max = -Infinity;
  for (const cell of piece.cells) {
    max = Math.max(max, piece.y + cell.y);
  }
  return max;
}

function findPiece(state, pieceId) {
  return state.activePieces.find((piece) => piece.id === pieceId) || null;
}

function currentFocusedPiece(state) {
  if (!state.focusedPieceId) return null;
  const piece = findPiece(state, state.focusedPieceId);
  return piece && !piece.committed ? piece : null;
}

function selectFallbackFocus(state) {
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

function cycleFocus(state, direction, events) {
  const usefulPieces = state.activePieces.filter((piece) => !piece.committed);
  if (usefulPieces.length === 0) {
    state.focusedPieceId = null;
    return;
  }

  const ordered = [...usefulPieces].sort((a, b) => a.spawnIndex - b.spawnIndex);
  const current = ordered.findIndex((piece) => piece.id === state.focusedPieceId);
  const base = current >= 0 ? current : 0;
  const next = (base + direction + ordered.length) % ordered.length;
  const nextId = ordered[next].id;

  if (state.focusedPieceId !== nextId) {
    state.focusedPieceId = nextId;
    events.push({ type: "FOCUS_CHANGED", pieceId: nextId });
  }
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
  piece.restingTicks = 0;
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
  piece.restingTicks = 0;
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

function applySculpt(state, command, rules, events) {
  const piece = currentFocusedPiece(state);
  if (!piece || command.pieceId !== piece.id) return false;
  if (!Number.isInteger(command.x) || !Number.isInteger(command.y)) return false;

  return hasLocalCell(piece, command.x, command.y)
    ? applyCarve(state, command, rules, events)
    : applyFill(state, command, rules, events);
}

function bringNextSpawnForward(state) {
  if (state.dropQueue.length === 0) return;
  const delta = state.tick - state.dropQueue[0].spawnTick;
  if (delta >= 0) return;

  for (const plan of state.dropQueue) plan.spawnTick += delta;
  if (state.nextScheduledSpawnTick != null) state.nextScheduledSpawnTick += delta;
}

function applyHardDrop(state, rules, events) {
  const piece = currentFocusedPiece(state);
  if (!piece) return;

  let distance = 0;
  while (canTranslate(state, piece, 0, distance + 1)) {
    distance += 1;
  }

  piece.y += distance;
  piece.restingTicks = 0;
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
  if (state.status !== "playing") return false;

  let sculptedThisTick = false;

  for (const command of commands) {
    if (!command || typeof command.type !== "string") continue;
    switch (command.type) {
      case "FOCUS_NEXT":
        cycleFocus(state, 1, events);
        break;
      case "FOCUS_PREVIOUS":
        cycleFocus(state, -1, events);
        break;
      case "SCULPT":
        sculptedThisTick = applySculpt(state, command, rules, events) || sculptedThisTick;
        break;
      case "HARD_DROP_FOCUSED":
        applyHardDrop(state, rules, events);
        break;
      default:
        break;
    }
  }

  return sculptedThisTick;
}

function getDropCoverage(state, rules) {
  const coverage = Array(state.board.width).fill(0);
  for (const plan of state.dropCoverageHistory) {
    for (const cell of getTemplateCells(rules, plan.templateId, plan.rotation)) {
      const x = plan.x + cell.x;
      if (x >= 0 && x < coverage.length) coverage[x] += 1;
    }
  }
  return coverage;
}

function chooseCoverageBalancedX(state, rules, templateId, rotation) {
  const cells = getTemplateCells(rules, templateId, rotation);
  const bounds = getTemplateBounds(rules, templateId, rotation);
  const maxX = state.board.width - bounds.width;
  const coverage = getDropCoverage(state, rules);
  let chosenX = randomInt(state.random.drops, maxX + 1);
  let chosenScore = cells.reduce((sum, cell) => sum + coverage[chosenX + cell.x], 0);

  // Sample only a small number of legal positions instead of globally
  // optimizing every drop. This nudges the long-run distribution toward
  // under-covered columns while still allowing local streaks and droughts.
  for (let choice = 1; choice < DROP_POSITION_CHOICES; choice += 1) {
    const x = randomInt(state.random.drops, maxX + 1);
    const score = cells.reduce((sum, cell) => sum + coverage[x + cell.x], 0);
    if (score < chosenScore) {
      chosenX = x;
      chosenScore = score;
    }
  }

  return chosenX;
}

function rememberDropCoverage(state, templateId, rotation, x) {
  state.dropCoverageHistory.push({ templateId, rotation, x });
  if (state.dropCoverageHistory.length > DROP_COVERAGE_HISTORY_LIMIT) {
    state.dropCoverageHistory.splice(
      0,
      state.dropCoverageHistory.length - DROP_COVERAGE_HISTORY_LIMIT
    );
  }
}

function makeDropPlan(state, spawnTick, rules) {
  const templateIds = getTemplateIds(rules);
  const templateId = templateIds[randomInt(state.random.pieces, templateIds.length)];
  const rotations = getTemplateRotations(rules, templateId);
  const rotation = rotations[randomInt(state.random.rotations, rotations.length)];
  const x = chooseCoverageBalancedX(state, rules, templateId, rotation);
  const pieceId = `p${state.nextPieceId++}`;
  rememberDropCoverage(state, templateId, rotation, x);

  return {
    pieceId,
    templateId,
    rotation,
    x,
    spawnTick
  };
}

function maintainDropQueue(state, rules, events) {
  const desired = Math.max(1, rules.progression.previewCount);
  while (state.dropQueue.length < desired) {
    let spawnTick;
    if (state.dropQueue.length === 0 && state.nextScheduledSpawnTick == null) {
      spawnTick = state.tick;
    } else if (state.dropQueue.length > 0) {
      const previous = state.dropQueue[state.dropQueue.length - 1];
      spawnTick = previous.spawnTick + spawnIntervalForLevel(rules, state.level);
    } else {
      spawnTick = state.nextScheduledSpawnTick;
    }

    const plan = makeDropPlan(state, spawnTick, rules);
    state.dropQueue.push(plan);
    state.nextScheduledSpawnTick = plan.spawnTick + spawnIntervalForLevel(rules, state.level);
    events.push({ type: "PIECE_PLANNED", plan: { ...plan } });
  }
}

function spawnDuePieces(state, rules, events) {
  while (state.dropQueue.length > 0 && state.dropQueue[0].spawnTick <= state.tick) {
    const plan = state.dropQueue.shift();
    const rotation = plan.rotation;
    const cells = getTemplateCells(rules, plan.templateId, rotation);
    const piece = {
      id: plan.pieceId,
      templateId: plan.templateId,
      rotation,
      cellValue: getTemplateCellValue(rules, plan.templateId),
      x: plan.x,
      y: 0,
      cells,
      carved: 0,
      carveLimit: rules.sculpting.carveLimit,
      restingTicks: 0,
      pendingLock: false,
      spawnIndex: state.nextSpawnIndex++,
      committed: false
    };

    if (!canOccupyWorldCells(state, allWorldCells(piece), piece.id)) {
      state.status = "gameover";
      state.gameOverReason = "spawn-blocked";
      events.push({ type: "GAME_OVER", reason: state.gameOverReason });
      return;
    }

    state.activePieces.push(piece);
    if (!state.focusedPieceId) {
      state.focusedPieceId = piece.id;
      events.push({ type: "FOCUS_CHANGED", pieceId: piece.id });
    }
    events.push({
      type: "PIECE_SPAWNED",
      pieceId: piece.id,
      templateId: piece.templateId,
      rotation: piece.rotation
    });
    maintainDropQueue(state, rules, events);
  }
}

function applyGravity(state, rules, events) {
  const interval = gravityIntervalForLevel(rules, state.level);
  if (state.tick % interval !== 0) return;

  const ordered = [...state.activePieces].sort(
    (a, b) => pieceBottom(b) - pieceBottom(a) || a.spawnIndex - b.spawnIndex
  );

  for (const piece of ordered) {
    if (!findPiece(state, piece.id)) continue;
    if (!canTranslate(state, piece, 0, 1)) continue;
    piece.y += 1;
    piece.restingTicks = 0;
    events.push({ type: "PIECE_MOVED", pieceId: piece.id, x: piece.x, y: piece.y });
  }
}

function operationGraceTicks(rules) {
  return Math.max(0, Math.floor(rules.simulation.operationGraceTicks || 0));
}

function refreshWorldHold(state, rules) {
  state.worldHoldTicks = Math.max(state.worldHoldTicks, operationGraceTicks(rules));
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

  const attackRows = attackForLineClear(rules, cleared);
  if (attackRows > 0) {
    events.push({ type: "ATTACK_GENERATED", rows: attackRows });
  }

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

function beginDueNaturalLocks(state, rules, events) {
  const ordered = [...state.activePieces].sort(
    (a, b) => pieceBottom(b) - pieceBottom(a) || a.spawnIndex - b.spawnIndex
  );
  const due = ordered.filter((piece) => (
    !piece.pendingLock
    && !canTranslate(state, piece, 0, 1)
    && supportKindBelow(state, piece) !== "active"
    && piece.restingTicks + 1 >= rules.simulation.lockDelayTicks
  ));
  if (due.length === 0) return false;

  if (operationGraceTicks(rules) === 0) {
    resolveLocks(state, due, rules, events);
    return true;
  }

  for (const piece of due) {
    piece.restingTicks = rules.simulation.lockDelayTicks;
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
      piece.restingTicks = 0;
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
      piece.restingTicks = 0;
      piece.pendingLock = false;
      continue;
    }

    const support = supportKindBelow(state, piece);
    if (support === "active") {
      piece.restingTicks = 0;
      piece.pendingLock = false;
      continue;
    }

    piece.restingTicks += 1;
  }
}

function garbageHoleSequence(seed, rows, width) {
  const stream = { state: hashSeed(seed >>> 0, 0x6d2b79f5) };
  const holes = [];
  for (let i = 0; i < rows; i += 1) holes.push(randomInt(stream, width));
  return holes;
}

function applyGarbageRows(state, packet, rules, events) {
  const rows = Math.min(packet.rows, state.board.height);
  if (rows <= 0) return;
  state.appliedGarbageIds.push(packet.id);
  const { board } = state;

  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < board.width; x += 1) {
      if (getBoardCell(board, x, y) !== 0) {
        state.status = "gameover";
        state.gameOverReason = "garbage-topout";
        events.push({ type: "GAME_OVER", reason: state.gameOverReason });
        return;
      }
    }
  }

  const shifted = new Uint8Array(board.width * board.height);
  for (let y = rows; y < board.height; y += 1) {
    for (let x = 0; x < board.width; x += 1) {
      shifted[(y - rows) * board.width + x] = getBoardCell(board, x, y);
    }
  }

  const holes = garbageHoleSequence(packet.seed, rows, board.width);
  for (let row = 0; row < rows; row += 1) {
    const y = board.height - rows + row;
    for (let x = 0; x < board.width; x += 1) {
      shifted[y * board.width + x] = x === holes[row] ? 0 : getGarbageCellValue(rules);
    }
  }
  board.cells = shifted;

  for (const piece of state.activePieces) {
    piece.y -= rows;
    piece.restingTicks = 0;
    piece.pendingLock = false;
    if (piece.cells.some((cell) => piece.y + cell.y < 0)) {
      state.status = "gameover";
      state.gameOverReason = "garbage-pushed-piece-out";
      events.push({ type: "GAME_OVER", reason: state.gameOverReason });
      return;
    }
  }

  events.push({
    type: "GARBAGE_APPLIED",
    packetId: packet.id,
    rows
  });
}

function applyScheduledGarbage(state, rules, events) {
  if (state.incomingGarbage.length === 0) return;
  state.incomingGarbage.sort((a, b) => a.applyTick - b.applyTick || a.id.localeCompare(b.id));

  while (state.incomingGarbage.length > 0) {
    const packet = state.incomingGarbage[0];
    if (packet.applyTick > state.tick) break;
    state.incomingGarbage.shift();
    if (packet.rows > 0) applyGarbageRows(state, packet, rules, events);
    if (state.status !== "playing") return;
  }
}

export function cancelIncomingGarbage(state, rows) {
  let remaining = Math.max(0, Math.floor(rows));
  let cancelled = 0;
  state.incomingGarbage.sort((a, b) => a.applyTick - b.applyTick || a.id.localeCompare(b.id));

  for (const packet of state.incomingGarbage) {
    if (remaining <= 0) break;
    const amount = Math.min(packet.rows, remaining);
    packet.rows -= amount;
    remaining -= amount;
    cancelled += amount;
    if (packet.rows === 0 && !state.appliedGarbageIds.includes(packet.id)) {
      state.appliedGarbageIds.push(packet.id);
    }
  }

  state.incomingGarbage = state.incomingGarbage.filter((packet) => packet.rows > 0);
  return { cancelled, remaining };
}

export function queueGarbage(state, packet) {
  if (!packet || !packet.id || !Number.isInteger(packet.rows) || packet.rows <= 0) return false;
  if (!Number.isInteger(packet.applyTick) || !Number.isInteger(packet.seed)) return false;
  if (state.appliedGarbageIds.includes(packet.id)) return false;
  if (state.incomingGarbage.some((existing) => existing.id === packet.id)) return false;

  state.incomingGarbage.push({
    id: String(packet.id),
    sourcePlayerId: packet.sourcePlayerId == null ? null : String(packet.sourcePlayerId),
    rows: packet.rows,
    applyTick: packet.applyTick,
    seed: packet.seed >>> 0
  });
  return true;
}

export function createGame({ seed = 1, rules }) {
  if (!rules) throw new Error("rules are required");
  const boardHeight = rules.board.visibleHeight + rules.board.hiddenHeight;
  const state = {
    schemaVersion: GAME_SCHEMA_VERSION,
    rulesetId: rules.id,
    tick: 0,
    simulationTick: 0,
    worldHoldTicks: 0,
    board: {
      width: rules.board.width,
      height: boardHeight,
      visibleHeight: rules.board.visibleHeight,
      hiddenHeight: rules.board.hiddenHeight,
      cells: new Uint8Array(rules.board.width * boardHeight)
    },
    activePieces: [],
    focusedPieceId: null,
    dropQueue: [],
    dropCoverageHistory: [],
    incomingGarbage: [],
    appliedGarbageIds: [],
    scrap: 0,
    score: 0,
    totalLines: 0,
    level: 1,
    status: "playing",
    gameOverReason: null,
    nextPieceId: 1,
    nextSpawnIndex: 1,
    nextScheduledSpawnTick: null,
    random: {
      pieces: { state: hashSeed(seed >>> 0, 0x243f6a88) },
      rotations: { state: hashSeed(seed >>> 0, 0xa4093822) },
      drops: { state: hashSeed(seed >>> 0, 0x85a308d3) },
      garbage: { state: hashSeed(seed >>> 0, 0x13198a2e) }
    }
  };

  const events = [];
  maintainDropQueue(state, rules, events);
  return state;
}

export function stepGame(state, commands, rules) {
  const events = [];
  if (state.status !== "playing") return events;
  state.simulationTick += 1;

  const sculptedThisTick = applyCommands(state, commands || [], rules, events);
  if (sculptedThisTick) refreshWorldHold(state, rules);

  if (state.worldHoldTicks > 0) {
    state.worldHoldTicks -= 1;
    return events;
  }

  if (finalizePendingLocks(state, rules, events)) {
    if (state.status === "playing") maintainDropQueue(state, rules, events);
    return events;
  }

  if (beginDueNaturalLocks(state, rules, events)) {
    if (state.worldHoldTicks > 0) state.worldHoldTicks -= 1;
    return events;
  }

  applyScheduledGarbage(state, rules, events);
  if (state.status !== "playing") return events;

  spawnDuePieces(state, rules, events);
  if (state.status !== "playing") return events;

  applyGravity(state, rules, events);
  updateResting(state);
  if (state.status === "playing") maintainDropQueue(state, rules, events);
  state.tick += 1;
  return events;
}

export function getFocusedPiece(state) {
  const piece = currentFocusedPiece(state);
  return piece ? clonePiece(piece) : null;
}

function clonePiece(piece) {
  return {
    ...piece,
    pendingLock: Boolean(piece.pendingLock),
    cells: normalizeCells(piece.cells)
  };
}

export function createGameView(state) {
  const focused = currentFocusedPiece(state);
  return {
    tick: state.tick,
    simulationTick: state.simulationTick,
    worldHoldTicks: state.worldHoldTicks,
    board: {
      width: state.board.width,
      height: state.board.height,
      visibleHeight: state.board.visibleHeight,
      hiddenHeight: state.board.hiddenHeight,
      cells: Array.from(state.board.cells)
    },
    activePieces: state.activePieces.map(clonePiece),
    focusedPiece: focused ? clonePiece(focused) : null,
    editableFillCells: focused ? getEditableFillCells(state, focused.id) : [],
    next: state.dropQueue[0] ? { ...state.dropQueue[0] } : null,
    score: state.score,
    scrap: state.scrap,
    totalLines: state.totalLines,
    level: state.level,
    incomingGarbage: state.incomingGarbage.map((packet) => ({ ...packet })),
    status: state.status,
    gameOverReason: state.gameOverReason
  };
}

export function snapshotGame(state) {
  return {
    schemaVersion: state.schemaVersion,
    rulesetId: state.rulesetId,
    tick: state.tick,
    simulationTick: state.simulationTick,
    worldHoldTicks: state.worldHoldTicks,
    board: {
      width: state.board.width,
      height: state.board.height,
      visibleHeight: state.board.visibleHeight,
      hiddenHeight: state.board.hiddenHeight,
      cells: Array.from(state.board.cells)
    },
    activePieces: state.activePieces.map(clonePiece),
    focusedPieceId: state.focusedPieceId,
    dropQueue: state.dropQueue.map((plan) => ({ ...plan })),
    dropCoverageHistory: state.dropCoverageHistory.map((plan) => ({ ...plan })),
    incomingGarbage: state.incomingGarbage.map((packet) => ({ ...packet })),
    appliedGarbageIds: [...state.appliedGarbageIds],
    scrap: state.scrap,
    score: state.score,
    totalLines: state.totalLines,
    level: state.level,
    status: state.status,
    gameOverReason: state.gameOverReason,
    nextPieceId: state.nextPieceId,
    nextSpawnIndex: state.nextSpawnIndex,
    nextScheduledSpawnTick: state.nextScheduledSpawnTick,
    random: {
      pieces: { ...state.random.pieces },
      rotations: { ...state.random.rotations },
      drops: { ...state.random.drops },
      garbage: { ...state.random.garbage }
    }
  };
}

const CURRENT_SNAPSHOT_KEYS = Object.freeze([
  "schemaVersion",
  "rulesetId",
  "tick",
  "simulationTick",
  "worldHoldTicks",
  "board",
  "activePieces",
  "focusedPieceId",
  "dropQueue",
  "dropCoverageHistory",
  "incomingGarbage",
  "appliedGarbageIds",
  "scrap",
  "score",
  "totalLines",
  "level",
  "status",
  "gameOverReason",
  "nextPieceId",
  "nextSpawnIndex",
  "nextScheduledSpawnTick",
  "random"
]);

function assertCurrentSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    throw new Error("game snapshot must be an object");
  }
  const expected = new Set(CURRENT_SNAPSHOT_KEYS);
  for (const key of Object.keys(snapshot)) {
    if (!expected.has(key)) throw new Error(`snapshot.${key} is not supported`);
  }
  for (const key of CURRENT_SNAPSHOT_KEYS) {
    if (!Object.hasOwn(snapshot, key)) throw new Error(`snapshot.${key} is required`);
  }
  if (snapshot.schemaVersion !== GAME_SCHEMA_VERSION) {
    throw new Error(`Unsupported game snapshot schema: ${snapshot.schemaVersion}`);
  }
  if (!snapshot.random || typeof snapshot.random !== "object") {
    throw new Error("snapshot.random is required");
  }
  for (const stream of ["pieces", "rotations", "drops", "garbage"]) {
    if (!Object.hasOwn(snapshot.random, stream)) {
      throw new Error(`snapshot.random.${stream} is required`);
    }
  }
  for (const [index, plan] of snapshot.dropQueue.entries()) {
    if (!Object.hasOwn(plan, "rotation")) throw new Error(`snapshot.dropQueue[${index}].rotation is required`);
  }
  for (const [index, plan] of snapshot.dropCoverageHistory.entries()) {
    if (!Object.hasOwn(plan, "rotation")) {
      throw new Error(`snapshot.dropCoverageHistory[${index}].rotation is required`);
    }
  }
  for (const [index, piece] of snapshot.activePieces.entries()) {
    for (const field of ["rotation", "pendingLock", "committed"]) {
      if (!Object.hasOwn(piece, field)) {
        throw new Error(`snapshot.activePieces[${index}].${field} is required`);
      }
    }
  }
}

export function restoreGame(snapshot) {
  assertCurrentSnapshot(snapshot);
  const state = {
    ...snapshot,
    board: {
      ...snapshot.board,
      cells: Uint8Array.from(snapshot.board.cells)
    },
    activePieces: snapshot.activePieces.map(clonePiece),
    dropQueue: snapshot.dropQueue.map((plan) => ({ ...plan })),
    dropCoverageHistory: snapshot.dropCoverageHistory.map((plan) => ({ ...plan })),
    incomingGarbage: snapshot.incomingGarbage.map((packet) => ({ ...packet })),
    appliedGarbageIds: [...snapshot.appliedGarbageIds],
    random: {
      pieces: { ...snapshot.random.pieces },
      rotations: { ...snapshot.random.rotations },
      drops: { ...snapshot.random.drops },
      garbage: { ...snapshot.random.garbage }
    }
  };
  assertGameState(state);
  return state;
}

export function hashGameState(state) {
  const text = JSON.stringify(snapshotGame(state));
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function assertGameState(state) {
  if (state.scrap < 0) throw new Error("scrap cannot be negative");
  const ids = new Set();
  const occupied = new Set();

  for (const piece of state.activePieces) {
    if (ids.has(piece.id)) throw new Error(`duplicate piece id: ${piece.id}`);
    ids.add(piece.id);
    if (piece.cells.length === 0) throw new Error(`piece has no cells: ${piece.id}`);
    if (piece.carved > piece.carveLimit) throw new Error(`carve limit exceeded: ${piece.id}`);
    const local = new Set();
    for (const cell of piece.cells) {
      const localKey = cellKey(cell.x, cell.y);
      if (local.has(localKey)) throw new Error(`duplicate local cell in ${piece.id}`);
      local.add(localKey);
      const x = piece.x + cell.x;
      const y = piece.y + cell.y;
      if (x < 0 || x >= state.board.width || y < 0 || y >= state.board.height) {
        throw new Error(`piece out of bounds: ${piece.id}`);
      }
      const worldKey = cellKey(x, y);
      if (occupied.has(worldKey)) throw new Error(`active pieces overlap at ${worldKey}`);
      occupied.add(worldKey);
      if (getBoardCell(state.board, x, y) !== 0) {
        throw new Error(`active piece overlaps board at ${worldKey}`);
      }
    }
  }
  return true;
}
