import assert from "node:assert/strict";
import test from "node:test";

import { LanSession } from "../src/app/lan-session.js";
import { VERSUS_CATALOG } from "../src/app/catalog.js";
import { createMessage } from "../src/app/protocol.js";
import { hashMatch } from "../src/domain/match.js";

class FakeLanTransport {
  constructor(network, initiator) {
    this.network = network;
    this.initiator = initiator;
    this.peer = null;
    this.open = false;
    this.closed = false;
    this.closeCount = 0;
    this.messageHandlers = new Set();
    this.stateHandlers = new Set();
    this.errorHandlers = new Set();
  }

  onMessage(handler) {
    this.messageHandlers.add(handler);
    return () => this.messageHandlers.delete(handler);
  }

  onStateChange(handler) {
    this.stateHandlers.add(handler);
    return () => this.stateHandlers.delete(handler);
  }

  onError(handler) {
    this.errorHandlers.add(handler);
    return () => this.errorHandlers.delete(handler);
  }

  getState() {
    return { channelState: this.open ? "open" : this.closed ? "closed" : "connecting" };
  }

  async createOfferText() {
    if (!this.initiator) throw new Error("joiner cannot create offer");
    this.network.host = this;
    return "host-offer";
  }

  async acceptOfferTextAndCreateAnswerText(text) {
    if (text !== "host-offer" || !this.network.host) throw new Error("invalid host offer");
    this.network.client = this;
    this.peer = this.network.host;
    this.network.host.peer = this;
    return "join-answer";
  }

  async acceptAnswerText(text) {
    if (text !== "join-answer" || !this.peer) throw new Error("invalid join answer");
    this.open = true;
    this.peer.open = true;
    for (const handler of this.peer.stateHandlers) handler("channel-open");
    for (const handler of this.stateHandlers) handler("channel-open");
  }

  send(message) {
    if (!this.open || !this.peer?.open) return false;
    const copy = JSON.parse(JSON.stringify(message));
    for (const handler of this.peer.messageHandlers) handler(copy);
    return true;
  }

  close() {
    if (this.closed) return false;
    this.closed = true;
    this.open = false;
    this.closeCount += 1;
    return true;
  }
}

class FakeLanNetwork {
  constructor() {
    this.host = null;
    this.client = null;
    this.transports = [];
  }

  create = ({ initiator }) => {
    const transport = new FakeLanTransport(this, initiator);
    this.transports.push(transport);
    return transport;
  };
}

function sequence(values) {
  let index = 0;
  return () => values[index++] ?? (100 + index);
}

test("LAN host/join signaling completes hello/ready/match-start with identical matches", async () => {
  const network = new FakeLanNetwork();
  const hostMatches = [];
  const clientMatches = [];
  const host = new LanSession({
    modes: VERSUS_CATALOG,
    transportFactory: network.create,
    randomUint32: sequence([1, 2, 77]),
    onMatchReady: (context) => hostMatches.push(context)
  });
  const client = new LanSession({
    modes: VERSUS_CATALOG,
    transportFactory: network.create,
    randomUint32: sequence([9]),
    onMatchReady: (context) => clientMatches.push(context)
  });

  const offer = await host.startHost("classic");
  const answer = await client.startJoin(offer);
  await host.acceptHostAnswer(answer);

  assert.equal(host.getSnapshot().state, "lobby");
  assert.equal(host.getSnapshot().phase, "ready-to-start");
  assert.equal(client.getSnapshot().state, "lobby");
  assert.equal(client.getSnapshot().phase, "ready");
  assert.equal(hostMatches.length, 0);
  assert.equal(clientMatches.length, 0);

  host.startHostMatch();

  assert.equal(host.getSnapshot().state, "playing");
  assert.equal(client.getSnapshot().state, "playing");
  assert.equal(hostMatches.length, 1);
  assert.equal(clientMatches.length, 1);
  assert.equal(hostMatches[0].role, "host");
  assert.equal(clientMatches[0].role, "client");
  assert.deepEqual(hostMatches[0].match.players.map(({ id }) => id), ["host-00000001", "join-00000009"]);
  assert.deepEqual(clientMatches[0].match.players.map(({ id }) => id), ["host-00000001", "join-00000009"]);
  assert.equal(hostMatches[0].match.seed, 77);
  assert.equal(hashMatch(hostMatches[0].match), hashMatch(clientMatches[0].match));
});

test("two-peer LAN signaling rejects a larger protocol roster at the adapter boundary", async () => {
  const network = new FakeLanNetwork();
  const client = new LanSession({
    modes: VERSUS_CATALOG,
    transportFactory: network.create,
    randomUint32: sequence([9])
  });
  const host = new LanSession({
    modes: VERSUS_CATALOG,
    transportFactory: network.create,
    randomUint32: sequence([1, 2, 77])
  });

  const offer = await host.startHost("classic");
  const answer = await client.startJoin(offer);
  await host.acceptHostAnswer(answer);

  const hostSnapshot = host.getSnapshot();
  const clientSnapshot = client.getSnapshot();
  network.host.send(createMessage("match-start", {
    matchId: "lan-multiplayer-roster",
    seed: 77,
    rulesetId: host.mode.rules.id,
    policyId: host.mode.policy.id,
    playerIds: [hostSnapshot.localPlayerId, clientSnapshot.localPlayerId, "third-player"]
  }));

  assert.equal(client.getSnapshot().state, "failed");
  assert.match(client.getSnapshot().error, /roster does not match negotiated host\/joiner roles/);
});

test("Carver VS uses the same LAN hello/ready/match-start path as Classic VS", async () => {
  const network = new FakeLanNetwork();
  const hostMatches = [];
  const clientMatches = [];
  const host = new LanSession({
    modes: VERSUS_CATALOG,
    transportFactory: network.create,
    randomUint32: sequence([11, 12, 99]),
    onMatchReady: (context) => hostMatches.push(context)
  });
  const client = new LanSession({
    modes: VERSUS_CATALOG,
    transportFactory: network.create,
    randomUint32: sequence([19]),
    onMatchReady: (context) => clientMatches.push(context)
  });

  const offer = await host.startHost("carver");
  const answer = await client.startJoin(offer);
  await host.acceptHostAnswer(answer);
  assert.equal(host.getSnapshot().phase, "ready-to-start");
  host.startHostMatch();

  assert.equal(hostMatches[0].mode.id, "carver");
  assert.equal(clientMatches[0].mode.id, "carver");
  assert.match(hostMatches[0].match.rulesetId, /carver/);
  assert.match(hostMatches[0].match.policyId, /carver/);
  assert.equal(hashMatch(hostMatches[0].match), hashMatch(clientMatches[0].match));
});

test("LAN signaling failure releases the peer and leaves the host flow reusable", async () => {
  const network = new FakeLanNetwork();
  const errors = [];
  const host = new LanSession({
    modes: VERSUS_CATALOG,
    transportFactory: network.create,
    randomUint32: sequence([1, 2]),
    onError: (error) => errors.push(error)
  });

  await host.startHost("classic");
  await assert.rejects(() => host.acceptHostAnswer("expired-answer"), /invalid join answer/);
  assert.equal(host.getSnapshot().state, "failed");
  assert.equal(network.transports[0].closeCount, 1);
  assert.equal(errors.length, 1);

  assert.equal(await host.startHost("classic"), "host-offer");
  assert.equal(host.getSnapshot().phase, "offer-ready");
  assert.equal(network.transports.length, 2);
});

test("cancelled LAN signaling cannot publish a stale offer into a later session", async () => {
  let resolveOffer;
  const transport = new FakeLanTransport(new FakeLanNetwork(), true);
  transport.createOfferText = () => new Promise((resolve) => {
    resolveOffer = resolve;
  });
  const session = new LanSession({
    modes: VERSUS_CATALOG,
    transportFactory: () => transport,
    randomUint32: sequence([1])
  });

  const pendingOffer = session.startHost("classic");
  session.cancel();
  resolveOffer("stale-offer");

  await assert.rejects(pendingOffer, (error) => error?.name === "AbortError");
  assert.equal(session.getSnapshot().state, "idle");
  assert.equal(session.getSnapshot().phase, "idle");
  assert.equal(transport.closeCount, 1);
});

test("LAN lobby treats direct ICE failure as terminal and releases the peer", async () => {
  const network = new FakeLanNetwork();
  const session = new LanSession({
    modes: VERSUS_CATALOG,
    transportFactory: network.create,
    randomUint32: sequence([1])
  });

  await session.startHost("classic");
  for (const handler of network.transports[0].stateHandlers) handler("ice-failed");

  assert.equal(session.getSnapshot().state, "failed");
  assert.equal(network.transports[0].closeCount, 1);
});

test("finished LAN sessions ignore late peer messages", async () => {
  const network = new FakeLanNetwork();
  const host = new LanSession({
    modes: VERSUS_CATALOG,
    transportFactory: network.create,
    randomUint32: sequence([1, 2, 77])
  });
  const client = new LanSession({
    modes: VERSUS_CATALOG,
    transportFactory: network.create,
    randomUint32: sequence([9])
  });

  const offer = await host.startHost("classic");
  const answer = await client.startJoin(offer);
  await host.acceptHostAnswer(answer);
  host.startHostMatch();
  host.markFinished();

  host.handleMessage({ definitely: "not a protocol message" });

  assert.equal(host.getSnapshot().state, "finished");
  assert.equal(host.getSnapshot().error, null);
});

test("repeated LAN host cancel paths release handlers and transports", async () => {
  const network = new FakeLanNetwork();
  const session = new LanSession({
    modes: VERSUS_CATALOG,
    transportFactory: network.create,
    randomUint32: sequence([1, 2, 3])
  });

  for (let attempt = 0; attempt < 3; attempt += 1) {
    await session.startHost("classic");
    const transport = network.transports[attempt];
    session.cancel();
    assert.equal(transport.closeCount, 1);
    assert.equal(transport.messageHandlers.size, 0);
    assert.equal(transport.stateHandlers.size, 0);
    assert.equal(transport.errorHandlers.size, 0);
    assert.equal(session.getSnapshot().state, "idle");
  }
});
