import { cancelIncomingGarbage, queueGarbage } from "./game/garbage.js";
import { getEditableFillCells } from "./game/sculpt.js";
import { stepGameState } from "./game/simulation.js";
import {
  assertGameState,
  createGameState,
  createGameViewState,
  hashGameState,
  restoreGameState,
  snapshotGameState
} from "./game/state.js";

function assertRules(rules) {
  if (!rules || typeof rules !== "object") throw new Error("rules are required");
  if (typeof rules.id !== "string" || rules.id.trim() === "") {
    throw new Error("rules.id must be a non-empty string");
  }
}

function assertBoundState(state, rulesetId) {
  if (!state || typeof state !== "object") throw new Error("game state is required");
  if (state.rulesetId !== rulesetId) {
    throw new Error(
      `Game state ruleset mismatch: expected ${rulesetId}, received ${String(state.rulesetId)}`
    );
  }
}

export function createGameEngine(rules) {
  assertRules(rules);
  const rulesetId = rules.id;
  const boundStates = new WeakSet();

  function bind(state) {
    assertBoundState(state, rulesetId);
    if (!boundStates.has(state)) {
      throw new Error(`Game state is not bound to engine ${rulesetId}`);
    }
    return state;
  }

  const engine = {
    rulesetId,
    stepsPerSecond: rules.simulation.stepsPerSecond,

    create({ seed = 1 } = {}) {
      const state = createGameState({ seed, rules });
      boundStates.add(state);
      return state;
    },

    step(state, commands = []) {
      return stepGameState(bind(state), commands, rules);
    },

    view(state) {
      return createGameViewState(bind(state), rules);
    },

    snapshot(state) {
      return snapshotGameState(bind(state));
    },

    restore(snapshot) {
      if (!snapshot || typeof snapshot !== "object") {
        throw new Error("game snapshot must be an object");
      }
      if (snapshot.rulesetId !== rulesetId) {
        throw new Error(
          `Game snapshot ruleset mismatch: expected ${rulesetId}, received ${String(snapshot.rulesetId)}`
        );
      }
      const state = restoreGameState(snapshot, rules);
      boundStates.add(state);
      return bind(state);
    },

    hash(state) {
      return hashGameState(bind(state));
    },

    assert(state) {
      assertGameState(bind(state));
      return true;
    },

    getEditableFillCells(state, pieceId) {
      return getEditableFillCells(bind(state), pieceId);
    },

    queueGarbage(state, packet) {
      return queueGarbage(bind(state), packet);
    },

    cancelIncomingGarbage(state, rows) {
      return cancelIncomingGarbage(bind(state), rows);
    }
  };

  return Object.freeze(engine);
}

/**
 * Owns one ruleset-bound game state together with the command log used for replay.
 *
 * Commands are recorded against the current simulation tick before the engine
 * advances, so exporting and replaying the log reproduces the same fixed-step
 * command timing.
 */
class GameSession {
  constructor({ rules, seed = 1 } = {}) {
    this.engine = createGameEngine(rules);
    this.seed = seed >>> 0;
    this.game = this.engine.create({ seed: this.seed });
    this.commandLog = [];
  }

  get rulesetId() {
    return this.engine.rulesetId;
  }

  step(commands = []) {
    const acceptedCommands = commands || [];
    for (const command of acceptedCommands) {
      this.commandLog.push({
        stepTick: this.game.stepTick,
        ...command
      });
    }
    return this.engine.step(this.game, acceptedCommands);
  }

  view() {
    return this.engine.view(this.game);
  }

  snapshot() {
    return this.engine.snapshot(this.game);
  }

  hash() {
    return this.engine.hash(this.game);
  }

  exportReplay() {
    return {
      version: 2,
      rulesetId: this.rulesetId,
      seed: this.seed,
      commands: this.commandLog.map((command) => ({ ...command }))
    };
  }
}

/**
 * Creates a deterministic game session and its replay log.
 * @param {object} options
 * @param {object} options.rules Rules used to bind the game engine.
 * @param {number} [options.seed] Unsigned seed for deterministic game creation.
 * @returns {GameSession}
 */
export function createGameSession(options) {
  return new GameSession(options);
}
