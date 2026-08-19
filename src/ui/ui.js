import { createAttract } from "./attract.js";
import { createGameScreen } from "./game-screen.js";
import {
  GAMEPAD_CONTROLLER_TYPES,
  createGamepadInput,
  getGamepadControllerType,
  getGamepadFaceButtonLabels
} from "./gamepad-input.js";
import { createOnScreenGameInput } from "./game-input.js";
import { createInputMode } from "./input-mode.js";
import { createLanLobby } from "./lan-lobby.js";
import { createNavigation } from "./navigation.js";
import { createProfileUi } from "./profile-ui.js";
import { claimStartupManualVisit, createStartupManual } from "./startup-manual.js";
import { createI18n } from "../i18n.js";

export { getSculptAction, getVersusEventLabel, getVersusResultLabel } from "./game-screen.js";
export {
  getBackScreen,
  getGameExitScreen,
  getTitleScreenAction,
  shouldPauseGameSimulation
} from "./navigation.js";

export function createUi({
  modes,
  lanModes = [],
  sendCommand,
  restart,
  startMode,
  createHostInvite = async () => "",
  acceptHostAnswer = async () => {},
  createJoinAnswer = async () => "",
  startHostMatch = async () => {},
  cancelLanSession = () => {},
  quitGame,
  pauseGame,
  resumeGame,
  onAudioEvent = () => {},
  onScreenChange = () => {},
  changeKeybinding,
  resetKeybindings,
  changeAudioSetting
}) {
  let navigation = null;
  let startupManual = null;
  let activeControllerType = GAMEPAD_CONTROLLER_TYPES.generic;
  const i18n = createI18n();
  i18n.apply();
  const attract = createAttract();
  const gameScreen = createGameScreen({ sendCommand });
  const lanLobby = createLanLobby({
    modes: lanModes,
    createHostInvite,
    acceptHostAnswer,
    createJoinAnswer,
    startHostMatch
  });
  const profileUi = createProfileUi({
    modes,
    onAudioEvent,
    onStartMode(modeId) {
      navigation.clearPause();
      startMode(modeId);
      navigation.showScreen("game");
    },
    changeKeybinding,
    resetKeybindings,
    changeAudioSetting
  });

  let previousScreen = "menu";
  navigation = createNavigation({
    attract,
    gameScreen,
    profileUi,
    restart,
    quitGame,
    pauseGame,
    resumeGame,
    openManual({ returnFocus }) {
      startupManual?.open({ returnFocus, mode: "reference" });
    },
    onAudioEvent,
    onScreenChange(screenName) {
      if (["lan-host", "lan-join"].includes(previousScreen)
          && screenName !== previousScreen && screenName !== "game") {
        cancelLanSession();
      }
      lanLobby.handleScreenChange(screenName);
      previousScreen = screenName;
      onScreenChange(screenName);
    }
  });

  function performUiGameAction(actionId) {
    const manualResult = startupManual?.handleGameAction(actionId);
    return manualResult === null || manualResult === undefined
      ? navigation.performControllerAction(actionId)
      : manualResult;
  }

  function performUiControllerAction(actionId) {
    const options = { controllerType: activeControllerType, physicalFace: true };
    const manualResult = startupManual?.handleControllerAction(actionId, options);
    return manualResult === null || manualResult === undefined
      ? navigation.performControllerAction(actionId, options)
      : manualResult;
  }

  function performUiControllerStart() {
    const manualResult = startupManual?.handleControllerStart();
    return manualResult === null || manualResult === undefined
      ? navigation.performControllerStart()
      : manualResult;
  }

  const inputMode = createInputMode();

  function updateControllerFaceHints(controllerType) {
    const labels = getGamepadFaceButtonLabels(controllerType);
    for (const [actionId, label] of Object.entries(labels)) {
      for (const element of document.querySelectorAll(`[data-controller-game-action="${actionId}"]`)) {
        element.textContent = label;
      }
    }
  }

  const onScreenGameInput = createOnScreenGameInput({
    root: document.querySelector(".console-layout"),
    performAction: performUiGameAction
  });
  const gamepadInput = createGamepadInput({
    performAction: performUiControllerAction,
    performStart: performUiControllerStart,
    onActivity: (gamepad) => {
      activeControllerType = getGamepadControllerType(gamepad);
      updateControllerFaceHints(activeControllerType);
      inputMode.setMode("controller");
    }
  });

  startupManual = createStartupManual({
    i18n,
    returnFocus: document.querySelector("#press-start"),
    screen: document.querySelector(".crt-glass"),
    onStart: () => navigation.showScreen("menu"),
    onAudioEvent
  });

  function setGameMode(modeId, options = {}) {
    const source = options.kind === "multiplayer" ? lanModes : modes;
    const mode = source.find((item) => item.id === modeId);
    if (!mode) throw new Error(`Unknown UI game mode: ${modeId}`);
    gameScreen.setGameMode(mode, options);
    if (options.kind !== "multiplayer") profileUi.setGameMode(mode);
  }

  navigation.showScreen("menu");
  if (claimStartupManualVisit()) startupManual.open({ mode: "startup" });

  return {
    render: gameScreen.render,
    renderNetwork: gameScreen.render,
    handleMatchEvents: gameScreen.handleMatchEvents,
    setProfile: profileUi.setProfile,
    setGameMode,
    setLanSessionState: lanLobby.setSessionState,
    setLanNotice: lanLobby.setNotice,
    showScreen: navigation.showScreen,
    destroy() {
      inputMode.destroy();
      onScreenGameInput.destroy();
      gamepadInput.destroy();
    }
  };
}
