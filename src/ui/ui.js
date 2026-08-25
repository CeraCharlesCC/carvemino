import { createAttract } from "./attract.js";
import { DEFAULT_KEYBINDINGS, GAMEPLAY_ACTION_IDS } from "../config.js";
import { createGameScreen } from "./game-screen.js";
import {
  GAMEPAD_CONTROLLER_TYPES,
  createGamepadInput,
  getGamepadControllerType,
  getGamepadFaceButtonLabels,
  mapPhysicalFaceActionForMenu
} from "./gamepad-input.js";
import { createOnScreenGameInput, formatKeyLabel } from "./game-input.js";
import { createInputMode } from "./input-mode.js";
import { createLanLobby } from "./lan-lobby.js";
import { createNavigation } from "./navigation.js";
import { createProfileUi } from "./profile-ui.js";
import { createStartupManual } from "./startup-manual.js";
import { createFirstRunTutorialStore, createTutorialCoordinator } from "./first-run-tutorial.js";
import { createI18n } from "../i18n.js";

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
  releaseTutorial = () => {},
  finishTutorial = () => {},
  onAudioEvent = () => {},
  onScreenChange = () => {},
  changeKeybinding,
  resetKeybindings,
  changeAudioSetting
}) {
  let navigation = null;
  let startupManual = null;
  let tutorialCoordinator = null;
  let profileUi = null;
  let pendingTutorialModeId = null;
  let activeTutorialGuide = null;
  let activeControllerType = GAMEPAD_CONTROLLER_TYPES.generic;
  const firstRun = createFirstRunTutorialStore();
  const i18n = createI18n();
  i18n.apply();
  const attract = createAttract();

  function tutorialKeyboardKeys(control) {
    const bindings = profileUi?.getKeybindings?.() || DEFAULT_KEYBINDINGS;
    let codes = [];
    if (control === "move") {
      codes = [
        bindings[GAMEPLAY_ACTION_IDS.cursorUp],
        bindings[GAMEPLAY_ACTION_IDS.cursorLeft],
        bindings[GAMEPLAY_ACTION_IDS.cursorDown],
        bindings[GAMEPLAY_ACTION_IDS.cursorRight]
      ];
    } else if (control === "sculpt") {
      codes = ["Enter", bindings[GAMEPLAY_ACTION_IDS.sculpt]];
    } else if (control === "drop") {
      codes = [bindings[GAMEPLAY_ACTION_IDS.hardDrop]];
    }
    return [...new Set(codes.filter(Boolean))].map(formatKeyLabel);
  }

  function tutorialStepKey(step) {
    return {
      "move-second": "moveSecond",
      "cut-again": "cutAgain",
      "move-fill": "moveFill"
    }[step] || step;
  }

  function presentTutorialGuide(guide) {
    const control = guide.control;
    const controllerLabels = getGamepadFaceButtonLabels(activeControllerType);
    const controllerButton = control === "sculpt"
      ? controllerLabels[GAMEPLAY_ACTION_IDS.sculpt]
      : controllerLabels[GAMEPLAY_ACTION_IDS.hardDrop];
    const stepKey = tutorialStepKey(guide.step);
    return {
      ...guide,
      message: i18n.t(guide.messageKey),
      keyboardAction: control ? i18n.t(`tutorial.action.${stepKey}`) : "",
      keyboardKeys: control ? tutorialKeyboardKeys(control) : [],
      touchHint: control ? i18n.t(`tutorial.control.touch.${stepKey}`) : "",
      controllerHint: control
        ? i18n.t(`tutorial.control.controller.${stepKey}`, {
            button: controllerButton
          })
        : ""
    };
  }

  const gameScreen = createGameScreen({
    sendCommand,
    onAction(actionId, context) {
      tutorialCoordinator?.handleAction(actionId, context);
    }
  });
  tutorialCoordinator = createTutorialCoordinator({
    onGuide(guide) {
      activeTutorialGuide = guide;
      gameScreen.setTutorialGuide(presentTutorialGuide(guide));
    },
    onRelease() {
      releaseTutorial();
    },
    onComplete() {
      activeTutorialGuide = null;
      firstRun.completeTutorial();
      gameScreen.clearTutorialGuide();
      finishTutorial();
    }
  });
  const lanLobby = createLanLobby({
    modes: lanModes,
    createHostInvite,
    acceptHostAnswer,
    createJoinAnswer,
    startHostMatch
  });
  profileUi = createProfileUi({
    modes,
    onAudioEvent,
    onStartMode: requestStartMode,
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
      startupManual?.open({ returnFocus });
    },
    interceptControllerStart: handleOnboardingControllerStart,
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

  const menuControlsDialog = document.querySelector("#menu-controls-dialog");
  const menuControlsAck = document.querySelector("#menu-controls-ack");
  const tutorialOfferDialog = document.querySelector("#tutorial-offer-dialog");
  const tutorialYes = document.querySelector("#tutorial-yes");
  const tutorialNo = document.querySelector("#tutorial-no");
  const consoleLayout = document.querySelector(".console-layout");
  const arcadeCabinet = document.querySelector(".arcade-cabinet");

  function syncOnboardingState() {
    const dialog = openOnboardingDialog();
    if (arcadeCabinet) arcadeCabinet.inert = Boolean(dialog);
    if (!consoleLayout?.dataset) return;
    if (dialog) consoleLayout.dataset.onboarding = dialog.id;
    else delete consoleLayout.dataset.onboarding;
  }

  function showDialog(dialog, focusTarget) {
    if (!dialog || dialog.open) return;
    // Keep the physical touch surfaces outside the CRT interactive. A modal
    // dialog would make every other element inert, including those controls.
    dialog.setAttribute("open", "");
    syncOnboardingState();
    requestAnimationFrame(() => focusTarget?.focus());
  }

  function closeDialog(dialog) {
    if (!dialog?.open) return;
    if (typeof dialog.close === "function") dialog.close();
    else dialog.removeAttribute("open");
    syncOnboardingState();
  }

  function beginSingleplayer(modeId, tutorial = false) {
    navigation.clearPause();
    if (!tutorial) tutorialCoordinator.stop();
    const result = startMode(modeId, { tutorial });
    navigation.showScreen("game");
    if (tutorial) tutorialCoordinator.start(result?.tutorialPlan);
    else gameScreen.clearTutorialGuide();
  }

  function requestStartMode(modeId) {
    if (firstRun.shouldOfferTutorial()) {
      pendingTutorialModeId = modeId;
      showDialog(tutorialOfferDialog, tutorialYes);
      return;
    }
    beginSingleplayer(modeId, false);
  }

  menuControlsAck?.addEventListener("click", () => {
    onAudioEvent("confirm");
    firstRun.acknowledgeMenu();
    closeDialog(menuControlsDialog);
  });
  tutorialYes?.addEventListener("click", () => {
    if (!pendingTutorialModeId) return;
    onAudioEvent("confirm");
    const modeId = pendingTutorialModeId;
    pendingTutorialModeId = null;
    firstRun.acceptTutorial();
    closeDialog(tutorialOfferDialog);
    beginSingleplayer(modeId, true);
  });
  tutorialNo?.addEventListener("click", () => {
    if (!pendingTutorialModeId) return;
    onAudioEvent("back");
    const modeId = pendingTutorialModeId;
    pendingTutorialModeId = null;
    firstRun.declineTutorial();
    closeDialog(tutorialOfferDialog);
    beginSingleplayer(modeId, false);
  });

  function openOnboardingDialog() {
    if (menuControlsDialog?.open) return menuControlsDialog;
    if (tutorialOfferDialog?.open) return tutorialOfferDialog;
    return null;
  }

  function onboardingButtons(dialog) {
    return [...(dialog?.querySelectorAll?.("button:not([disabled])") || [])];
  }

  function moveOnboardingSelection(dialog, previous) {
    const buttons = onboardingButtons(dialog);
    if (buttons.length === 0) return false;
    let index = buttons.indexOf(document.activeElement);
    if (index < 0) index = previous ? 0 : -1;
    index = (index + (previous ? -1 : 1) + buttons.length) % buttons.length;
    buttons[index].focus();
    onAudioEvent("select");
    return true;
  }

  function activateOnboardingSelection(dialog) {
    const buttons = onboardingButtons(dialog);
    const button = buttons.includes(document.activeElement) ? document.activeElement : buttons[0];
    if (!button) return false;
    button.click();
    return true;
  }

  function handleOnboardingControllerAction(actionId, options = {}) {
    const dialog = openOnboardingDialog();
    if (!dialog) return null;
    if (options.physicalFace) actionId = mapPhysicalFaceActionForMenu(actionId, options.controllerType);
    if (actionId === "cursorUp" || actionId === "cursorLeft" || actionId === "focusPrevious") {
      return moveOnboardingSelection(dialog, true);
    }
    if (actionId === "cursorDown" || actionId === "cursorRight" || actionId === "focusNext") {
      return moveOnboardingSelection(dialog, false);
    }
    if (actionId === "sculpt") return activateOnboardingSelection(dialog);
    if (actionId === "hardDrop") {
      if (dialog === tutorialOfferDialog) tutorialNo?.click();
      return true;
    }
    return true;
  }

  function handleOnboardingControllerStart() {
    const dialog = openOnboardingDialog();
    return dialog ? activateOnboardingSelection(dialog) : null;
  }

  function handleOnboardingKey(event) {
    const dialog = openOnboardingDialog();
    if (!dialog) return;
    const previous = ["ArrowUp", "ArrowLeft", "KeyW", "KeyA"].includes(event.code);
    const next = ["ArrowDown", "ArrowRight", "KeyS", "KeyD"].includes(event.code);
    if (event.code === "Tab") moveOnboardingSelection(dialog, event.shiftKey);
    else if (previous || next) moveOnboardingSelection(dialog, previous);
    else if (event.code === "Enter" || event.code === "Space") activateOnboardingSelection(dialog);
    else if (event.code === "Escape") {
      if (dialog === tutorialOfferDialog) tutorialNo?.click();
    } else return;
    event.preventDefault();
    event.stopPropagation();
  }
  window.addEventListener("keydown", handleOnboardingKey, true);

  function performUiGameAction(actionId) {
    const onboardingResult = handleOnboardingControllerAction(actionId);
    if (onboardingResult !== null) return onboardingResult;
    const manualResult = startupManual?.handleGameAction(actionId);
    return manualResult === null || manualResult === undefined
      ? navigation.performControllerAction(actionId)
      : manualResult;
  }

  function performUiControllerAction(actionId) {
    const options = { controllerType: activeControllerType, physicalFace: true };
    const onboardingResult = handleOnboardingControllerAction(actionId, options);
    if (onboardingResult !== null) return onboardingResult;
    const manualResult = startupManual?.handleControllerAction(actionId, options);
    return manualResult === null || manualResult === undefined
      ? navigation.performControllerAction(actionId, options)
      : manualResult;
  }

  function performUiControllerStart() {
    const onboardingResult = handleOnboardingControllerStart();
    if (onboardingResult !== null) return onboardingResult;
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
      const menuActionId = mapPhysicalFaceActionForMenu(actionId, controllerType);
      for (const element of document.querySelectorAll(`[data-controller-menu-action="${menuActionId}"]`)) {
        element.textContent = label;
      }
    }
    if (activeTutorialGuide) gameScreen.setTutorialGuide(presentTutorialGuide(activeTutorialGuide));
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
    onAudioEvent,
    getKeybindings: profileUi.getKeybindings
  });

  function setProfile(profile) {
    profileUi.setProfile(profile);
    startupManual.refreshKeybindings();
  }

  function setGameMode(modeId, options = {}) {
    const source = options.kind === "multiplayer" ? lanModes : modes;
    const mode = source.find((item) => item.id === modeId);
    if (!mode) throw new Error(`Unknown UI game mode: ${modeId}`);
    gameScreen.setGameMode(mode, options);
    if (options.kind !== "multiplayer") profileUi.setGameMode(mode);
  }

  navigation.showScreen("menu");
  if (firstRun.shouldShowMenuControls()) showDialog(menuControlsDialog, menuControlsAck);

  return {
    render: gameScreen.render,
    renderNetwork: gameScreen.render,
    handleGameEvents(events, feedbackViews) {
      gameScreen.handleGameEvents(events, feedbackViews);
      tutorialCoordinator.handleEvents(events);
    },
    handleMatchEvents: gameScreen.handleMatchEvents,
    setProfile,
    setGameMode,
    setLanSessionState: lanLobby.setSessionState,
    setLanNotice: lanLobby.setNotice,
    showScreen: navigation.showScreen,
    restartTutorial(plan) {
      gameScreen.clearTutorialGuide();
      tutorialCoordinator.start(plan);
    },
    abandonTutorial() {
      activeTutorialGuide = null;
      firstRun.abandonTutorial();
      tutorialCoordinator.stop();
      gameScreen.clearTutorialGuide();
    },
    destroy() {
      window.removeEventListener("keydown", handleOnboardingKey, true);
      inputMode.destroy();
      onScreenGameInput.destroy();
      gamepadInput.destroy();
    }
  };
}
