import { createProfileStore } from "./app/profile.js";
import { SINGLEPLAYER_CATALOG, getSingleplayerMode } from "./app/catalog.js";
import { GameRuntime } from "./app/runtime.js";
import { createAudioEngine } from "./audio/engine.js";
import { createGame, createGameView } from "./domain/game.js";
import { createUi } from "./ui/ui.js";

const profile = createProfileStore();
const audio = createAudioEngine();
audio.setSettings(profile.getSnapshot().settings.audio);

let runtime = null;
let rules = null;
let activeModeId = null;
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

function stopGame() {
  if (runtime) runtime.stop();
  runtime = null;
}

function startGame(modeId = activeModeId) {
  if (!modeId) return;
  stopGame();
  const mode = getSingleplayerMode(modeId);
  activeModeId = mode.id;
  rules = mode.rules;
  seed = freshSeed();
  const game = createGame({ seed, rules });
  audio.startGame({ modeId: mode.id, level: game.level });

  ui.setGameMode(mode);
  runtime = new GameRuntime({
    game,
    rules,
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
  ui.render(createGameView(game));
  runtime.start();
}

const ui = createUi({
  modes: SINGLEPLAYER_CATALOG,
  sendCommand(command) {
    if (runtime) runtime.command(command);
  },
  restart() {
    startGame();
  },
  startMode(modeId) {
    startGame(modeId);
  },
  onAudioEvent(type) {
    audio.handleUiEvent(type);
  },
  onScreenChange(screenName) {
    audio.setScreen(screenName);
  },
  quitGame() {
    stopGame();
  },
  pauseGame() {
    if (runtime) runtime.stop();
    audio.pauseGame();
  },
  resumeGame() {
    if (runtime) runtime.start();
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

window.addEventListener("pagehide", () => audio.dispose(), { once: true });
