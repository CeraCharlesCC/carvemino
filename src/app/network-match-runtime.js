import {
  PROTOCOL_LIMITS,
  createMessage,
  createProtocolStreamValidator,
  validateGameplayCommand,
  validateMessage
} from "./protocol.js";
import {
  getPlayerGame,
  hashMatch,
  restoreMatch,
  snapshotMatch,
  stepMatch
} from "../domain/match.js";

const NETWORK_ROLES = new Set(["host", "client"]);
const TERMINAL_TRANSPORT_STATES = new Set(["closed", "failed", "disconnected"]);
const DEFAULT_INPUT_DELAY_TICKS = 3;
const DEFAULT_HASH_INTERVAL_TICKS = 60;
const MAX_CHECKPOINT_HISTORY = 8;
const MAX_STEPS_PER_FRAME = 30;

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
    remotePlayerId,
    transport,
    inputDelayTicks = DEFAULT_INPUT_DELAY_TICKS,
    hashIntervalTicks = DEFAULT_HASH_INTERVAL_TICKS,
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
    assertFunction(onFrame, "onFrame");
    assertFunction(onEvents, "onEvents");
    assertFunction(onConnectionStateChange, "onConnectionStateChange");
    assertFunction(onStop, "onStop");
    assertFunction(onError, "onError");

    const playerIds = match.players?.map((player) => player.id) || [];
    if (playerIds.length !== 2 || new Set(playerIds).size !== 2) {
      throw new Error("network match requires exactly two unique players");
    }
    if (!playerIds.includes(localPlayerId)) throw new Error("localPlayerId is not in the match roster");
    if (!playerIds.includes(remotePlayerId)) throw new Error("remotePlayerId is not in the match roster");
    if (localPlayerId === remotePlayerId) throw new Error("localPlayerId and remotePlayerId must differ");
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
    this.remotePlayerId = remotePlayerId;
    this.playerIds = Object.freeze([...playerIds]);
    this.transport = transport;
    this.inputDelayTicks = inputDelayTicks;
    this.hashIntervalTicks = hashIntervalTicks;
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
    this.localInputsByTick = new Map();
    this.remoteInputsByTick = new Map();
    this.authoritativeFrames = new Map();
    this.expectedHashes = new Map();
    this.localCheckpointHashes = new Map();
    this.resyncPending = false;

    this.nextSequence = 0;
    this.running = false;
    this.disposed = false;
    this.frameHandle = null;
    this.stopReason = match.status === "playing" ? null : "finished";
    this.transportState = "open";
    this.boundFrame = (time) => this.frame(time);
    this.incomingValidator = createProtocolStreamValidator({ playerIds: this.playerIds });

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
      transport.onMessage((message) => this.receive(message))
    );
    this.removeStateHandler = normalizeUnsubscribe(
      transport.onStateChange((state) => this.handleTransportState(state))
    );
  }

  get localView() {
    return this.match.engine.view(getPlayerGame(this.match, this.localPlayerId));
  }

  get opponentView() {
    return this.match.engine.view(getPlayerGame(this.match, this.remotePlayerId));
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
      bufferedRemoteInputs: this.remoteInputsByTick.size,
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
    validateMessage(message, { playerIds: this.playerIds });
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
    const requestedTick = this.match.matchTick + this.inputDelayTicks;
    if (requestedTick > PROTOCOL_LIMITS.maxMatchTick) {
      this.fail(new Error("network match input tick exceeds the protocol limit"), "protocol-limit");
      return false;
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
      this.counters.inputsSent += 1;
    }

    this.pendingCommands = [];
    this.lastLocalSubmissionSourceTick = this.match.matchTick;
    return true;
  }

  runHostTick() {
    if (!this.scheduleLocalCommands()) return [];
    const matchTick = this.match.matchTick;
    const commandsByPlayer = commandsForRoster(this.playerIds, (playerId) => {
      if (playerId === this.localPlayerId) return this.localInputsByTick.get(matchTick) || [];
      return this.remoteInputsByTick.get(matchTick) || [];
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

  receive(message) {
    if (this.disposed) return;
    try {
      const validated = this.incomingValidator.validate(message);
      this.counters.messagesReceived += 1;
      this.handleValidatedMessage(validated);
    } catch (error) {
      this.counters.protocolErrors += 1;
      this.fail(error, "protocol-error");
    }
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
      case "hello":
      case "ready":
      case "match-start":
        break;
      case "attack":
      case "game-over":
      case "snapshot":
      case "state-hash":
        throw new Error(`Protocol ${message.type} is not authoritative in a network match`);
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
    if (message.payload.playerId !== this.remotePlayerId) {
      throw new Error("Protocol input must come from the remote player");
    }
    if (message.matchTick < this.match.matchTick) {
      this.counters.staleInputsDropped += 1;
      return;
    }
    if (message.matchTick > this.match.matchTick + this.inputDelayTicks) {
      throw new Error("Protocol input matchTick exceeds the negotiated input-delay window");
    }
    if (this.remoteInputsByTick.has(message.matchTick)) {
      throw new Error(`Protocol input already exists for match tick ${message.matchTick}`);
    }
    this.remoteInputsByTick.set(message.matchTick, cloneCommands(message.payload.commands));
    this.counters.inputsReceived += 1;
  }

  handleInputFrame(message) {
    this.requireRole("client", "input-frame");
    if (message.matchTick < this.match.matchTick) return;
    if (this.authoritativeFrames.has(message.matchTick)) {
      throw new Error(`Protocol input-frame already exists for match tick ${message.matchTick}`);
    }
    const commandsByPlayer = commandsForRoster(
      this.playerIds,
      (playerId) => message.payload.commandsByPlayer[playerId]
    );
    this.authoritativeFrames.set(message.matchTick, commandsByPlayer);
    this.counters.framesReceived += 1;
  }

  handleMatchHash(message) {
    this.requireRole("client", "match-hash");
    this.counters.hashesReceived += 1;
    this.expectedHashes.set(message.matchTick, message.payload.hash);
    this.compareExpectedHash(message.matchTick);
    if (message.matchTick < this.match.matchTick && this.expectedHashes.has(message.matchTick)) {
      this.requestResync();
    }
  }

  handleResyncRequest(message) {
    this.requireRole("host", "resync-request");
    if (message.payload.playerId !== this.remotePlayerId) {
      throw new Error("Protocol resync-request must come from the remote player");
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
    this.match = restored;
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
  }

  handleLeave(message) {
    if (message.payload.playerId !== this.remotePlayerId) {
      throw new Error("Protocol leave must come from the remote player");
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
      opponentView: this.opponentView,
      matchResult: this.match.result,
      matchStatus: this.match.status,
      interpolation,
      connectionStats: this.connectionStats
    });
  }

  markFinishedIfNeeded() {
    if (this.match.status === "playing") return;
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
    const elapsed = Math.min(0.25, Math.max(0, (timeMs - this.lastTime) / 1000));
    this.lastTime = timeMs;
    this.accumulator += elapsed;

    let steps = 0;
    while (
      this.accumulator >= this.stepSeconds
      && this.match.status === "playing"
      && steps < MAX_STEPS_PER_FRAME
    ) {
      const beforeTick = this.match.matchTick;
      this.runOneTick();
      if (this.match.matchTick === beforeTick) break;
      this.accumulator -= this.stepSeconds;
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
    this.onStop(reason, this.connectionStats);
  }
}