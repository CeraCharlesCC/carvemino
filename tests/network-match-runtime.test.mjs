import assert from "node:assert/strict";
import test from "node:test";

import { VERSUS_CATALOG } from "../src/app/catalog.js";
import { NetworkMatchRuntime } from "../src/app/network-match-runtime.js";
import { createMessage } from "../src/app/protocol.js";
import {
  createMatch,
  getPlayerGame,
  hashMatch,
  restoreMatch,
  snapshotMatch,
  stepMatch
} from "../src/domain/match.js";
import { defineVersusPolicy } from "../src/domain/match/versus.js";
import { prepareTwoLineClear } from "./helpers/game-fixtures.mjs";
import { replaceGlobal } from "./helpers/globals.mjs";
import { makeTestRules } from "./helpers/rules.mjs";

class MemoryTransport {
  constructor() {
    this.peer = null;
    this.open = true;
    this.sent = [];
    this.messageHandlers = new Set();
    this.stateHandlers = new Set();
    this.closeCount = 0;
  }

  onMessage(handler) {
    this.messageHandlers.add(handler);
    return () => this.messageHandlers.delete(handler);
  }

  onStateChange(handler) {
    this.stateHandlers.add(handler);
    return () => this.stateHandlers.delete(handler);
  }

  send(message) {
    if (!this.open || !this.peer?.open) return false;
    const wireCopy = JSON.parse(JSON.stringify(message));
    this.sent.push(wireCopy);
    for (const handler of this.peer.messageHandlers) handler(wireCopy);
    return true;
  }

  setState(state) {
    for (const handler of this.stateHandlers) handler(state);
  }

  close() {
    this.open = false;
    this.closeCount += 1;
  }
}

function createTransportPair() {
  const host = new MemoryTransport();
  const client = new MemoryTransport();
  host.peer = client;
  client.peer = host;
  return { host, client };
}

class StarTransport {
  constructor(id, network, isHost = false) {
    this.id = id;
    this.network = network;
    this.isHost = isHost;
    this.open = true;
    this.sent = [];
    this.messageHandlers = new Set();
    this.stateHandlers = new Set();
    this.closeCount = 0;
  }

  onMessage(handler) {
    this.messageHandlers.add(handler);
    return () => this.messageHandlers.delete(handler);
  }

  onStateChange(handler) {
    this.stateHandlers.add(handler);
    return () => this.stateHandlers.delete(handler);
  }

  send(message) {
    if (!this.open) return false;
    const recipients = this.isHost
      ? [...this.network.values()].filter((transport) => !transport.isHost)
      : [[...this.network.values()].find((transport) => transport.isHost)];
    if (recipients.some((transport) => !transport?.open)) return false;

    const wireCopy = JSON.parse(JSON.stringify(message));
    this.sent.push(wireCopy);
    for (const recipient of recipients) {
      for (const handler of recipient.messageHandlers) {
        handler(JSON.parse(JSON.stringify(wireCopy)), this.id);
      }
    }
    return true;
  }

  close() {
    this.open = false;
    this.closeCount += 1;
  }
}

function createTransportStar(playerIds) {
  const network = new Map();
  for (const playerId of playerIds) {
    network.set(playerId, new StarTransport(playerId, network, playerId === playerIds[0]));
  }
  return network;
}

function createVersusPolicy(id = "network-runtime-vs") {
  return defineVersusPolicy({
    id,
    lineClearAttackRows: [0, 0, 1, 2, 4],
    garbageWarningWorldTicks: 20,
    cancellation: true
  });
}

function createRuntimePair({
  hostMatch,
  clientMatch,
  rules,
  policy,
  inputDelayTicks = 2,
  hashIntervalTicks = 10,
  maxBufferedFutureTicks = 600,
  hostEvents = [],
  clientEvents = []
}) {
  const transports = createTransportPair();
  const host = new NetworkMatchRuntime({
    match: hostMatch,
    rules,
    policy,
    role: "host",
    localPlayerId: "a",
    transport: transports.host,
    inputDelayTicks,
    hashIntervalTicks,
    maxBufferedFutureTicks,
    onEvents(events) {
      hostEvents.push(...events);
    }
  });
  const client = new NetworkMatchRuntime({
    match: clientMatch,
    rules,
    policy,
    role: "client",
    localPlayerId: "b",
    transport: transports.client,
    inputDelayTicks,
    hashIntervalTicks,
    maxBufferedFutureTicks,
    onEvents(events) {
      clientEvents.push(...events);
    }
  });
  return { host, client, transports };
}

function createBasicRuntimePair(id, options = {}) {
  const {
    rules = makeTestRules(),
    policy = createVersusPolicy(`${id}-vs`),
    seed = 17,
    prepareHostMatch = null,
    mirrorClientFromHost = false,
    ...runtimeOptions
  } = options;
  const hostMatch = createMatch({ id, playerIds: ["a", "b"], seed, rules, policy });
  if (prepareHostMatch) prepareHostMatch(hostMatch, rules, policy);
  const clientMatch = mirrorClientFromHost
    ? restoreMatch(snapshotMatch(hostMatch), { rules, policy })
    : createMatch({ id, playerIds: ["a", "b"], seed, rules, policy });
  return {
    rules,
    policy,
    ...createRuntimePair({ hostMatch, clientMatch, rules, policy, ...runtimeOptions })
  };
}

test("network runtimes apply only host frames and converge after commands from both players", () => {
  const { host, client, transports } = createBasicRuntimePair("lockstep-match", { seed: 77 });

  host.command({ type: "FOCUS_PREVIOUS" });
  client.command({ type: "FOCUS_NEXT" });
  client.runOneTick();
  assert.equal(client.match.matchTick, 0, "client must pause until host frame 0 arrives");

  host.runOneTick();
  client.runOneTick();
  assert.equal(host.match.matchTick, 1);
  assert.equal(client.match.matchTick, 1);

  for (let tick = 1; tick < 40; tick += 1) {
    if (tick % 5 === 0) host.command({ type: "FOCUS_NEXT" });
    if (tick % 7 === 0) client.command({ type: "FOCUS_PREVIOUS" });
    host.runOneTick();
    client.runOneTick();
  }

  assert.equal(hashMatch(client.match), hashMatch(host.match));
  assert.equal(client.connectionStats.matchTick, host.connectionStats.matchTick);
  assert.equal(client.connectionStats.stalledTicks, 1);
  assert(client.localView.board);
  assert.equal(client.opponentViews.length, 1);
  assert(client.opponentViews[0].view.board);

  const delayedFrame = transports.host.sent.find(
    (message) => message.type === "input-frame" && message.matchTick === 2
  );
  assert.deepEqual(delayedFrame.payload.commandsByPlayer.a, [{ type: "FOCUS_PREVIOUS" }]);
  assert.deepEqual(delayedFrame.payload.commandsByPlayer.b, [{ type: "FOCUS_NEXT" }]);
  assert(client.connectionStats.inputsSent > 0);
  assert(host.connectionStats.inputsReceived > 0);
});

test("network runtime routes independent inputs for every remote player in a larger roster", () => {
  const rules = makeTestRules();
  const policy = createVersusPolicy("network-runtime-multiplayer");
  const playerIds = ["a", "b", "c"];
  const transports = createTransportStar(playerIds);
  const runtimes = new Map(playerIds.map((playerId, index) => [
    playerId,
    new NetworkMatchRuntime({
      match: createMatch({
        id: "multiplayer-lockstep-match",
        playerIds,
        seed: 91,
        rules,
        policy
      }),
      rules,
      policy,
      role: index === 0 ? "host" : "client",
      localPlayerId: playerId,
      transport: transports.get(playerId),
      inputDelayTicks: 2,
      hashIntervalTicks: 10
    })
  ]));
  const host = runtimes.get("a");
  const clientB = runtimes.get("b");
  const clientC = runtimes.get("c");

  assert.deepEqual(host.remotePlayerIds, ["b", "c"]);
  assert.deepEqual(clientB.remotePlayerIds, ["a", "c"]);
  assert.deepEqual(clientB.opponentViews.map(({ playerId }) => playerId), ["a", "c"]);

  clientB.command({ type: "FOCUS_NEXT" });
  clientC.command({ type: "FOCUS_PREVIOUS" });
  clientB.runOneTick();
  clientC.runOneTick();

  assert.equal(host.disposed, false);
  assert.equal(host.connectionStats.inputsReceived, 2);
  assert.equal(host.connectionStats.bufferedRemoteInputs, 2);

  for (let tick = 0; tick < 5; tick += 1) {
    host.runOneTick();
    clientB.runOneTick();
    clientC.runOneTick();
  }

  const multiplayerFrame = transports.get("a").sent.find(
    (message) => message.type === "input-frame" && message.matchTick === 2
  );
  assert.deepEqual(multiplayerFrame.payload.commandsByPlayer.a, []);
  assert.deepEqual(multiplayerFrame.payload.commandsByPlayer.b, [{ type: "FOCUS_NEXT" }]);
  assert.deepEqual(multiplayerFrame.payload.commandsByPlayer.c, [{ type: "FOCUS_PREVIOUS" }]);
  assert.equal(host.connectionStats.bufferedRemoteInputs, 0);
  assert.equal(hashMatch(clientB.match), hashMatch(host.match));
  assert.equal(hashMatch(clientC.match), hashMatch(host.match));

  transports.get("b").send(createMessage(
    "input",
    { playerId: "c", commands: [] },
    { seq: 1, matchTick: host.match.matchTick }
  ));
  assert.equal(host.connectionStats.protocolErrors, 1);
  assert.equal(host.disposed, true);
});

test("every registered VS mode uses the authoritative network runtime path", () => {
  for (const mode of VERSUS_CATALOG) {
    const { host, client } = createBasicRuntimePair(`${mode.id}-network-match`, {
      rules: mode.rules,
      policy: mode.policy,
      seed: 314
    });

    host.command({ type: "FOCUS_NEXT" });
    client.command({ type: "FOCUS_PREVIOUS" });
    for (let tick = 0; tick < 30; tick += 1) {
      host.runOneTick();
      client.runOneTick();
    }

    assert.equal(host.match.rulesetId, mode.rules.id, mode.id);
    assert.equal(host.match.policyId, mode.policy.id, mode.id);
    assert.equal(hashMatch(client.match), hashMatch(host.match), mode.id);
  }
});

test("client holds additional commands while the same authoritative tick is stalled", () => {
  const { host, client, transports } = createBasicRuntimePair("stalled-input-match", {
    seed: 44,
    inputDelayTicks: 2
  });

  client.command({ type: "FOCUS_NEXT" });
  client.runOneTick();
  client.command({ type: "FOCUS_PREVIOUS" });
  client.runOneTick();

  assert.equal(client.match.matchTick, 0);
  assert.equal(host.connectionStats.inputsReceived, 1);
  assert.equal(transports.client.sent.filter((message) => message.type === "input").length, 1);
  assert.equal(host.disposed, false);

  host.runOneTick();
  client.runOneTick();
  host.runOneTick();
  client.runOneTick();

  assert.equal(host.connectionStats.inputsReceived, 2);
  assert.equal(transports.client.sent.filter((message) => message.type === "input").length, 2);
  assert.equal(hashMatch(client.match), hashMatch(host.match));
});

test("client render timing catches up a backgrounded authoritative-frame backlog", (t) => {
  const rules = makeTestRules();
  const policy = createVersusPolicy("network-runtime-catch-up");
  const hostMatch = createMatch({
    id: "catch-up-match",
    playerIds: ["a", "b"],
    seed: 901,
    rules,
    policy
  });
  const clientMatch = createMatch({
    id: "catch-up-match",
    playerIds: ["a", "b"],
    seed: 901,
    rules,
    policy
  });
  const interpolations = [];
  const transports = createTransportPair();
  const host = new NetworkMatchRuntime({
    match: hostMatch,
    rules,
    policy,
    role: "host",
    localPlayerId: "a",
    transport: transports.host,
    hashIntervalTicks: 10
  });
  const client = new NetworkMatchRuntime({
    match: clientMatch,
    rules,
    policy,
    role: "client",
    localPlayerId: "b",
    transport: transports.client,
    hashIntervalTicks: 10,
    onFrame(_localView, metadata) {
      interpolations.push(metadata.interpolation);
    }
  });
  const callbacks = [];
  replaceGlobal(t, "requestAnimationFrame", (callback) => {
    callbacks.push(callback);
    return callbacks.length;
  });
  replaceGlobal(t, "cancelAnimationFrame", () => {});

  try {
    client.start();
    for (let tick = 0; tick < 80; tick += 1) host.runOneTick();
    assert.equal(client.match.matchTick, 0);
    assert.equal(client.connectionStats.bufferedFrames, 80);

    callbacks.shift()(0);
    callbacks.shift()(16);
    callbacks.shift()(32);
    callbacks.shift()(48);

    assert.equal(client.match.matchTick, 80);
    assert.equal(hashMatch(client.match), hashMatch(host.match));
    assert(interpolations.every((value) => value >= 0 && value <= 1));
  } finally {
    client.stop();
    host.stop();
  }
});

test("a lagging client schedules input from the newest authoritative frame without killing the host", () => {
  const { host, client, transports } = createBasicRuntimePair("lagging-client-input-match", {
    inputDelayTicks: 2
  });

  for (let tick = 0; tick < 10; tick += 1) host.runOneTick();
  assert.equal(host.match.matchTick, 10);
  assert.equal(client.match.matchTick, 0);
  assert.equal(client.connectionStats.bufferedFrames, 10);

  client.command({ type: "FOCUS_NEXT" });
  client.runOneTick();

  const submitted = transports.client.sent.find((message) => message.type === "input");
  assert.equal(submitted.matchTick, 11);
  assert.equal(host.disposed, false);
  assert.equal(host.connectionStats.inputsReceived, 1);

  host.runOneTick();
  host.runOneTick();
  const authoritative = transports.host.sent.find(
    (message) => message.type === "input-frame" && message.matchTick === 11
  );
  assert.deepEqual(authoritative.payload.commandsByPlayer.b, [{ type: "FOCUS_NEXT" }]);
});

test("the host drops a stale client input without terminating the match", () => {
  const { host, transports } = createBasicRuntimePair("stale-client-input-match", {
    inputDelayTicks: 2
  });

  host.runOneTick();
  host.runOneTick();
  transports.client.send(createMessage(
    "input",
    { playerId: "b", commands: [{ type: "FOCUS_NEXT" }] },
    { seq: 0, matchTick: 0 }
  ));

  assert.equal(host.disposed, false);
  assert.equal(host.connectionStats.protocolErrors, 0);
  assert.equal(host.connectionStats.staleInputsDropped, 1);
  assert.equal(host.connectionStats.inputsReceived, 0);
});

test("two-line clears produce the existing versus garbage attack on both peers", () => {
  const rules = makeTestRules({
    simulation: { lockDelayWorldTicks: 1, operationGraceSteps: 0 }
  });
  const hostEvents = [];
  const clientEvents = [];
  const { host, client } = createBasicRuntimePair("two-line-match", {
    rules,
    seed: 5,
    prepareHostMatch(match) {
      prepareTwoLineClear(getPlayerGame(match, "a"), rules);
    },
    mirrorClientFromHost: true,
    hashIntervalTicks: 1,
    hostEvents,
    clientEvents
  });

  host.runOneTick();
  client.runOneTick();

  for (const events of [hostEvents, clientEvents]) {
    assert(events.some((event) => event.type === "ATTACK_GENERATED" && event.playerId === "a"));
    assert(events.some((event) => event.type === "GARBAGE_SENT" && event.targetPlayerId === "b"));
  }
  assert.equal(getPlayerGame(host.match, "b").incomingGarbage.length, 1);
  assert.equal(getPlayerGame(client.match, "b").incomingGarbage.length, 1);
  assert.equal(getPlayerGame(host.match, "b").incomingGarbage[0].rows, 1);
  assert.equal(hashMatch(client.match), hashMatch(host.match));
});

test("a hash divergence requests one host snapshot and resumes from the recovered tick", () => {
  const { host, client } = createBasicRuntimePair("resync-match", {
    seed: 1234,
    hashIntervalTicks: 1
  });

  host.runOneTick();
  client.runOneTick();
  assert.equal(hashMatch(client.match), hashMatch(host.match));

  getPlayerGame(client.match, "b").score += 99;
  host.runOneTick();
  client.runOneTick();

  assert.equal(client.connectionStats.hashMismatches, 1);
  assert.equal(client.connectionStats.resyncRequestsSent, 1);
  assert.equal(host.connectionStats.resyncRequestsReceived, 1);
  assert.equal(host.connectionStats.snapshotsSent, 1);
  assert.equal(client.connectionStats.snapshotsApplied, 1);
  assert.equal(client.connectionStats.resyncPending, false);
  assert.equal(hashMatch(client.match), hashMatch(host.match));

  host.runOneTick();
  client.runOneTick();
  assert.equal(hashMatch(client.match), hashMatch(host.match));
  assert.equal(client.connectionStats.resyncRequestsSent, 1, "recovery must not loop");
});

test("a final hash received after local finish can still trigger terminal resync", () => {
  const { host, client } = createBasicRuntimePair("terminal-final-hash-match", {
    hashIntervalTicks: 10
  });

  stepMatch(host.match, { a: [], b: [] });
  stepMatch(client.match, { a: [], b: [] });
  for (const match of [host.match, client.match]) {
    const eliminated = getPlayerGame(match, "b");
    eliminated.status = "gameover";
    eliminated.gameOverReason = "lock-topout";
  }
  host.match.status = "finished";
  client.match.status = "finished";
  host.match.result = { type: "winner", winnerId: "a", atMatchTick: 0 };
  client.match.result = { type: "winner", winnerId: "a", atMatchTick: 0 };
  getPlayerGame(client.match, "b").score += 99;
  host.markFinishedIfNeeded();
  client.markFinishedIfNeeded();
  assert.notEqual(hashMatch(client.match), hashMatch(host.match));

  host.sendHashCheckpointIfNeeded();

  assert.equal(client.disposed, false);
  assert.equal(host.disposed, false);
  assert.equal(client.connectionStats.hashesReceived, 1);
  assert.equal(client.connectionStats.hashMismatches, 1);
  assert.equal(client.connectionStats.resyncRequestsSent, 1);
  assert.equal(host.connectionStats.resyncRequestsReceived, 1);
  assert.equal(host.connectionStats.snapshotsSent, 1);
  assert.equal(client.connectionStats.snapshotsApplied, 1);
  assert.equal(client.connectionStats.resyncPending, false);
  assert.equal(hashMatch(client.match), hashMatch(host.match));
  assert.equal(client.stopReason, "finished");
});

test("terminal resync resumes a running client when the host snapshot is still playing", (t) => {
  const { host, client } = createBasicRuntimePair("terminal-resume-match", {
    hashIntervalTicks: 1
  });
  stepMatch(host.match, { a: [], b: [] });
  stepMatch(client.match, { a: [], b: [] });

  const scheduledFrames = [];
  const cancelledFrames = [];
  replaceGlobal(t, "requestAnimationFrame", (callback) => {
    scheduledFrames.push(callback);
    return scheduledFrames.length;
  });
  replaceGlobal(t, "cancelAnimationFrame", (handle) => cancelledFrames.push(handle));

  try {
    assert.equal(client.start(), true);
    const eliminated = getPlayerGame(client.match, "b");
    eliminated.status = "gameover";
    eliminated.gameOverReason = "lock-topout";
    client.match.status = "finished";
    client.match.result = { type: "winner", winnerId: "a", atMatchTick: 0 };
    client.markFinishedIfNeeded();
    assert.equal(client.running, false);
    assert.equal(client.stopReason, "finished");

    host.sendHashCheckpointIfNeeded();

    assert.equal(client.disposed, false);
    assert.equal(client.connectionStats.hashMismatches, 1);
    assert.equal(client.connectionStats.snapshotsApplied, 1);
    assert.equal(client.match.status, "playing");
    assert.equal(client.stopReason, null);
    assert.equal(client.running, true);
    assert.equal(cancelledFrames.length, 1);
    assert.equal(scheduledFrames.length, 2);
    assert.equal(hashMatch(client.match), hashMatch(host.match));
  } finally {
    client.stop();
    host.stop();
  }
});

test("leaving a live network match notifies the peer and closes both transports", () => {
  const { host, client, transports } = createBasicRuntimePair("leave-match", { seed: 8 });

  host.leave();

  assert.equal(host.disposed, true);
  assert.equal(host.stopReason, "local-left");
  assert.equal(client.disposed, true);
  assert.equal(client.stopReason, "peer-left");
  assert.equal(transports.host.closeCount, 1);
  assert.equal(transports.client.closeCount, 1);
  assert.equal(transports.host.messageHandlers.size, 0);
  assert.equal(transports.host.stateHandlers.size, 0);
  assert.equal(transports.client.messageHandlers.size, 0);
  assert.equal(transports.client.stateHandlers.size, 0);
});

test("direct ICE failure terminates a live network runtime and closes its transport", () => {
  const { host, transports } = createBasicRuntimePair("ice-failure-match", { seed: 12 });

  transports.host.setState("ice-failed");

  assert.equal(host.disposed, true);
  assert.equal(host.stopReason, "transport-ice-failed");
  assert.equal(transports.host.closeCount, 1);
});

test("future client inputs and host frames are bounded before they can grow runtime queues", () => {
  const cases = [
    {
      name: "future input",
      id: "future-input-match",
      options: { inputDelayTicks: 2, maxBufferedFutureTicks: 4 },
      target: "host",
      sender: "client",
      message: createMessage("input", { playerId: "b", commands: [] }, { seq: 0, matchTick: 3 }),
      emptyStat: "bufferedRemoteInputs"
    },
    {
      name: "future frame",
      id: "future-frame-match",
      options: { maxBufferedFutureTicks: 3 },
      target: "client",
      sender: "host",
      message: createMessage("input-frame", { commandsByPlayer: { a: [], b: [] } }, { seq: 0, matchTick: 4 }),
      emptyStat: "bufferedFrames"
    },
    {
      name: "future hash",
      id: "future-hash-match",
      options: { maxBufferedFutureTicks: 3 },
      target: "client",
      sender: "host",
      message: createMessage("match-hash", { hash: "01234567" }, { seq: 0, matchTick: 4 })
    }
  ];

  for (const { name, id, options, target, sender, message, emptyStat } of cases) {
    const pair = createBasicRuntimePair(id, options);
    pair.transports[sender].send(message);
    assert.equal(pair[target].disposed, true, name);
    assert.equal(pair[target].stopReason, "protocol-error", name);
    if (emptyStat) assert.equal(pair[target].connectionStats[emptyStat], 0, name);
  }
});

test("network runtime rejects wrong-role and peer-spoofed player messages", () => {
  const cases = [
    ["peer-spoofed player", "wrong-player-match", "host", "client", "a", "inputsReceived"],
    ["wrong-role input", "wrong-role-match", "client", "host", "b", null]
  ];

  for (const [name, id, target, sender, playerId, emptyStat] of cases) {
    const pair = createBasicRuntimePair(id);
    pair.transports[sender].send(createMessage(
      "input",
      { playerId, commands: [] },
      { seq: 0, matchTick: 0 }
    ));
    assert.equal(pair[target].disposed, true, name);
    assert.equal(pair[target].stopReason, "protocol-error", name);
    if (emptyStat) assert.equal(pair[target].connectionStats[emptyStat], 0, name);
  }
});

test("network runtime rejects stale, duplicate, and post-handshake match messages", () => {
  const cases = [
    ["stale frame", "stale-frame-match", ({ client, transports }) => {
      stepMatch(client.match, { a: [], b: [] });
      transports.host.send(createMessage(
        "input-frame",
        { commandsByPlayer: { a: [], b: [] } },
        { seq: 0, matchTick: 0 }
      ));
    }],
    ["duplicate frame", "duplicate-frame-match", ({ transports }) => {
      const frame = { commandsByPlayer: { a: [], b: [] } };
      transports.host.send(createMessage("input-frame", frame, { seq: 0, matchTick: 0 }));
      transports.host.send(createMessage("input-frame", frame, { seq: 1, matchTick: 0 }));
    }],
    ["late handshake", "late-handshake-match", ({ client, transports }) => {
      transports.host.send(createMessage("hello", {
        playerId: "a",
        rulesetId: client.match.rulesetId,
        policyId: client.match.policyId
      }));
    }]
  ];

  for (const [name, id, sendInvalidMessages] of cases) {
    const pair = createBasicRuntimePair(id);
    sendInvalidMessages(pair);
    assert.equal(pair.client.disposed, true, name);
    assert.equal(pair.client.stopReason, "protocol-error", name);
  }
});

test("network runtime rejects recovery snapshots from another match", () => {
  const { client, transports } = createBasicRuntimePair("snapshot-context-match");
  const snapshot = snapshotMatch(client.match);
  snapshot.matchId = "other-match";

  transports.host.send(createMessage(
    "match-snapshot",
    { snapshot },
    { seq: 0, matchTick: snapshot.matchTick }
  ));

  assert.equal(client.disposed, true);
  assert.equal(client.stopReason, "protocol-error");
});

test("network runtime ignores messages after the deterministic match is terminal", () => {
  const { client, transports } = createBasicRuntimePair("terminal-ignore-match");
  client.match.status = "finished";
  client.markFinishedIfNeeded();

  transports.host.send(createMessage("ping", { nonce: 3 }));

  assert.equal(client.disposed, false);
  assert.equal(client.connectionStats.protocolErrors, 0);
  client.stop();
});

test("network runtime buffer settings cannot permit an unbounded input-delay queue", () => {
  const rules = makeTestRules();
  const policy = createVersusPolicy("buffer-constructor-vs");
  const transports = createTransportPair();
  const match = createMatch({
    id: "buffer-constructor-match",
    playerIds: ["a", "b"],
    seed: 4,
    rules,
    policy
  });

  assert.throws(() => new NetworkMatchRuntime({
    match,
    rules,
    policy,
    role: "host",
    localPlayerId: "a",
    transport: transports.host,
    inputDelayTicks: 5,
    maxBufferedFutureTicks: 4
  }), /inputDelayTicks cannot exceed maxBufferedFutureTicks/);
});
