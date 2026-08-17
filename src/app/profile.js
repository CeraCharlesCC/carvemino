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

const STORAGE_KEY = "carvemino-profile-v1";

function createDefaultData() {
  return {
    version: 1,
    highScores: { classic: 0, carver: 0 },
    achievements: {},
    settings: {
      theme: "default",
      keybindings: { ...DEFAULT_KEYBINDINGS }
    }
  };
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
    resetKeybindings
  };
}