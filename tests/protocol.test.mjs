import test from "node:test";
import assert from "node:assert/strict";

import {
  PROTOCOL_VERSION,
  createMessage,
  decodeMessage,
  encodeMessage,
  validateMessage
} from "../src/app/protocol.js";

function rawMessage(type, payload, fields = {}) {
  return {
    v: PROTOCOL_VERSION,
    type,
    ...fields,
    payload
  };
}

const VALID_PAYLOADS = {
  hello: { playerId: "p1", rulesetId: "rules-v1", policyId: "versus-v1" },
  ready: { playerId: "p1" },
  "match-start": {
    matchId: "match-1",
    seed: 123,
    rulesetId: "rules-v1",
    policyId: "versus-v1",
    playerIds: ["p1", "p2"]
  },
  attack: {
    targetPlayerId: "p2",
    packet: {
      id: "match-1:g1",
      sourcePlayerId: "p1",
      rows: 2,
      applyAtWorldTick: 90,
      seed: 55
    }
  },
  "game-over": { playerId: "p1", reason: "lock-topout" },
  snapshot: {
    playerId: "p1",
    snapshot: { schemaVersion: 3, rulesetId: "rules-v1" }
  },
  "state-hash": { playerId: "p1", hash: "01abcdef" },
  ping: { nonce: 42 },
  pong: { nonce: 42 },
  "resync-request": { playerId: "p1" }
};

test("protocol validates payload contracts for every message type", () => {
  for (const [type, payload] of Object.entries(VALID_PAYLOADS)) {
    const message = createMessage(type, payload, { seq: 4, matchTick: 12 });
    assert.equal(message.v, PROTOCOL_VERSION, type);
    assert.deepEqual(decodeMessage(encodeMessage(message)), message, type);
  }
});

test("protocol rejects malformed envelopes and reserved field injection", () => {
  assert.throws(
    () => validateMessage({ ...rawMessage("ready", VALID_PAYLOADS.ready), extra: true }),
    /Protocol message\.extra is not supported/
  );
  assert.throws(
    () => createMessage("ready", VALID_PAYLOADS.ready, { type: "attack" }),
    /Protocol message fields\.type is not supported/
  );
  assert.throws(
    () => validateMessage(rawMessage("ready", VALID_PAYLOADS.ready, { seq: Number.MAX_SAFE_INTEGER + 1 })),
    /Protocol seq/
  );
  assert.throws(
    () => validateMessage({ ...rawMessage("ready", VALID_PAYLOADS.ready), v: PROTOCOL_VERSION - 1 }),
    /Unsupported protocol version/
  );
});

test("protocol rejects hostile payloads before handing messages to transport consumers", () => {
  const cases = [
    ["hello missing id", "hello", { playerId: "", rulesetId: "rules-v1", policyId: "vs" }, /playerId/],
    ["ready extra field", "ready", { playerId: "p1", admin: true }, /admin is not supported/],
    [
      "match-start duplicate players",
      "match-start",
      { ...VALID_PAYLOADS["match-start"], playerIds: ["p1", "p1"] },
      /unique player ids/
    ],
    [
      "attack nonpositive rows",
      "attack",
      {
        ...VALID_PAYLOADS.attack,
        packet: { ...VALID_PAYLOADS.attack.packet, rows: 0 }
      },
      /packet\.rows/
    ],
    [
      "attack invalid seed",
      "attack",
      {
        ...VALID_PAYLOADS.attack,
        packet: { ...VALID_PAYLOADS.attack.packet, seed: 0x100000000 }
      },
      /packet\.seed/
    ],
    ["game-over invalid reason", "game-over", { playerId: "p1", reason: "remote-said-so" }, /reason is invalid/],
    ["snapshot array", "snapshot", { playerId: "p1", snapshot: [] }, /snapshot must be an object/],
    ["snapshot missing ruleset", "snapshot", { playerId: "p1", snapshot: { schemaVersion: 3 } }, /rulesetId/],
    ["state hash format", "state-hash", { playerId: "p1", hash: "not-a-hash" }, /lowercase hexadecimal/],
    ["ping nonce type", "ping", { nonce: "42" }, /ping payload\.nonce/],
    ["pong extra field", "pong", { nonce: 1, echoedAt: 2 }, /echoedAt is not supported/],
    ["resync missing player", "resync-request", {}, /playerId is required/]
  ];

  for (const [name, type, payload, expected] of cases) {
    assert.throws(() => validateMessage(rawMessage(type, payload)), expected, name);
  }
});

test("protocol rejects oversized or malformed wire data", () => {
  assert.throws(() => decodeMessage("x".repeat(300_000)), /Protocol data exceeds/);
  assert.throws(() => decodeMessage("{not json"), SyntaxError);
  assert.throws(() => decodeMessage(new Uint8Array()), /Protocol data must be text/);
});
