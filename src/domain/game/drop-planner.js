import {
  getTemplateBounds,
  getTemplateCellValue,
  getTemplateCells,
  getTemplateIds,
  getTemplateRotations,
  spawnIntervalWorldTicksForLevel
} from "../rules.js";
import { allWorldCells, canOccupyWorldCells } from "./model.js";
import { randomInt } from "./random.js";

export function bringNextSpawnForward(state) {
  if (state.dropQueue.length === 0) return;
  const delta = state.worldTick - state.dropQueue[0].spawnAtWorldTick;
  if (delta >= 0) return;

  for (const plan of state.dropQueue) plan.spawnAtWorldTick += delta;
  if (state.nextScheduledSpawnWorldTick != null) state.nextScheduledSpawnWorldTick += delta;
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

  // Sample the configured number of legal positions instead of globally
  // optimizing every drop. This nudges the long-run distribution toward
  // under-covered columns while still allowing local streaks and droughts.
  for (let choice = 1; choice < rules.simulation.dropPositionSampleCount; choice += 1) {
    const x = randomInt(state.random.drops, maxX + 1);
    const score = cells.reduce((sum, cell) => sum + coverage[x + cell.x], 0);
    if (score < chosenScore) {
      chosenX = x;
      chosenScore = score;
    }
  }

  return chosenX;
}

function rememberDropCoverage(state, templateId, rotation, x, rules) {
  state.dropCoverageHistory.push({ templateId, rotation, x });
  const historyLength = rules.simulation.dropCoverageHistoryLength;
  if (state.dropCoverageHistory.length > historyLength) {
    state.dropCoverageHistory.splice(
      0,
      state.dropCoverageHistory.length - historyLength
    );
  }
}

function makeDropPlan(state, spawnAtWorldTick, rules) {
  const templateIds = getTemplateIds(rules);
  const templateId = templateIds[randomInt(state.random.pieces, templateIds.length)];
  const rotations = getTemplateRotations(rules, templateId);
  const rotation = rotations[randomInt(state.random.rotations, rotations.length)];
  const x = chooseCoverageBalancedX(state, rules, templateId, rotation);
  const pieceId = `p${state.nextPieceId++}`;
  rememberDropCoverage(state, templateId, rotation, x, rules);

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
