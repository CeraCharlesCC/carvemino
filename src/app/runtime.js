export class GameRuntime {
  constructor({ session, onFrame = () => {}, onEvents = () => {} }) {
    if (!session) throw new Error("game session is required");
    this.session = session;
    this.game = session.game;
    this.onFrame = onFrame;
    this.onEvents = onEvents;
    this.stepSeconds = 1 / session.engine.stepsPerSecond;
    this.accumulator = 0;
    this.lastTime = null;
    this.pendingCommands = [];
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
    const beforeView = this.session.view();
    const events = this.session.step(commands);
    if (events.length > 0) {
      this.onEvents(events, this.game, Object.freeze({
        beforeView,
        afterView: this.session.view()
      }));
    }
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

    this.onFrame(this.session.view(), {
      interpolation: this.accumulator / this.stepSeconds
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

  exportReplay() {
    return this.session.exportReplay();
  }
}
