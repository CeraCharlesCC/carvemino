import { alivePlayers, finishMatch, mix32 } from "./policy-utils.js";

function assertNonEmptyString(value, name) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${name} must be a non-empty string`);
  }
}

function assertIntegerAtLeast(value, minimum, name) {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new Error(`${name} must be an integer >= ${minimum}`);
  }
}

function rowsForWave(policy, matchTick) {
  const elapsedMatchTicks = Math.max(0, matchTick - policy.firstWaveMatchTick);
  return Math.min(
    policy.maximumRowsPerWave,
    1 + Math.floor(elapsedMatchTicks / policy.rowsPerWaveStepMatchTicks)
  );
}

function queueWave(match, policy, events) {
  if (match.matchTick < policy.firstWaveMatchTick) return;
  if ((match.matchTick - policy.firstWaveMatchTick) % policy.waveIntervalMatchTicks !== 0) return;

  const rows = rowsForWave(policy, match.matchTick);
  const wave = match.policyState.nextWave++;
  for (const player of alivePlayers(match)) {
    const packet = {
      id: `${match.id}:wave${wave}:${player.id}`,
      sourcePlayerId: "survival",
      rows,
      applyAtWorldTick: player.game.worldTick + policy.garbageWarningWorldTicks,
      seed: mix32(match.seed ^ 0xa5a5a5a5 ^ wave)
    };
    if (match.engine.queueGarbage(player.game, packet)) {
      events.push({
        type: "SURVIVAL_WAVE_QUEUED",
        playerId: player.id,
        wave,
        atMatchTick: match.matchTick,
        packet: { ...packet }
      });
    }
  }
}

export function defineSurvivalPolicy({
  id,
  garbageWarningWorldTicks,
  firstWaveMatchTick,
  waveIntervalMatchTicks,
  rowsPerWaveStepMatchTicks,
  maximumRowsPerWave
}) {
  assertNonEmptyString(id, "survival policy id");
  assertIntegerAtLeast(garbageWarningWorldTicks, 0, "garbageWarningWorldTicks");
  assertIntegerAtLeast(firstWaveMatchTick, 0, "firstWaveMatchTick");
  assertIntegerAtLeast(waveIntervalMatchTicks, 1, "waveIntervalMatchTicks");
  assertIntegerAtLeast(rowsPerWaveStepMatchTicks, 1, "rowsPerWaveStepMatchTicks");
  assertIntegerAtLeast(maximumRowsPerWave, 1, "maximumRowsPerWave");

  const policy = {
    id,
    kind: "survival",
    garbageWarningWorldTicks,
    firstWaveMatchTick,
    waveIntervalMatchTicks,
    rowsPerWaveStepMatchTicks,
    maximumRowsPerWave,

    validatePlayerIds() {},

    createState() {
      return { nextWave: 1 };
    },

    beforeStep(match, events) {
      queueWave(match, policy, events);
    },

    onGameEvent() {},

    afterStep(match, events) {
      const alive = alivePlayers(match);
      if (match.players.length === 1 && alive.length === 0) {
        finishMatch(match, { type: "eliminated", atMatchTick: match.matchTick }, events);
      } else if (match.players.length > 1 && alive.length <= 1) {
        finishMatch(
          match,
          alive.length === 1
            ? { type: "winner", winnerId: alive[0].id, atMatchTick: match.matchTick }
            : { type: "draw", atMatchTick: match.matchTick },
          events
        );
      }
    }
  };

  return Object.freeze(policy);
}
