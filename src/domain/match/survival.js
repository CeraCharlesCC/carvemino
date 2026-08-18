import { mix32 } from "./policy-utils.js";

const POLICY_STATE_KEYS = Object.freeze(["nextWave"]);

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

function assertPlainObject(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${name} must be an object`);
  }
}

function assertExactKeys(value, expectedKeys, name) {
  assertPlainObject(value, name);
  const expected = new Set(expectedKeys);
  for (const key of Object.keys(value)) {
    if (!expected.has(key)) throw new Error(`${name}.${key} is not supported`);
  }
  for (const key of expectedKeys) {
    if (!Object.hasOwn(value, key)) throw new Error(`${name}.${key} is required`);
  }
}

function expectedNextWave(policy, matchTick) {
  if (matchTick <= policy.firstWaveMatchTick) return 1;
  const completedWaves = 1 + Math.floor(
    (matchTick - 1 - policy.firstWaveMatchTick) / policy.waveIntervalMatchTicks
  );
  if (completedWaves >= Number.MAX_SAFE_INTEGER) {
    throw new Error("survival policy state cannot represent the completed wave count safely");
  }
  return completedWaves + 1;
}

function copyPolicyState(state, context, policy) {
  assertExactKeys(state, POLICY_STATE_KEYS, "survival policy state");
  assertIntegerAtLeast(state.nextWave, 1, "survival policy state.nextWave");
  if (state.nextWave >= Number.MAX_SAFE_INTEGER) {
    throw new Error("survival policy state.nextWave is too large to advance safely");
  }
  const nextWave = expectedNextWave(policy, context.matchTick);
  if (state.nextWave !== nextWave) {
    throw new Error(`survival policy state.nextWave must be ${nextWave} at matchTick ${context.matchTick}`);
  }
  return { nextWave: state.nextWave };
}

function rowsForWave(policy, matchTick) {
  const elapsedMatchTicks = Math.max(0, matchTick - policy.firstWaveMatchTick);
  return Math.min(
    policy.maximumRowsPerWave,
    1 + Math.floor(elapsedMatchTicks / policy.rowsPerWaveStepMatchTicks)
  );
}

function queueWave(context, policy) {
  if (context.matchTick < policy.firstWaveMatchTick) return;
  if ((context.matchTick - policy.firstWaveMatchTick) % policy.waveIntervalMatchTicks !== 0) return;

  const rows = rowsForWave(policy, context.matchTick);
  const wave = context.state.nextWave++;
  for (const playerId of context.getAlivePlayerIds()) {
    const player = context.getPlayer(playerId);
    const packet = {
      id: `${context.matchId}:wave${wave}:${playerId}`,
      sourcePlayerId: "survival",
      rows,
      applyAtWorldTick: player.worldTick + policy.garbageWarningWorldTicks,
      seed: mix32(context.seed ^ 0xa5a5a5a5 ^ wave)
    };
    if (context.queueGarbage(playerId, packet)) {
      context.emit({
        type: "SURVIVAL_WAVE_QUEUED",
        playerId,
        wave,
        atMatchTick: context.matchTick,
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

    snapshotState(state, context) {
      return copyPolicyState(state, context, policy);
    },

    restoreState(snapshot, context) {
      return copyPolicyState(snapshot, context, policy);
    },

    beforeStep(context) {
      queueWave(context, policy);
    },

    onGameEvent() {},

    afterStep(context) {
      const alivePlayerIds = context.getAlivePlayerIds();
      if (context.playerIds.length === 1 && alivePlayerIds.length === 0) {
        context.finish({ type: "eliminated", atMatchTick: context.matchTick });
      } else if (context.playerIds.length > 1 && alivePlayerIds.length <= 1) {
        context.finish(
          alivePlayerIds.length === 1
            ? { type: "winner", winnerId: alivePlayerIds[0], atMatchTick: context.matchTick }
            : { type: "draw", atMatchTick: context.matchTick }
        );
      }
    }
  };

  return Object.freeze(policy);
}
