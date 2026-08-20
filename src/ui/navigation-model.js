const SCREEN_BACK_DESTINATIONS = Object.freeze({
  play: "menu",
  singleplayer: "play",
  multiplayer: "play",
  lan: "multiplayer",
  "lan-host": "lan",
  "lan-join": "lan",
  records: "menu",
  options: "menu"
});

export function getBackScreen(screenName) {
  return SCREEN_BACK_DESTINATIONS[screenName] || null;
}

export function shouldPauseGameSimulation(gameContext) {
  return gameContext?.kind !== "multiplayer";
}

export function getGameExitScreen(gameContext) {
  return gameContext?.kind === "multiplayer" ? "lan" : "singleplayer";
}

export function getTitleScreenAction(code) {
  if (code === "Enter") return "start";
  if (code === "KeyR") return "records";
  if (code === "KeyH") return "manual";
  if (code === "KeyO") return "options";
  return null;
}

export function getMenuButtons(container) {
  if (!container) return [];
  return [...container.querySelectorAll([
    ".menu-button:not([disabled])",
    ".start-button:not([disabled])",
    ".attract-secondary button:not([disabled])"
  ].join(", "))].filter((button) => !button.closest?.("[hidden]"));
}