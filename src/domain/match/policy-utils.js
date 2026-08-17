export function mix32(value) {
  let x = value >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x7feb352d);
  x = Math.imul(x ^ (x >>> 15), 0x846ca68b);
  return (x ^ (x >>> 16)) >>> 0;
}

export function alivePlayers(match) {
  return match.players.filter((player) => player.game.status === "playing");
}

export function playerById(match, playerId) {
  return match.players.find((player) => player.id === playerId) || null;
}

export function finishMatch(match, result, events) {
  if (match.status !== "playing") return;
  match.status = "finished";
  match.result = Object.freeze({ ...result });
  events.push({ type: "MATCH_FINISHED", result: { ...match.result } });
}
