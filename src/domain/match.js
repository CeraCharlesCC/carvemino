import { createGameEngine } from "./game.js";
import { mix32 } from "./match/policy-utils.js";

const MATCH_SNAPSHOT_SCHEMA_VERSION = 1;
const UINT32_MAX = 0xffffffff;
const MATCH_SNAPSHOT_KEYS = Object.freeze([
  "schemaVersion",
  "matchId",
  "seed",
  "matchTick",
  "rulesetId",
  "policyId",
  "playerIds",
  "status",
  "result",
  "players",
  "policyState"
]);
const MATCH_PLAYER_SNAPSHOT_KEYS = Object.freeze(["id", "game"]);
const POLICY_HOOKS = Object.freeze([
  "validatePlayerIds",
  "createState",
  "beforeStep",
  "onGameEvent",
  "afterStep"
]);
const POLICY_STATE_HOOKS = Object.freeze(["snapshotState", "restoreState"]);

function assertPlainObject(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${name} must be an object`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error(`${name} must be a plain object`);
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

function assertNonEmptyString(value, name) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${name} must be a non-empty string`);
  }
}

function assertSafeInteger(value, name, { minimum = Number.MIN_SAFE_INTEGER, maximum = Number.MAX_SAFE_INTEGER } = {}) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
}

function normalizePlayerIds(playerIds, name = "playerIds") {
  if (!Array.isArray(playerIds) || playerIds.length === 0) {
    throw new Error(`${name} must contain at least one player`);
  }
  const normalized = Array.from(playerIds, (playerId, index) => {
    assertNonEmptyString(playerId, `${name}[${index}]`);
    return playerId;
  });
  if (new Set(normalized).size !== normalized.length) {
    throw new Error(`${name} must be unique`);
  }
  return normalized;
}

function assertJsonValue(value, name, seen = new WeakSet()) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`${name} must contain only finite JSON numbers`);
    return;
  }
  if (typeof value !== "object") throw new Error(`${name} must contain only JSON-safe values`);
  if (seen.has(value)) throw new Error(`${name} must not contain circular references`);
  seen.add(value);
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.hasOwn(value, index)) throw new Error(`${name} must not contain sparse array entries`);
      assertJsonValue(value[index], `${name}[${index}]`, seen);
    }
  } else {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error(`${name} must contain only plain JSON objects`);
    }
    for (const [key, entry] of Object.entries(value)) {
      assertJsonValue(entry, `${name}.${key}`, seen);
    }
  }
  seen.delete(value);
}

function cloneJsonValue(value) {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(cloneJsonValue);
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, cloneJsonValue(entry)]));
}

function assertPolicy(policy) {
  if (!policy || typeof policy !== "object") throw new Error("match policy is required");
  if (typeof policy.id !== "string" || policy.id.trim() === "") {
    throw new Error("match policy id must be a non-empty string");
  }
  for (const hook of POLICY_HOOKS) {
    if (typeof policy[hook] !== "function") throw new Error(`match policy.${hook} must be a function`);
  }
}

function assertPolicyStateHooks(policy) {
  for (const hook of POLICY_STATE_HOOKS) {
    if (typeof policy[hook] !== "function") {
      throw new Error(`match policy.${hook} must be a function for match snapshots`);
    }
  }
}

function normalizeResult(result, status, playerIds, matchTick, name = "match snapshot.result") {
  if (status === "playing") {
    if (result !== null) throw new Error(`${name} must be null while the match is playing`);
    return null;
  }
  if (status !== "finished") throw new Error("match snapshot.status must be playing or finished");
  assertPlainObject(result, name);
  assertNonEmptyString(result.type, `${name}.type`);

  let normalized;
  if (result.type === "winner") {
    assertExactKeys(result, ["type", "winnerId", "atMatchTick"], name);
    assertNonEmptyString(result.winnerId, `${name}.winnerId`);
    if (!playerIds.includes(result.winnerId)) throw new Error(`${name}.winnerId must identify a match player`);
    normalized = { type: "winner", winnerId: result.winnerId, atMatchTick: result.atMatchTick };
  } else if (result.type === "draw" || result.type === "eliminated") {
    assertExactKeys(result, ["type", "atMatchTick"], name);
    normalized = { type: result.type, atMatchTick: result.atMatchTick };
  } else {
    throw new Error(`${name}.type is unsupported: ${result.type}`);
  }

  if (Object.hasOwn(normalized, "atMatchTick")) {
    assertSafeInteger(normalized.atMatchTick, `${name}.atMatchTick`, { minimum: 0 });
    if (matchTick === 0 || normalized.atMatchTick !== matchTick - 1) {
      throw new Error(`${name}.atMatchTick must be the completed match tick ${matchTick - 1}`);
    }
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

function hashSnapshot(snapshot) {
  const text = JSON.stringify(snapshot);
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function playerById(match, playerId) {
  return match.players.find((player) => player.id === playerId) || null;
}

function finishMatch(match, result, events) {
  if (match.status !== "playing") return false;
  const playerIds = match.players.map((player) => player.id);
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
  assertNonEmptyString(id, "match id");
  const normalizedPlayerIds = normalizePlayerIds(playerIds);
  policy.validatePlayerIds(Object.freeze([...normalizedPlayerIds]));
  const engine = createGameEngine(rules);

  return {
    version: 2,
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
  assertPlainObject(match, "match");
  assertNonEmptyString(match.id, "match.id");
  assertSafeInteger(match.seed, "match.seed", { minimum: 0, maximum: UINT32_MAX });
  assertSafeInteger(match.matchTick, "match.matchTick", { minimum: 0 });
  assertNonEmptyString(match.rulesetId, "match.rulesetId");
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
  assertJsonValue(serializedPolicyState, "match policy snapshot");
  const policyState = cloneJsonValue(serializedPolicyState);

  return {
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
    policyState
  };
}

export function restoreMatch(snapshot, { rules, policy } = {}) {
  if (!rules) throw new Error("rules are required to restore a match");
  assertPolicy(policy);
  assertPolicyStateHooks(policy);
  assertExactKeys(snapshot, MATCH_SNAPSHOT_KEYS, "match snapshot");
  if (snapshot.schemaVersion !== MATCH_SNAPSHOT_SCHEMA_VERSION) {
    throw new Error(`Unsupported match snapshot schema: ${String(snapshot.schemaVersion)}`);
  }
  assertNonEmptyString(snapshot.matchId, "match snapshot.matchId");
  assertSafeInteger(snapshot.seed, "match snapshot.seed", { minimum: 0, maximum: UINT32_MAX });
  assertSafeInteger(snapshot.matchTick, "match snapshot.matchTick", { minimum: 0 });
  assertNonEmptyString(snapshot.rulesetId, "match snapshot.rulesetId");
  assertNonEmptyString(snapshot.policyId, "match snapshot.policyId");

  const engine = createGameEngine(rules);
  if (snapshot.rulesetId !== engine.rulesetId) {
    throw new Error(
      `Match snapshot ruleset mismatch: expected ${engine.rulesetId}, received ${String(snapshot.rulesetId)}`
    );
  }
  if (snapshot.policyId !== policy.id) {
    throw new Error(`Match snapshot policy mismatch: expected ${policy.id}, received ${String(snapshot.policyId)}`);
  }

  const playerIds = normalizePlayerIds(snapshot.playerIds, "match snapshot.playerIds");
  policy.validatePlayerIds(Object.freeze([...playerIds]));
  if (!Array.isArray(snapshot.players) || snapshot.players.length !== playerIds.length) {
    throw new Error("match snapshot.players must contain exactly one entry per playerId");
  }

  const restoredPlayers = Array.from(snapshot.players, (playerSnapshot, index) => {
    const path = `match snapshot.players[${index}]`;
    assertExactKeys(playerSnapshot, MATCH_PLAYER_SNAPSHOT_KEYS, path);
    if (playerSnapshot.id !== playerIds[index]) {
      throw new Error(`${path}.id must match match snapshot.playerIds[${index}]`);
    }
    return { id: playerSnapshot.id, game: engine.restore(playerSnapshot.game) };
  });
  const validatedGameSnapshots = restoredPlayers.map((player) => engine.snapshot(player.game));
  for (const [index, gameSnapshot] of validatedGameSnapshots.entries()) {
    if (gameSnapshot.stepTick > snapshot.matchTick) {
      throw new Error(`match snapshot.players[${index}].game.stepTick cannot exceed matchTick`);
    }
    if (gameSnapshot.status === "playing" && gameSnapshot.stepTick !== snapshot.matchTick) {
      throw new Error(`match snapshot.players[${index}].game.stepTick must equal matchTick while playing`);
    }
  }

  const result = normalizeResult(
    snapshot.result,
    snapshot.status,
    playerIds,
    snapshot.matchTick,
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
    matchId: snapshot.matchId,
    seed: snapshot.seed,
    matchTick: snapshot.matchTick,
    playerIds,
    gameSnapshots: validatedGameSnapshots
  });
  assertJsonValue(snapshot.policyState, "match snapshot.policyState");
  const policyState = policy.restoreState(cloneJsonValue(snapshot.policyState), context);
  assertJsonValue(policy.snapshotState(policyState, context), "restored match policy state");

  return {
    version: 2,
    id: snapshot.matchId,
    seed: snapshot.seed,
    matchTick: snapshot.matchTick,
    engine,
    rulesetId: engine.rulesetId,
    policy,
    policyId: policy.id,
    policyState,
    status: snapshot.status,
    result: result === null ? null : Object.freeze(result),
    players: restoredPlayers
  };
}

export function hashMatch(match) {
  return hashSnapshot(snapshotMatch(match));
}
