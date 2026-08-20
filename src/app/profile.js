import { SINGLEPLAYER_CATALOG, isSingleplayerModeId } from "./catalog.js";
import {
  DEFAULT_AUDIO_SETTINGS,
  DEFAULT_KEYBINDINGS,
  PROFILE_SCHEMA_VERSION,
  PROFILE_STORAGE_KEY
} from "../config.js";
import { defineCodec, shape as s } from "../codec.js";

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
const nonEmptyString = s.string({ nonEmpty: true });
const keybindingShape = s.object(Object.fromEntries(
  Object.keys(DEFAULT_KEYBINDINGS).map((action) => [action, nonEmptyString])
));
const achievementIds = Object.values(ACHIEVEMENTS).map((achievement) => achievement.id);
const PROFILE_CODEC = defineCodec(s.object({
  schemaVersion: s.literal(PROFILE_SCHEMA_VERSION),
  highScores: s.record(s.integer({ minimum: 0 }), { key: nonEmptyString }),
  achievements: s.record(s.object({
    unlocked: s.literal(true),
    unlockedAt: nonEmptyString
  }), { key: s.enum(achievementIds) }),
  settings: s.object({
    theme: nonEmptyString,
    keybindings: keybindingShape,
    audio: s.object({
      masterVolume: s.number({ minimum: 0, maximum: 1 }),
      musicVolume: s.number({ minimum: 0, maximum: 1 }),
      sfxVolume: s.number({ minimum: 0, maximum: 1 }),
      musicEnabled: s.boolean(),
      sfxEnabled: s.boolean()
    })
  })
}));

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

function normalizeCurrentProfileData(value) {
  const data = PROFILE_CODEC.tryParse(value, "profile");
  if (!data) return null;
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
      if (typeof storage?.setItem !== "function") return;
      storage.setItem(PROFILE_STORAGE_KEY, PROFILE_CODEC.stringify(data, "profile"));
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
      return PROFILE_CODEC.parse(data, "profile");
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
