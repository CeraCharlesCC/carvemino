import test from "node:test";
import assert from "node:assert/strict";

import {
  PROTOCOL_LIMITS,
  PROTOCOL_VERSION,
  createMessage,
  createProtocolStreamValidator,
  decodeMessage,
  encodeMessage,
  validateGameplayCommand,
  validateMessage
} from "../src/app/protocol.js";

const TICKED_TYPES = new Set(["input", "input-frame", "match-hash", "match-snapshot"]);

function rawMessage(type, payload, fields = {}) {
  return {
    v: PROTOCOL_VERSION,
    type,
    ...fields,
    payload
  };
}

function requiredFields(type, overrides = {}) {
  if (TICKED_TYPES.has(type)) return { seq: 4, matchTick: 12, ...overrides };
  if (type === "leave") return { seq: 4, ...overrides };
  return overrides;
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
  input: {
    playerId: "p2",
    commands: [
      { type: "FOCUS_PREVIOUS" },
      { type: "FOCUS_NEXT" },
      { type: "SCULPT", pieceId: "piece-1", x: -1, y: 2 },
      { type: "HARD_DROP_FOCUSED" }
    ]
  },
  "input-frame": {
    commandsByPlayer: {
      p1: [],
      p2: [{ type: "FOCUS_NEXT" }]
    }
  },
  "match-hash": { hash: "01abcdef" },
  "match-snapshot": {
    snapshot: {
      matchId: "match-1",
      seed: 123,
      matchTick: 12,
      rulesetId: "rules-v1",
      policyId: "versus-v1",
      playerIds: ["p1", "p2"],
      players: []
    }
  },
  leave: { playerId: "p2" },
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
    const fields = TICKED_TYPES.has(type)
      ? { seq: 4, matchTick: 12 }
      : type === "leave"
        ? { seq: 4 }
        : { seq: 4, matchTick: 12 };
    const message = createMessage(type, payload, fields);
    assert.equal(message.v, PROTOCOL_VERSION, type);
    assert.deepEqual(decodeMessage(encodeMessage(message)), message, type);
  }
});

test("authoritative gameplay messages require bounded sequence and match tick fields", () => {
  assert.throws(
    () => validateMessage(rawMessage("input", VALID_PAYLOADS.input, { matchTick: 12 })),
    /input message\.seq is required/
  );
  assert.throws(
    () => validateMessage(rawMessage("input-frame", VALID_PAYLOADS["input-frame"], { seq: 2 })),
    /input-frame message\.matchTick is required/
  );
  assert.throws(
    () => validateMessage(rawMessage("match-hash", VALID_PAYLOADS["match-hash"], {
      seq: 2,
      matchTick: PROTOCOL_LIMITS.maxMatchTick + 1
    })),
    /Protocol matchTick/
  );
  assert.throws(
    () => validateMessage(rawMessage("leave", VALID_PAYLOADS.leave)),
    /leave message\.seq is required/
  );
});

test("gameplay commands are strict tagged objects", () => {
  for (const command of VALID_PAYLOADS.input.commands) {
    assert.equal(validateGameplayCommand(command), command);
  }

  assert.throws(() => validateGameplayCommand({ type: "TELEPORT" }), /type is invalid/);
  assert.throws(() => validateGameplayCommand({ type: "FOCUS_NEXT", admin: true }), /admin is not supported/);
  assert.throws(() => validateGameplayCommand({ type: "SCULPT", x: 0, y: 0 }), /pieceId is required/);
  assert.throws(
    () => validateGameplayCommand({
      type: "SCULPT",
      pieceId: "piece-1",
      x: PROTOCOL_LIMITS.maxSculptCoordinateMagnitude + 1,
      y: 0
    }),
    /Gameplay command\.x/
  );
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
  const oversizedCommands = Array.from(
    { length: PROTOCOL_LIMITS.maxCommandsPerPlayerTick + 1 },
    () => ({ type: "FOCUS_NEXT" })
  );
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
      "match-start wrong roster size",
      "match-start",
      { ...VALID_PAYLOADS["match-start"], playerIds: ["p1"] },
      /exactly 2 player ids/
    ],
    ["input command array type", "input", { playerId: "p2", commands: {} }, /commands must be an array/],
    [
      "input arbitrary command",
      "input",
      { playerId: "p2", commands: [{ type: "REMOTE_ATTACK" }] },
      /type is invalid/
    ],
    [
      "input oversized command array",
      "input",
      { playerId: "p2", commands: oversizedCommands },
      /at most/
    ],
    [
      "input frame must include both players",
      "input-frame",
      { commandsByPlayer: { p1: [] } },
      /exactly 2 players/
    ],
    ["match hash format", "match-hash", { hash: "01ABCDEF" }, /lowercase hexadecimal/],
    [
      "match snapshot missing roster",
      "match-snapshot",
      { snapshot: { matchId: "m", seed: 1, matchTick: 12, rulesetId: "r", policyId: "p" } },
      /playerIds is required/
    ],
    ["leave extra field", "leave", { playerId: "p2", force: true }, /force is not supported/],
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
    assert.throws(
      () => validateMessage(rawMessage(type, payload, requiredFields(type))),
      expected,
      name
    );
  }
});

test("roster-aware validation rejects wrong-player routing", () => {
  const playerIds = ["p1", "p2"];
  assert.doesNotThrow(() => validateMessage(
    rawMessage("input", VALID_PAYLOADS.input, requiredFields("input")),
    { playerIds }
  ));
  assert.throws(
    () => validateMessage(
      rawMessage("input", { playerId: "intruder", commands: [] }, requiredFields("input")),
      { playerIds }
    ),
    /not in the negotiated player roster/
  );
  assert.throws(
    () => validateMessage(
      rawMessage("input-frame", {
        commandsByPlayer: { p1: [], intruder: [] }
      }, requiredFields("input-frame")),
      { playerIds }
    ),
    /must match the negotiated player roster/
  );
  assert.throws(
    () => validateMessage(
      rawMessage("match-start", { ...VALID_PAYLOADS["match-start"], playerIds: ["p2", "p1"] }),
      { playerIds }
    ),
    /must match the negotiated player roster/
  );
});

test("stream validation rejects duplicate or stale sequences and gameplay ticks", () => {
  const stream = createProtocolStreamValidator({ playerIds: ["p1", "p2"] });
  const first = rawMessage("input", { playerId: "p2", commands: [] }, { seq: 10, matchTick: 20 });
  assert.equal(stream.validate(first), first);

  assert.throws(
    () => stream.validate(rawMessage("input", { playerId: "p2", commands: [] }, { seq: 11, matchTick: 20 })),
    /matchTick must increase monotonically/
  );
  assert.doesNotThrow(
    () => stream.validate(rawMessage("input", { playerId: "p2", commands: [] }, { seq: 11, matchTick: 21 }))
  );
  assert.throws(
    () => stream.validate(rawMessage("input", { playerId: "p2", commands: [] }, { seq: 10, matchTick: 22 })),
    /seq must increase monotonically/
  );
});

test("match snapshots are size bounded and tied to their envelope tick", () => {
  const payload = VALID_PAYLOADS["match-snapshot"];
  assert.throws(
    () => validateMessage(rawMessage("match-snapshot", payload, { seq: 1, matchTick: 13 })),
    /matchTick must match payload\.snapshot\.matchTick/
  );

  const oversized = {
    snapshot: {
      ...payload.snapshot,
      blob: "x".repeat(PROTOCOL_LIMITS.maxSnapshotLength)
    }
  };
  assert.throws(
    () => validateMessage(rawMessage("match-snapshot", oversized, { seq: 1, matchTick: 12 })),
    /exceeds/
  );
});

test("protocol rejects oversized or malformed wire data", () => {
  assert.throws(() => decodeMessage("x".repeat(PROTOCOL_LIMITS.maxTextLength + 1)), /Protocol data exceeds/);
  assert.throws(() => decodeMessage("{not json"), SyntaxError);
  assert.throws(() => decodeMessage(new Uint8Array()), /Protocol data must be text/);
});