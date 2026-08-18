import assert from "node:assert/strict";
import test from "node:test";

import {
  WebRtcPeerTransport,
  decodeSessionDescription,
  encodeSessionDescription
} from "../src/adapters/webrtc.js";
import { createMessage, encodeMessage } from "../src/app/protocol.js";

class FakeEventTarget {
  constructor() {
    this.handlers = new Map();
  }

  addEventListener(type, handler) {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type).add(handler);
  }

  removeEventListener(type, handler) {
    this.handlers.get(type)?.delete(handler);
  }

  emit(type, event = {}) {
    for (const handler of this.handlers.get(type) || []) handler(event);
  }
}

class FakeChannel extends FakeEventTarget {
  constructor() {
    super();
    this.readyState = "connecting";
    this.closeCount = 0;
  }

  send() {}

  close() {
    this.closeCount += 1;
    this.readyState = "closed";
  }
}

class FakePeerConnection extends FakeEventTarget {
  constructor() {
    super();
    this.connectionState = "new";
    this.iceConnectionState = "new";
    this.iceGatheringState = "complete";
    this.signalingState = "stable";
    this.localDescription = null;
    this.remoteDescription = null;
    this.channel = null;
    this.closeCount = 0;
  }

  createDataChannel() {
    this.channel = new FakeChannel();
    return this.channel;
  }

  async createOffer() {
    return { type: "offer", sdp: "offer-sdp" };
  }

  async createAnswer() {
    return { type: "answer", sdp: "answer-sdp" };
  }

  async setLocalDescription(description) {
    this.localDescription = description;
  }

  async setRemoteDescription(description) {
    this.remoteDescription = description;
  }

  close() {
    this.closeCount += 1;
    this.connectionState = "closed";
  }
}

test("WebRTC transport supports injected peer connections and distinct channel/connection states", async () => {
  const connection = new FakePeerConnection();
  const configs = [];
  const transport = new WebRtcPeerTransport({
    initiator: true,
    rtcConfig: { iceServers: [] },
    peerConnectionFactory(config) {
      configs.push(config);
      return connection;
    }
  });
  const states = [];
  transport.onStateChange((state, snapshot) => states.push([state, snapshot.channelState]));

  assert.deepEqual(configs, [{ iceServers: [] }]);
  const offerCode = await transport.createOfferText();
  assert.match(offerCode, /^cm1o\.[du]\.[A-Za-z0-9_-]+$/);
  assert.deepEqual(await decodeSessionDescription(offerCode), { type: "offer", sdp: "offer-sdp" });

  connection.channel.readyState = "open";
  connection.channel.emit("open");
  connection.connectionState = "failed";
  connection.emit("connectionstatechange");

  assert.deepEqual(states.map(([state]) => state), ["channel-open", "connection-failed"]);
  assert.equal(transport.getState().channelState, "open");
  assert.equal(transport.getState().connectionState, "failed");

  assert.equal(transport.close(), true);
  assert.equal(transport.close(), false);
  assert.equal(connection.closeCount, 1);
  assert.equal(connection.channel.closeCount, 1);
});

test("WebRTC join transport accepts legacy JSON signaling and emits compact answer codes", async () => {
  const connection = new FakePeerConnection();
  const transport = new WebRtcPeerTransport({
    peerConnectionFactory: () => connection
  });
  const errors = [];
  transport.onError((error) => errors.push(error));

  const answer = await transport.acceptOfferTextAndCreateAnswerText(
    JSON.stringify({ type: "offer", sdp: "remote-offer" })
  );
  assert.match(answer, /^cm1a\.[du]\.[A-Za-z0-9_-]+$/);
  assert.deepEqual(await decodeSessionDescription(answer), { type: "answer", sdp: "answer-sdp" });
  assert.deepEqual(connection.remoteDescription, { type: "offer", sdp: "remote-offer" });

  const channel = new FakeChannel();
  connection.emit("datachannel", { channel });
  channel.emit("message", { data: "not-json" });
  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /JSON|Unexpected token|not valid/i);
});

test("compact WebRTC signaling round-trips SDP and stays shorter than legacy JSON", async () => {
  const description = {
    type: "offer",
    sdp: [
      "v=0",
      "o=- 123456789 2 IN IP4 127.0.0.1",
      "s=-",
      "t=0 0",
      "a=group:BUNDLE 0",
      "m=application 9 UDP/DTLS/SCTP webrtc-datachannel",
      "c=IN IP4 192.168.1.25",
      "a=ice-ufrag:abcd",
      "a=ice-pwd:abcdefghijklmnopqrstuvwx",
      "a=fingerprint:sha-256 AA:BB:CC:DD:EE:FF",
      "a=sctp-port:5000",
      "a=max-message-size:262144"
    ].join("\r\n")
  };
  const legacy = JSON.stringify(description);
  const encoded = await encodeSessionDescription(description);

  assert.match(encoded, /^cm1o\.[du]\.[A-Za-z0-9_-]+$/);
  assert.deepEqual(await decodeSessionDescription(encoded, "offer"), description);
  if (encoded.startsWith("cm1o.d.")) assert.ok(encoded.length < legacy.length, `${encoded.length} < ${legacy.length}`);
  await assert.rejects(() => decodeSessionDescription(encoded, "answer"), /Expected WebRTC answer/);
});

test("WebRTC message dispatch does not replay one packet into handlers added during handoff", () => {
  const connection = new FakePeerConnection();
  const transport = new WebRtcPeerTransport({
    initiator: true,
    peerConnectionFactory: () => connection
  });
  const received = [];
  let removeLobbyHandler = () => {};
  removeLobbyHandler = transport.onMessage(() => {
    received.push("lobby");
    removeLobbyHandler();
    transport.onMessage(() => received.push("runtime"));
  });
  const wire = encodeMessage(createMessage("ready", { playerId: "joiner" }));

  connection.channel.emit("message", { data: wire });
  assert.deepEqual(received, ["lobby"]);

  connection.channel.emit("message", { data: wire });
  assert.deepEqual(received, ["lobby", "runtime"]);
});

test("closing WebRTC transport aborts pending ICE gathering", async () => {
  const connection = new FakePeerConnection();
  connection.iceGatheringState = "gathering";
  const transport = new WebRtcPeerTransport({
    initiator: true,
    peerConnectionFactory: () => connection
  });

  const pendingOffer = transport.createOfferText();
  await Promise.resolve();
  transport.close();

  await assert.rejects(pendingOffer, /closed during ICE gathering/);
  assert.equal(connection.closeCount, 1);
});
