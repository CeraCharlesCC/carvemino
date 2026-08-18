import { getGarbageCellValue } from "../rules.js";
import { getBoardCell } from "./model.js";
import { hashSeed, randomInt } from "./random.js";

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
    piece.restingWorldTicks = 0;
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

export function applyScheduledGarbage(state, rules, events) {
  if (state.incomingGarbage.length === 0) return;
  state.incomingGarbage.sort((a, b) => a.applyAtWorldTick - b.applyAtWorldTick || a.id.localeCompare(b.id));

  while (state.incomingGarbage.length > 0) {
    const packet = state.incomingGarbage[0];
    if (packet.applyAtWorldTick > state.worldTick) break;
    state.incomingGarbage.shift();
    if (packet.rows > 0) applyGarbageRows(state, packet, rules, events);
    if (state.status !== "playing") return;
  }
}

export function cancelIncomingGarbage(state, rows) {
  let remaining = Math.max(0, Math.floor(rows));
  let cancelled = 0;
  state.incomingGarbage.sort((a, b) => a.applyAtWorldTick - b.applyAtWorldTick || a.id.localeCompare(b.id));

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
  if (!Number.isInteger(packet.applyAtWorldTick) || !Number.isInteger(packet.seed)) return false;
  if (state.appliedGarbageIds.includes(packet.id)) return false;
  if (state.incomingGarbage.some((existing) => existing.id === packet.id)) return false;

  state.incomingGarbage.push({
    id: String(packet.id),
    sourcePlayerId: packet.sourcePlayerId == null ? null : String(packet.sourcePlayerId),
    rows: packet.rows,
    applyAtWorldTick: packet.applyAtWorldTick,
    seed: packet.seed >>> 0
  });
  return true;
}
