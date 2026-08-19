import { SINGLEPLAYER_CATALOG, getSingleplayerMode } from "./app/catalog.js";
import { LanSession } from "./app/lan-session.js";
import { LAN_MULTIPLAYER_CATALOG } from "./app/multiplayer-catalog.js";
import { NetworkMatchRuntime } from "./app/network-match-runtime.js";
import { createProfileStore } from "./app/profile.js";
import { GameRuntime } from "./app/runtime.js";
import { createAudioEngine } from "./audio/engine.js";
import { createGameSession } from "./domain/game.js";
import { getPlayerGame } from "./domain/match.js";
import { createUi } from "./ui/ui.js";

const profile = createProfileStore();
const audio = createAudioEngine();
audio.setSettings(profile.getSnapshot().settings.audio);

let ui = null;
let runtime = null;
let runtimeKind = null;
let activeModeId = null;
let networkQuitInProgress = false;
let seed = 1;

function freshSeed() {
  if (globalThis.crypto && globalThis.crypto.getRandomValues) {
    const values = new Uint32Array(1);
    globalThis.crypto.getRandomValues(values);
    return values[0] || 1;
  }
  seed = (seed + 1) >>> 0 || 1;
  return seed;
}

function stopSingleplayer() {
  if (runtimeKind === "singleplayer" && runtime) runtime.stop();
  runtime = null;
  runtimeKind = null;
}

function startGame(modeId = activeModeId) {
  if (!modeId) return;
  if (runtimeKind === "network") quitNetworkGame();
  else stopSingleplayer();

  const mode = getSingleplayerMode(modeId);
  activeModeId = mode.id;
  seed = freshSeed();
  const session = createGameSession({ seed, rules: mode.rules });
  audio.startGame({ modeId: mode.id, level: session.game.level });

  ui.setGameMode(mode.id, { kind: "singleplayer" });
  runtimeKind = "singleplayer";
  runtime = new GameRuntime({
    session,
    onEvents(events, gameState) {
      audio.handleGameEvents(events, gameState);
      const result = profile.processGameEvents(activeModeId, events, gameState.score);
      if (result.highScoreChanged || result.unlocked.length > 0) {
        ui.setProfile(profile.getSnapshot());
      }
    },
    onFrame(view) {
      ui.render(view);
    }
  });
  ui.render(session.view());
  runtime.start();
}

function localAudioEvents(events, localPlayerId) {
  const local = events.filter((event) => (
    event.playerId === localPlayerId
    || (event.type === "GARBAGE_SENT" && event.sourcePlayerId === localPlayerId)
  ));
  if (events.some((event) => event.type === "MATCH_FINISHED")
      && !local.some((event) => event.type === "GAME_OVER")) {
    local.push({ type: "GAME_OVER" });
  }
  return local;
}

function describeNetworkStop(reason) {
  if (reason === "peer-left") return "PLAYER 2 LEFT THE MATCH.";
  if (String(reason).startsWith("transport-")) return "LAN LINK WAS LOST.";
  if (reason === "protocol-error") return "LAN SESSION ENDED AFTER INVALID PEER DATA.";
  return "LAN MATCH ENDED.";
}

function startNetworkMatch(context) {
  if (runtimeKind === "singleplayer") stopSingleplayer();
  const { role, mode, match, localPlayerId, remotePlayerId, transport } = context;
  activeModeId = mode.id;
  audio.startGame({ modeId: mode.id, level: getPlayerGame(match, localPlayerId).level });
  ui.setGameMode(mode.id, { kind: "multiplayer", localPlayerId });
  ui.setLanNotice("");

  let networkRuntime = null;
  networkRuntime = new NetworkMatchRuntime({
    match,
    rules: mode.rules,
    policy: mode.policy,
    role,
    localPlayerId,
    remotePlayerId,
    transport,
    onEvents(events, currentMatch) {
      ui.handleMatchEvents(events);
      const localGame = getPlayerGame(currentMatch, localPlayerId);
      audio.handleGameEvents(localAudioEvents(events, localPlayerId), localGame);
      if (currentMatch.status === "finished") lanSession.markFinished();
    },
    onFrame(view, meta) {
      ui.renderNetwork(view, meta);
      if (meta.matchStatus === "finished") lanSession.markFinished();
    },
    onStop(reason) {
      if (runtime === networkRuntime) {
        runtime = null;
        runtimeKind = null;
      }
      if (networkQuitInProgress || reason === "local-left") return;
      ui.setLanNotice(describeNetworkStop(reason));
      lanSession.reset();
      ui.showScreen("lan");
    },
    onError(error) {
      console.error("LAN match runtime failed", error);
    }
  });

  runtime = networkRuntime;
  runtimeKind = "network";
  ui.renderNetwork(networkRuntime.localView, {
    opponentView: networkRuntime.opponentView,
    matchResult: networkRuntime.result,
    matchStatus: networkRuntime.match.status,
    interpolation: 0,
    connectionStats: networkRuntime.connectionStats
  });
  ui.showScreen("game");
  networkRuntime.start();
}

const lanSession = new LanSession({
  modes: LAN_MULTIPLAYER_CATALOG,
  onStateChange(snapshot) {
    ui?.setLanSessionState(snapshot);
  },
  onMatchReady(context) {
    startNetworkMatch(context);
  },
  onError(error, snapshot) {
    if (networkQuitInProgress) return;
    if (snapshot.state === "disconnected") ui?.setLanNotice(error.message);
  }
});

function quitNetworkGame() {
  if (runtimeKind !== "network") {
    lanSession.reset();
    return;
  }
  const current = runtime;
  runtime = null;
  runtimeKind = null;
  networkQuitInProgress = true;
  try {
    if (current && !current.disposed) current.leave();
    lanSession.reset();
  } finally {
    networkQuitInProgress = false;
  }
}

function quitGame() {
  if (runtimeKind === "network") quitNetworkGame();
  else stopSingleplayer();
}

ui = createUi({
  modes: SINGLEPLAYER_CATALOG.map(({ id, name, description }) => ({ id, name, description })),
  lanModes: LAN_MULTIPLAYER_CATALOG.map(({ id, name, description }) => ({ id, name, description })),
  sendCommand(command) {
    if (runtime) runtime.command(command);
  },
  restart() {
    if (runtimeKind !== "network") startGame();
  },
  startMode(modeId) {
    startGame(modeId);
  },
  async createHostInvite(modeId) {
    ui.setLanNotice("");
    return lanSession.startHost(modeId);
  },
  async acceptHostAnswer(answerText) {
    return lanSession.acceptHostAnswer(answerText);
  },
  async createJoinAnswer(offerText) {
    ui.setLanNotice("");
    return lanSession.startJoin(offerText);
  },
  async startHostMatch() {
    return lanSession.startHostMatch();
  },
  cancelLanSession() {
    if (runtimeKind !== "network") lanSession.cancel();
  },
  onAudioEvent(type) {
    audio.handleUiEvent(type);
  },
  onScreenChange(screenName) {
    audio.setScreen(screenName);
  },
  quitGame,
  pauseGame() {
    if (runtimeKind === "singleplayer" && runtime) runtime.stop();
    audio.pauseGame();
  },
  resumeGame() {
    if (runtimeKind === "singleplayer" && runtime) runtime.start();
    audio.resumeGame();
  },
  changeKeybinding(action, code) {
    profile.setKeybinding(action, code);
    return profile.getSnapshot();
  },
  resetKeybindings() {
    profile.resetKeybindings();
    return profile.getSnapshot();
  },
  changeAudioSetting(setting, value) {
    if (!profile.setAudioSetting(setting, value)) return null;
    const snapshot = profile.getSnapshot();
    audio.setSettings(snapshot.settings.audio);
    return snapshot;
  }
});

ui.setProfile(profile.getSnapshot());
ui.showScreen("menu");

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register(new URL("../sw.js", import.meta.url)).catch((error) => {
      console.warn("Carvemino service worker registration failed:", error);
    });
  }, { once: true });
}

window.addEventListener("pagehide", () => {
  networkQuitInProgress = true;
  try {
    if (runtimeKind === "network" && runtime && !runtime.disposed) runtime.leave();
    else if (runtimeKind === "singleplayer" && runtime) runtime.stop();
    lanSession.reset();
    audio.dispose();
  } finally {
    runtime = null;
    runtimeKind = null;
  }
}, { once: true });
