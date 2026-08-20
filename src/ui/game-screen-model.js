export function getVersusResultLabel(result, localPlayerId) {
  if (!result) return "MATCH OVER";
  if (result.type === "draw") return "DRAW";
  if (result.type === "winner") return result.winnerId === localPlayerId ? "WIN" : "LOSE";
  return "MATCH OVER";
}

export function getVersusEventLabel(event, localPlayerId) {
  if (!event || !localPlayerId) return null;
  if (event.type === "ATTACK_GENERATED" && event.playerId === localPlayerId) {
    return `ATTACK +${event.rows}`;
  }
  if (event.type === "GARBAGE_SENT" && event.sourcePlayerId === localPlayerId) {
    return `SENT ${event.packet?.rows || 0}`;
  }
  if (event.type === "GARBAGE_CANCELLED" && event.playerId === localPlayerId) {
    return `CANCEL ${event.rows}`;
  }
  return null;
}

export function getSculptAction(view, cursor) {
  const piece = view?.focusedPiece;
  if (!piece || !cursor || !view.sculpt) return null;
  if (view.sculpt.carve.targets.some((cell) => cell.x === cursor.x && cell.y === cursor.y)) {
    return "CARVE";
  }
  if (view.sculpt.fill.targets.some((cell) => cell.x === cursor.x && cell.y === cursor.y)) {
    return "FILL";
  }
  return null;
}