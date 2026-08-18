import { mix32 } from "./policy-utils.js";

const POLICY_STATE_KEYS = Object.freeze(["nextGarbageSequence", "pendingAttacks"]);
const PENDING_ATTACK_KEYS = Object.freeze(["sourcePlayerId", "rows"]);

function assertNonEmptyString(value, name) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${name} must be a non-empty string`);
  }
}

function assertNonNegativeInteger(value, name) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be an integer >= 0`);
  }
}

function assertPositiveInteger(value, name) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${name} must be an integer >= 1`);
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
  assertExactKeys(state, POLICY_STATE_KEYS, "versus policy state");
  assertPositiveInteger(state.nextGarbageSequence, "versus policy state.nextGarbageSequence");
  if (state.nextGarbageSequence >= Number.MAX_SAFE_INTEGER) {
    throw new Error("versus policy state.nextGarbageSequence is too large to advance safely");
  }
  const highestReservedSequence = highestReservedGarbageSequence(context);
  if (state.nextGarbageSequence <= highestReservedSequence) {
    throw new Error(
      `versus policy state.nextGarbageSequence must be greater than reserved garbage sequence ${highestReservedSequence}`
    );
  }
  if (!Array.isArray(state.pendingAttacks)) {
    throw new Error("versus policy state.pendingAttacks must be an array");
  }
  const playerIds = context?.playerIds || [];
  const pendingAttacks = Array.from(state.pendingAttacks, (attack, index) => {
    const path = `versus policy state.pendingAttacks[${index}]`;
    assertExactKeys(attack, PENDING_ATTACK_KEYS, path);
    assertNonEmptyString(attack.sourcePlayerId, `${path}.sourcePlayerId`);
    if (!playerIds.includes(attack.sourcePlayerId)) {
      throw new Error(`${path}.sourcePlayerId must identify a match player`);
    }
    assertPositiveInteger(attack.rows, `${path}.rows`);
    if (!attackTable.includes(attack.rows)) {
      throw new Error(`${path}.rows is not produced by this versus policy`);
    }
    return { sourcePlayerId: attack.sourcePlayerId, rows: attack.rows };
  });
  return {
    nextGarbageSequence: state.nextGarbageSequence,
    pendingAttacks
  };
}

function normalizeAttackTable(lineClearAttackRows) {
  if (!Array.isArray(lineClearAttackRows) || lineClearAttackRows.length === 0) {
    throw new Error("lineClearAttackRows must be a non-empty array");
  }
  const table = lineClearAttackRows.map((rows, index) => {
    assertNonNegativeInteger(rows, `lineClearAttackRows[${index}]`);
    return rows;
  });
  return Object.freeze(table);
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

export function defineVersusPolicy({
  id,
  lineClearAttackRows,
  garbageWarningWorldTicks,
  cancellation = true
}) {
  assertNonEmptyString(id, "versus policy id");
  const attackTable = normalizeAttackTable(lineClearAttackRows);
  assertNonNegativeInteger(garbageWarningWorldTicks, "garbageWarningWorldTicks");
  if (typeof cancellation !== "boolean") throw new Error("cancellation must be a boolean");

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
