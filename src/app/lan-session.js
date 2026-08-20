import { WebRtcPeerTransport } from "../adapters/webrtc.js";
import { createMatch } from "../domain/match.js";
import { VERSUS_CATALOG } from "./catalog.js";
import { createMessage } from "./protocol.js";

const TERMINAL_TRANSPORT_STATES = new Set([
  "closed",
  "channel-closed",
  "connection-closed",
  "connection-failed",
  "connection-disconnected",
  "ice-closed",
  "ice-failed",
  "ice-disconnected",
  "failed",
  "disconnected"
]);
const TERMINAL_SESSION_STATES = new Set(["idle", "finished", "failed", "disconnected"]);

function defaultRandomUint32() {
  if (globalThis.crypto?.getRandomValues) {
    const values = new Uint32Array(1);
    globalThis.crypto.getRandomValues(values);
    return values[0] >>> 0;
  }
  return Math.floor(Math.random() * 0x100000000) >>> 0;
}

function normalizeError(error, fallback = "LAN session failed") {
  return error instanceof Error ? error : new Error(String(error || fallback));
}

function makeId(prefix, randomUint32) {
  return `${prefix}-${randomUint32().toString(16).padStart(8, "0")}`;
}

function modeForConfiguration(modes, rulesetId, policyId) {
  return modes.find((mode) => mode.rules.id === rulesetId && mode.policy.id === policyId) || null;
}

export class LanSession {
  constructor({
    modes = VERSUS_CATALOG,
    transportFactory = (options) => new WebRtcPeerTransport(options),
    randomUint32 = defaultRandomUint32,
    onStateChange = () => {},
    onMatchReady = () => {},
    onError = () => {}
  } = {}) {
    if (!Array.isArray(modes) || modes.length === 0) throw new Error("LAN modes are required");
    if (typeof transportFactory !== "function") throw new Error("transportFactory must be a function");
    if (typeof randomUint32 !== "function") throw new Error("randomUint32 must be a function");
    if (typeof onStateChange !== "function") throw new Error("onStateChange must be a function");
    if (typeof onMatchReady !== "function") throw new Error("onMatchReady must be a function");
    if (typeof onError !== "function") throw new Error("onError must be a function");

    this.modes = [...modes];
    this.transportFactory = transportFactory;
    this.randomUint32 = randomUint32;
    this.onStateChange = onStateChange;
    this.onMatchReady = onMatchReady;
    this.onError = onError;

    this.state = "idle";
    this.phase = "idle";
    this.role = null;
    this.mode = null;
    this.localPlayerId = null;
    this.remotePlayerId = null;
    this.transport = null;
    this.lastError = null;
    this.closing = false;
    this.generation = 0;
    this.removeMessageHandler = () => {};
    this.removeStateHandler = () => {};
    this.removeErrorHandler = () => {};
  }

  getSnapshot() {
    return Object.freeze({
      state: this.state,
      phase: this.phase,
      role: this.role,
      modeId: this.mode?.id || null,
      localPlayerId: this.localPlayerId,
      remotePlayerId: this.remotePlayerId,
      error: this.lastError?.message || null,
      transport: this.transport?.getState?.() || null
    });
  }

  publish(state = this.state, phase = this.phase) {
    this.state = state;
    this.phase = phase;
    this.onStateChange(this.getSnapshot());
  }

  createTransport(initiator) {
    const transport = this.transportFactory({
      initiator,
      rtcConfig: { iceServers: [] }
    });
    if (!transport || typeof transport.send !== "function") {
      throw new Error("LAN transport is invalid");
    }
    this.transport = transport;
    this.removeMessageHandler = transport.onMessage((message) => this.handleMessage(message)) || (() => {});
    this.removeStateHandler = transport.onStateChange((state) => this.handleTransportState(state)) || (() => {});
    this.removeErrorHandler = typeof transport.onError === "function"
      ? (transport.onError((error) => this.handleFailure(error)) || (() => {}))
      : (() => {});
    return transport;
  }

  cleanupTransport() {
    this.removeMessageHandler();
    this.removeStateHandler();
    this.removeErrorHandler();
    this.removeMessageHandler = () => {};
    this.removeStateHandler = () => {};
    this.removeErrorHandler = () => {};
    if (this.transport) {
      this.closing = true;
      try {
        this.transport.close?.();
      } finally {
        this.closing = false;
      }
    }
    this.transport = null;
  }

  reset() {
    this.generation += 1;
    this.cleanupTransport();
    this.role = null;
    this.mode = null;
    this.localPlayerId = null;
    this.remotePlayerId = null;
    this.lastError = null;
    this.publish("idle", "idle");
  }

  cancel() {
    this.reset();
  }

  isCurrentOperation(generation, transport) {
    return this.generation === generation && this.transport === transport;
  }

  staleOperationError() {
    if (this.lastError) return this.lastError;
    const error = new Error("LAN signaling was cancelled");
    error.name = "AbortError";
    return error;
  }

  async startHost(modeId) {
    this.reset();
    const mode = this.modes.find((item) => item.id === modeId);
    if (!mode) throw new Error(`Unsupported LAN mode: ${String(modeId)}`);

    this.role = "host";
    this.mode = mode;
    this.localPlayerId = makeId("host", this.randomUint32);
    this.publish("signaling", "creating-offer");

    try {
      const transport = this.createTransport(true);
      const generation = this.generation;
      const offerText = await transport.createOfferText();
      if (!this.isCurrentOperation(generation, transport)) throw this.staleOperationError();
      this.publish("signaling", "offer-ready");
      return offerText;
    } catch (error) {
      if (error?.name === "AbortError" || this.state === "idle" || this.state === "failed" || this.state === "disconnected") {
        throw this.staleOperationError();
      }
      this.handleFailure(error);
      throw normalizeError(error);
    }
  }

  async acceptHostAnswer(answerText) {
    if (this.role !== "host" || !this.transport) throw new Error("No LAN host session is active");
    if (typeof answerText !== "string" || answerText.trim() === "") throw new Error("Joiner answer is required");

    const transport = this.transport;
    const generation = this.generation;
    try {
      this.publish("connecting", "accepting-answer");
      await transport.acceptAnswerText(answerText.trim());
      if (!this.isCurrentOperation(generation, transport)) throw this.staleOperationError();
      if (this.state === "connecting") this.publish("connecting", "waiting-for-peer");
    } catch (error) {
      if (error?.name === "AbortError" || !this.isCurrentOperation(generation, transport)) {
        throw this.staleOperationError();
      }
      this.handleFailure(error);
      throw normalizeError(error);
    }
  }

  async startJoin(offerText) {
    this.reset();
    if (typeof offerText !== "string" || offerText.trim() === "") throw new Error("Host invite is required");

    this.role = "client";
    this.localPlayerId = makeId("join", this.randomUint32);
    this.publish("signaling", "creating-answer");

    try {
      const transport = this.createTransport(false);
      const generation = this.generation;
      const answerText = await transport.acceptOfferTextAndCreateAnswerText(offerText.trim());
      if (!this.isCurrentOperation(generation, transport)) throw this.staleOperationError();
      if (this.state === "signaling") this.publish("connecting", "answer-ready");
      return answerText;
    } catch (error) {
      if (error?.name === "AbortError" || this.state === "idle" || this.state === "failed" || this.state === "disconnected") {
        throw this.staleOperationError();
      }
      this.handleFailure(error);
      throw normalizeError(error);
    }
  }

  handleTransportState(state) {
    if (this.closing || this.state === "idle" || this.state === "failed" || this.state === "disconnected") return;
    const normalized = String(state);
    if (normalized === "channel-open" || normalized === "open") {
      this.beginHandshake();
      return;
    }
    if (TERMINAL_TRANSPORT_STATES.has(normalized)) {
      const nextState = this.state === "playing" || this.state === "finished" ? "disconnected" : "failed";
      this.handleFailure(new Error(`LAN peer connection ${normalized.replaceAll("-", " ")}`), nextState);
      return;
    }
    this.onStateChange(this.getSnapshot());
  }

  beginHandshake() {
    if (this.role === "host") {
      this.publish("lobby", "waiting-for-ready");
      this.send(createMessage("hello", {
        playerId: this.localPlayerId,
        rulesetId: this.mode.rules.id,
        policyId: this.mode.policy.id
      }));
      return;
    }
    this.publish("lobby", "waiting-for-host");
  }

  send(message) {
    if (!this.transport?.send(message)) {
      throw new Error("LAN peer is not ready to receive data");
    }
  }

  handleMessage(message) {
    if (TERMINAL_SESSION_STATES.has(this.state)) return;
    try {
      if (this.role === "host") this.handleHostMessage(message);
      else if (this.role === "client") this.handleClientMessage(message);
    } catch (error) {
      this.handleFailure(error);
    }
  }

  handleHostMessage(message) {
    if (message.type !== "ready" || this.state !== "lobby" || this.phase !== "waiting-for-ready") {
      throw new Error(`Unexpected LAN host message: ${String(message.type)}`);
    }
    if (message.payload.playerId === this.localPlayerId) throw new Error("LAN peer player id collides with host id");
    this.remotePlayerId = message.payload.playerId;
    this.publish("lobby", "ready-to-start");
  }

  startHostMatch() {
    if (this.role !== "host" || this.state !== "lobby" || this.phase !== "ready-to-start" || !this.remotePlayerId) {
      throw new Error("LAN match is not ready to start");
    }
    const matchId = makeId("lan", this.randomUint32);
    const seed = this.randomUint32() >>> 0;
    const playerIds = [this.localPlayerId, this.remotePlayerId];

    try {
      this.publish("starting", "sending-match-start");
      this.send(createMessage("match-start", {
        matchId,
        seed,
        rulesetId: this.mode.rules.id,
        policyId: this.mode.policy.id,
        playerIds
      }));
      this.startMatch({ matchId, seed, playerIds });
    } catch (error) {
      this.handleFailure(error);
      throw normalizeError(error);
    }
  }

  handleClientMessage(message) {
    if (message.type === "hello" && (this.state === "lobby" || this.state === "connecting")) {
      if (this.mode) throw new Error("Duplicate LAN host hello");
      const mode = modeForConfiguration(this.modes, message.payload.rulesetId, message.payload.policyId);
      if (!mode) throw new Error("Host selected an unsupported LAN ruleset or policy");
      if (message.payload.playerId === this.localPlayerId) throw new Error("LAN peer player id collides with joiner id");
      this.mode = mode;
      this.remotePlayerId = message.payload.playerId;
      this.publish("lobby", "ready");
      this.send(createMessage("ready", { playerId: this.localPlayerId }));
      return;
    }

    if (message.type === "match-start" && this.state === "lobby") {
      const payload = message.payload;
      if (!this.mode || payload.rulesetId !== this.mode.rules.id || payload.policyId !== this.mode.policy.id) {
        throw new Error("LAN match-start configuration changed after hello");
      }
      if (payload.playerIds.length !== 2
          || payload.playerIds[0] !== this.remotePlayerId
          || payload.playerIds[1] !== this.localPlayerId) {
        throw new Error("LAN match-start roster does not match negotiated host/joiner roles");
      }
      this.startMatch({
        matchId: payload.matchId,
        seed: payload.seed,
        playerIds: payload.playerIds
      });
      return;
    }

    throw new Error(`Unexpected LAN joiner message: ${String(message.type)}`);
  }

  startMatch({ matchId, seed, playerIds }) {
    const match = createMatch({
      id: matchId,
      playerIds,
      seed,
      rules: this.mode.rules,
      policy: this.mode.policy
    });
    this.removeMessageHandler();
    this.removeMessageHandler = () => {};
    this.publish("playing", "playing");
    this.onMatchReady(Object.freeze({
      role: this.role,
      mode: this.mode,
      match,
      localPlayerId: this.localPlayerId,
      remotePlayerId: this.remotePlayerId,
      transport: this.transport
    }));
  }

  markFinished() {
    if (this.state === "playing") this.publish("finished", "finished");
  }

  handleFailure(error, nextState = "failed") {
    if (this.state === "idle" || this.state === "failed" || this.state === "disconnected") return;
    this.lastError = normalizeError(error);
    this.cleanupTransport();
    this.publish(nextState, nextState);
    this.onError(this.lastError, this.getSnapshot());
  }
}
