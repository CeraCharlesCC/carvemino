import {
  cellKey,
  clonePiece,
  currentFocusedPiece,
  getBoardCell
} from "./model.js";
import { hashSeed } from "./random.js";
import { parseGeneratedPieceNumber } from "./piece-id.js";
import { getEditableFillCells } from "./sculpt.js";
import { maintainDropQueue } from "./drop-planner.js";
import {
  getTemplateBounds,
  getTemplateCellValue,
  getTemplateCells,
  getTemplateRotations
} from "../rules.js";
import { defineCodec, shape as s } from "../../codec.js";

const GAME_SCHEMA_VERSION = 4;
const GAME_OVER_REASONS = new Set([
  "spawn-blocked",
  "garbage-topout",
  "garbage-pushed-piece-out",
  "lock-topout"
]);
const UINT32_MAX = 0xffffffff;
const nonEmptyString = s.string({ nonEmpty: true });
const integer = s.integer();
const nonNegativeInteger = s.integer({ minimum: 0 });
const positiveInteger = s.integer({ minimum: 1 });
const byte = s.integer({ minimum: 0, maximum: 255 });
const uint32 = s.integer({ minimum: 0, maximum: UINT32_MAX });
const cellShape = s.object({ x: integer, y: integer });
const templatePlacementFields = {
  templateId: nonEmptyString,
  rotation: s.integer({ minimum: 0, maximum: 3 }),
  x: integer
};
const dropPlanShape = s.object({
  pieceId: nonEmptyString,
  ...templatePlacementFields,
  spawnAtWorldTick: nonNegativeInteger
});
const dropCoverageShape = s.object({ ...templatePlacementFields });
const pieceShape = s.object({
  id: nonEmptyString,
  templateId: nonEmptyString,
  rotation: s.integer({ minimum: 0, maximum: 3 }),
  cellValue: s.integer({ minimum: 1, maximum: 255 }),
  x: integer,
  y: integer,
  cells: s.array(cellShape, { minimumLength: 1 }),
  carved: nonNegativeInteger,
  carveLimit: nonNegativeInteger,
  restingWorldTicks: nonNegativeInteger,
  pendingLock: s.boolean(),
  spawnIndex: positiveInteger,
  committed: s.boolean()
});
const garbagePacketShape = s.object({
  id: nonEmptyString,
  sourcePlayerId: s.nullable(nonEmptyString),
  rows: positiveInteger,
  applyAtWorldTick: nonNegativeInteger,
  seed: uint32
});
const randomStreamShape = s.object({ state: s.integer({ minimum: 1, maximum: UINT32_MAX }) });
const GAME_SNAPSHOT_CODEC = defineCodec(s.object({
  schemaVersion: s.integer(),
  rulesetId: nonEmptyString,
  worldTick: nonNegativeInteger,
  stepTick: nonNegativeInteger,
  worldHoldSteps: nonNegativeInteger,
  lastFocusHoldWorldTick: integer,
  board: s.object({
    width: positiveInteger,
    height: positiveInteger,
    visibleHeight: positiveInteger,
    hiddenHeight: nonNegativeInteger,
    cells: s.array(byte)
  }),
  activePieces: s.array(pieceShape),
  focusedPieceId: s.nullable(nonEmptyString),
  dropQueue: s.array(dropPlanShape),
  dropCoverageHistory: s.array(dropCoverageShape),
  incomingGarbage: s.array(garbagePacketShape),
  appliedGarbageIds: s.array(nonEmptyString),
  scrap: nonNegativeInteger,
  score: nonNegativeInteger,
  totalLines: nonNegativeInteger,
  level: positiveInteger,
  status: s.enum(["playing", "gameover"]),
  gameOverReason: s.nullable(s.enum(GAME_OVER_REASONS)),
  nextPieceId: positiveInteger,
  nextSpawnIndex: positiveInteger,
  nextScheduledSpawnWorldTick: s.nullable(nonNegativeInteger),
  random: s.object({
    pieces: randomStreamShape,
    rotations: randomStreamShape,
    drops: randomStreamShape
  })
}));

export function createGameState({ seed = 1, rules }) {
  if (!rules) throw new Error("rules are required");
  const boardHeight = rules.board.visibleHeight + rules.board.hiddenHeight;
  const state = {
    rulesetId: rules.id,
    worldTick: 0,
    stepTick: 0,
    worldHoldSteps: 0,
    lastFocusHoldWorldTick: -1,
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
  return GAME_SNAPSHOT_CODEC.parse({
    ...state,
    schemaVersion: GAME_SCHEMA_VERSION,
    board: {
      ...state.board,
      cells: Array.from(state.board.cells)
    },
    activePieces: state.activePieces.map(clonePiece)
  }, "snapshot");
}

function allowedBoardCellValues(rules) {
  return new Set([
    0,
    rules.pieces.garbageCellValue,
    ...Object.values(rules.pieces.templates).map((template) => template.cellValue)
  ]);
}

function assertBoardSnapshot(board, rules) {
  const expectedHeight = rules.board.visibleHeight + rules.board.hiddenHeight;
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
  if (board.cells.length !== board.width * board.height) {
    throw new Error(`snapshot.board.cells must contain exactly ${board.width * board.height} cells`);
  }
  const allowed = allowedBoardCellValues(rules);
  for (const [index, value] of board.cells.entries()) {
    if (!allowed.has(value)) {
      throw new Error(`snapshot.board.cells[${index}] contains unsupported cell value ${value}`);
    }
  }
}

function assertTemplatePlacement(plan, path, rules) {
  if (!Object.hasOwn(rules.pieces.templates, plan.templateId)) {
    throw new Error(`${path}.templateId is unknown: ${plan.templateId}`);
  }
  if (!getTemplateRotations(rules, plan.templateId).includes(plan.rotation)) {
    throw new Error(`${path}.rotation is not allowed for template ${plan.templateId}`);
  }
  const bounds = getTemplateBounds(rules, plan.templateId, plan.rotation);
  const maximumX = rules.board.width - bounds.width;
  if (plan.x < 0 || plan.x > maximumX) {
    throw new Error(`${path}.x must be an integer between 0 and ${maximumX}`);
  }
}

function assertPieceSnapshot(piece, path, rules, boardCellCount) {
  if (!Object.hasOwn(rules.pieces.templates, piece.templateId)) {
    throw new Error(`${path}.templateId is unknown: ${piece.templateId}`);
  }
  if (!getTemplateRotations(rules, piece.templateId).includes(piece.rotation)) {
    throw new Error(`${path}.rotation is not allowed for template ${piece.templateId}`);
  }
  if (piece.cellValue !== getTemplateCellValue(rules, piece.templateId)) {
    throw new Error(`${path}.cellValue does not match template ${piece.templateId}`);
  }
  if (piece.cells.length > boardCellCount) {
    throw new Error(`${path}.cells must contain at most ${boardCellCount} entries`);
  }
  if (piece.carveLimit !== rules.sculpting.carveLimit) {
    throw new Error(`${path}.carveLimit must match ruleset carve limit ${rules.sculpting.carveLimit}`);
  }
  if (piece.carved > piece.carveLimit) throw new Error(`${path}.carved exceeds carveLimit`);
  if (piece.restingWorldTicks > rules.simulation.lockDelayWorldTicks) {
    throw new Error(
      `${path}.restingWorldTicks must be an integer between 0 and ${rules.simulation.lockDelayWorldTicks}`
    );
  }
}

function assertStatusFields(snapshot) {
  if (snapshot.status === "playing") {
    if (snapshot.gameOverReason !== null) {
      throw new Error("snapshot.gameOverReason must be null while playing");
    }
    return;
  }
  if (snapshot.gameOverReason === null) {
    throw new Error("snapshot.gameOverReason must identify why the game ended");
  }
}

function assertCurrentSnapshot(snapshot, rules) {
  const decoded = GAME_SNAPSHOT_CODEC.parse(snapshot, "snapshot");
  if (decoded.schemaVersion !== GAME_SCHEMA_VERSION) {
    throw new Error(`Unsupported game snapshot schema: ${decoded.schemaVersion}`);
  }
  if (decoded.rulesetId !== rules.id) {
    throw new Error(`snapshot.rulesetId must match ruleset ${rules.id}`);
  }
  const maximumHoldSteps = Math.max(rules.simulation.operationGraceSteps, rules.simulation.focusGraceSteps);
  if (decoded.worldHoldSteps > maximumHoldSteps) {
    throw new Error(`snapshot.worldHoldSteps must be an integer between 0 and ${maximumHoldSteps}`);
  }
  if (decoded.lastFocusHoldWorldTick < -1 || decoded.lastFocusHoldWorldTick > decoded.worldTick) {
    throw new Error(
      `snapshot.lastFocusHoldWorldTick must be an integer between -1 and ${decoded.worldTick}`
    );
  }
  assertBoardSnapshot(decoded.board, rules);

  const boardCellCount = decoded.board.width * decoded.board.height;
  if (decoded.activePieces.length > boardCellCount) {
    throw new Error(`snapshot.activePieces must contain at most ${boardCellCount} entries`);
  }
  const pieceIds = new Set();
  const spawnIndexes = new Set();
  let highestReservedPieceNumber = 0n;
  let highestReservedSpawnIndex = 0;
  for (const [index, piece] of decoded.activePieces.entries()) {
    const path = `snapshot.activePieces[${index}]`;
    assertPieceSnapshot(piece, path, rules, boardCellCount);
    if (pieceIds.has(piece.id)) throw new Error(`${path}.id duplicates piece id ${piece.id}`);
    if (spawnIndexes.has(piece.spawnIndex)) {
      throw new Error(`${path}.spawnIndex duplicates spawn index ${piece.spawnIndex}`);
    }
    pieceIds.add(piece.id);
    spawnIndexes.add(piece.spawnIndex);
    const pieceNumber = parseGeneratedPieceNumber(piece.id);
    if (pieceNumber !== null && pieceNumber > highestReservedPieceNumber) {
      highestReservedPieceNumber = pieceNumber;
    }
    highestReservedSpawnIndex = Math.max(highestReservedSpawnIndex, piece.spawnIndex);
  }

  if (decoded.focusedPieceId !== null) {
    const focused = decoded.activePieces.find((piece) => piece.id === decoded.focusedPieceId);
    if (!focused) throw new Error("snapshot.focusedPieceId must identify an active piece");
    if (focused.committed) throw new Error("snapshot.focusedPieceId cannot identify a committed piece");
  }

  if (decoded.dropQueue.length > rules.progression.dropQueueDepth) {
    throw new Error(`snapshot.dropQueue must contain at most ${rules.progression.dropQueueDepth} entries`);
  }
  let previousSpawnTick = -1;
  for (const [index, plan] of decoded.dropQueue.entries()) {
    const path = `snapshot.dropQueue[${index}]`;
    assertTemplatePlacement(plan, path, rules);
    if (pieceIds.has(plan.pieceId)) throw new Error(`${path}.pieceId duplicates piece id ${plan.pieceId}`);
    pieceIds.add(plan.pieceId);
    const pieceNumber = parseGeneratedPieceNumber(plan.pieceId);
    if (pieceNumber !== null && pieceNumber > highestReservedPieceNumber) {
      highestReservedPieceNumber = pieceNumber;
    }
    if (plan.spawnAtWorldTick < previousSpawnTick) {
      throw new Error("snapshot.dropQueue must be ordered by spawnAtWorldTick");
    }
    previousSpawnTick = plan.spawnAtWorldTick;
  }

  if (decoded.dropCoverageHistory.length > rules.simulation.dropCoverageHistoryLength) {
    throw new Error(
      `snapshot.dropCoverageHistory must contain at most ${rules.simulation.dropCoverageHistoryLength} entries`
    );
  }
  for (const [index, plan] of decoded.dropCoverageHistory.entries()) {
    assertTemplatePlacement(plan, `snapshot.dropCoverageHistory[${index}]`, rules);
  }

  const garbageIds = new Set();
  for (const [index, packet] of decoded.incomingGarbage.entries()) {
    const path = `snapshot.incomingGarbage[${index}]`;
    if (garbageIds.has(packet.id)) throw new Error(`${path}.id duplicates garbage id ${packet.id}`);
    garbageIds.add(packet.id);
  }

  const appliedIds = new Set();
  for (const id of decoded.appliedGarbageIds) {
    if (appliedIds.has(id)) throw new Error(`snapshot.appliedGarbageIds contains duplicate id ${id}`);
    if (garbageIds.has(id)) throw new Error(`garbage id ${id} cannot be both incoming and applied`);
    appliedIds.add(id);
  }

  const expectedLevel = 1 + Math.floor(decoded.totalLines / rules.progression.linesPerLevel);
  if (decoded.level !== expectedLevel) {
    throw new Error(`snapshot.level must be ${expectedLevel} for ${decoded.totalLines} total lines`);
  }
  assertStatusFields(decoded);
  if (BigInt(decoded.nextPieceId) <= highestReservedPieceNumber) {
    throw new Error(
      `snapshot.nextPieceId must be greater than reserved piece id p${highestReservedPieceNumber}`
    );
  }
  if (decoded.nextSpawnIndex <= highestReservedSpawnIndex) {
    throw new Error(
      `snapshot.nextSpawnIndex must be greater than reserved spawn index ${highestReservedSpawnIndex}`
    );
  }
  return decoded;
}

export function restoreGameState(snapshot, rules) {
  if (!rules) throw new Error("rules are required to restore game state");
  const decoded = assertCurrentSnapshot(snapshot, rules);
  const { schemaVersion: _schemaVersion, ...liveState } = decoded;
  const state = {
    ...liveState,
    board: {
      ...decoded.board,
      cells: Uint8Array.from(decoded.board.cells)
    },
    activePieces: decoded.activePieces.map(clonePiece)
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
