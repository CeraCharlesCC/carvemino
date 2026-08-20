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
  validateMessageContext
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

function decodeRaw(message) {
  return decodeMessage(JSON.stringify(message));
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

test("protocol accepts multiplayer rosters and frames with more than two players", () => {
  const playerIds = ["p1", "p2", "p3"];
  const matchStart = createMessage("match-start", {
    ...VALID_PAYLOADS["match-start"],
    playerIds
  });
  assert.deepEqual(matchStart.payload.playerIds, playerIds);

  const inputFrame = createMessage("input-frame", {
    commandsByPlayer: {
      p1: [],
      p2: [{ type: "FOCUS_NEXT" }],
      p3: [{ type: "FOCUS_PREVIOUS" }]
    }
  }, { seq: 1, matchTick: 12 });
  assert.doesNotThrow(() => validateMessageContext(inputFrame, { playerIds }));
  const stream = createProtocolStreamValidator({ playerIds });
  assert.doesNotThrow(() => stream.validate(inputFrame));

  const snapshot = createMessage("match-snapshot", {
    snapshot: {
      ...VALID_PAYLOADS["match-snapshot"].snapshot,
      playerIds
    }
  }, { seq: 2, matchTick: 12 });
  assert.doesNotThrow(() => validateMessageContext(snapshot, { playerIds }));
});

test("authoritative gameplay messages require bounded sequence and match tick fields", () => {
  const cases = [
    ["input missing sequence", "input", { matchTick: 12 }, /input message\.seq is required/],
    ["frame missing match tick", "input-frame", { seq: 2 }, /input-frame message\.matchTick is required/],
    [
      "match tick exceeds limit",
      "match-hash",
      { seq: 2, matchTick: PROTOCOL_LIMITS.maxMatchTick + 1 },
      /Protocol message\.matchTick/
    ],
    ["leave missing sequence", "leave", {}, /leave message\.seq is required/]
  ];

  for (const [name, type, fields, expected] of cases) {
    assert.throws(() => decodeRaw(rawMessage(type, VALID_PAYLOADS[type], fields)), expected, name);
  }
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
  const cases = [
    [
      "unknown envelope field",
      () => decodeRaw({ ...rawMessage("ready", VALID_PAYLOADS.ready), extra: true }),
      /Protocol message\.extra is not supported/
    ],
    [
      "reserved create field",
      () => createMessage("ready", VALID_PAYLOADS.ready, { type: "input" }),
      /Protocol message fields\.type is not supported/
    ],
    [
      "unsafe sequence integer",
      () => decodeRaw(rawMessage("ready", VALID_PAYLOADS.ready, { seq: Number.MAX_SAFE_INTEGER + 1 })),
      /Protocol message\.seq/
    ],
    [
      "unsupported version",
      () => decodeRaw({ ...rawMessage("ready", VALID_PAYLOADS.ready), v: PROTOCOL_VERSION - 1 }),
      /Unsupported protocol version/
    ]
  ];

  for (const [name, action, expected] of cases) {
    assert.throws(action, expected, name);
  }
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
      /at least 2 player ids/
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
      "input frame must include a multiplayer roster",
      "input-frame",
      { commandsByPlayer: { p1: [] } },
      /at least 2 players/
    ],
    ["match hash format", "match-hash", { hash: "01ABCDEF" }, /lowercase hexadecimal/],
    [
      "match snapshot missing roster",
      "match-snapshot",
      { snapshot: { matchId: "m", seed: 1, matchTick: 12, rulesetId: "r", policyId: "p" } },
      /playerIds is required/
    ],
    ["leave extra field", "leave", { playerId: "p2", force: true }, /force is not supported/],
    ["ping nonce type", "ping", { nonce: "42" }, /ping payload\.nonce/],
    ["pong extra field", "pong", { nonce: 1, echoedAt: 2 }, /echoedAt is not supported/],
    ["resync missing player", "resync-request", {}, /playerId is required/]
  ];

  for (const [name, type, payload, expected] of cases) {
    assert.throws(
      () => decodeRaw(rawMessage(type, payload, requiredFields(type))),
      expected,
      name
    );
  }
});

test("roster-aware validation rejects wrong-player routing", () => {
  const playerIds = ["p1", "p2"];
  assert.doesNotThrow(() => validateMessageContext(
    decodeRaw(rawMessage("input", VALID_PAYLOADS.input, requiredFields("input"))),
    { playerIds }
  ));
  assert.throws(
    () => validateMessageContext(
      decodeRaw(rawMessage("input", { playerId: "intruder", commands: [] }, requiredFields("input"))),
      { playerIds }
    ),
    /not in the negotiated player roster/
  );
  assert.throws(
    () => validateMessageContext(
      decodeRaw(rawMessage("input-frame", {
        commandsByPlayer: { p1: [], intruder: [] }
      }, requiredFields("input-frame"))),
      { playerIds }
    ),
    /must match the negotiated player roster/
  );
  assert.throws(
    () => validateMessageContext(
      decodeRaw(rawMessage("match-start", { ...VALID_PAYLOADS["match-start"], playerIds: ["p2", "p1"] })),
      { playerIds }
    ),
    /must match the negotiated player roster/
  );
});

test("stream validation rejects duplicate or stale sequences and gameplay ticks", () => {
  const stream = createProtocolStreamValidator({ playerIds: ["p1", "p2"] });
  const first = createMessage("input", { playerId: "p2", commands: [] }, { seq: 10, matchTick: 20 });
  assert.equal(stream.validate(first), first);

  assert.throws(
    () => stream.validate(createMessage("input", { playerId: "p2", commands: [] }, { seq: 11, matchTick: 20 })),
    /matchTick must increase monotonically/
  );
  assert.doesNotThrow(
    () => stream.validate(createMessage("input", { playerId: "p2", commands: [] }, { seq: 11, matchTick: 21 }))
  );
  assert.throws(
    () => stream.validate(createMessage("input", { playerId: "p2", commands: [] }, { seq: 10, matchTick: 22 })),
    /seq must increase monotonically/
  );
});

test("wire decoding owns structural validation while encoding trusts structured messages", () => {
  const malformed = rawMessage("ready", { playerId: "" });
  const encoded = encodeMessage(malformed);
  assert.equal(encoded, JSON.stringify(malformed));
  assert.throws(() => decodeMessage(encoded), /playerId/);
});

test("match snapshots are size bounded and tied to their envelope tick", () => {
  const payload = VALID_PAYLOADS["match-snapshot"];
  assert.throws(
    () => decodeRaw(rawMessage("match-snapshot", payload, { seq: 1, matchTick: 13 })),
    /matchTick must match payload\.snapshot\.matchTick/
  );

  const oversized = {
    snapshot: {
      ...payload.snapshot,
      blob: "x".repeat(PROTOCOL_LIMITS.maxSnapshotLength)
    }
  };
  assert.throws(
    () => decodeRaw(rawMessage("match-snapshot", oversized, { seq: 1, matchTick: 12 })),
    /exceeds/
  );
});

test("protocol rejects oversized or malformed wire data", () => {
  assert.throws(() => decodeMessage("x".repeat(PROTOCOL_LIMITS.maxTextLength + 1)), /Protocol data exceeds/);
  assert.throws(() => decodeMessage("{not json"), SyntaxError);
  assert.throws(() => decodeMessage(new Uint8Array()), /Protocol data must be text/);
});