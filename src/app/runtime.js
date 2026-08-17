import { createGameView, hashGameState, stepGame } from "../domain/game.js";

export class GameRuntime {
  constructor({ game, rules, onFrame = () => {}, onEvents = () => {} }) {
    this.game = game;
    this.rules = rules;
    this.onFrame = onFrame;
    this.onEvents = onEvents;
    this.stepSeconds = 1 / rules.simulation.ticksPerSecond;
    this.accumulator = 0;
    this.lastTime = null;
    this.pendingCommands = [];
    this.commandLog = [];
    this.running = false;
    this.frameHandle = null;
    this.boundFrame = (time) => this.frame(time);
  }

  command(command) {
    this.pendingCommands.push({ ...command });
  }

  runOneTick() {
    const commands = this.pendingCommands;
    this.pendingCommands = [];
    for (const command of commands) {
      this.commandLog.push({
        tick: this.game.simulationTick,
        ...command
      });
    }
    const events = stepGame(this.game, commands, this.rules);
    if (events.length > 0) this.onEvents(events, this.game);
    return events;
  }

  frame(timeMs) {
    if (!this.running) return;
    if (this.lastTime == null) this.lastTime = timeMs;
    const elapsed = Math.min(0.25, Math.max(0, (timeMs - this.lastTime) / 1000));
    this.lastTime = timeMs;
    this.accumulator += elapsed;

    while (this.accumulator >= this.stepSeconds) {
      this.runOneTick();
      this.accumulator -= this.stepSeconds;
    }

    this.onFrame(createGameView(this.game), {
      interpolation: this.accumulator / this.stepSeconds,
      stateHash: hashGameState(this.game)
    });
    if (this.game.status === "playing") {
      this.frameHandle = requestAnimationFrame(this.boundFrame);
    } else {
      this.running = false;
      this.frameHandle = null;
    }
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.lastTime = null;
    this.frameHandle = requestAnimationFrame(this.boundFrame);
  }

  stop() {
    this.running = false;
    if (this.frameHandle != null) cancelAnimationFrame(this.frameHandle);
    this.frameHandle = null;
  }

  exportReplay(seed) {
    return {
      version: 1,
      rulesetId: this.rules.id,
      seed,
      commands: this.commandLog.map((command) => ({ ...command }))
    };
  }
}
