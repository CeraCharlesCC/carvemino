import { defineCodec, shape as s } from "../codec.js";

export const PROTOCOL_VERSION = 4;

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
  "ping",
  "pong",
  "resync-request"
]);
const TICKED_MESSAGE_TYPES = new Set(["input", "input-frame", "match-hash", "match-snapshot"]);
const SEQUENCED_MESSAGE_TYPES = new Set([...TICKED_MESSAGE_TYPES, "leave"]);
const MONOTONIC_TICK_TYPES = new Set(["input", "input-frame", "match-hash"]);
const UINT32_MAX = 0xffffffff;

const idShape = (maximumLength = PROTOCOL_LIMITS.maxPlayerIdLength) => s.string({
  nonEmpty: true,
  maximumLength
});
const playerIdShape = idShape();
const uint32Shape = s.integer({ minimum: 0, maximum: UINT32_MAX });
const sequenceShape = s.integer({ minimum: 0, maximum: PROTOCOL_LIMITS.maxSequence });
const matchTickShape = s.integer({ minimum: 0, maximum: PROTOCOL_LIMITS.maxMatchTick });
const playerIdsShape = s.refine(
  s.array(playerIdShape, { minimumLength: 2, entryLabel: "player ids" }),
  (playerIds, path) => {
    if (new Set(playerIds).size !== playerIds.length) {
      throw new Error(`${path} must contain unique player ids`);
    }
  }
);
const PLAYER_IDS_CODEC = defineCodec(playerIdsShape);

const gameplayCommandShape = s.discriminatedUnion("type", {
  FOCUS_PREVIOUS: s.object({ type: s.literal("FOCUS_PREVIOUS") }),
  FOCUS_NEXT: s.object({ type: s.literal("FOCUS_NEXT") }),
  SCULPT: s.object({
    type: s.literal("SCULPT"),
    pieceId: idShape(PROTOCOL_LIMITS.maxPieceIdLength),
    x: s.integer({
      minimum: -PROTOCOL_LIMITS.maxSculptCoordinateMagnitude,
      maximum: PROTOCOL_LIMITS.maxSculptCoordinateMagnitude
    }),
    y: s.integer({
      minimum: -PROTOCOL_LIMITS.maxSculptCoordinateMagnitude,
      maximum: PROTOCOL_LIMITS.maxSculptCoordinateMagnitude
    })
  }),
  HARD_DROP_FOCUSED: s.object({ type: s.literal("HARD_DROP_FOCUSED") })
}, {
  unsupportedMessage: (path, type) => `${path}.type is invalid: ${String(type)}`
});
const GAMEPLAY_COMMAND_CODEC = defineCodec(gameplayCommandShape);
const commandArrayShape = s.array(gameplayCommandShape, {
  maximumLength: PROTOCOL_LIMITS.maxCommandsPerPlayerTick
});
const commandsByPlayerShape = s.record(commandArrayShape, {
  key: playerIdShape,
  minimumEntries: 2,
  entryLabel: "players"
});

const hashShape = s.refine(s.string(), (value, path) => {
  if (!/^[0-9a-f]{8}$/.test(value)) {
    throw new Error(`${path} must be an 8-character lowercase hexadecimal hash`);
  }
});

const matchSnapshotSummaryShape = s.refine(s.object({
  matchId: idShape(),
  seed: uint32Shape,
  matchTick: matchTickShape,
  rulesetId: idShape(),
  policyId: idShape(),
  playerIds: playerIdsShape
}, { allowUnknown: true }), (snapshot, path) => {
  let text;
  try {
    text = JSON.stringify(snapshot);
  } catch (error) {
    throw new Error(`${path} must be JSON-serializable`, { cause: error });
  }
  if (typeof text !== "string") throw new Error(`${path} must be JSON-serializable`);
  if (text.length > PROTOCOL_LIMITS.maxSnapshotLength) {
    throw new Error(`${path} exceeds ${PROTOCOL_LIMITS.maxSnapshotLength} characters`);
  }
});

const PAYLOAD_CODECS = Object.freeze({
  hello: defineCodec(s.object({
    playerId: playerIdShape,
    rulesetId: idShape(),
    policyId: idShape()
  })),
  ready: defineCodec(s.object({ playerId: playerIdShape })),
  "match-start": defineCodec(s.object({
    matchId: idShape(),
    seed: uint32Shape,
    rulesetId: idShape(),
    policyId: idShape(),
    playerIds: playerIdsShape
  })),
  input: defineCodec(s.object({
    playerId: playerIdShape,
    commands: commandArrayShape
  })),
  "input-frame": defineCodec(s.object({ commandsByPlayer: commandsByPlayerShape })),
  "match-hash": defineCodec(s.object({ hash: hashShape })),
  "match-snapshot": defineCodec(s.object({ snapshot: matchSnapshotSummaryShape })),
  leave: defineCodec(s.object({ playerId: playerIdShape })),
  ping: defineCodec(s.object({ nonce: uint32Shape })),
  pong: defineCodec(s.object({ nonce: uint32Shape })),
  "resync-request": defineCodec(s.object({ playerId: playerIdShape }))
});

const MESSAGE_ENVELOPE_CODEC = defineCodec(s.object({
  v: s.integer(),
  type: s.string({ nonEmpty: true }),
  seq: s.optional(sequenceShape),
  matchTick: s.optional(matchTickShape),
  payload: s.unknown()
}));
const MESSAGE_FIELDS_CODEC = defineCodec(s.object({
  seq: s.optional(sequenceShape),
  matchTick: s.optional(matchTickShape)
}));

export function validateGameplayCommand(command) {
  GAMEPLAY_COMMAND_CODEC.assert(command, "Gameplay command");
  return command;
}

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
    default:
      break;
  }
}

function normalizeRoster(playerIds) {
  if (playerIds === undefined || playerIds === null) return null;
  return Object.freeze(PLAYER_IDS_CODEC.parse(playerIds, "Protocol negotiated playerIds"));
}

function parseStructuredMessage(message) {
  const normalized = MESSAGE_ENVELOPE_CODEC.parse(message, "Protocol message");
  if (normalized.v !== PROTOCOL_VERSION) {
    throw new Error(`Unsupported protocol version: ${normalized.v}`);
  }
  if (!MESSAGE_TYPES.has(normalized.type)) {
    throw new Error(`Unknown protocol message type: ${normalized.type}`);
  }
  if (SEQUENCED_MESSAGE_TYPES.has(normalized.type) && normalized.seq === undefined) {
    throw new Error(`Protocol ${normalized.type} message.seq is required`);
  }
  if (TICKED_MESSAGE_TYPES.has(normalized.type) && normalized.matchTick === undefined) {
    throw new Error(`Protocol ${normalized.type} message.matchTick is required`);
  }

  PAYLOAD_CODECS[normalized.type].assert(normalized.payload, `Protocol ${normalized.type} payload`);
  if (normalized.type === "match-snapshot" && normalized.payload.snapshot.matchTick !== normalized.matchTick) {
    throw new Error("Protocol match-snapshot matchTick must match payload.snapshot.matchTick");
  }
  return normalized;
}

// Validation ownership is intentionally split by trust boundary:
// - createMessage validates locally constructed structured messages once.
// - decodeMessage validates untrusted wire text and returns a trusted structured message.
// - encodeMessage only serializes trusted structured messages; it does not validate again.
// - context/stream validators enforce negotiated roster and ordering constraints on trusted messages.
export function createMessage(type, payload, fields = {}) {
  if (!MESSAGE_TYPES.has(type)) throw new Error(`Unknown protocol message type: ${type}`);
  const normalizedFields = MESSAGE_FIELDS_CODEC.parse(fields, "Protocol message fields");
  return parseStructuredMessage({
    v: PROTOCOL_VERSION,
    type,
    ...normalizedFields,
    payload
  });
}

export function validateMessageContext(message, { playerIds = null } = {}) {
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
    validateRosterRouting(message, roster);

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

  return Object.freeze({ validate, setPlayerIds });
}

export function encodeMessage(message) {
  return JSON.stringify(message);
}

export function decodeMessage(text) {
  if (typeof text !== "string") throw new Error("Protocol data must be text");
  if (text.length > PROTOCOL_LIMITS.maxTextLength) {
    throw new Error(`Protocol data exceeds ${PROTOCOL_LIMITS.maxTextLength} characters`);
  }
  return parseStructuredMessage(JSON.parse(text));
}
