import { mix32 } from "../hash.js";
import { defineCodec, shape as s } from "../../codec.js";

const nonEmptyString = s.string({ nonEmpty: true });
const nonNegativeInteger = s.integer({ minimum: 0 });
const positiveInteger = s.integer({ minimum: 1 });
const POLICY_STATE_CODEC = defineCodec(s.object({ nextWave: positiveInteger }));
const SURVIVAL_POLICY_CODEC = defineCodec(s.object({
  id: nonEmptyString,
  garbageWarningWorldTicks: nonNegativeInteger,
  firstWaveMatchTick: nonNegativeInteger,
  waveIntervalMatchTicks: positiveInteger,
  rowsPerWaveStepMatchTicks: positiveInteger,
  maximumRowsPerWave: positiveInteger
}));

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
  const copy = POLICY_STATE_CODEC.parse(state, "survival policy state");
  if (copy.nextWave >= Number.MAX_SAFE_INTEGER) {
    throw new Error("survival policy state.nextWave is too large to advance safely");
  }
  const nextWave = expectedNextWave(policy, context.matchTick);
  if (copy.nextWave !== nextWave) {
    throw new Error(`survival policy state.nextWave must be ${nextWave} at matchTick ${context.matchTick}`);
  }
  return copy;
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

export function defineSurvivalPolicy(definition) {
  const {
    id,
    garbageWarningWorldTicks,
    firstWaveMatchTick,
    waveIntervalMatchTicks,
    rowsPerWaveStepMatchTicks,
    maximumRowsPerWave
  } = SURVIVAL_POLICY_CODEC.parse(definition, "survival policy");

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
