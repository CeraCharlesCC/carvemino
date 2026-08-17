export const ACHIEVEMENTS = Object.freeze({
  firstCut: Object.freeze({
    id: "first-cut",
    name: "FIRST CUT",
    description: "Carve your first block."
  }),
  fullCut: Object.freeze({
    id: "full-cut",
    name: "FULL CUT",
    description: "Use every carve available on a single piece."
  }),
  carvemino: Object.freeze({
    id: "carvemino",
    name: "CARVEMINO",
    description: "Clear 4 or more lines simultaneously."
  })
});

export const DEFAULT_KEYBINDINGS = Object.freeze({
  focusPrevious: "KeyQ",
  focusNext: "KeyE",
  cursorUp: "KeyW",
  cursorLeft: "KeyA",
  cursorDown: "KeyS",
  cursorRight: "KeyD",
  carve: "KeyZ",
  fill: "KeyF",
  hardDrop: "Space",
  restart: "KeyR"
});

export const DEFAULT_AUDIO_SETTINGS = Object.freeze({
  masterVolume: 0.8,
  musicVolume: 0.55,
  sfxVolume: 0.8,
  musicEnabled: true,
  sfxEnabled: true
});

const STORAGE_KEY = "carvemino-profile-v1";

function createDefaultData() {
  return {
    version: 1,
    highScores: { classic: 0, carver: 0 },
    achievements: {},
    settings: {
      theme: "default",
      keybindings: { ...DEFAULT_KEYBINDINGS },
      audio: { ...DEFAULT_AUDIO_SETTINGS }
    }
  };
}

function normalizeVolume(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.min(1, number));
}

function safeParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function normalizeData(value) {
  const defaults = createDefaultData();
  if (!value || typeof value !== "object") return defaults;
  return {
    version: 1,
    highScores: {
      ...defaults.highScores,
      ...(value.highScores || {})
    },
    achievements: { ...(value.achievements || {}) },
    settings: {
      theme: value.settings?.theme || defaults.settings.theme,
      keybindings: {
        ...defaults.settings.keybindings,
        ...(value.settings?.keybindings || {})
      },
      audio: {
        masterVolume: normalizeVolume(
          value.settings?.audio?.masterVolume,
          defaults.settings.audio.masterVolume
        ),
        musicVolume: normalizeVolume(
          value.settings?.audio?.musicVolume,
          defaults.settings.audio.musicVolume
        ),
        sfxVolume: normalizeVolume(
          value.settings?.audio?.sfxVolume,
          defaults.settings.audio.sfxVolume
        ),
        musicEnabled: typeof value.settings?.audio?.musicEnabled === "boolean"
          ? value.settings.audio.musicEnabled
          : defaults.settings.audio.musicEnabled,
        sfxEnabled: typeof value.settings?.audio?.sfxEnabled === "boolean"
          ? value.settings.audio.sfxEnabled
          : defaults.settings.audio.sfxEnabled
      }
    }
  };
}

function cloneData(data) {
  return JSON.parse(JSON.stringify(data));
}

export function createProfileStore(storage) {
  if (storage === undefined) {
    try {
      storage = globalThis.localStorage;
    } catch {
      storage = null;
    }
  }
  let data = createDefaultData();

  try {
    const saved = storage?.getItem?.(STORAGE_KEY);
    if (saved) data = normalizeData(safeParse(saved));
  } catch {
    data = createDefaultData();
  }

  function persist() {
    try {
      storage?.setItem?.(STORAGE_KEY, JSON.stringify(data));
    } catch {
      // Persistence is optional; the in-memory profile still works.
    }
  }

  function unlock(achievement, unlocked) {
    if (!achievement || data.achievements[achievement.id]) return;
    data.achievements[achievement.id] = {
      unlocked: true,
      unlockedAt: new Date().toISOString()
    };
    unlocked.push(achievement);
  }

  function recordScore(modeId, score) {
    const normalized = Math.max(0, Math.floor(Number(score) || 0));
    const previous = data.highScores[modeId] || 0;
    if (normalized <= previous) return false;
    data.highScores[modeId] = normalized;
    persist();
    return true;
  }

  function processGameEvents(modeId, events, score) {
    const unlocked = [];
    for (const event of events || []) {
      if (event.type === "BLOCK_CARVED") {
        unlock(ACHIEVEMENTS.firstCut, unlocked);
        if (event.carveLimit > 0 && event.carved >= event.carveLimit) {
          unlock(ACHIEVEMENTS.fullCut, unlocked);
        }
      }
      if (event.type === "LINES_CLEARED" && event.count >= 4) {
        unlock(ACHIEVEMENTS.carvemino, unlocked);
      }
    }
    const highScoreChanged = recordScore(modeId, score);
    if (unlocked.length > 0) persist();
    return { unlocked, highScoreChanged };
  }

  function setTheme(theme) {
    data.settings.theme = theme || "default";
    persist();
  }

  function setKeybinding(action, code) {
    if (!(action in DEFAULT_KEYBINDINGS) || typeof code !== "string" || !code) return false;
    const previousCode = data.settings.keybindings[action];
    for (const otherAction of Object.keys(data.settings.keybindings)) {
      if (otherAction !== action && data.settings.keybindings[otherAction] === code) {
        data.settings.keybindings[otherAction] = previousCode;
        break;
      }
    }
    data.settings.keybindings[action] = code;
    persist();
    return true;
  }

  function resetKeybindings() {
    data.settings.keybindings = { ...DEFAULT_KEYBINDINGS };
    persist();
  }

  function setAudioSetting(setting, value) {
    if (setting === "masterVolume" || setting === "musicVolume" || setting === "sfxVolume") {
      data.settings.audio[setting] = normalizeVolume(value, data.settings.audio[setting]);
    } else if (setting === "musicEnabled" || setting === "sfxEnabled") {
      if (typeof value !== "boolean") return false;
      data.settings.audio[setting] = value;
    } else {
      return false;
    }
    persist();
    return true;
  }

  return {
    getSnapshot() {
      return cloneData(data);
    },
    getHighScore(modeId) {
      return data.highScores[modeId] || 0;
    },
    recordScore,
    processGameEvents,
    setTheme,
    setKeybinding,
    resetKeybindings,
    setAudioSetting
  };
}