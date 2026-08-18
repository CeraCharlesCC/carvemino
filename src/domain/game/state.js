import {
  cellKey,
  clonePiece,
  currentFocusedPiece,
  getBoardCell
} from "./model.js";
import { hashSeed } from "./random.js";
import { getEditableFillCells } from "./sculpt.js";
import { maintainDropQueue } from "./drop-planner.js";
import {
  getTemplateBounds,
  getTemplateCellValue,
  getTemplateCells,
  getTemplateRotations
} from "../rules.js";

const GAME_SCHEMA_VERSION = 3;
const RANDOM_STREAM_KEYS = Object.freeze(["pieces", "rotations", "drops"]);
const BOARD_KEYS = Object.freeze(["width", "height", "visibleHeight", "hiddenHeight", "cells"]);
const DROP_PLAN_KEYS = Object.freeze(["pieceId", "templateId", "rotation", "x", "spawnAtWorldTick"]);
const DROP_COVERAGE_KEYS = Object.freeze(["templateId", "rotation", "x"]);
const PIECE_KEYS = Object.freeze([
  "id",
  "templateId",
  "rotation",
  "cellValue",
  "x",
  "y",
  "cells",
  "carved",
  "carveLimit",
  "restingWorldTicks",
  "pendingLock",
  "spawnIndex",
  "committed"
]);
const GARBAGE_PACKET_KEYS = Object.freeze([
  "id",
  "sourcePlayerId",
  "rows",
  "applyAtWorldTick",
  "seed"
]);
const GAME_OVER_REASONS = new Set([
  "spawn-blocked",
  "garbage-topout",
  "garbage-pushed-piece-out",
  "lock-topout"
]);
const UINT32_MAX = 0xffffffff;

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
      drops: { state: hashSeed(seed >>> 0, 0x85a308d3) }
    }
  };

  const events = [];
  maintainDropQueue(state, rules, events);
  return state;
}

function projectCell(cell) {
  return { x: cell.x, y: cell.y };
}

function cellStyleForValue(rules, cellValue) {
  const style = rules.presentation.cellStyles[String(cellValue)];
  if (!style) throw new Error(`Missing presentation style for cell value ${cellValue}`);
  return style;
}

function projectPiece(piece, state, rules) {
  return {
    id: piece.id,
    x: piece.x,
    y: piece.y - state.board.hiddenHeight,
    cells: piece.cells.map(projectCell),
    style: cellStyleForValue(rules, piece.cellValue),
    pendingLock: piece.pendingLock
  };
}

function projectBoard(state, rules) {
  const { width, visibleHeight, hiddenHeight, cells } = state.board;
  const start = hiddenHeight * width;
  const end = start + visibleHeight * width;
  return {
    width,
    height: visibleHeight,
    cells: Array.from(cells.slice(start, end), (cellValue) => (
      cellValue === 0 ? null : cellStyleForValue(rules, cellValue)
    ))
  };
}

function projectNextPiece(state, rules) {
  const plan = state.dropQueue[0];
  if (!plan) return null;
  return {
    x: plan.x,
    cells: getTemplateCells(rules, plan.templateId, plan.rotation),
    style: cellStyleForValue(rules, getTemplateCellValue(rules, plan.templateId))
  };
}

function projectSculpt(state, focused, rules) {
  const fillCost = rules.sculpting.fillCost;
  const canCarve = Boolean(focused)
    && focused.carved < focused.carveLimit
    && focused.cells.length > rules.sculpting.minimumCells;
  const canFill = Boolean(focused) && state.scrap >= fillCost;
  return {
    carve: {
      remaining: focused ? Math.max(0, focused.carveLimit - focused.carved) : 0,
      limit: focused ? focused.carveLimit : rules.sculpting.carveLimit,
      targets: canCarve ? focused.cells.map(projectCell) : []
    },
    fill: {
      cost: fillCost,
      targets: canFill ? getEditableFillCells(state, focused.id).map(projectCell) : []
    }
  };
}

export function createGameViewState(state, rules) {
  if (!rules) throw new Error("rules are required to project game state");
  const focused = currentFocusedPiece(state);
  const activePieces = state.activePieces.map((piece) => projectPiece(piece, state, rules));
  const focusedPiece = focused
    ? activePieces.find((piece) => piece.id === focused.id) || null
    : null;
  return {
    board: projectBoard(state, rules),
    activePieces,
    focusedPiece,
    sculpt: projectSculpt(state, focused, rules),
    nextPiece: projectNextPiece(state, rules),
    score: state.score,
    scrap: state.scrap,
    totalLines: state.totalLines,
    level: state.level,
    incomingGarbageRows: state.incomingGarbage.reduce((sum, packet) => sum + packet.rows, 0),
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
      drops: { ...state.random.drops }
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

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertPlainObject(value, path) {
  if (!isPlainObject(value)) throw new Error(`${path} must be an object`);
}

function assertExactKeys(value, keys, path) {
  assertPlainObject(value, path);
  const expected = new Set(keys);
  for (const key of Object.keys(value)) {
    if (!expected.has(key)) throw new Error(`${path}.${key} is not supported`);
  }
  for (const key of keys) {
    if (!Object.hasOwn(value, key)) throw new Error(`${path}.${key} is required`);
  }
}

function assertSafeInteger(value, path, { minimum = Number.MIN_SAFE_INTEGER, maximum = Number.MAX_SAFE_INTEGER } = {}) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${path} must be an integer between ${minimum} and ${maximum}`);
  }
}

function assertBoolean(value, path) {
  if (typeof value !== "boolean") throw new Error(`${path} must be a boolean`);
}

function assertNonEmptyString(value, path) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${path} must be a non-empty string`);
  }
}

function generatedPieceNumber(pieceId) {
  const match = /^p([1-9]\d*)$/.exec(pieceId);
  return match ? BigInt(match[1]) : null;
}

function assertArray(value, path, maximumLength = Number.MAX_SAFE_INTEGER) {
  if (!Array.isArray(value)) throw new Error(`${path} must be an array`);
  if (value.length > maximumLength) {
    throw new Error(`${path} must contain at most ${maximumLength} entries`);
  }
}

function allowedBoardCellValues(rules) {
  return new Set([
    0,
    rules.pieces.garbageCellValue,
    ...Object.values(rules.pieces.templates).map((template) => template.cellValue)
  ]);
}

function assertBoardSnapshot(board, rules) {
  assertExactKeys(board, BOARD_KEYS, "snapshot.board");
  const expectedHeight = rules.board.visibleHeight + rules.board.hiddenHeight;
  assertSafeInteger(board.width, "snapshot.board.width", { minimum: 1 });
  assertSafeInteger(board.height, "snapshot.board.height", { minimum: 1 });
  assertSafeInteger(board.visibleHeight, "snapshot.board.visibleHeight", { minimum: 1 });
  assertSafeInteger(board.hiddenHeight, "snapshot.board.hiddenHeight", { minimum: 0 });

  if (board.width !== rules.board.width) {
    throw new Error(`snapshot.board.width must match ruleset width ${rules.board.width}`);
  }
  if (board.visibleHeight !== rules.board.visibleHeight) {
    throw new Error(`snapshot.board.visibleHeight must match ruleset visible height ${rules.board.visibleHeight}`);
  }
  if (board.hiddenHeight !== rules.board.hiddenHeight) {
    throw new Error(`snapshot.board.hiddenHeight must match ruleset hidden height ${rules.board.hiddenHeight}`);
  }
  if (board.height !== expectedHeight || board.height !== board.visibleHeight + board.hiddenHeight) {
    throw new Error(`snapshot.board.height must match ruleset height ${expectedHeight}`);
  }

  assertArray(board.cells, "snapshot.board.cells", board.width * board.height);
  if (board.cells.length !== board.width * board.height) {
    throw new Error(`snapshot.board.cells must contain exactly ${board.width * board.height} cells`);
  }
  const allowed = allowedBoardCellValues(rules);
  for (const [index, value] of board.cells.entries()) {
    assertSafeInteger(value, `snapshot.board.cells[${index}]`, { minimum: 0, maximum: 255 });
    if (!allowed.has(value)) {
      throw new Error(`snapshot.board.cells[${index}] contains unsupported cell value ${value}`);
    }
  }
}

function assertTemplatePlacement(plan, path, rules) {
  assertNonEmptyString(plan.templateId, `${path}.templateId`);
  if (!Object.hasOwn(rules.pieces.templates, plan.templateId)) {
    throw new Error(`${path}.templateId is unknown: ${plan.templateId}`);
  }
  assertSafeInteger(plan.rotation, `${path}.rotation`, { minimum: 0, maximum: 3 });
  if (!getTemplateRotations(rules, plan.templateId).includes(plan.rotation)) {
    throw new Error(`${path}.rotation is not allowed for template ${plan.templateId}`);
  }
  const bounds = getTemplateBounds(rules, plan.templateId, plan.rotation);
  assertSafeInteger(plan.x, `${path}.x`, {
    minimum: 0,
    maximum: rules.board.width - bounds.width
  });
}

function assertDropPlan(plan, path, rules) {
  assertExactKeys(plan, DROP_PLAN_KEYS, path);
  assertNonEmptyString(plan.pieceId, `${path}.pieceId`);
  assertTemplatePlacement(plan, path, rules);
  assertSafeInteger(plan.spawnAtWorldTick, `${path}.spawnAtWorldTick`, { minimum: 0 });
}

function assertDropCoverage(plan, path, rules) {
  assertExactKeys(plan, DROP_COVERAGE_KEYS, path);
  assertTemplatePlacement(plan, path, rules);
}

function assertPieceSnapshot(piece, path, rules, boardCellCount) {
  assertExactKeys(piece, PIECE_KEYS, path);
  assertNonEmptyString(piece.id, `${path}.id`);
  assertNonEmptyString(piece.templateId, `${path}.templateId`);
  if (!Object.hasOwn(rules.pieces.templates, piece.templateId)) {
    throw new Error(`${path}.templateId is unknown: ${piece.templateId}`);
  }
  assertSafeInteger(piece.rotation, `${path}.rotation`, { minimum: 0, maximum: 3 });
  if (!getTemplateRotations(rules, piece.templateId).includes(piece.rotation)) {
    throw new Error(`${path}.rotation is not allowed for template ${piece.templateId}`);
  }
  assertSafeInteger(piece.cellValue, `${path}.cellValue`, { minimum: 1, maximum: 255 });
  if (piece.cellValue !== getTemplateCellValue(rules, piece.templateId)) {
    throw new Error(`${path}.cellValue does not match template ${piece.templateId}`);
  }
  assertSafeInteger(piece.x, `${path}.x`);
  assertSafeInteger(piece.y, `${path}.y`);
  assertArray(piece.cells, `${path}.cells`, boardCellCount);
  if (piece.cells.length === 0) throw new Error(`${path}.cells must not be empty`);
  for (const [cellIndex, cell] of piece.cells.entries()) {
    const cellPath = `${path}.cells[${cellIndex}]`;
    assertExactKeys(cell, ["x", "y"], cellPath);
    assertSafeInteger(cell.x, `${cellPath}.x`);
    assertSafeInteger(cell.y, `${cellPath}.y`);
  }
  assertSafeInteger(piece.carved, `${path}.carved`, { minimum: 0 });
  assertSafeInteger(piece.carveLimit, `${path}.carveLimit`, { minimum: 0 });
  if (piece.carveLimit !== rules.sculpting.carveLimit) {
    throw new Error(`${path}.carveLimit must match ruleset carve limit ${rules.sculpting.carveLimit}`);
  }
  if (piece.carved > piece.carveLimit) throw new Error(`${path}.carved exceeds carveLimit`);
  assertSafeInteger(piece.restingWorldTicks, `${path}.restingWorldTicks`, {
    minimum: 0,
    maximum: rules.simulation.lockDelayWorldTicks
  });
  assertBoolean(piece.pendingLock, `${path}.pendingLock`);
  assertSafeInteger(piece.spawnIndex, `${path}.spawnIndex`, { minimum: 1 });
  assertBoolean(piece.committed, `${path}.committed`);
}

function assertGarbagePacket(packet, path) {
  assertExactKeys(packet, GARBAGE_PACKET_KEYS, path);
  assertNonEmptyString(packet.id, `${path}.id`);
  if (packet.sourcePlayerId !== null) assertNonEmptyString(packet.sourcePlayerId, `${path}.sourcePlayerId`);
  assertSafeInteger(packet.rows, `${path}.rows`, { minimum: 1 });
  assertSafeInteger(packet.applyAtWorldTick, `${path}.applyAtWorldTick`, { minimum: 0 });
  assertSafeInteger(packet.seed, `${path}.seed`, { minimum: 0, maximum: UINT32_MAX });
}

function assertStatusFields(snapshot) {
  if (snapshot.status !== "playing" && snapshot.status !== "gameover") {
    throw new Error("snapshot.status must be playing or gameover");
  }
  if (snapshot.status === "playing") {
    if (snapshot.gameOverReason !== null) {
      throw new Error("snapshot.gameOverReason must be null while playing");
    }
    return;
  }
  if (!GAME_OVER_REASONS.has(snapshot.gameOverReason)) {
    throw new Error(`snapshot.gameOverReason is invalid: ${String(snapshot.gameOverReason)}`);
  }
}

function assertRandomStreams(random) {
  assertExactKeys(random, RANDOM_STREAM_KEYS, "snapshot.random");
  for (const stream of RANDOM_STREAM_KEYS) {
    const path = `snapshot.random.${stream}`;
    assertExactKeys(random[stream], ["state"], path);
    assertSafeInteger(random[stream].state, `${path}.state`, { minimum: 1, maximum: UINT32_MAX });
  }
}

function assertCurrentSnapshot(snapshot, rules) {
  assertExactKeys(snapshot, CURRENT_SNAPSHOT_KEYS, "snapshot");
  if (snapshot.schemaVersion !== GAME_SCHEMA_VERSION) {
    throw new Error(`Unsupported game snapshot schema: ${snapshot.schemaVersion}`);
  }
  assertNonEmptyString(snapshot.rulesetId, "snapshot.rulesetId");
  if (snapshot.rulesetId !== rules.id) {
    throw new Error(`snapshot.rulesetId must match ruleset ${rules.id}`);
  }

  assertSafeInteger(snapshot.worldTick, "snapshot.worldTick", { minimum: 0 });
  assertSafeInteger(snapshot.stepTick, "snapshot.stepTick", { minimum: 0 });
  assertSafeInteger(snapshot.worldHoldSteps, "snapshot.worldHoldSteps", {
    minimum: 0,
    maximum: rules.simulation.operationGraceSteps
  });
  assertBoardSnapshot(snapshot.board, rules);

  const boardCellCount = snapshot.board.width * snapshot.board.height;
  assertArray(snapshot.activePieces, "snapshot.activePieces", boardCellCount);
  const pieceIds = new Set();
  const spawnIndexes = new Set();
  let highestReservedPieceNumber = 0n;
  let highestReservedSpawnIndex = 0;
  for (const [index, piece] of snapshot.activePieces.entries()) {
    const path = `snapshot.activePieces[${index}]`;
    assertPieceSnapshot(piece, path, rules, boardCellCount);
    if (pieceIds.has(piece.id)) throw new Error(`${path}.id duplicates piece id ${piece.id}`);
    if (spawnIndexes.has(piece.spawnIndex)) {
      throw new Error(`${path}.spawnIndex duplicates spawn index ${piece.spawnIndex}`);
    }
    pieceIds.add(piece.id);
    spawnIndexes.add(piece.spawnIndex);
    const pieceNumber = generatedPieceNumber(piece.id);
    if (pieceNumber !== null && pieceNumber > highestReservedPieceNumber) {
      highestReservedPieceNumber = pieceNumber;
    }
    highestReservedSpawnIndex = Math.max(highestReservedSpawnIndex, piece.spawnIndex);
  }

  if (snapshot.focusedPieceId !== null) {
    assertNonEmptyString(snapshot.focusedPieceId, "snapshot.focusedPieceId");
    const focused = snapshot.activePieces.find((piece) => piece.id === snapshot.focusedPieceId);
    if (!focused) throw new Error("snapshot.focusedPieceId must identify an active piece");
    if (focused.committed) throw new Error("snapshot.focusedPieceId cannot identify a committed piece");
  }

  assertArray(snapshot.dropQueue, "snapshot.dropQueue", rules.progression.dropQueueDepth);
  let previousSpawnTick = -1;
  for (const [index, plan] of snapshot.dropQueue.entries()) {
    const path = `snapshot.dropQueue[${index}]`;
    assertDropPlan(plan, path, rules);
    if (pieceIds.has(plan.pieceId)) throw new Error(`${path}.pieceId duplicates piece id ${plan.pieceId}`);
    pieceIds.add(plan.pieceId);
    const pieceNumber = generatedPieceNumber(plan.pieceId);
    if (pieceNumber !== null && pieceNumber > highestReservedPieceNumber) {
      highestReservedPieceNumber = pieceNumber;
    }
    if (plan.spawnAtWorldTick < previousSpawnTick) {
      throw new Error("snapshot.dropQueue must be ordered by spawnAtWorldTick");
    }
    previousSpawnTick = plan.spawnAtWorldTick;
  }

  assertArray(
    snapshot.dropCoverageHistory,
    "snapshot.dropCoverageHistory",
    rules.simulation.dropCoverageHistoryLength
  );
  for (const [index, plan] of snapshot.dropCoverageHistory.entries()) {
    assertDropCoverage(plan, `snapshot.dropCoverageHistory[${index}]`, rules);
  }

  assertArray(snapshot.incomingGarbage, "snapshot.incomingGarbage");
  const garbageIds = new Set();
  for (const [index, packet] of snapshot.incomingGarbage.entries()) {
    const path = `snapshot.incomingGarbage[${index}]`;
    assertGarbagePacket(packet, path);
    if (garbageIds.has(packet.id)) throw new Error(`${path}.id duplicates garbage id ${packet.id}`);
    garbageIds.add(packet.id);
  }

  assertArray(snapshot.appliedGarbageIds, "snapshot.appliedGarbageIds");
  const appliedIds = new Set();
  for (const [index, id] of snapshot.appliedGarbageIds.entries()) {
    assertNonEmptyString(id, `snapshot.appliedGarbageIds[${index}]`);
    if (appliedIds.has(id)) throw new Error(`snapshot.appliedGarbageIds contains duplicate id ${id}`);
    if (garbageIds.has(id)) throw new Error(`garbage id ${id} cannot be both incoming and applied`);
    appliedIds.add(id);
  }

  assertSafeInteger(snapshot.scrap, "snapshot.scrap", { minimum: 0 });
  assertSafeInteger(snapshot.score, "snapshot.score", { minimum: 0 });
  assertSafeInteger(snapshot.totalLines, "snapshot.totalLines", { minimum: 0 });
  assertSafeInteger(snapshot.level, "snapshot.level", { minimum: 1 });
  const expectedLevel = 1 + Math.floor(snapshot.totalLines / rules.progression.linesPerLevel);
  if (snapshot.level !== expectedLevel) {
    throw new Error(`snapshot.level must be ${expectedLevel} for ${snapshot.totalLines} total lines`);
  }
  assertStatusFields(snapshot);
  assertSafeInteger(snapshot.nextPieceId, "snapshot.nextPieceId", { minimum: 1 });
  assertSafeInteger(snapshot.nextSpawnIndex, "snapshot.nextSpawnIndex", { minimum: 1 });
  if (BigInt(snapshot.nextPieceId) <= highestReservedPieceNumber) {
    throw new Error(
      `snapshot.nextPieceId must be greater than reserved piece id p${highestReservedPieceNumber}`
    );
  }
  if (snapshot.nextSpawnIndex <= highestReservedSpawnIndex) {
    throw new Error(
      `snapshot.nextSpawnIndex must be greater than reserved spawn index ${highestReservedSpawnIndex}`
    );
  }
  if (snapshot.nextScheduledSpawnWorldTick !== null) {
    assertSafeInteger(snapshot.nextScheduledSpawnWorldTick, "snapshot.nextScheduledSpawnWorldTick", { minimum: 0 });
  }
  assertRandomStreams(snapshot.random);
}

export function restoreGameState(snapshot, rules) {
  if (!rules) throw new Error("rules are required to restore game state");
  assertCurrentSnapshot(snapshot, rules);
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
      drops: { ...snapshot.random.drops }
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
      const terminalGarbagePush = state.status === "gameover"
        && state.gameOverReason === "garbage-pushed-piece-out";
      if (
        x < 0
        || x >= state.board.width
        || y >= state.board.height
        || (y < 0 && (!terminalGarbagePush || y < -state.board.height))
      ) {
        throw new Error(`piece out of bounds: ${piece.id}`);
      }
      if (y < 0) continue;
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
