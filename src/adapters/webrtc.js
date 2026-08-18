import { decodeMessage, encodeMessage } from "../app/protocol.js";

const SIGNALING_CODE_VERSION = "cm1";
const SIGNALING_TYPE_CODE = Object.freeze({ offer: "o", answer: "a" });
const SIGNALING_CODE_TYPE = Object.freeze({ o: "offer", a: "answer" });

function bytesToBase64Url(bytes) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function base64UrlToBytes(text) {
  if (!/^[A-Za-z0-9_-]+$/u.test(text)) throw new Error("Invalid LAN signaling code");
  const base64 = text.replaceAll("-", "+").replaceAll("_", "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  let binary;
  try {
    binary = atob(padded);
  } catch {
    throw new Error("Invalid LAN signaling code");
  }
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function transformBytes(bytes, StreamConstructor, format) {
  const stream = new Blob([bytes]).stream().pipeThrough(new StreamConstructor(format));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function compressSdp(sdp) {
  const bytes = new TextEncoder().encode(sdp);
  if (typeof CompressionStream !== "function") return { codec: "u", bytes };
  try {
    return { codec: "d", bytes: await transformBytes(bytes, CompressionStream, "deflate") };
  } catch {
    return { codec: "u", bytes };
  }
}

async function decompressSdp(codec, bytes) {
  if (codec === "u") return new TextDecoder().decode(bytes);
  if (codec !== "d") throw new Error("Unsupported LAN signaling code compression");
  if (typeof DecompressionStream !== "function") {
    throw new Error("This browser cannot read compressed LAN signaling codes");
  }
  try {
    const decoded = await transformBytes(bytes, DecompressionStream, "deflate");
    return new TextDecoder().decode(decoded);
  } catch {
    throw new Error("Invalid compressed LAN signaling code");
  }
}

function waitForIceGatheringComplete(connection, signal) {
  if (connection.iceGatheringState === "complete") return Promise.resolve();
  if (signal?.aborted) return Promise.reject(new Error("WebRTC transport closed during ICE gathering"));
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      connection.removeEventListener("icegatheringstatechange", listener);
      signal?.removeEventListener("abort", abortListener);
    };
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback(value);
    };
    const listener = () => {
      if (connection.iceGatheringState !== "complete") return;
      finish(resolve);
    };
    const abortListener = () => {
      finish(reject, new Error("WebRTC transport closed during ICE gathering"));
    };
    connection.addEventListener("icegatheringstatechange", listener);
    signal?.addEventListener("abort", abortListener, { once: true });

    if (signal?.aborted) abortListener();
    else listener();
  });
}

export async function encodeSessionDescription(description) {
  if (!description || typeof description.type !== "string" || typeof description.sdp !== "string") {
    throw new Error("Invalid WebRTC session description");
  }
  const typeCode = SIGNALING_TYPE_CODE[description.type];
  if (!typeCode) throw new Error(`Unsupported WebRTC session description type: ${String(description.type)}`);
  const compressed = await compressSdp(description.sdp);
  return `${SIGNALING_CODE_VERSION}${typeCode}.${compressed.codec}.${bytesToBase64Url(compressed.bytes)}`;
}

export async function decodeSessionDescription(text, expectedType = null) {
  const normalized = String(text || "").trim();
  let parsed;
  if (normalized.startsWith("{")) {
    try {
      parsed = JSON.parse(normalized);
    } catch {
      throw new Error("Invalid WebRTC session description");
    }
  } else {
    const match = /^cm1([oa])\.([a-z])\.([A-Za-z0-9_-]+)$/u.exec(normalized);
    if (!match) throw new Error("Invalid LAN signaling code");
    const [, typeCode, codec, payload] = match;
    parsed = {
      type: SIGNALING_CODE_TYPE[typeCode],
      sdp: await decompressSdp(codec, base64UrlToBytes(payload))
    };
  }

  if (!parsed || typeof parsed.type !== "string" || typeof parsed.sdp !== "string" || parsed.sdp.length === 0) {
    throw new Error("Invalid WebRTC session description");
  }
  if (!SIGNALING_TYPE_CODE[parsed.type]) {
    throw new Error(`Unsupported WebRTC session description type: ${String(parsed.type)}`);
  }
  if (expectedType && parsed.type !== expectedType) {
    throw new Error(`Expected WebRTC ${expectedType}, received ${parsed.type}`);
  }
  return parsed;
}

function defaultPeerConnectionFactory(rtcConfig) {
  if (typeof RTCPeerConnection !== "function") {
    throw new Error("WebRTC is not available in this browser");
  }
  return new RTCPeerConnection(rtcConfig);
}

export class WebRtcPeerTransport {
  constructor({
    rtcConfig = {},
    initiator = false,
    channelName = "carvemino",
    peerConnectionFactory = defaultPeerConnectionFactory
  } = {}) {
    if (typeof peerConnectionFactory !== "function") {
      throw new Error("peerConnectionFactory must be a function");
    }
    this.connection = peerConnectionFactory(rtcConfig);
    this.channel = null;
    this.messageHandlers = new Set();
    this.stateHandlers = new Set();
    this.errorHandlers = new Set();
    this.closed = false;
    this.lastError = null;
    this.closeController = new AbortController();

    this.connection.addEventListener("connectionstatechange", () => {
      this.emitState(`connection-${this.connection.connectionState}`);
    });
    this.connection.addEventListener("iceconnectionstatechange", () => {
      this.emitState(`ice-${this.connection.iceConnectionState}`);
    });

    if (initiator) {
      this.attachChannel(this.connection.createDataChannel(channelName, { ordered: true }));
    } else {
      this.connection.addEventListener("datachannel", (event) => this.attachChannel(event.channel));
    }
  }

  attachChannel(channel) {
    this.channel = channel;
    channel.addEventListener("message", (event) => {
      try {
        const message = decodeMessage(event.data);
        for (const handler of [...this.messageHandlers]) handler(message);
      } catch (error) {
        this.reportError(error);
      }
    });
    channel.addEventListener("open", () => {
      this.emitState("channel-open");
    });
    channel.addEventListener("close", () => {
      this.emitState("channel-closed");
    });
    channel.addEventListener("error", (event) => {
      this.reportError(event?.error instanceof Error ? event.error : new Error("WebRTC DataChannel error"));
    });
  }

  getState() {
    return Object.freeze({
      connectionState: String(this.connection?.connectionState || "unknown"),
      iceConnectionState: String(this.connection?.iceConnectionState || "unknown"),
      iceGatheringState: String(this.connection?.iceGatheringState || "unknown"),
      signalingState: String(this.connection?.signalingState || "unknown"),
      channelState: String(this.channel?.readyState || "none"),
      closed: this.closed,
      error: this.lastError ? this.lastError.message : null
    });
  }

  emitState(state) {
    const snapshot = this.getState();
    for (const handler of this.stateHandlers) handler(state, snapshot);
  }

  reportError(error) {
    this.lastError = error instanceof Error ? error : new Error(String(error));
    for (const handler of this.errorHandlers) handler(this.lastError, this.getState());
    this.emitState("error");
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

  send(message) {
    if (!this.channel || this.channel.readyState !== "open") return false;
    try {
      this.channel.send(encodeMessage(message));
    } catch (error) {
      this.reportError(error);
      return false;
    }
    return true;
  }

  async createOfferText() {
    const offer = await this.connection.createOffer();
    await this.connection.setLocalDescription(offer);
    await waitForIceGatheringComplete(this.connection, this.closeController.signal);
    return encodeSessionDescription(this.connection.localDescription);
  }

  async acceptOfferTextAndCreateAnswerText(offerText) {
    await this.connection.setRemoteDescription(await decodeSessionDescription(offerText, "offer"));
    const answer = await this.connection.createAnswer();
    await this.connection.setLocalDescription(answer);
    await waitForIceGatheringComplete(this.connection, this.closeController.signal);
    return encodeSessionDescription(this.connection.localDescription);
  }

  async acceptAnswerText(answerText) {
    await this.connection.setRemoteDescription(await decodeSessionDescription(answerText, "answer"));
  }

  close() {
    if (this.closed) return false;
    this.closed = true;
    this.closeController.abort();
    if (this.channel && this.channel.readyState !== "closed") this.channel.close();
    if (this.connection?.connectionState !== "closed") this.connection.close();
    this.emitState("closed");
    return true;
  }
}