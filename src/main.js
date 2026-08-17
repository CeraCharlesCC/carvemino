import { GameRuntime } from "./app/runtime.js";
import { createGame, createGameView } from "./domain/game.js";
import { createRules } from "./domain/rules.js";
import { createUi } from "./ui/ui.js";

const rules = createRules();
let runtime = null;
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

const ui = createUi({
  rules,
  sendCommand(command) {
    if (runtime) runtime.command(command);
  },
  restart() {
    startGame();
  }
});

function startGame() {
  if (runtime) runtime.stop();
  seed = freshSeed();
  const game = createGame({ seed, rules });
  runtime = new GameRuntime({
    game,
    rules,
    onFrame(view) {
      ui.render(view);
    }
  });
  ui.render(createGameView(game));
  runtime.start();
}

startGame();