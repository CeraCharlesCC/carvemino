export const PROTOCOL_VERSION = 3;

export const PROTOCOL_LIMITS = Object.freeze({
  maxTextLength: 256 * 1024,
  maxSnapshotLength: 192 * 1024,
  maxSequence: 0xffffffff,
  maxMatchTick: 0xffffffff,
  maxCommandsPerPlayerTick: 32,
  maxPlayerIdLength: 128,
  maxPieceIdLength: 128,
  maxSculptCoordinateMagnitude: 64
});

const MESSAGE_TYPES = new Set([
  "hello",
  "ready",
  "match-start",
  "input",
  "input-frame",
  "match-hash",
  "match-snapshot",
  "leave",
  "attack",
  "game-over",
  "snapshot",
  "state-hash",
  "ping",
  "pong",
  "resync-request"
]);

const ENVELOPE_KEYS = Object.freeze(["v", "type", "seq", "matchTick", "payload"]);
const ENVELOPE_REQUIRED_KEYS = Object.freeze(["v", "type", "payload"]);
const TICKED_MESSAGE_TYPES = new Set(["input", "input-frame", "match-hash", "match-snapshot"]);
const SEQUENCED_MESSAGE_TYPES = new Set([...TICKED_MESSAGE_TYPES, "leave"]);
const MONOTONIC_TICK_TYPES = new Set(["input", "input-frame", "match-hash"]);
const UINT32_MAX = 0xffffffff;
const GAME_OVER_REASONS = new Set([
  "spawn-blocked",
  "garbage-topout",
  "garbage-pushed-piece-out",
  "lock-topout"
]);
const GAMEPLAY_COMMAND_TYPES = new Set([
  "FOCUS_PREVIOUS",
  "FOCUS_NEXT",
  "SCULPT",
  "HARD_DROP_FOCUSED"
]);

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertPlainObject(value, path) {
  if (!isPlainObject(value)) throw new Error(`${path} must be an object`);
}

function assertExactKeys(value, keys, path, requiredKeys = keys) {
  assertPlainObject(value, path);
  const allowed = new Set(keys);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error(`${path}.${key} is not supported`);
  }
  for (const key of requiredKeys) {
    if (!Object.hasOwn(value, key)) throw new Error(`${path}.${key} is required`);
  }
}

function assertRequiredKeys(value, keys, path) {
  assertPlainObject(value, path);
  for (const key of keys) {
    if (!Object.hasOwn(value, key)) throw new Error(`${path}.${key} is required`);
  }
}

function assertSafeInteger(value, path, { minimum = Number.MIN_SAFE_INTEGER, maximum = Number.MAX_SAFE_INTEGER } = {}) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${path} must be an integer between ${minimum} and ${maximum}`);
  }
}

function assertId(value, path, maximumLength = PROTOCOL_LIMITS.maxPlayerIdLength) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${path} must be a non-empty string`);
  }
  if (value.length > maximumLength) {
    throw new Error(`${path} exceeds ${maximumLength} characters`);
  }
}

function assertPlayerIds(value, path, { exactLength = null } = {}) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${path} must be a non-empty array`);
  }
  if (exactLength !== null && value.length !== exactLength) {
    throw new Error(`${path} must contain exactly ${exactLength} player ids`);
  }
  const ids = new Set();
  for (const [index, playerId] of value.entries()) {
    assertId(playerId, `${path}[${index}]`);
    if (ids.has(playerId)) throw new Error(`${path} must contain unique player ids`);
    ids.add(playerId);
  }
}

function assertHash(value, path) {
  if (typeof value !== "string" || !/^[0-9a-f]{8}$/.test(value)) {
    throw new Error(`${path} must be an 8-character lowercase hexadecimal hash`);
  }
}

function assertJsonSize(value, path, maximumLength) {
  let text;
  try {
    text = JSON.stringify(value);
  } catch (error) {
    throw new Error(`${path} must be JSON-serializable`, { cause: error });
  }
  if (typeof text !== "string") throw new Error(`${path} must be JSON-serializable`);
  if (text.length > maximumLength) {
    throw new Error(`${path} exceeds ${maximumLength} characters`);
  }
}

function validateGameplayCommandAtPath(command, path) {
  assertPlainObject(command, path);
  if (!GAMEPLAY_COMMAND_TYPES.has(command.type)) {
    throw new Error(`${path}.type is invalid: ${String(command.type)}`);
  }

  if (command.type === "SCULPT") {
    assertExactKeys(command, ["type", "pieceId", "x", "y"], path);
    assertId(command.pieceId, `${path}.pieceId`, PROTOCOL_LIMITS.maxPieceIdLength);
    const limit = PROTOCOL_LIMITS.maxSculptCoordinateMagnitude;
    assertSafeInteger(command.x, `${path}.x`, { minimum: -limit, maximum: limit });
    assertSafeInteger(command.y, `${path}.y`, { minimum: -limit, maximum: limit });
    return;
  }

  assertExactKeys(command, ["type"], path);
}

export function validateGameplayCommand(command) {
  validateGameplayCommandAtPath(command, "Gameplay command");
  return command;
}

function validateCommandArray(commands, path) {
  if (!Array.isArray(commands)) throw new Error(`${path} must be an array`);
  if (commands.length > PROTOCOL_LIMITS.maxCommandsPerPlayerTick) {
    throw new Error(`${path} may contain at most ${PROTOCOL_LIMITS.maxCommandsPerPlayerTick} commands`);
  }
  for (const [index, command] of commands.entries()) {
    validateGameplayCommandAtPath(command, `${path}[${index}]`);
  }
}

function validateHello(payload) {
  assertExactKeys(payload, ["playerId", "rulesetId", "policyId"], "Protocol hello payload");
  assertId(payload.playerId, "Protocol hello payload.playerId");
  assertId(payload.rulesetId, "Protocol hello payload.rulesetId");
  assertId(payload.policyId, "Protocol hello payload.policyId");
}

function validateReady(payload) {
  assertExactKeys(payload, ["playerId"], "Protocol ready payload");
  assertId(payload.playerId, "Protocol ready payload.playerId");
}

function validateMatchStart(payload) {
  assertExactKeys(
    payload,
    ["matchId", "seed", "rulesetId", "policyId", "playerIds"],
    "Protocol match-start payload"
  );
  assertId(payload.matchId, "Protocol match-start payload.matchId");
  assertSafeInteger(payload.seed, "Protocol match-start payload.seed", { minimum: 0, maximum: UINT32_MAX });
  assertId(payload.rulesetId, "Protocol match-start payload.rulesetId");
  assertId(payload.policyId, "Protocol match-start payload.policyId");
  assertPlayerIds(payload.playerIds, "Protocol match-start payload.playerIds", { exactLength: 2 });
}

function validateInput(payload) {
  assertExactKeys(payload, ["playerId", "commands"], "Protocol input payload");
  assertId(payload.playerId, "Protocol input payload.playerId");
  validateCommandArray(payload.commands, "Protocol input payload.commands");
}

function validateInputFrame(payload) {
  assertExactKeys(payload, ["commandsByPlayer"], "Protocol input-frame payload");
  assertPlainObject(payload.commandsByPlayer, "Protocol input-frame payload.commandsByPlayer");
  const playerIds = Object.keys(payload.commandsByPlayer);
  if (playerIds.length !== 2) {
    throw new Error("Protocol input-frame payload.commandsByPlayer must contain exactly 2 players");
  }
  for (const playerId of playerIds) {
    assertId(playerId, "Protocol input-frame payload player id");
    validateCommandArray(
      payload.commandsByPlayer[playerId],
      `Protocol input-frame payload.commandsByPlayer.${playerId}`
    );
  }
}

function validateMatchHash(payload) {
  assertExactKeys(payload, ["hash"], "Protocol match-hash payload");
  assertHash(payload.hash, "Protocol match-hash payload.hash");
}

function validateMatchSnapshot(payload) {
  assertExactKeys(payload, ["snapshot"], "Protocol match-snapshot payload");
  const path = "Protocol match-snapshot payload.snapshot";
  assertRequiredKeys(payload.snapshot, ["matchId", "seed", "matchTick", "rulesetId", "policyId", "playerIds"], path);
  assertId(payload.snapshot.matchId, `${path}.matchId`);
  assertSafeInteger(payload.snapshot.seed, `${path}.seed`, { minimum: 0, maximum: UINT32_MAX });
  assertSafeInteger(payload.snapshot.matchTick, `${path}.matchTick`, {
    minimum: 0,
    maximum: PROTOCOL_LIMITS.maxMatchTick
  });
  assertId(payload.snapshot.rulesetId, `${path}.rulesetId`);
  assertId(payload.snapshot.policyId, `${path}.policyId`);
  assertPlayerIds(payload.snapshot.playerIds, `${path}.playerIds`, { exactLength: 2 });
  assertJsonSize(payload.snapshot, path, PROTOCOL_LIMITS.maxSnapshotLength);
}

function validateLeave(payload) {
  assertExactKeys(payload, ["playerId"], "Protocol leave payload");
  assertId(payload.playerId, "Protocol leave payload.playerId");
}

function validateGarbagePacket(packet, path) {
  assertExactKeys(
    packet,
    ["id", "sourcePlayerId", "rows", "applyAtWorldTick", "seed"],
    path
  );
  assertId(packet.id, `${path}.id`);
  assertId(packet.sourcePlayerId, `${path}.sourcePlayerId`);
  assertSafeInteger(packet.rows, `${path}.rows`, { minimum: 1 });
  assertSafeInteger(packet.applyAtWorldTick, `${path}.applyAtWorldTick`, { minimum: 0 });
  assertSafeInteger(packet.seed, `${path}.seed`, { minimum: 0, maximum: UINT32_MAX });
}

function validateAttack(payload) {
  assertExactKeys(payload, ["targetPlayerId", "packet"], "Protocol attack payload");
  assertId(payload.targetPlayerId, "Protocol attack payload.targetPlayerId");
  validateGarbagePacket(payload.packet, "Protocol attack payload.packet");
}

function validateGameOver(payload) {
  assertExactKeys(payload, ["playerId", "reason"], "Protocol game-over payload");
  assertId(payload.playerId, "Protocol game-over payload.playerId");
  if (!GAME_OVER_REASONS.has(payload.reason)) {
    throw new Error(`Protocol game-over payload.reason is invalid: ${String(payload.reason)}`);
  }
}

function validateSnapshot(payload) {
  assertExactKeys(payload, ["playerId", "snapshot"], "Protocol snapshot payload");
  assertId(payload.playerId, "Protocol snapshot payload.playerId");
  // Legacy one-playfield snapshots remain reserved. Full semantic validation is
  // rules-bound and happens at GameEngine.restore().
  assertPlainObject(payload.snapshot, "Protocol snapshot payload.snapshot");
  assertId(payload.snapshot.rulesetId, "Protocol snapshot payload.snapshot.rulesetId");
  assertSafeInteger(payload.snapshot.schemaVersion, "Protocol snapshot payload.snapshot.schemaVersion", { minimum: 1 });
  assertJsonSize(payload.snapshot, "Protocol snapshot payload.snapshot", PROTOCOL_LIMITS.maxSnapshotLength);
}

function validateStateHash(payload) {
  assertExactKeys(payload, ["playerId", "hash"], "Protocol state-hash payload");
  assertId(payload.playerId, "Protocol state-hash payload.playerId");
  assertHash(payload.hash, "Protocol state-hash payload.hash");
}

function validatePingPong(payload, type) {
  assertExactKeys(payload, ["nonce"], `Protocol ${type} payload`);
  assertSafeInteger(payload.nonce, `Protocol ${type} payload.nonce`, { minimum: 0, maximum: UINT32_MAX });
}

function validateResyncRequest(payload) {
  assertExactKeys(payload, ["playerId"], "Protocol resync-request payload");
  assertId(payload.playerId, "Protocol resync-request payload.playerId");
}

const PAYLOAD_VALIDATORS = Object.freeze({
  hello: validateHello,
  ready: validateReady,
  "match-start": validateMatchStart,
  input: validateInput,
  "input-frame": validateInputFrame,
  "match-hash": validateMatchHash,
  "match-snapshot": validateMatchSnapshot,
  leave: validateLeave,
  attack: validateAttack,
  "game-over": validateGameOver,
  snapshot: validateSnapshot,
  "state-hash": validateStateHash,
  ping: (payload) => validatePingPong(payload, "ping"),
  pong: (payload) => validatePingPong(payload, "pong"),
  "resync-request": validateResyncRequest
});

function assertSameRoster(actual, expected, path) {
  if (actual.length !== expected.length || actual.some((playerId, index) => playerId !== expected[index])) {
    throw new Error(`${path} must match the negotiated player roster`);
  }
}

function assertRosterMember(playerId, roster, path) {
  if (!roster.includes(playerId)) throw new Error(`${path} is not in the negotiated player roster`);
}

function validateRosterRouting(message, playerIds) {
  if (!playerIds) return;
  const payload = message.payload;
  switch (message.type) {
    case "hello":
    case "ready":
    case "input":
    case "game-over":
    case "snapshot":
    case "state-hash":
    case "resync-request":
    case "leave":
      assertRosterMember(payload.playerId, playerIds, `Protocol ${message.type} payload.playerId`);
      break;
    case "match-start":
      assertSameRoster(payload.playerIds, playerIds, "Protocol match-start payload.playerIds");
      break;
    case "input-frame":
      assertSameRoster(
        Object.keys(payload.commandsByPlayer).sort(),
        [...playerIds].sort(),
        "Protocol input-frame payload.commandsByPlayer"
      );
      break;
    case "match-snapshot":
      assertSameRoster(payload.snapshot.playerIds, playerIds, "Protocol match-snapshot payload.snapshot.playerIds");
      break;
    case "attack":
      assertRosterMember(payload.targetPlayerId, playerIds, "Protocol attack payload.targetPlayerId");
      assertRosterMember(payload.packet.sourcePlayerId, playerIds, "Protocol attack payload.packet.sourcePlayerId");
      break;
    default:
      break;
  }
}

function normalizeRoster(playerIds) {
  if (playerIds === undefined || playerIds === null) return null;
  assertPlayerIds(playerIds, "Protocol negotiated playerIds", { exactLength: 2 });
  return Object.freeze([...playerIds]);
}

export function createMessage(type, payload, fields = {}) {
  if (!MESSAGE_TYPES.has(type)) throw new Error(`Unknown protocol message type: ${type}`);
  assertExactKeys(fields, ["seq", "matchTick"], "Protocol message fields", []);
  const message = {
    v: PROTOCOL_VERSION,
    type,
    ...fields,
    payload
  };
  return validateMessage(message);
}

export function validateMessage(message, { playerIds = null } = {}) {
  assertExactKeys(message, ENVELOPE_KEYS, "Protocol message", ENVELOPE_REQUIRED_KEYS);
  if (message.v !== PROTOCOL_VERSION) {
    throw new Error(`Unsupported protocol version: ${message.v}`);
  }
  if (!MESSAGE_TYPES.has(message.type)) {
    throw new Error(`Unknown protocol message type: ${message.type}`);
  }
  if (message.seq !== undefined) {
    assertSafeInteger(message.seq, "Protocol seq", { minimum: 0, maximum: PROTOCOL_LIMITS.maxSequence });
  }
  if (message.matchTick !== undefined) {
    assertSafeInteger(message.matchTick, "Protocol matchTick", { minimum: 0, maximum: PROTOCOL_LIMITS.maxMatchTick });
  }
  if (SEQUENCED_MESSAGE_TYPES.has(message.type) && message.seq === undefined) {
    throw new Error(`Protocol ${message.type} message.seq is required`);
  }
  if (TICKED_MESSAGE_TYPES.has(message.type) && message.matchTick === undefined) {
    throw new Error(`Protocol ${message.type} message.matchTick is required`);
  }

  PAYLOAD_VALIDATORS[message.type](message.payload);
  if (message.type === "match-snapshot" && message.payload.snapshot.matchTick !== message.matchTick) {
    throw new Error("Protocol match-snapshot matchTick must match payload.snapshot.matchTick");
  }
  validateRosterRouting(message, normalizeRoster(playerIds));
  return message;
}

export function createProtocolStreamValidator({ playerIds = null } = {}) {
  let roster = normalizeRoster(playerIds);
  let lastSequence = -1;
  const lastMatchTickByType = new Map();

  function setPlayerIds(nextPlayerIds) {
    roster = normalizeRoster(nextPlayerIds);
  }

  function validate(message) {
    validateMessage(message, { playerIds: roster });

    if (message.seq !== undefined && message.seq <= lastSequence) {
      throw new Error(`Protocol seq must increase monotonically after ${lastSequence}`);
    }
    if (MONOTONIC_TICK_TYPES.has(message.type)) {
      const previous = lastMatchTickByType.get(message.type);
      if (previous !== undefined && message.matchTick <= previous) {
        throw new Error(`Protocol ${message.type} matchTick must increase monotonically after ${previous}`);
      }
    }

    if (message.seq !== undefined) lastSequence = message.seq;
    if (MONOTONIC_TICK_TYPES.has(message.type)) {
      lastMatchTickByType.set(message.type, message.matchTick);
    }
    return message;
  }

  function decode(text) {
    return validate(decodeMessage(text));
  }

  return Object.freeze({ validate, decode, setPlayerIds });
}

export function encodeMessage(message) {
  validateMessage(message);
  return JSON.stringify(message);
}

export function decodeMessage(text, options = {}) {
  if (typeof text !== "string") throw new Error("Protocol data must be text");
  if (text.length > PROTOCOL_LIMITS.maxTextLength) {
    throw new Error(`Protocol data exceeds ${PROTOCOL_LIMITS.maxTextLength} characters`);
  }
  return validateMessage(JSON.parse(text), options);
}