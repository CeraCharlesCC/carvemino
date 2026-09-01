import { createGameEngine } from "./game.js";
import { hashJson32Hex, mix32 } from "./hash.js";
import { defineCodec, shape as s } from "../codec.js";

const MATCH_SNAPSHOT_SCHEMA_VERSION = 1;
const UINT32_MAX = 0xffffffff;
const nonEmptyString = s.string({ nonEmpty: true });
const nonNegativeInteger = s.integer({ minimum: 0 });
const uint32 = s.integer({ minimum: 0, maximum: UINT32_MAX });
const jsonValue = s.json();
const resultShape = s.discriminatedUnion("type", {
  winner: s.object({
    type: s.literal("winner"),
    winnerId: nonEmptyString,
    atMatchTick: nonNegativeInteger
  }),
  draw: s.object({
    type: s.literal("draw"),
    atMatchTick: nonNegativeInteger
  }),
  eliminated: s.object({
    type: s.literal("eliminated"),
    atMatchTick: nonNegativeInteger
  })
});
const MATCH_RESULT_CODEC = defineCodec(resultShape);
const PLAYER_IDS_CODEC = defineCodec(s.array(nonEmptyString, { minimumLength: 1 }));
const MATCH_SNAPSHOT_CODEC = defineCodec(s.object({
  schemaVersion: s.integer(),
  matchId: nonEmptyString,
  seed: uint32,
  matchTick: nonNegativeInteger,
  rulesetId: nonEmptyString,
  policyId: nonEmptyString,
  playerIds: s.array(nonEmptyString, { minimumLength: 1 }),
  status: s.enum(["playing", "finished"]),
  result: s.nullable(resultShape),
  players: s.array(s.object({ id: nonEmptyString, game: jsonValue }), { minimumLength: 1 }),
  policyState: jsonValue
}));
const LIVE_MATCH_CODEC = defineCodec(s.object({
  id: nonEmptyString,
  seed: uint32,
  matchTick: nonNegativeInteger,
  engine: s.unknown(),
  rulesetId: nonEmptyString,
  policy: s.unknown(),
  policyId: nonEmptyString,
  policyState: s.unknown(),
  status: s.enum(["playing", "finished"]),
  result: s.nullable(resultShape),
  players: s.array(s.object({ id: nonEmptyString, game: s.unknown() }), { minimumLength: 1 })
}));
const POLICY_CODEC = defineCodec(s.object({
  id: nonEmptyString,
  validatePlayerIds: s.function(),
  createState: s.function(),
  beforeStep: s.function(),
  onGameEvent: s.function(),
  afterStep: s.function()
}, { allowUnknown: true }));
const POLICY_STATE_HOOKS_CODEC = defineCodec(s.object({
  snapshotState: s.function(),
  restoreState: s.function()
}, { allowUnknown: true }));
const JSON_VALUE_CODEC = defineCodec(jsonValue);
const NON_EMPTY_STRING_CODEC = defineCodec(nonEmptyString);

function normalizePlayerIds(playerIds, name = "playerIds") {
  const normalized = PLAYER_IDS_CODEC.parse(playerIds, name);
  if (new Set(normalized).size !== normalized.length) {
    throw new Error(`${name} must be unique`);
  }
  return normalized;
}

function assertPolicy(policy) {
  if (!policy) throw new Error("match policy is required");
  POLICY_CODEC.assert(policy, "match policy");
}

function assertPolicyStateHooks(policy) {
  POLICY_STATE_HOOKS_CODEC.assert(policy, "match policy");
}

function normalizeResult(result, status, playerIds, matchTick, name = "match snapshot.result") {
  if (status === "playing") {
    if (result !== null) throw new Error(`${name} must be null while the match is playing`);
    return null;
  }
  if (status !== "finished") throw new Error("match snapshot.status must be playing or finished");
  const normalized = MATCH_RESULT_CODEC.parse(result, name);
  if (normalized.type === "winner" && !playerIds.includes(normalized.winnerId)) {
    throw new Error(`${name}.winnerId must identify a match player`);
  }
  if (matchTick === 0 || normalized.atMatchTick !== matchTick - 1) {
    throw new Error(`${name}.atMatchTick must be the completed match tick ${matchTick - 1}`);
  }
  return normalized;
}

function makePolicySnapshotContext({ matchId, seed, matchTick, playerIds, gameSnapshots }) {
  return Object.freeze({
    matchId,
    seed,
    matchTick,
    playerIds: Object.freeze([...playerIds]),
    gameSnapshots: Object.freeze(gameSnapshots.map((game) => game))
  });
}

function playerById(match, playerId) {
  return match.players.find((player) => player.id === playerId) || null;
}

function finishMatch(match, result, events) {
  if (match.status !== "playing") return false;
  const playerIds = match.players.map((player) => player.id);
  // Policies report atMatchTick for the tick currently being processed. Since
  // matchTick increments after policy hooks, validate it against matchTick + 1.
  const normalizedResult = normalizeResult(
    result,
    "finished",
    playerIds,
    match.matchTick + 1,
    "match policy result"
  );
  match.status = "finished";
  match.result = Object.freeze(normalizedResult);
  events.push({ type: "MATCH_FINISHED", result: { ...match.result } });
  return true;
}

function createPolicyCapabilities(match, events) {
  const playerIds = Object.freeze(match.players.map((player) => player.id));

  function getPlayer(playerId) {
    const player = playerById(match, playerId);
    if (!player) return null;
    return Object.freeze({
      id: player.id,
      status: player.game.status,
      worldTick: player.game.worldTick
    });
  }

  return Object.freeze({
    matchId: match.id,
    seed: match.seed,
    matchTick: match.matchTick,
    playerIds,
    state: match.policyState,

    getPlayer,

    getAlivePlayerIds() {
      return Object.freeze(
        match.players
          .filter((player) => player.game.status === "playing")
          .map((player) => player.id)
      );
    },

    queueGarbage(playerId, packet) {
      const player = playerById(match, playerId);
      if (!player || player.game.status !== "playing") return false;
      return match.engine.queueGarbage(player.game, packet);
    },

    cancelIncomingGarbage(playerId, rows) {
      const player = playerById(match, playerId);
      if (!player) return { cancelled: 0, remaining: rows };
      return match.engine.cancelIncomingGarbage(player.game, rows);
    },

    emit(event) {
      if (!event || typeof event !== "object" || Array.isArray(event)) {
        throw new Error("match policy events must be objects");
      }
      events.push({ ...event });
    },

    finish(result) {
      return finishMatch(match, result, events);
    }
  });
}

export function createMatch({
  id = "match-1",
  playerIds,
  seed = 1,
  rules,
  policy
}) {
  if (!rules) throw new Error("rules are required");
  assertPolicy(policy);
  NON_EMPTY_STRING_CODEC.assert(id, "match id");
  const normalizedPlayerIds = normalizePlayerIds(playerIds);
  policy.validatePlayerIds(Object.freeze([...normalizedPlayerIds]));
  const engine = createGameEngine(rules);

  return {
    id,
    seed: seed >>> 0,
    matchTick: 0,
    engine,
    rulesetId: engine.rulesetId,
    policy,
    policyId: policy.id,
    policyState: policy.createState(),
    status: "playing",
    result: null,
    players: normalizedPlayerIds.map((playerId, index) => ({
      id: playerId,
      game: engine.create({ seed: mix32((seed >>> 0) ^ (index + 1)) })
    }))
  };
}

export function stepMatch(match, commandsByPlayer = {}) {
  const events = [];
  if (match.status !== "playing") return events;
  const capabilities = createPolicyCapabilities(match, events);

  match.policy.beforeStep(capabilities);

  const gameEventBatches = [];
  for (const player of match.players) {
    if (player.game.status !== "playing") continue;
    const commands = commandsByPlayer[player.id] || [];
    const gameEvents = match.engine.step(player.game, commands);
    gameEventBatches.push({ playerId: player.id, gameEvents });
  }

  // Interpret cross-playfield consequences only after every game has advanced.
  // This keeps policy timing independent of player iteration order.
  for (const { playerId, gameEvents } of gameEventBatches) {
    for (const event of gameEvents) {
      events.push({ ...event, playerId });
      match.policy.onGameEvent(capabilities, playerId, event);
    }
  }

  match.policy.afterStep(capabilities);
  match.matchTick += 1;
  return events;
}

export function getPlayerGame(match, playerId) {
  const player = playerById(match, playerId);
  return player ? player.game : null;
}

export function snapshotMatch(match) {
  LIVE_MATCH_CODEC.assert(match, "match");
  assertPolicy(match.policy);
  assertPolicyStateHooks(match.policy);
  if (match.policyId !== match.policy.id) throw new Error("match policy id does not match the bound policy");
  if (!match.engine || match.engine.rulesetId !== match.rulesetId) {
    throw new Error("match ruleset id does not match the bound engine");
  }

  const playerIds = normalizePlayerIds(match.players?.map((player) => player.id), "match playerIds");
  match.policy.validatePlayerIds(Object.freeze([...playerIds]));
  const players = match.players.map((player) => ({
    id: player.id,
    game: match.engine.snapshot(player.game)
  }));
  const gameSnapshots = players.map((player) => player.game);
  const result = normalizeResult(match.result, match.status, playerIds, match.matchTick, "match.result");
  const context = makePolicySnapshotContext({
    matchId: match.id,
    seed: match.seed,
    matchTick: match.matchTick,
    playerIds,
    gameSnapshots
  });
  const serializedPolicyState = match.policy.snapshotState(match.policyState, context);
  const snapshot = {
    schemaVersion: MATCH_SNAPSHOT_SCHEMA_VERSION,
    matchId: match.id,
    seed: match.seed,
    matchTick: match.matchTick,
    rulesetId: match.rulesetId,
    policyId: match.policyId,
    playerIds: [...playerIds],
    status: match.status,
    result,
    players,
    policyState: serializedPolicyState
  };
  return MATCH_SNAPSHOT_CODEC.parse(snapshot, "match snapshot");
}

export function restoreMatch(snapshot, { rules, policy } = {}) {
  if (!rules) throw new Error("rules are required to restore a match");
  assertPolicy(policy);
  assertPolicyStateHooks(policy);
  const decoded = MATCH_SNAPSHOT_CODEC.parse(snapshot, "match snapshot");
  if (decoded.schemaVersion !== MATCH_SNAPSHOT_SCHEMA_VERSION) {
    throw new Error(`Unsupported match snapshot schema: ${String(decoded.schemaVersion)}`);
  }

  const engine = createGameEngine(rules);
  if (decoded.rulesetId !== engine.rulesetId) {
    throw new Error(
      `Match snapshot ruleset mismatch: expected ${engine.rulesetId}, received ${String(decoded.rulesetId)}`
    );
  }
  if (decoded.policyId !== policy.id) {
    throw new Error(`Match snapshot policy mismatch: expected ${policy.id}, received ${String(decoded.policyId)}`);
  }

  const playerIds = normalizePlayerIds(decoded.playerIds, "match snapshot.playerIds");
  policy.validatePlayerIds(Object.freeze([...playerIds]));
  if (decoded.players.length !== playerIds.length) {
    throw new Error("match snapshot.players must contain exactly one entry per playerId");
  }

  const restoredPlayers = Array.from(decoded.players, (playerSnapshot, index) => {
    const path = `match snapshot.players[${index}]`;
    if (playerSnapshot.id !== playerIds[index]) {
      throw new Error(`${path}.id must match match snapshot.playerIds[${index}]`);
    }
    return { id: playerSnapshot.id, game: engine.restore(playerSnapshot.game) };
  });
  const validatedGameSnapshots = restoredPlayers.map((player) => engine.snapshot(player.game));
  for (const [index, gameSnapshot] of validatedGameSnapshots.entries()) {
    if (gameSnapshot.stepTick > decoded.matchTick) {
      throw new Error(`match snapshot.players[${index}].game.stepTick cannot exceed matchTick`);
    }
    if (gameSnapshot.status === "playing" && gameSnapshot.stepTick !== decoded.matchTick) {
      throw new Error(`match snapshot.players[${index}].game.stepTick must equal matchTick while playing`);
    }
  }

  const result = normalizeResult(
    decoded.result,
    decoded.status,
    playerIds,
    decoded.matchTick,
    "match snapshot.result"
  );
  if (result?.type === "winner") {
    const alivePlayerIds = restoredPlayers
      .filter((player) => player.game.status === "playing")
      .map((player) => player.id);
    if (alivePlayerIds.length !== 1 || alivePlayerIds[0] !== result.winnerId) {
      throw new Error("match snapshot.result winner must be the only surviving player");
    }
  } else if (result?.type === "draw" || result?.type === "eliminated") {
    if (restoredPlayers.some((player) => player.game.status === "playing")) {
      throw new Error(`match snapshot.result ${result.type} requires every player to be eliminated`);
    }
  }
  const context = makePolicySnapshotContext({
    matchId: decoded.matchId,
    seed: decoded.seed,
    matchTick: decoded.matchTick,
    playerIds,
    gameSnapshots: validatedGameSnapshots
  });
  const policyState = policy.restoreState(decoded.policyState, context);
  JSON_VALUE_CODEC.assert(policy.snapshotState(policyState, context), "restored match policy state");

  return {
    id: decoded.matchId,
    seed: decoded.seed,
    matchTick: decoded.matchTick,
    engine,
    rulesetId: engine.rulesetId,
    policy,
    policyId: policy.id,
    policyState,
    status: decoded.status,
    result: result === null ? null : Object.freeze(result),
    players: restoredPlayers
  };
}

export function hashMatch(match) {
  return hashJson32Hex(snapshotMatch(match));
}
