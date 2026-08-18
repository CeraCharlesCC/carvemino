const MENU_PREVIOUS_KEYS = new Set(["ArrowUp", "ArrowLeft", "KeyW", "KeyA"]);
const MENU_NEXT_KEYS = new Set(["ArrowDown", "ArrowRight", "KeyS", "KeyD"]);
const NON_REPEATING_UI_KEYS = new Set(["Enter", "Space", "Escape", "KeyR", "KeyO"]);

export function getTitleScreenAction(code) {
  if (code === "Enter") return "start";
  if (code === "KeyR") return "records";
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
  const pauseOverlay = document.querySelector("#pause-overlay");
  const resumeGameButton = document.querySelector("#resume-game");
  const pressStart = document.querySelector("#press-start");

  let currentScreen = "menu";
  let gamePaused = false;
  let secondaryReturnScreen = "menu";

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
    if (currentScreen === "menu" && screenName !== "menu") attract.stop();
    currentScreen = screenName;
    for (const [name, screen] of screens) screen.hidden = name !== screenName;
    if (screenName === "options") profileUi.renderOptions();
    if (screenName === "menu") attract.start();
    if (screenName === "game") gameScreen.refreshLayout();
    if (screenName !== "game") focusFirstMenuButton(screenName);
    onScreenChange(screenName);
  }

  function performGameAction(actionId) {
    if (currentScreen !== "game" || gamePaused || gameScreen.getStatus() !== "playing") return false;
    return gameScreen.performAction(actionId);
  }

  function navigateTo(screenName) {
    if ((screenName === "records" || screenName === "options") && currentScreen !== screenName) {
      secondaryReturnScreen = currentScreen === "records" || currentScreen === "options"
        ? "menu"
        : currentScreen;
    }
    showScreen(screenName);
  }

  function setPaused(paused) {
    if (gamePaused === paused) return;
    gamePaused = paused;
    pauseOverlay.hidden = !paused;
    if (paused) {
      pauseGame();
      requestAnimationFrame(() => {
        if (gamePaused) resumeGameButton.focus();
      });
    } else {
      resumeGame();
      requestAnimationFrame(() => pauseGameButton.focus());
    }
  }

  function clearPause() {
    gamePaused = false;
    pauseOverlay.hidden = true;
  }

  function quitToSingleplayer() {
    clearPause();
    quitGame();
    showScreen("singleplayer");
  }

  function getMenuButtons(container) {
    return [...container.querySelectorAll([
      ".menu-button:not([disabled])",
      ".start-button:not([disabled])",
      ".attract-secondary button:not([disabled])"
    ].join(", "))];
  }

  function handleMenuNavigation(event, container = screens.get(currentScreen)) {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return false;
    const movingPrevious = MENU_PREVIOUS_KEYS.has(event.code);
    if (!movingPrevious && !MENU_NEXT_KEYS.has(event.code)) return false;
    const buttons = getMenuButtons(container);
    if (buttons.length === 0) return false;
    let index = buttons.indexOf(document.activeElement);
    if (index < 0) index = 0;
    index = (index + (movingPrevious ? -1 : 1) + buttons.length) % buttons.length;
    buttons[index].focus();
    onAudioEvent("select");
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
    if (profileUi.handleBindingKey(event)) return;

    if (event.repeat && NON_REPEATING_UI_KEYS.has(event.code)) {
      event.preventDefault();
      return;
    }

    if (currentScreen === "game") {
      if (gameScreen.getStatus() === "gameover") {
        if (event.code === "Escape") {
          onAudioEvent("back");
          quitToSingleplayer();
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
      } else if (action === "records" || action === "options") {
        secondaryReturnScreen = "menu";
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
      if (currentScreen === "records" || currentScreen === "options") showScreen(secondaryReturnScreen);
      else showScreen("menu");
      event.preventDefault();
    }
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden" && currentScreen === "game"
        && !gamePaused && gameScreen.getStatus() === "playing") {
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
      showScreen(secondaryReturnScreen);
    });
  }
  pauseGameButton.addEventListener("click", () => {
    if (gameScreen.getStatus() === "gameover") return;
    onAudioEvent("confirm");
    setPaused(true);
  });
  resumeGameButton.addEventListener("click", () => {
    onAudioEvent("back");
    setPaused(false);
  });
  document.querySelector("#restart-game").addEventListener("click", () => {
    onAudioEvent("confirm");
    clearPause();
    restart();
    requestAnimationFrame(() => pauseGameButton.focus());
  });
  document.querySelector("#quit-game").addEventListener("click", () => {
    onAudioEvent("back");
    quitToSingleplayer();
  });
  playAgainButton.addEventListener("click", () => {
    onAudioEvent("confirm");
    clearPause();
    restart();
    requestAnimationFrame(() => pauseGameButton.focus());
  });
  gameOverBackButton.addEventListener("click", () => {
    onAudioEvent("back");
    quitToSingleplayer();
  });

  return {
    clearPause,
    performGameAction,
    showScreen
  };
}
