import { mix32 } from "./policy-utils.js";
import { defineCodec, shape as s } from "../../codec.js";

const nonEmptyString = s.string({ nonEmpty: true });
const nonNegativeInteger = s.integer({ minimum: 0 });
const positiveInteger = s.integer({ minimum: 1 });
const pendingAttackShape = s.object({
  sourcePlayerId: nonEmptyString,
  rows: positiveInteger
});
const POLICY_STATE_CODEC = defineCodec(s.object({
  nextGarbageSequence: positiveInteger,
  pendingAttacks: s.array(pendingAttackShape)
}));
const VERSUS_POLICY_CODEC = defineCodec(s.object({
  id: nonEmptyString,
  lineClearAttackRows: s.array(nonNegativeInteger, { minimumLength: 1 }),
  garbageWarningWorldTicks: nonNegativeInteger,
  cancellation: s.optional(s.boolean())
}));

function generatedGarbageSequence(id, matchId) {
  const prefix = `${matchId}:g`;
  if (typeof id !== "string" || !id.startsWith(prefix)) return null;
  const suffix = id.slice(prefix.length);
  if (!/^[1-9]\d*$/.test(suffix)) return null;
  const sequence = Number(suffix);
  return Number.isSafeInteger(sequence) ? sequence : null;
}

function highestReservedGarbageSequence(context) {
  if (!context?.gameSnapshots) return 0;
  let highest = 0;
  for (const gameSnapshot of context.gameSnapshots) {
    const ids = [
      ...gameSnapshot.incomingGarbage.map((packet) => packet.id),
      ...gameSnapshot.appliedGarbageIds
    ];
    for (const id of ids) {
      const sequence = generatedGarbageSequence(id, context.matchId);
      if (sequence !== null) highest = Math.max(highest, sequence);
    }
  }
  return highest;
}

function copyPolicyState(state, context, attackTable) {
  const copy = POLICY_STATE_CODEC.parse(state, "versus policy state");
  if (copy.nextGarbageSequence >= Number.MAX_SAFE_INTEGER) {
    throw new Error("versus policy state.nextGarbageSequence is too large to advance safely");
  }
  const highestReservedSequence = highestReservedGarbageSequence(context);
  if (copy.nextGarbageSequence <= highestReservedSequence) {
    throw new Error(
      `versus policy state.nextGarbageSequence must be greater than reserved garbage sequence ${highestReservedSequence}`
    );
  }
  const playerIds = context?.playerIds || [];
  copy.pendingAttacks.forEach((attack, index) => {
    const path = `versus policy state.pendingAttacks[${index}]`;
    if (!playerIds.includes(attack.sourcePlayerId)) {
      throw new Error(`${path}.sourcePlayerId must identify a match player`);
    }
    if (!attackTable.includes(attack.rows)) {
      throw new Error(`${path}.rows is not produced by this versus policy`);
    }
  });
  return copy;
}

function normalizeAttackTable(lineClearAttackRows) {
  return Object.freeze([...lineClearAttackRows]);
}

function attackRowsForLineClear(table, count) {
  return table[Math.min(count, table.length - 1)] || 0;
}

function makeGarbagePacket(context, policy, sourcePlayerId, targetPlayerId, rows) {
  const target = context.getPlayer(targetPlayerId);
  if (!target) return null;
  const sequence = context.state.nextGarbageSequence++;
  return {
    id: `${context.matchId}:g${sequence}`,
    sourcePlayerId,
    rows,
    applyAtWorldTick: target.worldTick + policy.garbageWarningWorldTicks,
    seed: mix32(context.seed ^ sequence)
  };
}

function queueAttack(context, policy, sourcePlayerId, targetPlayerId, rows) {
  const target = context.getPlayer(targetPlayerId);
  if (!target || target.status !== "playing" || rows <= 0) return;
  const packet = makeGarbagePacket(context, policy, sourcePlayerId, targetPlayerId, rows);
  if (!packet || !context.queueGarbage(targetPlayerId, packet)) return;

  context.emit({
    type: "GARBAGE_SENT",
    sourcePlayerId,
    targetPlayerId,
    packet: { ...packet }
  });
}

function cancelOutgoingAgainstExistingGarbage(context, policy, attack) {
  if (!policy.cancellation) return attack.rows;
  if (!context.getPlayer(attack.sourcePlayerId)) return 0;

  const result = context.cancelIncomingGarbage(attack.sourcePlayerId, attack.rows);
  if (result.cancelled > 0) {
    context.emit({
      type: "GARBAGE_CANCELLED",
      playerId: attack.sourcePlayerId,
      rows: result.cancelled
    });
  }
  return result.remaining;
}

function routeRoundRobinAttack(context, policy, sourcePlayerId, rows) {
  const sourceIndex = context.playerIds.indexOf(sourcePlayerId);
  for (let offset = 1; offset < context.playerIds.length; offset += 1) {
    const targetPlayerId = context.playerIds[(sourceIndex + offset) % context.playerIds.length];
    const target = context.getPlayer(targetPlayerId);
    if (target?.status === "playing") {
      queueAttack(context, policy, sourcePlayerId, targetPlayerId, rows);
      return;
    }
  }
}

function resolvePendingAttacks(context, policy) {
  const pending = context.state.pendingAttacks;
  if (pending.length === 0) return;

  // Cancellation is resolved for every source before any same-step attack is
  // queued. Simultaneous attacks therefore cannot cancel one another based on
  // player iteration order.
  const outgoing = pending.map((attack) => ({
    ...attack,
    rows: cancelOutgoingAgainstExistingGarbage(context, policy, attack)
  }));
  pending.length = 0;

  for (const attack of outgoing) {
    if (attack.rows > 0) {
      routeRoundRobinAttack(context, policy, attack.sourcePlayerId, attack.rows);
    }
  }
}

export function defineVersusPolicy(definition) {
  const {
    id,
    lineClearAttackRows,
    garbageWarningWorldTicks,
    cancellation = true
  } = VERSUS_POLICY_CODEC.parse(definition, "versus policy");
  const attackTable = normalizeAttackTable(lineClearAttackRows);

  const policy = {
    id,
    kind: "versus",
    lineClearAttackRows: attackTable,
    garbageWarningWorldTicks,
    cancellation,

    validatePlayerIds(playerIds) {
      if (playerIds.length < 2) throw new Error("versus policy requires at least two players");
    },

    createState() {
      return { nextGarbageSequence: 1, pendingAttacks: [] };
    },

    snapshotState(state, context) {
      return copyPolicyState(state, context, attackTable);
    },

    restoreState(snapshot, context) {
      return copyPolicyState(snapshot, context, attackTable);
    },

    beforeStep() {},

    onGameEvent(context, playerId, event) {
      if (event.type !== "LINES_CLEARED") return;
      const rows = attackRowsForLineClear(attackTable, event.count);
      if (rows <= 0) return;
      context.emit({ type: "ATTACK_GENERATED", playerId, rows });
      context.state.pendingAttacks.push({ sourcePlayerId: playerId, rows });
    },

    afterStep(context) {
      resolvePendingAttacks(context, policy);
      const alivePlayerIds = context.getAlivePlayerIds();
      if (alivePlayerIds.length > 1) return;
      context.finish(
        alivePlayerIds.length === 1
          ? { type: "winner", winnerId: alivePlayerIds[0], atMatchTick: context.matchTick }
          : { type: "draw", atMatchTick: context.matchTick }
      );
    }
  };

  return Object.freeze(policy);
}
