import { decodeMessage, encodeMessage } from "../app/protocol.js";

function waitForIceGatheringComplete(connection) {
  if (connection.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((resolve) => {
    const listener = () => {
      if (connection.iceGatheringState !== "complete") return;
      connection.removeEventListener("icegatheringstatechange", listener);
      resolve();
    };
    connection.addEventListener("icegatheringstatechange", listener);
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

export class WebRtcPeerTransport {
  constructor({ rtcConfig = {}, initiator = false, channelName = "carvemino" } = {}) {
    this.connection = new RTCPeerConnection(rtcConfig);
    this.channel = null;
    this.messageHandlers = new Set();
    this.stateHandlers = new Set();

    this.connection.addEventListener("connectionstatechange", () => {
      for (const handler of this.stateHandlers) handler(this.connection.connectionState);
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
        console.error("Rejected WebRTC message", error);
      }
    });
    channel.addEventListener("open", () => {
      for (const handler of this.stateHandlers) handler("open");
    });
    channel.addEventListener("close", () => {
      for (const handler of this.stateHandlers) handler("closed");
    });
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
    if (!this.channel || this.channel.readyState !== "open") return false;
    this.channel.send(encodeMessage(message));
    return true;
  }

  async createOfferText() {
    const offer = await this.connection.createOffer();
    await this.connection.setLocalDescription(offer);
    await waitForIceGatheringComplete(this.connection);
    return encodeDescription(this.connection.localDescription);
  }

  async acceptOfferTextAndCreateAnswerText(offerText) {
    await this.connection.setRemoteDescription(decodeDescription(offerText));
    const answer = await this.connection.createAnswer();
    await this.connection.setLocalDescription(answer);
    await waitForIceGatheringComplete(this.connection);
    return encodeDescription(this.connection.localDescription);
  }

  async acceptAnswerText(answerText) {
    await this.connection.setRemoteDescription(decodeDescription(answerText));
  }

  close() {
    if (this.channel) this.channel.close();
    this.connection.close();
  }
}