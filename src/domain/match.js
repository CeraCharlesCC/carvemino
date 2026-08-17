import {
  cancelIncomingGarbage,
  createGame,
  queueGarbage,
  stepGame
} from "./game.js";

function mix32(value) {
  let x = value >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x7feb352d);
  x = Math.imul(x ^ (x >>> 15), 0x846ca68b);
  return (x ^ (x >>> 16)) >>> 0;
}

function playerById(match, playerId) {
  return match.players.find((player) => player.id === playerId) || null;
}

function alivePlayers(match) {
  return match.players.filter((player) => player.game.status === "playing");
}

function makeGarbagePacket(match, sourcePlayerId, target, rows) {
  const sequence = match.nextAttackSequence++;
  return {
    id: `${match.id}:g${sequence}`,
    sourcePlayerId,
    rows,
    applyTick: target.game.tick + match.rules.garbage.warningTicks,
    seed: mix32(match.seed ^ sequence)
  };
}

function queueAttack(match, sourcePlayerId, targetPlayerId, rows, events) {
  const source = playerById(match, sourcePlayerId);
  const target = playerById(match, targetPlayerId);
  if (!source || !target || target.game.status !== "playing" || rows <= 0) return;

  let outgoingRows = rows;
  let cancelled = 0;
  if (match.rules.garbage.cancellation) {
    const result = cancelIncomingGarbage(source.game, outgoingRows);
    cancelled = result.cancelled;
    outgoingRows = result.remaining;
  }

  if (cancelled > 0) {
    events.push({
      type: "GARBAGE_CANCELLED",
      playerId: sourcePlayerId,
      rows: cancelled
    });
  }

  if (outgoingRows <= 0) return;
  const packet = makeGarbagePacket(match, sourcePlayerId, target, outgoingRows);
  if (!queueGarbage(target.game, packet)) return;

  events.push({
    type: "GARBAGE_SENT",
    sourcePlayerId,
    targetPlayerId,
    packet: { ...packet }
  });
}

function routeVersusAttack(match, sourcePlayerId, rows, events) {
  const candidates = match.players.filter(
    (player) => player.id !== sourcePlayerId && player.game.status === "playing"
  );
  if (candidates.length === 0) return;

  // Two-player VS targets the other player. For more players this deterministic
  // round-robin choice is intentionally simple and can later become a policy.
  const sourceIndex = match.players.findIndex((player) => player.id === sourcePlayerId);
  for (let offset = 1; offset < match.players.length; offset += 1) {
    const target = match.players[(sourceIndex + offset) % match.players.length];
    if (target.game.status === "playing") {
      queueAttack(match, sourcePlayerId, target.id, rows, events);
      return;
    }
  }
}

function routeGameEvents(match, playerId, gameEvents, events) {
  for (const event of gameEvents) {
    events.push({ ...event, playerId });
    if (event.type === "ATTACK_GENERATED" && match.mode === "versus") {
      routeVersusAttack(match, playerId, event.rows, events);
    }
  }
}

function survivalWaveRows(match) {
  const survival = match.rules.survival;
  const elapsed = Math.max(0, match.tick - survival.firstWaveTick);
  return Math.min(
    survival.maximumRowsPerWave,
    1 + Math.floor(elapsed / survival.rowsPerWaveStep)
  );
}

function queueSurvivalWave(match, events) {
  if (match.mode !== "survival") return;
  const survival = match.rules.survival;
  if (match.tick < survival.firstWaveTick) return;
  if ((match.tick - survival.firstWaveTick) % survival.waveIntervalTicks !== 0) return;

  const rows = survivalWaveRows(match);
  const wave = match.nextSurvivalWave++;
  for (const player of alivePlayers(match)) {
    const packet = {
      id: `${match.id}:wave${wave}:${player.id}`,
      sourcePlayerId: "survival",
      rows,
      applyTick: player.game.tick + match.rules.garbage.warningTicks,
      seed: mix32(match.seed ^ 0xa5a5a5a5 ^ wave)
    };
    if (queueGarbage(player.game, packet)) {
      events.push({
        type: "SURVIVAL_WAVE_QUEUED",
        playerId: player.id,
        wave,
        packet: { ...packet }
      });
    }
  }
}

function updateMatchResult(match, events) {
  if (match.status !== "playing") return;
  const alive = alivePlayers(match);

  if (match.mode === "versus") {
    if (alive.length <= 1 && match.players.length > 1) {
      match.status = "finished";
      match.result = alive.length === 1
        ? { type: "winner", winnerId: alive[0].id }
        : { type: "draw" };
      events.push({ type: "MATCH_FINISHED", result: { ...match.result } });
    }
    return;
  }

  if (match.mode === "survival") {
    if (match.players.length === 1 && alive.length === 0) {
      match.status = "finished";
      match.result = { type: "survived", ticks: match.tick };
      events.push({ type: "MATCH_FINISHED", result: { ...match.result } });
    } else if (match.players.length > 1 && alive.length <= 1) {
      match.status = "finished";
      match.result = alive.length === 1
        ? { type: "winner", winnerId: alive[0].id, ticks: match.tick }
        : { type: "draw", ticks: match.tick };
      events.push({ type: "MATCH_FINISHED", result: { ...match.result } });
    }
  }
}

export function createMatch({
  id = "match-1",
  mode = "versus",
  playerIds,
  seed = 1,
  rules
}) {
  if (!rules) throw new Error("rules are required");
  if (!Array.isArray(playerIds) || playerIds.length === 0) {
    throw new Error("playerIds must contain at least one player");
  }
  const normalizedPlayerIds = playerIds.map(String);
  if (new Set(normalizedPlayerIds).size !== normalizedPlayerIds.length) {
    throw new Error("playerIds must be unique");
  }
  if (mode === "versus" && playerIds.length < 2) {
    throw new Error("versus mode requires at least two players");
  }
  if (mode !== "versus" && mode !== "survival") {
    throw new Error(`unsupported match mode: ${mode}`);
  }

  return {
    version: 1,
    id,
    mode,
    seed: seed >>> 0,
    tick: 0,
    rules,
    rulesetId: rules.id,
    status: "playing",
    result: null,
    nextAttackSequence: 1,
    nextSurvivalWave: 1,
    players: normalizedPlayerIds.map((playerId, index) => ({
      id: playerId,
      game: createGame({ seed: mix32((seed >>> 0) ^ (index + 1)), rules })
    }))
  };
}

export function stepMatch(match, commandsByPlayer = {}) {
  const events = [];
  if (match.status !== "playing") return events;

  queueSurvivalWave(match, events);

  for (const player of match.players) {
    if (player.game.status !== "playing") continue;
    const commands = commandsByPlayer[player.id] || [];
    const gameEvents = stepGame(player.game, commands, match.rules);
    routeGameEvents(match, player.id, gameEvents, events);
  }

  updateMatchResult(match, events);
  match.tick += 1;
  return events;
}

export function getPlayerGame(match, playerId) {
  const player = playerById(match, playerId);
  return player ? player.game : null;
}