import { createAttract } from "./attract.js";
import { createGameScreen } from "./game-screen.js";
import { createOnScreenGameInput } from "./game-input.js";
import { createNavigation } from "./navigation.js";
import { createProfileUi } from "./profile-ui.js";
import { createStartupManual } from "./startup-manual.js";
import { createI18n } from "../i18n.js";

export { getSculptAction } from "./game-screen.js";
export { getTitleScreenAction } from "./navigation.js";

export function createUi({
  modes,
  sendCommand,
  restart,
  startMode,
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
    onScreenChange
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

  function setGameMode(modeId) {
    const mode = modes.find((item) => item.id === modeId);
    if (!mode) throw new Error(`Unknown UI game mode: ${modeId}`);
    gameScreen.setGameMode(mode);
    profileUi.setGameMode(mode);
  }

  navigation.showScreen("menu");
  startupManual.open({ mode: "startup" });

  return {
    render: gameScreen.render,
    setProfile: profileUi.setProfile,
    setGameMode,
    showScreen: navigation.showScreen
  };
}
