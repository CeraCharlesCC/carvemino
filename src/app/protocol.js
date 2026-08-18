export const PROTOCOL_VERSION = 2;

const MESSAGE_TYPES = new Set([
  "hello",
  "ready",
  "match-start",
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
const UINT32_MAX = 0xffffffff;
const MAX_PROTOCOL_TEXT_LENGTH = 256 * 1024;
const GAME_OVER_REASONS = new Set([
  "spawn-blocked",
  "garbage-topout",
  "garbage-pushed-piece-out",
  "lock-topout"
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

function assertSafeInteger(value, path, { minimum = Number.MIN_SAFE_INTEGER, maximum = Number.MAX_SAFE_INTEGER } = {}) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${path} must be an integer between ${minimum} and ${maximum}`);
  }
}

function assertId(value, path) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${path} must be a non-empty string`);
  }
}

function assertPlayerIds(value, path) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${path} must be a non-empty array`);
  }
  const ids = new Set();
  for (const [index, playerId] of value.entries()) {
    assertId(playerId, `${path}[${index}]`);
    if (ids.has(playerId)) throw new Error(`${path} must contain unique player ids`);
    ids.add(playerId);
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
  assertPlayerIds(payload.playerIds, "Protocol match-start payload.playerIds");
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
  // Full snapshot validation is rules-bound and happens at GameEngine.restore().
  // The protocol layer only validates the routing/schema discriminators here.
  assertPlainObject(payload.snapshot, "Protocol snapshot payload.snapshot");
  assertId(payload.snapshot.rulesetId, "Protocol snapshot payload.snapshot.rulesetId");
  assertSafeInteger(payload.snapshot.schemaVersion, "Protocol snapshot payload.snapshot.schemaVersion", { minimum: 1 });
}

function validateStateHash(payload) {
  assertExactKeys(payload, ["playerId", "hash"], "Protocol state-hash payload");
  assertId(payload.playerId, "Protocol state-hash payload.playerId");
  if (typeof payload.hash !== "string" || !/^[0-9a-f]{8}$/.test(payload.hash)) {
    throw new Error("Protocol state-hash payload.hash must be an 8-character lowercase hexadecimal hash");
  }
}

function validatePingPong(payload, type) {
  assertExactKeys(payload, ["nonce"], `Protocol ${type} payload`);
  assertSafeInteger(payload.nonce, `Protocol ${type} payload.nonce`, { minimum: 0 });
}

function validateResyncRequest(payload) {
  assertExactKeys(payload, ["playerId"], "Protocol resync-request payload");
  assertId(payload.playerId, "Protocol resync-request payload.playerId");
}

const PAYLOAD_VALIDATORS = Object.freeze({
  hello: validateHello,
  ready: validateReady,
  "match-start": validateMatchStart,
  attack: validateAttack,
  "game-over": validateGameOver,
  snapshot: validateSnapshot,
  "state-hash": validateStateHash,
  ping: (payload) => validatePingPong(payload, "ping"),
  pong: (payload) => validatePingPong(payload, "pong"),
  "resync-request": validateResyncRequest
});

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

export function validateMessage(message) {
  assertExactKeys(message, ENVELOPE_KEYS, "Protocol message", ENVELOPE_REQUIRED_KEYS);
  if (message.v !== PROTOCOL_VERSION) {
    throw new Error(`Unsupported protocol version: ${message.v}`);
  }
  if (!MESSAGE_TYPES.has(message.type)) {
    throw new Error(`Unknown protocol message type: ${message.type}`);
  }
  if (message.seq !== undefined) {
    assertSafeInteger(message.seq, "Protocol seq", { minimum: 0 });
  }
  if (message.matchTick !== undefined) {
    assertSafeInteger(message.matchTick, "Protocol matchTick", { minimum: 0 });
  }
  PAYLOAD_VALIDATORS[message.type](message.payload);
  return message;
}

export function encodeMessage(message) {
  validateMessage(message);
  return JSON.stringify(message);
}

export function decodeMessage(text) {
  if (typeof text !== "string") throw new Error("Protocol data must be text");
  if (text.length > MAX_PROTOCOL_TEXT_LENGTH) {
    throw new Error(`Protocol data exceeds ${MAX_PROTOCOL_TEXT_LENGTH} characters`);
  }
  return validateMessage(JSON.parse(text));
}
