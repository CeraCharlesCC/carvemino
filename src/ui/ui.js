import { createAttract } from "./attract.js";
import { createGameScreen } from "./game-screen.js";
import { createOnScreenGameInput } from "./game-input.js";
import { createNavigation } from "./navigation.js";
import { createProfileUi } from "./profile-ui.js";

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
    onAudioEvent,
    onScreenChange
  });

  createOnScreenGameInput({
    root: document.querySelector(".console-layout"),
    performAction: (actionId) => navigation.performControllerAction(actionId)
  });

  function setGameMode(modeId) {
    const mode = modes.find((item) => item.id === modeId);
    if (!mode) throw new Error(`Unknown UI game mode: ${modeId}`);
    gameScreen.setGameMode(mode);
    profileUi.setGameMode(mode);
  }

  navigation.showScreen("menu");

  return {
    render: gameScreen.render,
    setProfile: profileUi.setProfile,
    setGameMode,
    showScreen: navigation.showScreen
  };
}
