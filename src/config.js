function defineGameplayAction(id, label, defaultKeybinding) {
  return Object.freeze({ id, label, defaultKeybinding });
}

export const GAMEPLAY_ACTIONS = Object.freeze([
  defineGameplayAction("focusPrevious", "Focus previous", "KeyQ"),
  defineGameplayAction("focusNext", "Focus next", "KeyE"),
  defineGameplayAction("cursorUp", "Cursor up", "KeyW"),
  defineGameplayAction("cursorLeft", "Cursor left", "KeyA"),
  defineGameplayAction("cursorDown", "Cursor down", "KeyS"),
  defineGameplayAction("cursorRight", "Cursor right", "KeyD"),
  defineGameplayAction("sculpt", "Sculpt", "KeyZ"),
  defineGameplayAction("hardDrop", "Hard drop", "Space")
]);

export const GAMEPLAY_ACTION_IDS = Object.freeze(Object.fromEntries(
  GAMEPLAY_ACTIONS.map(({ id }) => [id, id])
));

export const DEFAULT_KEYBINDINGS = Object.freeze(Object.fromEntries(
  GAMEPLAY_ACTIONS.map(({ id, defaultKeybinding }) => [id, defaultKeybinding])
));

export const DEFAULT_AUDIO_SETTINGS = Object.freeze({
  masterVolume: 0.8,
  musicVolume: 0.55,
  sfxVolume: 0.8,
  musicEnabled: true,
  sfxEnabled: true
});

export const PROFILE_STORAGE_KEY = "carvemino-profile";
export const PROFILE_SCHEMA_VERSION = 2;