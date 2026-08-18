import { SINGLEPLAYER_CATALOG, isSingleplayerModeId } from "./catalog.js";
import {
  DEFAULT_AUDIO_SETTINGS,
  DEFAULT_KEYBINDINGS,
  PROFILE_SCHEMA_VERSION,
  PROFILE_STORAGE_KEY
} from "../config.js";

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

const SINGLEPLAYER_MODE_IDS = Object.freeze(SINGLEPLAYER_CATALOG.map((mode) => mode.id));

function createDefaultHighScores() {
  return Object.fromEntries(SINGLEPLAYER_MODE_IDS.map((modeId) => [modeId, 0]));
}

function createDefaultData() {
  return {
    schemaVersion: PROFILE_SCHEMA_VERSION,
    highScores: createDefaultHighScores(),
    achievements: {},
    settings: {
      theme: "default",
      keybindings: { ...DEFAULT_KEYBINDINGS },
      audio: { ...DEFAULT_AUDIO_SETTINGS }
    }
  };
}

function clampVolume(value, fallback) {
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

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value, keys) {
  if (!isPlainObject(value)) return false;
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function isCurrentProfileData(value) {
  if (!hasExactKeys(value, ["schemaVersion", "highScores", "achievements", "settings"])) return false;
  if (value.schemaVersion !== PROFILE_SCHEMA_VERSION) return false;

  if (!isPlainObject(value.highScores)) return false;
  for (const [modeId, score] of Object.entries(value.highScores)) {
    if (modeId.trim() === "" || !Number.isSafeInteger(score) || score < 0) return false;
  }

  if (!isPlainObject(value.achievements)) return false;
  const achievementIds = new Set(Object.values(ACHIEVEMENTS).map((achievement) => achievement.id));
  for (const [achievementId, achievement] of Object.entries(value.achievements)) {
    if (!achievementIds.has(achievementId)) return false;
    if (!hasExactKeys(achievement, ["unlocked", "unlockedAt"])) return false;
    if (achievement.unlocked !== true) return false;
    if (typeof achievement.unlockedAt !== "string" || achievement.unlockedAt === "") return false;
  }

  if (!hasExactKeys(value.settings, ["theme", "keybindings", "audio"])) return false;
  if (typeof value.settings.theme !== "string" || value.settings.theme === "") return false;

  const keybindingActions = Object.keys(DEFAULT_KEYBINDINGS);
  if (!hasExactKeys(value.settings.keybindings, keybindingActions)) return false;
  if (!Object.values(value.settings.keybindings).every((code) => typeof code === "string" && code !== "")) {
    return false;
  }

  const audio = value.settings.audio;
  if (!hasExactKeys(audio, ["masterVolume", "musicVolume", "sfxVolume", "musicEnabled", "sfxEnabled"])) {
    return false;
  }
  for (const setting of ["masterVolume", "musicVolume", "sfxVolume"]) {
    if (!Number.isFinite(audio[setting]) || audio[setting] < 0 || audio[setting] > 1) return false;
  }
  return typeof audio.musicEnabled === "boolean" && typeof audio.sfxEnabled === "boolean";
}

function cloneData(data) {
  return JSON.parse(JSON.stringify(data));
}

function normalizeCurrentProfileData(value) {
  if (!isCurrentProfileData(value)) return null;
  const data = cloneData(value);
  for (const modeId of SINGLEPLAYER_MODE_IDS) {
    if (!Object.hasOwn(data.highScores, modeId)) data.highScores[modeId] = 0;
  }
  return data;
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
    const saved = storage?.getItem?.(PROFILE_STORAGE_KEY);
    if (saved != null) data = normalizeCurrentProfileData(safeParse(saved)) || createDefaultData();
  } catch {
    data = createDefaultData();
  }

  function persist() {
    try {
      if (typeof storage?.setItem !== "function") return false;
      storage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(data));
      return true;
    } catch {
      // Persistence is optional; the in-memory profile still works.
      return false;
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
    if (!isSingleplayerModeId(modeId)) return false;
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
      data.settings.audio[setting] = clampVolume(value, data.settings.audio[setting]);
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
    setKeybinding,
    resetKeybindings,
    setAudioSetting
  };
}
