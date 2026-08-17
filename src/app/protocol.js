export const PROTOCOL_VERSION = 1;

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

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function createMessage(type, payload = {}, fields = {}) {
  if (!MESSAGE_TYPES.has(type)) throw new Error(`Unknown protocol message type: ${type}`);
  return {
    v: PROTOCOL_VERSION,
    type,
    ...fields,
    payload
  };
}

export function validateMessage(message) {
  if (!isPlainObject(message)) throw new Error("Protocol message must be an object");
  if (message.v !== PROTOCOL_VERSION) {
    throw new Error(`Unsupported protocol version: ${message.v}`);
  }
  if (!MESSAGE_TYPES.has(message.type)) {
    throw new Error(`Unknown protocol message type: ${message.type}`);
  }
  if (!isPlainObject(message.payload)) {
    throw new Error("Protocol payload must be an object");
  }
  if (message.seq !== undefined && (!Number.isInteger(message.seq) || message.seq < 0)) {
    throw new Error("Protocol seq must be a non-negative integer");
  }
  if (
    message.matchTick !== undefined &&
    (!Number.isInteger(message.matchTick) || message.matchTick < 0)
  ) {
    throw new Error("Protocol matchTick must be a non-negative integer");
  }
  return message;
}

export function encodeMessage(message) {
  validateMessage(message);
  return JSON.stringify(message);
}

export function decodeMessage(text) {
  if (typeof text !== "string") throw new Error("Protocol data must be text");
  return validateMessage(JSON.parse(text));
}