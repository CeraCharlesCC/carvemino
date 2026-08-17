import { createProfileStore } from "./app/profile.js";
import { GameRuntime } from "./app/runtime.js";
import { createGame, createGameView } from "./domain/game.js";
import { createRulesForMode } from "./domain/rules.js";
import { createUi } from "./ui/ui.js";

const profile = createProfileStore();

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
  activeModeId = modeId;
  rules = createRulesForMode(modeId);
  seed = freshSeed();
  const game = createGame({ seed, rules });

  ui.setGameMode(rules);
  runtime = new GameRuntime({
    game,
    rules,
    onEvents(events, gameState) {
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
  sendCommand(command) {
    if (runtime) runtime.command(command);
  },
  restart() {
    startGame();
  },
  startMode(modeId) {
    startGame(modeId);
  },
  quitGame() {
    stopGame();
  },
  pauseGame() {
    if (runtime) runtime.stop();
  },
  resumeGame() {
    if (runtime) runtime.start();
  },
  changeKeybinding(action, code) {
    profile.setKeybinding(action, code);
    return profile.getSnapshot();
  },
  resetKeybindings() {
    profile.resetKeybindings();
    return profile.getSnapshot();
  }
});

ui.setProfile(profile.getSnapshot());
ui.showScreen("menu");
