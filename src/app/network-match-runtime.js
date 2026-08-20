import {
  PROTOCOL_LIMITS,
  createMessage,
  createProtocolStreamValidator,
  validateGameplayCommand,
  validateMessageContext
} from "./protocol.js";
import {
  getPlayerGame,
  hashMatch,
  restoreMatch,
  snapshotMatch,
  stepMatch
} from "../domain/match.js";

const NETWORK_ROLES = new Set(["host", "client"]);
const TERMINAL_TRANSPORT_STATES = new Set([
  "closed",
  "failed",
  "disconnected",
  "channel-closed",
  "connection-closed",
  "connection-failed",
  "connection-disconnected",
  "ice-closed",
  "ice-failed",
  "ice-disconnected"
]);
const DEFAULT_INPUT_DELAY_TICKS = 3;
const DEFAULT_HASH_INTERVAL_TICKS = 60;
const DEFAULT_MAX_BUFFERED_FUTURE_TICKS = 600;
const MAX_CHECKPOINT_HISTORY = 8;
const MAX_STEPS_PER_FRAME = 30;
const MAX_FRAME_ELAPSED_SECONDS = 0.25;
const PLAYER_ROUTED_MESSAGE_TYPES = new Set(["input", "resync-request", "leave"]);

function assertFunction(value, name) {
  if (typeof value !== "function") throw new Error(`${name} must be a function`);
}

function assertPositiveInteger(value, name) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
}

function cloneCommand(command) {
  return { ...command };
}

function cloneCommands(commands) {
  return commands.map(cloneCommand);
}

function commandsForRoster(playerIds, commandsForPlayer) {
  const commandsByPlayer = Object.create(null);
  for (const playerId of playerIds) {
    commandsByPlayer[playerId] = cloneCommands(commandsForPlayer(playerId));
  }
  return commandsByPlayer;
}

function countBufferedInputs(inputsByTick) {
  let count = 0;
  for (const inputsByPlayer of inputsByTick.values()) count += inputsByPlayer.size;
  return count;
}

function normalizeUnsubscribe(value) {
  return typeof value === "function" ? value : () => {};
}

export class NetworkMatchRuntime {
  constructor({
    match,
    rules,
    policy,
    role,
    localPlayerId,
    transport,
    inputDelayTicks = DEFAULT_INPUT_DELAY_TICKS,
    hashIntervalTicks = DEFAULT_HASH_INTERVAL_TICKS,
    maxBufferedFutureTicks = DEFAULT_MAX_BUFFERED_FUTURE_TICKS,
    onFrame = () => {},
    onEvents = () => {},
    onConnectionStateChange = () => {},
    onStop = () => {},
    onError = () => {}
  } = {}) {
    if (!match || typeof match !== "object") throw new Error("network match is required");
    if (!rules || typeof rules !== "object") throw new Error("network match rules are required");
    if (!policy || typeof policy !== "object") throw new Error("network match policy is required");
    if (!NETWORK_ROLES.has(role)) throw new Error(`Invalid network match role: ${String(role)}`);
    if (!transport || typeof transport !== "object") throw new Error("network match transport is required");
    assertFunction(transport.send, "network match transport.send");
    assertFunction(transport.onMessage, "network match transport.onMessage");
    assertFunction(transport.onStateChange, "network match transport.onStateChange");
    assertPositiveInteger(inputDelayTicks, "inputDelayTicks");
    assertPositiveInteger(hashIntervalTicks, "hashIntervalTicks");
    assertPositiveInteger(maxBufferedFutureTicks, "maxBufferedFutureTicks");
    if (inputDelayTicks > maxBufferedFutureTicks) {
      throw new Error("inputDelayTicks cannot exceed maxBufferedFutureTicks");
    }
    assertFunction(onFrame, "onFrame");
    assertFunction(onEvents, "onEvents");
    assertFunction(onConnectionStateChange, "onConnectionStateChange");
    assertFunction(onStop, "onStop");
    assertFunction(onError, "onError");

    const playerIds = match.players?.map((player) => player.id) || [];
    if (playerIds.length < 2 || new Set(playerIds).size !== playerIds.length) {
      throw new Error("network match requires at least two unique players");
    }
    if (!playerIds.includes(localPlayerId)) throw new Error("localPlayerId is not in the match roster");
    if (match.rulesetId !== rules.id) {
      throw new Error(`network match ruleset mismatch: expected ${match.rulesetId}, received ${String(rules.id)}`);
    }
    if (match.policyId !== policy.id) {
      throw new Error(`network match policy mismatch: expected ${match.policyId}, received ${String(policy.id)}`);
    }
    if (!match.engine || !Number.isFinite(match.engine.stepsPerSecond) || match.engine.stepsPerSecond <= 0) {
      throw new Error("network match engine must expose a positive stepsPerSecond");
    }

    this.match = match;
    this.rules = rules;
    this.policy = policy;
    this.role = role;
    this.localPlayerId = localPlayerId;
    this.playerIds = Object.freeze([...playerIds]);
    this.remotePlayerIds = Object.freeze(playerIds.filter((playerId) => playerId !== localPlayerId));
    this.transport = transport;
    this.inputDelayTicks = inputDelayTicks;
    this.hashIntervalTicks = hashIntervalTicks;
    this.maxBufferedFutureTicks = maxBufferedFutureTicks;
    this.onFrame = onFrame;
    this.onEvents = onEvents;
    this.onConnectionStateChange = onConnectionStateChange;
    this.onStop = onStop;
    this.onError = onError;

    this.stepSeconds = 1 / match.engine.stepsPerSecond;
    this.accumulator = 0;
    this.lastTime = null;
    this.pendingCommands = [];
    this.lastLocalSubmissionSourceTick = -1;
    this.lastLocalRequestedTick = -1;
    this.localInputsByTick = new Map();
    this.remoteInputsByTick = new Map();
    this.authoritativeFrames = new Map();
    this.latestAuthoritativeFrameTick = -1;
    this.expectedHashes = new Map();
    this.localCheckpointHashes = new Map();
    this.resyncPending = false;
    this.resumeAfterTerminalResync = false;

    this.nextSequence = 0;
    this.running = false;
    this.disposed = false;
    this.frameHandle = null;
    this.stopReason = match.status === "playing" ? null : "finished";
    this.transportState = "open";
    this.boundFrame = (time) => this.frame(time);
    this.incomingValidator = createProtocolStreamValidator({ playerIds: this.playerIds });
    this.incomingValidatorsByPlayer = new Map(
      this.remotePlayerIds.map((playerId) => [
        playerId,
        createProtocolStreamValidator({ playerIds: this.playerIds })
      ])
    );

    this.counters = {
      messagesSent: 0,
      messagesReceived: 0,
      inputsSent: 0,
      inputsReceived: 0,
      staleInputsDropped: 0,
      framesSent: 0,
      framesReceived: 0,
      stalledTicks: 0,
      hashesSent: 0,
      hashesReceived: 0,
      hashMismatches: 0,
      resyncRequestsSent: 0,
      resyncRequestsReceived: 0,
      snapshotsSent: 0,
      snapshotsApplied: 0,
      protocolErrors: 0
    };

    this.removeMessageHandler = normalizeUnsubscribe(
      // Multiplexed transports may identify the sending roster member as a second callback argument.
      // Existing one-peer transports can omit it because the sole remote player is unambiguous.
      transport.onMessage((message, sourcePlayerId) => this.receive(message, sourcePlayerId))
    );
    this.removeStateHandler = normalizeUnsubscribe(
      transport.onStateChange((state) => this.handleTransportState(state))
    );
  }

  get localView() {
    return this.match.engine.view(getPlayerGame(this.match, this.localPlayerId));
  }

  get opponentViews() {
    return Object.freeze(this.remotePlayerIds.map((playerId) => Object.freeze({
      playerId,
      view: this.match.engine.view(getPlayerGame(this.match, playerId))
    })));
  }

  get result() {
    return this.match.result;
  }

  get connectionStats() {
    return Object.freeze({
      role: this.role,
      transportState: this.transportState,
      matchTick: this.match.matchTick,
      inputDelayTicks: this.inputDelayTicks,
      bufferedFrames: this.authoritativeFrames.size,
      bufferedRemoteInputs: countBufferedInputs(this.remoteInputsByTick),
      maxBufferedFutureTicks: this.maxBufferedFutureTicks,
      resyncPending: this.resyncPending,
      ...this.counters
    });
  }

  command(command) {
    if (this.disposed || this.match.status !== "playing") return false;
    validateGameplayCommand(command);
    if (this.pendingCommands.length >= PROTOCOL_LIMITS.maxCommandsPerPlayerTick) {
      throw new Error(
        `network match may queue at most ${PROTOCOL_LIMITS.maxCommandsPerPlayerTick} commands per local tick`
      );
    }
    this.pendingCommands.push(cloneCommand(command));
    return true;
  }

  sendMessage(message) {
    validateMessageContext(message, { playerIds: this.playerIds });
    let sent;
    try {
      sent = this.transport.send(message);
    } catch (error) {
      this.fail(error, "transport-send-failed");
      return false;
    }
    if (sent === false) {
      this.fail(new Error("network match transport rejected a message"), "transport-send-failed");
      return false;
    }
    this.counters.messagesSent += 1;
    return true;
  }

  sendSequenced(type, payload, matchTick = undefined) {
    if (this.nextSequence > PROTOCOL_LIMITS.maxSequence) {
      this.fail(new Error("network match exhausted protocol sequence numbers"), "protocol-limit");
      return false;
    }
    const seq = this.nextSequence;
    this.nextSequence += 1;
    const fields = matchTick === undefined ? { seq } : { seq, matchTick };
    const message = createMessage(type, payload, fields);
    return this.sendMessage(message);
  }

  scheduleLocalCommands() {
    if (this.pendingCommands.length === 0) return true;
    if (this.role === "client" && this.lastLocalSubmissionSourceTick === this.match.matchTick) {
      return true;
    }
    const schedulingTick = this.role === "client"
      ? Math.max(this.match.matchTick, this.latestAuthoritativeFrameTick)
      : this.match.matchTick;
    const requestedTick = schedulingTick + this.inputDelayTicks;
    if (requestedTick > PROTOCOL_LIMITS.maxMatchTick) {
      this.fail(new Error("network match input tick exceeds the protocol limit"), "protocol-limit");
      return false;
    }
    if (this.role === "client" && requestedTick <= this.lastLocalRequestedTick) {
      return true;
    }

    const commands = cloneCommands(this.pendingCommands);
    if (this.role === "host") {
      const existing = this.localInputsByTick.get(requestedTick) || [];
      if (existing.length + commands.length > PROTOCOL_LIMITS.maxCommandsPerPlayerTick) {
        throw new Error(
          `network match may schedule at most ${PROTOCOL_LIMITS.maxCommandsPerPlayerTick} commands per player tick`
        );
      }
      this.localInputsByTick.set(requestedTick, [...existing, ...commands]);
    } else {
      if (!this.sendSequenced(
        "input",
        { playerId: this.localPlayerId, commands },
        requestedTick
      )) return false;
      this.lastLocalRequestedTick = requestedTick;
      this.counters.inputsSent += 1;
    }

    this.pendingCommands = [];
    this.lastLocalSubmissionSourceTick = this.match.matchTick;
    return true;
  }

  runHostTick() {
    if (!this.scheduleLocalCommands()) return [];
    const matchTick = this.match.matchTick;
    const remoteInputs = this.remoteInputsByTick.get(matchTick);
    const commandsByPlayer = commandsForRoster(this.playerIds, (playerId) => {
      if (playerId === this.localPlayerId) return this.localInputsByTick.get(matchTick) || [];
      return remoteInputs?.get(playerId) || [];
    });

    if (!this.sendSequenced("input-frame", { commandsByPlayer }, matchTick)) return [];
    this.counters.framesSent += 1;
    this.localInputsByTick.delete(matchTick);
    this.remoteInputsByTick.delete(matchTick);

    const events = stepMatch(this.match, commandsByPlayer);
    this.emitEvents(events);
    this.sendHashCheckpointIfNeeded();
    this.markFinishedIfNeeded();
    return events;
  }

  runClientTick() {
    if (this.resyncPending) {
      this.counters.stalledTicks += 1;
      return [];
    }
    if (!this.scheduleLocalCommands()) return [];

    const matchTick = this.match.matchTick;
    const frame = this.authoritativeFrames.get(matchTick);
    if (!frame) {
      this.counters.stalledTicks += 1;
      return [];
    }

    this.authoritativeFrames.delete(matchTick);
    const events = stepMatch(this.match, frame);
    this.emitEvents(events);
    this.recordLocalCheckpointIfNeeded();
    this.compareExpectedHash(this.match.matchTick);
    this.markFinishedIfNeeded();
    return events;
  }

  runOneTick() {
    if (this.disposed || this.match.status !== "playing") return [];
    return this.role === "host" ? this.runHostTick() : this.runClientTick();
  }

  sendHashCheckpointIfNeeded() {
    const finished = this.match.status !== "playing";
    if (!finished && this.match.matchTick % this.hashIntervalTicks !== 0) return;
    const hash = hashMatch(this.match);
    if (this.sendSequenced("match-hash", { hash }, this.match.matchTick)) {
      this.counters.hashesSent += 1;
    }
  }

  recordLocalCheckpointIfNeeded() {
    const finished = this.match.status !== "playing";
    if (!finished && this.match.matchTick % this.hashIntervalTicks !== 0) return;
    this.localCheckpointHashes.set(this.match.matchTick, hashMatch(this.match));
    while (this.localCheckpointHashes.size > MAX_CHECKPOINT_HISTORY) {
      this.localCheckpointHashes.delete(this.localCheckpointHashes.keys().next().value);
    }
  }

  compareExpectedHash(matchTick) {
    const expected = this.expectedHashes.get(matchTick);
    if (!expected) return;
    const actual = this.localCheckpointHashes.get(matchTick)
      || (this.match.matchTick === matchTick ? hashMatch(this.match) : null);
    if (actual === null) return;

    this.expectedHashes.delete(matchTick);
    if (actual === expected) return;
    this.counters.hashMismatches += 1;
    this.requestResync();
  }

  requestResync() {
    if (this.role !== "client" || this.resyncPending || this.disposed) return false;
    this.resyncPending = true;
    const message = createMessage("resync-request", { playerId: this.localPlayerId });
    if (!this.sendMessage(message)) return false;
    this.counters.resyncRequestsSent += 1;
    return true;
  }

  receive(message, sourcePlayerId = null) {
    if (this.disposed) return;
    if (this.match.status !== "playing" && !this.canReceiveAfterMatchEnd(message)) return;
    try {
      let validator = this.incomingValidator;
      if (this.role === "host" && PLAYER_ROUTED_MESSAGE_TYPES.has(message?.type)) {
        const routedPlayerId = sourcePlayerId ?? (
          this.remotePlayerIds.length === 1 ? this.remotePlayerIds[0] : null
        );
        if (!this.incomingValidatorsByPlayer.has(routedPlayerId)) {
          throw new Error("network match transport must identify a remote source player");
        }
        if (message.payload.playerId !== routedPlayerId) {
          throw new Error(`Protocol ${message.type} playerId does not match the transport source player`);
        }
        validator = this.incomingValidatorsByPlayer.get(routedPlayerId);
      }
      const validated = validator.validate(message);
      this.counters.messagesReceived += 1;
      this.handleValidatedMessage(validated);
    } catch (error) {
      this.counters.protocolErrors += 1;
      this.fail(error, "protocol-error");
    }
  }

  canReceiveAfterMatchEnd(message) {
    if (this.role === "client") {
      if (this.resyncPending && message?.type === "match-snapshot") return true;
      return message?.type === "match-hash" && message.matchTick === this.match.matchTick;
    }
    return message?.type === "resync-request";
  }

  handleValidatedMessage(message) {
    switch (message.type) {
      case "input":
        this.handleInput(message);
        break;
      case "input-frame":
        this.handleInputFrame(message);
        break;
      case "match-hash":
        this.handleMatchHash(message);
        break;
      case "match-snapshot":
        this.handleMatchSnapshot(message);
        break;
      case "resync-request":
        this.handleResyncRequest(message);
        break;
      case "leave":
        this.handleLeave(message);
        break;
      case "ping":
        this.sendMessage(createMessage("pong", { nonce: message.payload.nonce }));
        break;
      case "pong":
        break;
      case "hello":
      case "ready":
      case "match-start":
        throw new Error(`Protocol ${message.type} is not valid after a network match has started`);
      default:
        throw new Error(`Unsupported network match message: ${String(message.type)}`);
    }
  }

  requireRole(expectedRole, messageType) {
    if (this.role !== expectedRole) {
      throw new Error(`Protocol ${messageType} is not valid for network match role ${this.role}`);
    }
  }

  handleInput(message) {
    this.requireRole("host", "input");
    const { playerId } = message.payload;
    if (!this.remotePlayerIds.includes(playerId)) {
      throw new Error("Protocol input must come from a remote player");
    }
    if (message.matchTick < this.match.matchTick) {
      this.counters.staleInputsDropped += 1;
      return;
    }
    if (message.matchTick > this.match.matchTick + this.inputDelayTicks) {
      throw new Error("Protocol input matchTick exceeds the negotiated input-delay window");
    }
    let inputsByPlayer = this.remoteInputsByTick.get(message.matchTick);
    if (!inputsByPlayer) {
      inputsByPlayer = new Map();
      this.remoteInputsByTick.set(message.matchTick, inputsByPlayer);
    }
    if (inputsByPlayer.has(playerId)) {
      throw new Error(`Protocol input already exists for player ${playerId} at match tick ${message.matchTick}`);
    }
    inputsByPlayer.set(playerId, cloneCommands(message.payload.commands));
    this.counters.inputsReceived += 1;
  }

  handleInputFrame(message) {
    this.requireRole("client", "input-frame");
    if (message.matchTick < this.match.matchTick) {
      throw new Error("Protocol input-frame matchTick is stale for the current match");
    }
    if (message.matchTick > this.match.matchTick + this.maxBufferedFutureTicks) {
      throw new Error("Protocol input-frame exceeds the buffered future-tick limit");
    }
    if (this.authoritativeFrames.has(message.matchTick)) {
      throw new Error(`Protocol input-frame already exists for match tick ${message.matchTick}`);
    }
    const commandsByPlayer = commandsForRoster(
      this.playerIds,
      (playerId) => message.payload.commandsByPlayer[playerId]
    );
    this.authoritativeFrames.set(message.matchTick, commandsByPlayer);
    this.latestAuthoritativeFrameTick = Math.max(this.latestAuthoritativeFrameTick, message.matchTick);
    this.counters.framesReceived += 1;
  }

  handleMatchHash(message) {
    this.requireRole("client", "match-hash");
    if (message.matchTick < this.match.matchTick) {
      throw new Error("Protocol match-hash matchTick is stale for the current match");
    }
    if (message.matchTick > this.match.matchTick + this.maxBufferedFutureTicks) {
      throw new Error("Protocol match-hash exceeds the buffered future-tick limit");
    }
    this.counters.hashesReceived += 1;
    this.expectedHashes.set(message.matchTick, message.payload.hash);
    this.compareExpectedHash(message.matchTick);
  }

  handleResyncRequest(message) {
    this.requireRole("host", "resync-request");
    if (!this.remotePlayerIds.includes(message.payload.playerId)) {
      throw new Error("Protocol resync-request must come from a remote player");
    }
    this.counters.resyncRequestsReceived += 1;
    const snapshot = snapshotMatch(this.match);
    if (this.sendSequenced("match-snapshot", { snapshot }, snapshot.matchTick)) {
      this.counters.snapshotsSent += 1;
    }
  }

  handleMatchSnapshot(message) {
    this.requireRole("client", "match-snapshot");
    const { snapshot } = message.payload;
    if (snapshot.matchId !== this.match.id) throw new Error("Protocol match-snapshot changed the match id");
    if (snapshot.seed !== this.match.seed) throw new Error("Protocol match-snapshot changed the match seed");
    if (snapshot.matchTick < this.match.matchTick) {
      throw new Error("Protocol match-snapshot cannot rewind the client match");
    }

    const restored = restoreMatch(snapshot, { rules: this.rules, policy: this.policy });
    const shouldResume = this.resumeAfterTerminalResync && restored.status === "playing";
    this.resumeAfterTerminalResync = false;
    this.match = restored;
    if (restored.status === "playing") this.stopReason = null;
    for (const matchTick of this.authoritativeFrames.keys()) {
      if (matchTick < restored.matchTick) this.authoritativeFrames.delete(matchTick);
    }
    for (const matchTick of this.expectedHashes.keys()) {
      if (matchTick <= restored.matchTick) this.expectedHashes.delete(matchTick);
    }
    this.localCheckpointHashes.clear();
    this.resyncPending = false;
    this.counters.snapshotsApplied += 1;
    this.emitFrame(0);
    this.markFinishedIfNeeded();
    if (shouldResume) {
      this.running = true;
      this.lastTime = null;
    }
    if (this.running && this.match.status === "playing" && this.frameHandle == null
        && typeof requestAnimationFrame === "function") {
      this.lastTime = null;
      this.frameHandle = requestAnimationFrame(this.boundFrame);
    }
  }

  handleLeave(message) {
    if (!this.remotePlayerIds.includes(message.payload.playerId)) {
      throw new Error("Protocol leave must come from a remote player");
    }
    this.stop("peer-left");
  }

  handleTransportState(state) {
    if (this.disposed) return;
    this.transportState = String(state);
    this.onConnectionStateChange(this.transportState, this.connectionStats);
    if (TERMINAL_TRANSPORT_STATES.has(this.transportState)) {
      this.stop(`transport-${this.transportState}`);
    }
  }

  emitEvents(events) {
    if (events.length > 0) this.onEvents(events, this.match);
  }

  emitFrame(interpolation) {
    this.onFrame(this.localView, {
      opponentViews: this.opponentViews,
      matchResult: this.match.result,
      matchStatus: this.match.status,
      interpolation,
      connectionStats: this.connectionStats
    });
  }

  markFinishedIfNeeded() {
    if (this.match.status === "playing") return;
    if (this.resyncPending) return;
    if (this.running) this.resumeAfterTerminalResync = true;
    this.stopReason = "finished";
    this.running = false;
    if (this.frameHandle != null && typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(this.frameHandle);
    }
    this.frameHandle = null;
  }

  frame(timeMs) {
    if (!this.running || this.disposed) return;
    if (this.lastTime == null) this.lastTime = timeMs;
    const elapsed = Math.min(MAX_FRAME_ELAPSED_SECONDS, Math.max(0, (timeMs - this.lastTime) / 1000));
    this.lastTime = timeMs;
    this.accumulator += elapsed;

    let steps = 0;
    while (this.match.status === "playing" && steps < MAX_STEPS_PER_FRAME) {
      const hasElapsedStep = this.accumulator >= this.stepSeconds;
      const canCatchUpBufferedFrame = this.role === "client"
        && this.authoritativeFrames.size > 1
        && this.authoritativeFrames.has(this.match.matchTick);
      if (!hasElapsedStep && !canCatchUpBufferedFrame) break;

      const beforeTick = this.match.matchTick;
      this.runOneTick();
      if (this.match.matchTick === beforeTick) break;
      if (hasElapsedStep) this.accumulator -= this.stepSeconds;
      steps += 1;
    }

    this.emitFrame(Math.min(1, this.accumulator / this.stepSeconds));
    if (this.running && this.match.status === "playing") {
      this.frameHandle = requestAnimationFrame(this.boundFrame);
    } else {
      this.frameHandle = null;
    }
  }

  start() {
    if (this.running || this.disposed || this.match.status !== "playing") return false;
    if (typeof requestAnimationFrame !== "function") {
      throw new Error("requestAnimationFrame is required to start a network match runtime");
    }
    this.running = true;
    this.lastTime = null;
    this.frameHandle = requestAnimationFrame(this.boundFrame);
    return true;
  }

  leave() {
    if (this.disposed) return;
    this.sendSequenced("leave", { playerId: this.localPlayerId });
    this.stop("local-left");
  }

  fail(error, reason) {
    try {
      this.onError(error);
    } finally {
      this.stop(reason);
    }
  }

  stop(reason = "stopped") {
    if (this.disposed) return;
    this.disposed = true;
    this.running = false;
    this.stopReason = reason;
    if (this.frameHandle != null && typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(this.frameHandle);
    }
    this.frameHandle = null;
    this.removeMessageHandler();
    this.removeStateHandler();
    try {
      this.transport.close?.();
    } finally {
      this.onStop(reason, this.connectionStats);
    }
  }
}