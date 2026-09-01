import {
  getTemplateBounds,
  getTemplateCellValue,
  getTemplateCells,
  getTemplateIds,
  getTemplateRotations,
  spawnIntervalWorldTicksForLevel
} from "../rules.js";
import { allWorldCells, canOccupyWorldCells } from "./model.js";
import { formatGeneratedPieceId } from "./piece-id.js";
import { randomInt } from "./random.js";

export function bringNextSpawnForward(state) {
  if (state.dropQueue.length === 0) return;
  const delta = state.worldTick - state.dropQueue[0].spawnAtWorldTick;
  if (delta >= 0) return;

  // Shift the prepared queue as a unit instead of replanning it. This preserves
  // piece identities, relative spawn cadence, and the already-consumed RNG state.
  for (const plan of state.dropQueue) plan.spawnAtWorldTick += delta;
  if (state.nextScheduledSpawnWorldTick != null) state.nextScheduledSpawnWorldTick += delta;
}

function getRecentDropCoverage(state, rules) {
  const coverage = Array(state.board.width).fill(0);
  for (const plan of state.dropPositionMemory.placements) {
    for (const cell of getTemplateCells(rules, plan.templateId, plan.rotation)) {
      const x = plan.x + cell.x;
      if (x >= 0 && x < coverage.length) coverage[x] += 1;
    }
  }
  return coverage;
}

function chooseBestSampledX(state, cells, maxX, coverage, sampleCount) {
  let chosenX = randomInt(state.random.drops, maxX + 1);
  let chosenScore = cells.reduce((sum, cell) => sum + coverage[chosenX + cell.x], 0);

  for (let choice = 1; choice < sampleCount; choice += 1) {
    const x = randomInt(state.random.drops, maxX + 1);
    const score = cells.reduce((sum, cell) => sum + coverage[x + cell.x], 0);
    if (score < chosenScore) {
      chosenX = x;
      chosenScore = score;
    }
  }

  return chosenX;
}

function chooseRecentCoverageX(state, rules, cells, maxX, strategy) {
  const coverage = getRecentDropCoverage(state, rules);
  return chooseBestSampledX(state, cells, maxX, coverage, strategy.sampleCount);
}

function chooseLeakyCoverageX(state, cells, maxX, strategy) {
  const pressure = state.dropPositionMemory.pressure;
  // This memory deliberately depends only on generated pieces and positions.
  // Settled board state must not influence drop distribution.
  for (let x = 0; x < pressure.length; x += 1) {
    pressure[x] = Math.floor(
      pressure[x] * strategy.decayNumerator / strategy.decayDenominator
    );
  }

  const candidates = Array.from(
    { length: strategy.sampleCount },
    () => randomInt(state.random.drops, maxX + 1)
  );
  const rawRandom = randomInt(state.random.drops, strategy.rawRandomDenominator)
    < strategy.rawRandomNumerator;
  if (rawRandom) return candidates[0];

  const score = (candidateX) => cells.reduce(
    (sum, cell) => sum + pressure[candidateX + cell.x],
    0
  );
  let chosenX = candidates[0];
  let chosenScore = score(chosenX);
  for (let choice = 1; choice < candidates.length; choice += 1) {
    const candidateX = candidates[choice];
    const candidateScore = score(candidateX);
    if (candidateScore < chosenScore) {
      chosenX = candidateX;
      chosenScore = candidateScore;
    }
  }
  return chosenX;
}

function chooseDropX(state, rules, templateId, rotation) {
  const cells = getTemplateCells(rules, templateId, rotation);
  const bounds = getTemplateBounds(rules, templateId, rotation);
  const maxX = state.board.width - bounds.width;
  const strategy = rules.simulation.dropPosition;
  if (strategy.type === "leaky-coverage") {
    return chooseLeakyCoverageX(state, cells, maxX, strategy);
  }
  return chooseRecentCoverageX(state, rules, cells, maxX, strategy);
}

function rememberDropPosition(state, templateId, rotation, x, rules) {
  const strategy = rules.simulation.dropPosition;
  if (strategy.type === "leaky-coverage") {
    for (const cell of getTemplateCells(rules, templateId, rotation)) {
      state.dropPositionMemory.pressure[x + cell.x] += strategy.pressurePerCell;
    }
    return;
  }

  const placements = state.dropPositionMemory.placements;
  placements.push({ templateId, rotation, x });
  if (placements.length > strategy.historyLength) {
    placements.splice(
      0,
      placements.length - strategy.historyLength
    );
  }
}

function makeDropPlan(state, spawnAtWorldTick, rules) {
  const templateIds = getTemplateIds(rules);
  const templateId = templateIds[randomInt(state.random.pieces, templateIds.length)];
  const rotations = getTemplateRotations(rules, templateId);
  const rotation = rotations[randomInt(state.random.rotations, rotations.length)];
  const x = chooseDropX(state, rules, templateId, rotation);
  const pieceId = formatGeneratedPieceId(state.nextPieceId++);
  rememberDropPosition(state, templateId, rotation, x, rules);

  return {
    pieceId,
    templateId,
    rotation,
    x,
    spawnAtWorldTick
  };
}

export function maintainDropQueue(state, rules, events) {
  const desired = rules.progression.dropQueueDepth;
  while (state.dropQueue.length < desired) {
    let spawnAtWorldTick;
    if (state.dropQueue.length === 0 && state.nextScheduledSpawnWorldTick == null) {
      spawnAtWorldTick = state.worldTick;
    } else if (state.dropQueue.length > 0) {
      const previous = state.dropQueue[state.dropQueue.length - 1];
      spawnAtWorldTick = previous.spawnAtWorldTick + spawnIntervalWorldTicksForLevel(rules, state.level);
    } else {
      spawnAtWorldTick = state.nextScheduledSpawnWorldTick;
    }

    const plan = makeDropPlan(state, spawnAtWorldTick, rules);
    state.dropQueue.push(plan);
    state.nextScheduledSpawnWorldTick = plan.spawnAtWorldTick + spawnIntervalWorldTicksForLevel(rules, state.level);
    events.push({ type: "PIECE_PLANNED", plan: { ...plan } });
  }
}

export function spawnDuePieces(state, rules, events) {
  while (state.dropQueue.length > 0 && state.dropQueue[0].spawnAtWorldTick <= state.worldTick) {
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
      restingWorldTicks: 0,
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
