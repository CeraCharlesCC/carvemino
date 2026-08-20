import assert from "node:assert/strict";
import test from "node:test";

import { NetworkMatchRuntime } from "../src/app/network-match-runtime.js";
import { createMessage } from "../src/app/protocol.js";
import { CARVER_VERSUS_POLICY } from "../src/match-policies/carver.js";
import { CARVER_RULESET } from "../src/rulesets/carver.js";
import {
  createMatch,
  getPlayerGame,
  hashMatch,
  restoreMatch,
  snapshotMatch,
  stepMatch
} from "../src/domain/match.js";
import { defineVersusPolicy } from "../src/domain/match/versus.js";
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
  const rules = makeTestRules();
  const policy = createVersusPolicy(`${id}-vs`);
  const hostMatch = createMatch({ id, playerIds: ["a", "b"], seed: 17, rules, policy });
  const clientMatch = createMatch({ id, playerIds: ["a", "b"], seed: 17, rules, policy });
  return {
    rules,
    policy,
    ...createRuntimePair({ hostMatch, clientMatch, rules, policy, ...options })
  };
}

function boardIndex(board, x, y) {
  return y * board.width + x;
}

function deferSpawns(game) {
  const firstDeferredWorldTick = game.worldTick + 1000;
  const interval = 100;
  game.dropQueue.forEach((plan, index) => {
    plan.spawnAtWorldTick = firstDeferredWorldTick + index * interval;
  });
  game.nextScheduledSpawnWorldTick = firstDeferredWorldTick + game.dropQueue.length * interval;
}

function prepareTwoLineClear(game, rules) {
  const bottom = game.board.height - 1;
  game.worldTick = 1;
  deferSpawns(game);
  for (const y of [bottom - 1, bottom]) {
    for (let x = 1; x < game.board.width; x += 1) {
      game.board.cells[boardIndex(game.board, x, y)] = 1;
    }
  }
  game.activePieces = [{
    id: "manual-clear",
    templateId: "I",
    rotation: 0,
    cellValue: 1,
    x: 0,
    y: bottom - 1,
    cells: [{ x: 0, y: 0 }, { x: 0, y: 1 }],
    carved: 0,
    carveLimit: rules.sculpting.carveLimit,
    restingWorldTicks: 0,
    pendingLock: false,
    spawnIndex: 1,
    committed: false
  }];
  game.focusedPieceId = "manual-clear";
  game.nextSpawnIndex = Math.max(game.nextSpawnIndex, 2);
}

test("network runtimes apply only host frames and converge after commands from both players", () => {
  const rules = makeTestRules();
  const policy = createVersusPolicy("network-runtime-lockstep");
  const hostMatch = createMatch({
    id: "lockstep-match",
    playerIds: ["a", "b"],
    seed: 77,
    rules,
    policy
  });
  const clientMatch = createMatch({
    id: "lockstep-match",
    playerIds: ["a", "b"],
    seed: 77,
    rules,
    policy
  });
  const { host, client, transports } = createRuntimePair({ hostMatch, clientMatch, rules, policy });

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

test("Carver VS uses the same authoritative network runtime path", () => {
  const hostMatch = createMatch({
    id: "carver-network-match",
    playerIds: ["a", "b"],
    seed: 314,
    rules: CARVER_RULESET,
    policy: CARVER_VERSUS_POLICY
  });
  const clientMatch = createMatch({
    id: "carver-network-match",
    playerIds: ["a", "b"],
    seed: 314,
    rules: CARVER_RULESET,
    policy: CARVER_VERSUS_POLICY
  });
  const { host, client } = createRuntimePair({
    hostMatch,
    clientMatch,
    rules: CARVER_RULESET,
    policy: CARVER_VERSUS_POLICY
  });

  host.command({ type: "FOCUS_NEXT" });
  client.command({ type: "FOCUS_PREVIOUS" });
  for (let tick = 0; tick < 30; tick += 1) {
    host.runOneTick();
    client.runOneTick();
  }

  assert.equal(host.match.rulesetId, CARVER_RULESET.id);
  assert.equal(host.match.policyId, CARVER_VERSUS_POLICY.id);
  assert.equal(hashMatch(client.match), hashMatch(host.match));
});

test("client holds additional commands while the same authoritative tick is stalled", () => {
  const rules = makeTestRules();
  const policy = createVersusPolicy("network-runtime-stalled-input");
  const hostMatch = createMatch({
    id: "stalled-input-match",
    playerIds: ["a", "b"],
    seed: 44,
    rules,
    policy
  });
  const clientMatch = createMatch({
    id: "stalled-input-match",
    playerIds: ["a", "b"],
    seed: 44,
    rules,
    policy
  });
  const { host, client, transports } = createRuntimePair({
    hostMatch,
    clientMatch,
    rules,
    policy,
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

test("client render timing catches up a backgrounded authoritative-frame backlog", () => {
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
  const previousRequest = globalThis.requestAnimationFrame;
  const previousCancel = globalThis.cancelAnimationFrame;
  const callbacks = [];
  globalThis.requestAnimationFrame = (callback) => {
    callbacks.push(callback);
    return callbacks.length;
  };
  globalThis.cancelAnimationFrame = () => {};

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
    if (previousRequest === undefined) delete globalThis.requestAnimationFrame;
    else globalThis.requestAnimationFrame = previousRequest;
    if (previousCancel === undefined) delete globalThis.cancelAnimationFrame;
    else globalThis.cancelAnimationFrame = previousCancel;
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
  const policy = createVersusPolicy("network-runtime-two-line");
  const hostMatch = createMatch({
    id: "two-line-match",
    playerIds: ["a", "b"],
    seed: 5,
    rules,
    policy
  });
  prepareTwoLineClear(getPlayerGame(hostMatch, "a"), rules);
  const clientMatch = restoreMatch(snapshotMatch(hostMatch), { rules, policy });
  const hostEvents = [];
  const clientEvents = [];
  const { host, client } = createRuntimePair({
    hostMatch,
    clientMatch,
    rules,
    policy,
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

test("simultaneous attacks retain domain ordering semantics across the network runtime", () => {
  const rules = makeTestRules({
    simulation: { lockDelayWorldTicks: 1, operationGraceSteps: 0 }
  });
  const policy = createVersusPolicy("network-runtime-simultaneous");
  const hostMatch = createMatch({
    id: "simultaneous-match",
    playerIds: ["a", "b"],
    seed: 8,
    rules,
    policy
  });
  prepareTwoLineClear(getPlayerGame(hostMatch, "a"), rules);
  prepareTwoLineClear(getPlayerGame(hostMatch, "b"), rules);
  const clientMatch = restoreMatch(snapshotMatch(hostMatch), { rules, policy });
  const hostEvents = [];
  const clientEvents = [];
  const { host, client } = createRuntimePair({
    hostMatch,
    clientMatch,
    rules,
    policy,
    hashIntervalTicks: 1,
    hostEvents,
    clientEvents
  });

  host.runOneTick();
  client.runOneTick();

  for (const events of [hostEvents, clientEvents]) {
    assert.equal(events.filter((event) => event.type === "ATTACK_GENERATED").length, 2);
    assert.equal(events.filter((event) => event.type === "GARBAGE_SENT").length, 2);
    assert.equal(events.filter((event) => event.type === "GARBAGE_CANCELLED").length, 0);
  }
  assert.equal(getPlayerGame(host.match, "a").incomingGarbage.length, 1);
  assert.equal(getPlayerGame(host.match, "b").incomingGarbage.length, 1);
  assert.equal(hashMatch(client.match), hashMatch(host.match));
});

test("a hash divergence requests one host snapshot and resumes from the recovered tick", () => {
  const rules = makeTestRules();
  const policy = createVersusPolicy("network-runtime-resync");
  const hostMatch = createMatch({
    id: "resync-match",
    playerIds: ["a", "b"],
    seed: 1234,
    rules,
    policy
  });
  const clientMatch = createMatch({
    id: "resync-match",
    playerIds: ["a", "b"],
    seed: 1234,
    rules,
    policy
  });
  const { host, client } = createRuntimePair({
    hostMatch,
    clientMatch,
    rules,
    policy,
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

test("terminal resync resumes a running client when the host snapshot is still playing", () => {
  const { host, client } = createBasicRuntimePair("terminal-resume-match", {
    hashIntervalTicks: 1
  });
  stepMatch(host.match, { a: [], b: [] });
  stepMatch(client.match, { a: [], b: [] });

  const previousRequest = globalThis.requestAnimationFrame;
  const previousCancel = globalThis.cancelAnimationFrame;
  const scheduledFrames = [];
  const cancelledFrames = [];
  globalThis.requestAnimationFrame = (callback) => {
    scheduledFrames.push(callback);
    return scheduledFrames.length;
  };
  globalThis.cancelAnimationFrame = (handle) => cancelledFrames.push(handle);

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
    globalThis.requestAnimationFrame = previousRequest;
    globalThis.cancelAnimationFrame = previousCancel;
  }
});

test("leaving a live network match notifies the peer and closes both transports", () => {
  const rules = makeTestRules();
  const policy = createVersusPolicy("network-runtime-leave");
  const hostMatch = createMatch({
    id: "leave-match",
    playerIds: ["a", "b"],
    seed: 8,
    rules,
    policy
  });
  const clientMatch = createMatch({
    id: "leave-match",
    playerIds: ["a", "b"],
    seed: 8,
    rules,
    policy
  });
  const { host, client, transports } = createRuntimePair({ hostMatch, clientMatch, rules, policy });

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
  const rules = makeTestRules();
  const policy = createVersusPolicy("network-runtime-ice-failure");
  const hostMatch = createMatch({
    id: "ice-failure-match",
    playerIds: ["a", "b"],
    seed: 12,
    rules,
    policy
  });
  const clientMatch = createMatch({
    id: "ice-failure-match",
    playerIds: ["a", "b"],
    seed: 12,
    rules,
    policy
  });
  const { host, transports } = createRuntimePair({ hostMatch, clientMatch, rules, policy });

  transports.host.setState("ice-failed");

  assert.equal(host.disposed, true);
  assert.equal(host.stopReason, "transport-ice-failed");
  assert.equal(transports.host.closeCount, 1);
});

test("future client inputs and host frames are bounded before they can grow runtime queues", () => {
  {
    const { host, transports } = createBasicRuntimePair("future-input-match", {
      inputDelayTicks: 2,
      maxBufferedFutureTicks: 4
    });
    transports.client.send(createMessage(
      "input",
      { playerId: "b", commands: [] },
      { seq: 0, matchTick: 3 }
    ));
    assert.equal(host.disposed, true);
    assert.equal(host.stopReason, "protocol-error");
    assert.equal(host.connectionStats.bufferedRemoteInputs, 0);
  }

  {
    const { client, transports } = createBasicRuntimePair("future-frame-match", {
      maxBufferedFutureTicks: 3
    });
    transports.host.send(createMessage(
      "input-frame",
      { commandsByPlayer: { a: [], b: [] } },
      { seq: 0, matchTick: 4 }
    ));
    assert.equal(client.disposed, true);
    assert.equal(client.stopReason, "protocol-error");
    assert.equal(client.connectionStats.bufferedFrames, 0);
  }

  {
    const { client, transports } = createBasicRuntimePair("future-hash-match", {
      maxBufferedFutureTicks: 3
    });
    transports.host.send(createMessage(
      "match-hash",
      { hash: "01234567" },
      { seq: 0, matchTick: 4 }
    ));
    assert.equal(client.disposed, true);
    assert.equal(client.stopReason, "protocol-error");
  }
});

test("network runtime rejects wrong-role and peer-spoofed player messages", () => {
  {
    const { host, transports } = createBasicRuntimePair("wrong-player-match");
    transports.client.send(createMessage(
      "input",
      { playerId: "a", commands: [] },
      { seq: 0, matchTick: 0 }
    ));
    assert.equal(host.disposed, true);
    assert.equal(host.stopReason, "protocol-error");
    assert.equal(host.connectionStats.inputsReceived, 0);
  }

  {
    const { client, transports } = createBasicRuntimePair("wrong-role-match");
    transports.host.send(createMessage(
      "input",
      { playerId: "b", commands: [] },
      { seq: 0, matchTick: 0 }
    ));
    assert.equal(client.disposed, true);
    assert.equal(client.stopReason, "protocol-error");
  }
});

test("network runtime rejects stale, duplicate, and post-handshake match messages", () => {
  {
    const { client, transports } = createBasicRuntimePair("stale-frame-match");
    stepMatch(client.match, { a: [], b: [] });
    transports.host.send(createMessage(
      "input-frame",
      { commandsByPlayer: { a: [], b: [] } },
      { seq: 0, matchTick: 0 }
    ));
    assert.equal(client.disposed, true);
    assert.equal(client.stopReason, "protocol-error");
  }

  {
    const { client, transports } = createBasicRuntimePair("duplicate-frame-match");
    const frame = { commandsByPlayer: { a: [], b: [] } };
    transports.host.send(createMessage("input-frame", frame, { seq: 0, matchTick: 0 }));
    transports.host.send(createMessage("input-frame", frame, { seq: 1, matchTick: 0 }));
    assert.equal(client.disposed, true);
    assert.equal(client.stopReason, "protocol-error");
  }

  {
    const { client, transports } = createBasicRuntimePair("late-handshake-match");
    transports.host.send(createMessage("hello", {
      playerId: "a",
      rulesetId: client.match.rulesetId,
      policyId: client.match.policyId
    }));
    assert.equal(client.disposed, true);
    assert.equal(client.stopReason, "protocol-error");
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

test("a locally terminal client can still accept its pending recovery snapshot", () => {
  const { host, client, transports } = createBasicRuntimePair("terminal-resync-match");
  const snapshot = snapshotMatch(host.match);
  client.match.status = "finished";
  client.resyncPending = true;

  transports.host.send(createMessage(
    "match-snapshot",
    { snapshot },
    { seq: 0, matchTick: snapshot.matchTick }
  ));

  assert.equal(client.match.status, "playing");
  assert.equal(client.resyncPending, false);
  assert.equal(client.connectionStats.snapshotsApplied, 1);
  assert.equal(client.stopReason, null);
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
