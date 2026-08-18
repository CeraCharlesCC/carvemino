import { createAttract } from "./attract.js";
import { createGameScreen } from "./game-screen.js";
import { createOnScreenGameInput } from "./game-input.js";
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
  const i18n = createI18n();
  i18n.apply();
  const attract = createAttract();
  const gameScreen = createGameScreen({ sendCommand });
  const lanLobby = createLanLobby({
    modes: lanModes,
    createHostInvite,
    acceptHostAnswer,
    createJoinAnswer
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

  createOnScreenGameInput({
    root: document.querySelector(".console-layout"),
    performAction: (actionId) => {
      const manualResult = startupManual?.handleGameAction(actionId);
      return manualResult === null || manualResult === undefined
        ? navigation.performControllerAction(actionId)
        : manualResult;
    }
  });

  startupManual = createStartupManual({
    i18n,
    returnFocus: document.querySelector("#press-start"),
    screen: document.querySelector(".crt-glass"),
    onStart: () => document.querySelector("#press-start")?.click()
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
    showScreen: navigation.showScreen
  };
}
