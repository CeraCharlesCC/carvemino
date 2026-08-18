import { createGameEngine } from "./game.js";
import { mix32, playerById } from "./match/policy-utils.js";

const POLICY_HOOKS = Object.freeze([
  "validatePlayerIds",
  "createState",
  "beforeStep",
  "onGameEvent",
  "afterStep"
]);

function assertPolicy(policy) {
  if (!policy || typeof policy !== "object") throw new Error("match policy is required");
  if (typeof policy.id !== "string" || policy.id.trim() === "") {
    throw new Error("match policy id must be a non-empty string");
  }
  for (const hook of POLICY_HOOKS) {
    if (typeof policy[hook] !== "function") throw new Error(`match policy.${hook} must be a function`);
  }
}

export function createMatch({
  id = "match-1",
  playerIds,
  seed = 1,
  rules,
  policy
}) {
  if (!rules) throw new Error("rules are required");
  assertPolicy(policy);
  if (!Array.isArray(playerIds) || playerIds.length === 0) {
    throw new Error("playerIds must contain at least one player");
  }
  const normalizedPlayerIds = playerIds.map(String);
  if (new Set(normalizedPlayerIds).size !== normalizedPlayerIds.length) {
    throw new Error("playerIds must be unique");
  }
  policy.validatePlayerIds(normalizedPlayerIds);
  const engine = createGameEngine(rules);

  return {
    version: 2,
    id,
    seed: seed >>> 0,
    matchTick: 0,
    engine,
    rulesetId: engine.rulesetId,
    policy,
    policyId: policy.id,
    policyState: policy.createState(),
    status: "playing",
    result: null,
    players: normalizedPlayerIds.map((playerId, index) => ({
      id: playerId,
      game: engine.create({ seed: mix32((seed >>> 0) ^ (index + 1)) })
    }))
  };
}

export function stepMatch(match, commandsByPlayer = {}) {
  const events = [];
  if (match.status !== "playing") return events;

  match.policy.beforeStep(match, events);

  const gameEventBatches = [];
  for (const player of match.players) {
    if (player.game.status !== "playing") continue;
    const commands = commandsByPlayer[player.id] || [];
    const gameEvents = match.engine.step(player.game, commands);
    gameEventBatches.push({ playerId: player.id, gameEvents });
  }

  // Interpret cross-playfield consequences only after every game has advanced.
  // This keeps policy timing independent of player iteration order.
  for (const { playerId, gameEvents } of gameEventBatches) {
    for (const event of gameEvents) {
      events.push({ ...event, playerId });
      match.policy.onGameEvent(match, playerId, event, events);
    }
  }

  match.policy.afterStep(match, events);
  match.matchTick += 1;
  return events;
}

export function getPlayerGame(match, playerId) {
  const player = playerById(match, playerId);
  return player ? player.game : null;
}
