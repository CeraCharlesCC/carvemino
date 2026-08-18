import { decodeMessage, encodeMessage } from "../app/protocol.js";

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

function encodeDescription(description) {
  return JSON.stringify({ type: description.type, sdp: description.sdp });
}

function decodeDescription(text) {
  const parsed = JSON.parse(text);
  if (!parsed || typeof parsed.type !== "string" || typeof parsed.sdp !== "string") {
    throw new Error("Invalid WebRTC session description");
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
        for (const handler of this.messageHandlers) handler(message);
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
    return encodeDescription(this.connection.localDescription);
  }

  async acceptOfferTextAndCreateAnswerText(offerText) {
    await this.connection.setRemoteDescription(decodeDescription(offerText));
    const answer = await this.connection.createAnswer();
    await this.connection.setLocalDescription(answer);
    await waitForIceGatheringComplete(this.connection, this.closeController.signal);
    return encodeDescription(this.connection.localDescription);
  }

  async acceptAnswerText(answerText) {
    await this.connection.setRemoteDescription(decodeDescription(answerText));
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