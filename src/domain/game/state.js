import {
  cellKey,
  clonePiece,
  currentFocusedPiece,
  getBoardCell
} from "./model.js";
import { hashSeed } from "./random.js";
import { getEditableFillCells } from "./sculpt.js";
import { maintainDropQueue } from "./drop-planner.js";

const GAME_SCHEMA_VERSION = 2;

export function createGameState({ seed = 1, rules }) {
  if (!rules) throw new Error("rules are required");
  const boardHeight = rules.board.visibleHeight + rules.board.hiddenHeight;
  const state = {
    schemaVersion: GAME_SCHEMA_VERSION,
    rulesetId: rules.id,
    worldTick: 0,
    stepTick: 0,
    worldHoldSteps: 0,
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
    nextScheduledSpawnWorldTick: null,
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

export function getFocusedPiece(state) {
  const piece = currentFocusedPiece(state);
  return piece ? clonePiece(piece) : null;
}


export function createGameViewState(state) {
  const focused = currentFocusedPiece(state);
  return {
    worldTick: state.worldTick,
    stepTick: state.stepTick,
    worldHoldSteps: state.worldHoldSteps,
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

export function snapshotGameState(state) {
  return {
    schemaVersion: state.schemaVersion,
    rulesetId: state.rulesetId,
    worldTick: state.worldTick,
    stepTick: state.stepTick,
    worldHoldSteps: state.worldHoldSteps,
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
    nextScheduledSpawnWorldTick: state.nextScheduledSpawnWorldTick,
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
  "worldTick",
  "stepTick",
  "worldHoldSteps",
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
  "nextScheduledSpawnWorldTick",
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

export function restoreGameState(snapshot) {
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
  const text = JSON.stringify(snapshotGameState(state));
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
