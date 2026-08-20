import { ACHIEVEMENTS } from "../app/profile.js";
import {
  DEFAULT_AUDIO_SETTINGS,
  DEFAULT_KEYBINDINGS,
  GAMEPLAY_ACTIONS,
  GAMEPLAY_ACTION_IDS
} from "../config.js";
import { formatKeyLabel } from "./game-input.js";

function emptyProfile(modes) {
  return {
    highScores: Object.fromEntries(modes.map((mode) => [mode.id, 0])),
    achievements: {},
    settings: {
      theme: "default",
      keybindings: { ...DEFAULT_KEYBINDINGS },
      audio: { ...DEFAULT_AUDIO_SETTINGS }
    }
  };
}

export function createProfileUi({
  modes,
  onAudioEvent,
  onStartMode,
  changeKeybinding,
  resetKeybindings,
  changeAudioSetting
}) {
  const highScore = document.querySelector("#high-score");
  const keybindingList = document.querySelector("#keybinding-list");
  const masterVolume = document.querySelector("#audio-master-volume");
  const musicVolume = document.querySelector("#audio-music-volume");
  const sfxVolume = document.querySelector("#audio-sfx-volume");
  const musicEnabled = document.querySelector("#audio-music-enabled");
  const sfxEnabled = document.querySelector("#audio-sfx-enabled");
  const achievementList = document.querySelector("#achievement-list");
  const achievementSummary = document.querySelector("#achievement-summary");
  const modeMenu = document.querySelector("#mode-menu");
  const recordScoreList = document.querySelector("#record-score-list");
  const attractRanking = document.querySelector("#attract-ranking");
  const focusPrevKey = document.querySelector("#focus-prev-key");
  const focusNextKey = document.querySelector("#focus-next-key");

  const modeScoreOutputs = new Map();
  const recordScoreOutputs = new Map();
  let activeMode = null;
  let profile = emptyProfile(modes);
  let pendingBinding = null;

  modeMenu.replaceChildren(...modes.map((mode) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "menu-button mode-button";
    button.dataset.mode = mode.id;

    const name = document.createElement("span");
    name.textContent = mode.name;
    const scoreLabel = document.createElement("b");
    scoreLabel.append("HI ");
    const output = document.createElement("output");
    output.textContent = "0000000";
    scoreLabel.append(output);
    modeScoreOutputs.set(mode.id, output);
    button.append(name, scoreLabel);
    button.addEventListener("click", () => {
      onAudioEvent("confirm");
      onStartMode(mode.id);
    });
    return button;
  }));

  recordScoreList.replaceChildren(...modes.map((mode) => {
    const row = document.createElement("div");
    row.className = "record-score";
    const name = document.createElement("span");
    name.textContent = mode.name.toUpperCase();
    const output = document.createElement("output");
    output.textContent = "0000000";
    recordScoreOutputs.set(mode.id, output);
    row.append(name, output);
    return row;
  }));

  function renderAchievements() {
    const definitions = Object.values(ACHIEVEMENTS);
    const unlockedCount = definitions.filter((item) => profile.achievements[item.id]?.unlocked).length;
    achievementSummary.textContent = `${unlockedCount} / ${definitions.length}`;
    achievementList.replaceChildren(...definitions.map((item) => {
      const unlocked = Boolean(profile.achievements[item.id]?.unlocked);
      const element = document.createElement("div");
      element.className = `achievement-item${unlocked ? " unlocked" : ""}`;
      const name = document.createElement("b");
      name.textContent = unlocked ? item.name : "?????";
      const description = document.createElement("span");
      description.textContent = unlocked ? item.description : "Locked";
      element.append(name, description);
      return element;
    }));
  }

  function renderProfileNumbers() {
    const ranking = modes
      .map((mode) => [mode, profile.highScores[mode.id] || 0])
      .sort((left, right) => right[1] - left[1]);
    const bestScore = String(ranking[0]?.[1] || 0).padStart(7, "0");
    for (const [mode, value] of ranking) {
      const formatted = String(value).padStart(7, "0");
      modeScoreOutputs.get(mode.id).textContent = formatted;
      recordScoreOutputs.get(mode.id).textContent = formatted;
    }
    document.querySelector("#attract-high-score").textContent = bestScore;
    attractRanking.replaceChildren(...ranking.map(([mode, value], index) => {
      const row = document.createElement("div");
      const rank = document.createElement("b");
      const position = index + 1;
      const lastTwo = position % 100;
      const suffix = lastTwo >= 11 && lastTwo <= 13
        ? "TH"
        : ({ 1: "ST", 2: "ND", 3: "RD" }[position % 10] || "TH");
      rank.textContent = `${position}${suffix}`;
      const name = document.createElement("span");
      name.textContent = mode.name.toUpperCase();
      const output = document.createElement("output");
      output.textContent = String(value).padStart(7, "0");
      row.append(rank, name, output);
      return row;
    }));
    if (activeMode) highScore.textContent = String(profile.highScores[activeMode.id] || 0).padStart(7, "0");
  }

  function renderControlKeys() {
    const bindings = profile.settings.keybindings;
    focusPrevKey.textContent = formatKeyLabel(bindings[GAMEPLAY_ACTION_IDS.focusPrevious]);
    focusNextKey.textContent = formatKeyLabel(bindings[GAMEPLAY_ACTION_IDS.focusNext]);
  }

  function renderKeybindings() {
    keybindingList.replaceChildren(...GAMEPLAY_ACTIONS.map(({ id: action, label }) => {
      const row = document.createElement("div");
      row.className = "keybinding-row";
      const name = document.createElement("span");
      name.textContent = label;
      const button = document.createElement("button");
      button.type = "button";
      button.className = `utility-button${pendingBinding === action ? " binding-capture" : ""}`;
      button.dataset.bindAction = action;
      button.textContent = pendingBinding === action
        ? "PRESS KEY"
        : formatKeyLabel(profile.settings.keybindings[action]);
      button.addEventListener("click", () => {
        onAudioEvent("confirm");
        pendingBinding = action;
        renderKeybindings();
      });
      row.append(name, button);
      return row;
    }));
  }

  function renderAudioSettings() {
    const settings = profile.settings.audio || DEFAULT_AUDIO_SETTINGS;
    masterVolume.value = String(settings.masterVolume);
    musicVolume.value = String(settings.musicVolume);
    sfxVolume.value = String(settings.sfxVolume);
    musicEnabled.checked = settings.musicEnabled;
    sfxEnabled.checked = settings.sfxEnabled;
  }

  function renderOptions() {
    renderAudioSettings();
    renderKeybindings();
  }

  function setProfile(nextProfile) {
    profile = nextProfile || emptyProfile(modes);
    document.documentElement.dataset.theme = profile.settings.theme || "default";
    renderProfileNumbers();
    renderAchievements();
    renderControlKeys();
    renderOptions();
  }

  function setGameMode(mode) {
    activeMode = mode;
    renderProfileNumbers();
  }

  function handleBindingKey(event) {
    if (!pendingBinding) return false;
    event.preventDefault();
    if (event.code === "Escape") {
      pendingBinding = null;
      renderKeybindings();
      return true;
    }
    const action = pendingBinding;
    pendingBinding = null;
    const nextProfile = changeKeybinding(action, event.code);
    if (nextProfile) setProfile(nextProfile);
    renderKeybindings();
    return true;
  }

  document.querySelector("#reset-keybindings").addEventListener("click", () => {
    onAudioEvent("confirm");
    pendingBinding = null;
    const nextProfile = resetKeybindings();
    if (nextProfile) setProfile(nextProfile);
    renderKeybindings();
  });

  for (const input of [masterVolume, musicVolume, sfxVolume]) {
    input.addEventListener("input", () => {
      const nextProfile = changeAudioSetting?.(input.dataset.audioSetting, Number(input.value));
      if (nextProfile) profile = nextProfile;
    });
  }
  for (const input of [musicEnabled, sfxEnabled]) {
    input.addEventListener("change", () => {
      const nextProfile = changeAudioSetting?.(input.dataset.audioSetting, input.checked);
      if (nextProfile) profile = nextProfile;
      onAudioEvent("confirm");
    });
  }

  return {
    getKeybindings: () => profile.settings.keybindings,
    handleBindingKey,
    renderOptions,
    setGameMode,
    setProfile
  };
}
