import { cancelIncomingGarbage, queueGarbage } from "../game.js";
import { alivePlayers, finishMatch, mix32, playerById } from "./policy-utils.js";

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

function makeGarbagePacket(match, policy, sourcePlayerId, target, rows) {
  const sequence = match.policyState.nextGarbageSequence++;
  return {
    id: `${match.id}:g${sequence}`,
    sourcePlayerId,
    rows,
    applyAtWorldTick: target.game.worldTick + policy.garbageWarningWorldTicks,
    seed: mix32(match.seed ^ sequence)
  };
}

function queueAttack(match, policy, sourcePlayerId, targetPlayerId, rows, events) {
  const target = playerById(match, targetPlayerId);
  if (!target || target.game.status !== "playing" || rows <= 0) return;
  const packet = makeGarbagePacket(match, policy, sourcePlayerId, target, rows);
  if (!queueGarbage(target.game, packet)) return;

  events.push({
    type: "GARBAGE_SENT",
    sourcePlayerId,
    targetPlayerId,
    packet: { ...packet }
  });
}

function cancelOutgoingAgainstExistingGarbage(match, policy, attack, events) {
  if (!policy.cancellation) return attack.rows;
  const source = playerById(match, attack.sourcePlayerId);
  if (!source) return 0;

  const result = cancelIncomingGarbage(source.game, attack.rows);
  if (result.cancelled > 0) {
    events.push({
      type: "GARBAGE_CANCELLED",
      playerId: attack.sourcePlayerId,
      rows: result.cancelled
    });
  }
  return result.remaining;
}

function routeRoundRobinAttack(match, policy, sourcePlayerId, rows, events) {
  const sourceIndex = match.players.findIndex((player) => player.id === sourcePlayerId);
  for (let offset = 1; offset < match.players.length; offset += 1) {
    const target = match.players[(sourceIndex + offset) % match.players.length];
    if (target.game.status === "playing") {
      queueAttack(match, policy, sourcePlayerId, target.id, rows, events);
      return;
    }
  }
}

function resolvePendingAttacks(match, policy, events) {
  const pending = match.policyState.pendingAttacks;
  if (pending.length === 0) return;

  // Cancellation is resolved for every source before any same-step attack is
  // queued. Simultaneous attacks therefore cannot cancel one another based on
  // player iteration order.
  const outgoing = pending.map((attack) => ({
    ...attack,
    rows: cancelOutgoingAgainstExistingGarbage(match, policy, attack, events)
  }));
  pending.length = 0;

  for (const attack of outgoing) {
    if (attack.rows > 0) {
      routeRoundRobinAttack(match, policy, attack.sourcePlayerId, attack.rows, events);
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

    beforeStep() {},

    onGameEvent(match, playerId, event, events) {
      if (event.type !== "LINES_CLEARED") return;
      const rows = attackRowsForLineClear(attackTable, event.count);
      if (rows <= 0) return;
      events.push({ type: "ATTACK_GENERATED", playerId, rows });
      match.policyState.pendingAttacks.push({ sourcePlayerId: playerId, rows });
    },

    afterStep(match, events) {
      resolvePendingAttacks(match, policy, events);
      const alive = alivePlayers(match);
      if (alive.length > 1) return;
      finishMatch(
        match,
        alive.length === 1
          ? { type: "winner", winnerId: alive[0].id, atMatchTick: match.matchTick }
          : { type: "draw", atMatchTick: match.matchTick },
        events
      );
    }
  };

  return Object.freeze(policy);
}
