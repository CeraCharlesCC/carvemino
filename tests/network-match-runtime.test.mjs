import assert from "node:assert/strict";
import test from "node:test";

import { NetworkMatchRuntime } from "../src/app/network-match-runtime.js";
import { createMessage } from "../src/app/protocol.js";
import {
  createMatch,
  getPlayerGame,
  hashMatch,
  restoreMatch,
  snapshotMatch
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
}

function createTransportPair() {
  const host = new MemoryTransport();
  const client = new MemoryTransport();
  host.peer = client;
  client.peer = host;
  return { host, client };
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
    remotePlayerId: "b",
    transport: transports.host,
    inputDelayTicks,
    hashIntervalTicks,
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
    remotePlayerId: "a",
    transport: transports.client,
    inputDelayTicks,
    hashIntervalTicks,
    onEvents(events) {
      clientEvents.push(...events);
    }
  });
  return { host, client, transports };
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
  assert(client.opponentView.board);

  const delayedFrame = transports.host.sent.find(
    (message) => message.type === "input-frame" && message.matchTick === 2
  );
  assert.deepEqual(delayedFrame.payload.commandsByPlayer.a, [{ type: "FOCUS_PREVIOUS" }]);
  assert.deepEqual(delayedFrame.payload.commandsByPlayer.b, [{ type: "FOCUS_NEXT" }]);
  assert(client.connectionStats.inputsSent > 0);
  assert(host.connectionStats.inputsReceived > 0);
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

test("client render timing catches up buffered authoritative frames after a stall", () => {
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
    remotePlayerId: "b",
    transport: transports.host,
    hashIntervalTicks: 10
  });
  const client = new NetworkMatchRuntime({
    match: clientMatch,
    rules,
    policy,
    role: "client",
    localPlayerId: "b",
    remotePlayerId: "a",
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
    for (let tick = 0; tick < 12; tick += 1) host.runOneTick();
    assert.equal(client.match.matchTick, 0);
    assert.equal(client.connectionStats.bufferedFrames, 12);

    callbacks.shift()(0);
    callbacks.shift()(250);

    assert.equal(client.match.matchTick, 12);
    assert.equal(hashMatch(client.match), hashMatch(host.match));
    assert(interpolations.every((value) => value >= 0 && value <= 1));
  } finally {
    client.stop();
    host.stop();
    globalThis.requestAnimationFrame = previousRequest;
    globalThis.cancelAnimationFrame = previousCancel;
  }
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

test("legacy remote attack messages are rejected instead of mutating the shared match", () => {
  const rules = makeTestRules();
  const policy = createVersusPolicy("network-runtime-reject-attack");
  const hostMatch = createMatch({
    id: "reject-attack-match",
    playerIds: ["a", "b"],
    seed: 3,
    rules,
    policy
  });
  const clientMatch = createMatch({
    id: "reject-attack-match",
    playerIds: ["a", "b"],
    seed: 3,
    rules,
    policy
  });
  const errors = [];
  const transports = createTransportPair();
  const client = new NetworkMatchRuntime({
    match: clientMatch,
    rules,
    policy,
    role: "client",
    localPlayerId: "b",
    remotePlayerId: "a",
    transport: transports.client,
    onError(error) {
      errors.push(error);
    }
  });
  const beforeHash = hashMatch(client.match);
  const attack = createMessage("attack", {
    targetPlayerId: "b",
    packet: {
      id: "hostile-garbage",
      sourcePlayerId: "a",
      rows: 4,
      applyAtWorldTick: 1,
      seed: 9
    }
  });

  transports.host.send(attack);

  assert.equal(client.disposed, true);
  assert.equal(client.stopReason, "protocol-error");
  assert.equal(errors.length, 1);
  assert.equal(getPlayerGame(client.match, "b").incomingGarbage.length, 0);
  assert.equal(hashMatch(client.match), beforeHash);
  assert.equal(hashMatch(hostMatch), beforeHash);
});