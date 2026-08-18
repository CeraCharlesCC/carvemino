import { triggerHapticFeedback } from "./game-input.js";

const MENU_PREVIOUS_KEYS = new Set(["ArrowUp", "ArrowLeft", "KeyW", "KeyA"]);
const MENU_NEXT_KEYS = new Set(["ArrowDown", "ArrowRight", "KeyS", "KeyD"]);
const NON_REPEATING_UI_KEYS = new Set(["Enter", "Space", "Escape", "KeyR", "KeyO", "KeyH"]);

const CONTROLLER_PREVIOUS_ACTIONS = new Set(["cursorUp", "cursorLeft", "focusPrevious"]);
const CONTROLLER_NEXT_ACTIONS = new Set(["cursorDown", "cursorRight", "focusNext"]);

export const SCREEN_BACK_DESTINATIONS = Object.freeze({
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

export function createNavigation({
  attract,
  gameScreen,
  profileUi,
  restart,
  quitGame,
  pauseGame,
  resumeGame,
  openManual = () => {},
  onAudioEvent,
  onScreenChange
}) {
  const screens = new Map(
    [...document.querySelectorAll("[data-screen]")].map((screen) => [screen.dataset.screen, screen])
  );
  const gameOver = document.querySelector("#game-over");
  const playAgainButton = document.querySelector("#play-again");
  const gameOverBackButton = document.querySelector("#game-over-back");
  const pauseGameButton = document.querySelector("#pause-game");
  const controllerPauseButtons = [...document.querySelectorAll("[data-pause-game]")];
  const consoleLayout = document.querySelector(".console-layout");
  const pauseOverlay = document.querySelector("#pause-overlay");
  const resumeGameButton = document.querySelector("#resume-game");
  const pressStart = document.querySelector("#press-start");
  const titleManualButton = document.querySelector("#title-manual");

  let currentScreen = "menu";
  let gamePaused = false;

  function updateControllerStartLabels() {
    const isMultiplayer = gameScreen.getContext?.()?.kind === "multiplayer";
    const label = currentScreen !== "game"
      ? "Start or confirm selection"
      : isMultiplayer
        ? (gamePaused ? "Return to match" : "Open match menu")
        : (gamePaused ? "Resume game" : "Pause game");
    for (const button of controllerPauseButtons) button.setAttribute("aria-label", label);
  }

  function focusFirstMenuButton(screenName) {
    const screen = screens.get(screenName);
    const button = screenName === "menu"
      ? pressStart
      : screen?.querySelector(".menu-button:not([disabled])");
    if (button) requestAnimationFrame(() => {
      if (currentScreen === screenName) button.focus();
    });
  }

  function showScreen(screenName) {
    if (!screens.has(screenName)) return;
    if (gamePaused && screenName !== currentScreen) clearPause();
    if (currentScreen === "menu" && screenName !== "menu") attract.stop();
    currentScreen = screenName;
    for (const [name, screen] of screens) screen.hidden = name !== screenName;
    if (consoleLayout) consoleLayout.dataset.activeScreen = screenName;
    updateControllerStartLabels();
    if (screenName === "options") profileUi.renderOptions();
    if (screenName === "menu") attract.start();
    if (screenName === "game") gameScreen.refreshLayout();
    if (screenName !== "game") focusFirstMenuButton(screenName);
    onScreenChange(screenName);
  }

  function navigateTo(screenName) {
    showScreen(screenName);
  }

  function setPaused(paused, returnFocus = pauseGameButton) {
    if (gamePaused === paused) return;
    gamePaused = paused;
    if (consoleLayout) consoleLayout.dataset.gameState = paused ? "paused" : "playing";
    updateControllerStartLabels();
    pauseOverlay.hidden = !paused;
    const pausesSimulation = shouldPauseGameSimulation(gameScreen.getContext?.());
    if (paused) {
      if (pausesSimulation) pauseGame();
      requestAnimationFrame(() => {
        if (gamePaused) resumeGameButton.focus();
      });
    } else {
      if (pausesSimulation) resumeGame();
      requestAnimationFrame(() => returnFocus?.focus());
    }
  }

  function clearPause() {
    gamePaused = false;
    if (consoleLayout) consoleLayout.dataset.gameState = "playing";
    updateControllerStartLabels();
    pauseOverlay.hidden = true;
  }

  function quitToGameOrigin() {
    const destination = getGameExitScreen(gameScreen.getContext?.());
    clearPause();
    quitGame();
    showScreen(destination);
  }

  function getMenuButtons(container) {
    return [...container.querySelectorAll([
      ".menu-button:not([disabled])",
      ".start-button:not([disabled])",
      ".attract-secondary button:not([disabled])"
    ].join(", "))];
  }

  function moveMenuSelection(movingPrevious, container = screens.get(currentScreen)) {
    const buttons = getMenuButtons(container);
    if (buttons.length === 0) return false;
    let index = buttons.indexOf(document.activeElement);
    if (index < 0) index = movingPrevious ? 0 : -1;
    index = (index + (movingPrevious ? -1 : 1) + buttons.length) % buttons.length;
    buttons[index].focus();
    onAudioEvent("select");
    return true;
  }

  function activateMenuSelection(container = screens.get(currentScreen), fallback = null) {
    const buttons = getMenuButtons(container);
    const button = buttons.includes(document.activeElement)
      ? document.activeElement
      : fallback || buttons[0];
    if (!button) return false;
    button.click();
    return true;
  }

  function goBackWithController() {
    if (currentScreen === "menu") return false;
    if (currentScreen === "game") {
      if (gamePaused) {
        onAudioEvent("back");
        setPaused(false);
        return true;
      }
      if (gameScreen.getStatus() === "gameover") {
        onAudioEvent("back");
        quitToGameOrigin();
        return true;
      }
      return false;
    }
    onAudioEvent("back");
    showScreen(getBackScreen(currentScreen) || "menu");
    return true;
  }

  function performControllerAction(actionId) {
    if (currentScreen === "game" && !gamePaused && gameScreen.getStatus() === "playing") {
      return gameScreen.performAction(actionId);
    }

    const menuContainer = currentScreen === "game"
      ? (gamePaused ? pauseOverlay : gameOver)
      : screens.get(currentScreen);
    if (CONTROLLER_PREVIOUS_ACTIONS.has(actionId)) {
      return moveMenuSelection(true, menuContainer);
    }
    if (CONTROLLER_NEXT_ACTIONS.has(actionId)) {
      return moveMenuSelection(false, menuContainer);
    }
    if (actionId === "sculpt") {
      const fallback = currentScreen === "menu"
        ? pressStart
        : currentScreen === "game" && gameScreen.getStatus() === "gameover"
          ? playAgainButton
          : null;
      return activateMenuSelection(menuContainer, fallback);
    }
    if (actionId === "hardDrop") return goBackWithController();
    return false;
  }

  function handleMenuNavigation(event, container = screens.get(currentScreen)) {
    if (event.target?.matches?.("input, select, textarea")) return false;
    const movingPrevious = MENU_PREVIOUS_KEYS.has(event.code);
    if (!movingPrevious && !MENU_NEXT_KEYS.has(event.code)) return false;
    if (!moveMenuSelection(movingPrevious, container)) return false;
    event.preventDefault();
    return true;
  }

  function trapMenuFocus(event, container) {
    if (event.code !== "Tab") return false;
    const buttons = getMenuButtons(container);
    if (buttons.length === 0) return false;
    const currentIndex = buttons.indexOf(document.activeElement);
    const direction = event.shiftKey ? -1 : 1;
    const nextIndex = currentIndex < 0
      ? (event.shiftKey ? buttons.length - 1 : 0)
      : (currentIndex + direction + buttons.length) % buttons.length;
    buttons[nextIndex].focus();
    event.preventDefault();
    return true;
  }

  window.addEventListener("keydown", (event) => {
    if (document.querySelector("#startup-manual")?.open) return;
    if (profileUi.handleBindingKey(event)) return;

    if (event.repeat && NON_REPEATING_UI_KEYS.has(event.code)) {
      event.preventDefault();
      return;
    }

    if (currentScreen === "game") {
      if (gameScreen.getStatus() === "gameover") {
        if (event.code === "Escape") {
          onAudioEvent("back");
          quitToGameOrigin();
          event.preventDefault();
        } else if (event.code === "Enter" || event.code === "Space") {
          const buttons = getMenuButtons(gameOver);
          const activeButton = buttons.includes(document.activeElement)
            ? document.activeElement
            : playAgainButton;
          activeButton.click();
          event.preventDefault();
        } else if (trapMenuFocus(event, gameOver)) {
          return;
        } else {
          handleMenuNavigation(event, gameOver);
        }
        return;
      }
      if (gamePaused) {
        if (event.code === "Escape") {
          onAudioEvent("back");
          setPaused(false);
          event.preventDefault();
        } else if (trapMenuFocus(event, pauseOverlay)) {
          return;
        } else {
          handleMenuNavigation(event, pauseOverlay);
        }
        return;
      }
      if (event.code === "Escape") {
        onAudioEvent("confirm");
        setPaused(true);
        event.preventDefault();
        return;
      }
      gameScreen.handleKey(event, profileUi.getKeybindings());
      return;
    }

    if (currentScreen === "menu") {
      const action = getTitleScreenAction(event.code);
      if (action === "start") {
        pressStart.click();
      } else if (action === "manual") {
        onAudioEvent("confirm");
        openManual({
          context: "menu",
          returnFocus: document.activeElement?.focus ? document.activeElement : titleManualButton || pressStart
        });
      } else if (action === "records" || action === "options") {
        onAudioEvent("confirm");
        showScreen(action);
      }
      if (action || event.code === "Space" || MENU_PREVIOUS_KEYS.has(event.code)
          || MENU_NEXT_KEYS.has(event.code)) {
        event.preventDefault();
      }
      return;
    }

    if (handleMenuNavigation(event)) return;
    if (event.code === "Escape" && currentScreen !== "menu") {
      onAudioEvent("back");
      showScreen(getBackScreen(currentScreen) || "menu");
      event.preventDefault();
    }
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden" && currentScreen === "game"
        && !gamePaused && gameScreen.getStatus() === "playing"
        && shouldPauseGameSimulation(gameScreen.getContext?.())) {
      setPaused(true);
    }
  });

  for (const button of document.querySelectorAll("[data-nav]")) {
    button.addEventListener("click", () => {
      onAudioEvent("confirm");
      navigateTo(button.dataset.nav);
    });
  }
  for (const button of document.querySelectorAll("[data-back]")) {
    button.addEventListener("click", () => {
      onAudioEvent("back");
      const destination = button.dataset.back;
      if (destination) showScreen(destination);
    });
  }
  for (const button of document.querySelectorAll("[data-open-manual]")) {
    button.addEventListener("click", () => {
      onAudioEvent("confirm");
      openManual({
        context: button.dataset.manualContext || currentScreen,
        returnFocus: button
      });
    });
  }
  pauseGameButton.addEventListener("click", () => {
    if (gameScreen.getStatus() === "gameover") return;
    onAudioEvent("confirm");
    setPaused(true);
  });
  for (const button of controllerPauseButtons) {
    button.addEventListener("click", () => {
      const status = gameScreen.getStatus();
      if (currentScreen !== "game") {
        triggerHapticFeedback();
        activateMenuSelection(screens.get(currentScreen), currentScreen === "menu" ? pressStart : null);
        return;
      }
      if (status === "gameover") {
        triggerHapticFeedback();
        activateMenuSelection(gameOver, playAgainButton);
        return;
      }
      if (!gamePaused && status !== "playing") return;
      triggerHapticFeedback();
      onAudioEvent(gamePaused ? "back" : "confirm");
      setPaused(!gamePaused, button);
    });
  }
  resumeGameButton.addEventListener("click", () => {
    onAudioEvent("back");
    setPaused(false);
  });
  document.querySelector("#restart-game").addEventListener("click", () => {
    if (!shouldPauseGameSimulation(gameScreen.getContext?.())) return;
    onAudioEvent("confirm");
    clearPause();
    restart();
    requestAnimationFrame(() => pauseGameButton.focus());
  });
  document.querySelector("#quit-game").addEventListener("click", () => {
    onAudioEvent("back");
    quitToGameOrigin();
  });
  playAgainButton.addEventListener("click", () => {
    onAudioEvent("confirm");
    if (!shouldPauseGameSimulation(gameScreen.getContext?.())) {
      quitToGameOrigin();
      return;
    }
    clearPause();
    restart();
    requestAnimationFrame(() => pauseGameButton.focus());
  });
  gameOverBackButton.addEventListener("click", () => {
    onAudioEvent("back");
    quitToGameOrigin();
  });

  return {
    clearPause,
    performControllerAction,
    performGameAction: performControllerAction,
    showScreen
  };
}
