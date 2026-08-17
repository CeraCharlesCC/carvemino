import { createMusicController } from "./music.js";
import { getSoundCue, lineClearCueName } from "./sounds.js";

const MENU_AUDIO_EVENTS = Object.freeze({
  select: "menu-select",
  confirm: "menu-confirm",
  back: "menu-back"
});

const DEFAULT_SETTINGS = Object.freeze({
  masterVolume: 0.8,
  musicVolume: 0.55,
  sfxVolume: 0.8,
  musicEnabled: true,
  sfxEnabled: true
});

function defaultContextFactory() {
  const AudioContext = globalThis.AudioContext || globalThis.webkitAudioContext;
  return AudioContext ? new AudioContext() : null;
}

function clampVolume(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.min(1, number));
}

function normalizeSettings(settings = {}) {
  return {
    masterVolume: clampVolume(settings.masterVolume, DEFAULT_SETTINGS.masterVolume),
    musicVolume: clampVolume(settings.musicVolume, DEFAULT_SETTINGS.musicVolume),
    sfxVolume: clampVolume(settings.sfxVolume, DEFAULT_SETTINGS.sfxVolume),
    musicEnabled: typeof settings.musicEnabled === "boolean"
      ? settings.musicEnabled
      : DEFAULT_SETTINGS.musicEnabled,
    sfxEnabled: typeof settings.sfxEnabled === "boolean"
      ? settings.sfxEnabled
      : DEFAULT_SETTINGS.sfxEnabled
  };
}

function setGainValue(audio, gainNode, value) {
  if (!audio || !gainNode) return;
  const now = audio.currentTime;
  gainNode.gain.cancelScheduledValues?.(now);
  if (typeof gainNode.gain.setTargetAtTime === "function") {
    gainNode.gain.setTargetAtTime(value, now, 0.015);
  } else {
    gainNode.gain.setValueAtTime(value, now);
  }
}

export function createAudioEngine({
  contextFactory = defaultContextFactory,
  musicController = createMusicController()
} = {}) {
  let context = null;
  let masterGain = null;
  let musicGain = null;
  let sfxGain = null;
  let settings = { ...DEFAULT_SETTINGS };
  let screen = "menu";
  let lifecycle = "menu";
  let modeId = null;
  let level = 1;
  const activeOscillators = new Set();

  function applyMixerSettings() {
    if (!context) return;
    setGainValue(context, masterGain, settings.masterVolume);
    setGainValue(context, musicGain, settings.musicEnabled ? settings.musicVolume : 0);
    setGainValue(context, sfxGain, settings.sfxEnabled ? settings.sfxVolume : 0);
  }

  function ensureGraph() {
    if (context) return context;
    context = contextFactory?.() || null;
    if (!context) return null;

    masterGain = context.createGain();
    musicGain = context.createGain();
    sfxGain = context.createGain();
    musicGain.connect(masterGain);
    sfxGain.connect(masterGain);
    masterGain.connect(context.destination);
    musicController.attach?.({ context, output: musicGain });
    applyMixerSettings();
    return context;
  }

  function unlock() {
    const audio = ensureGraph();
    if (!audio || audio.state !== "suspended") return;
    const resume = audio.resume?.();
    resume?.catch?.(() => {});
  }

  function playTone(tone, extraDelay = 0) {
    if (!settings.sfxEnabled || settings.masterVolume <= 0 || settings.sfxVolume <= 0) return;
    const audio = ensureGraph();
    if (!audio) return;
    unlock();

    const duration = Math.max(0.01, Number(tone.duration) || 0.04);
    const delay = Math.max(0, (Number(tone.delay) || 0) + extraDelay);
    const start = audio.currentTime + delay;
    const end = start + duration;
    const oscillator = audio.createOscillator();
    const envelope = audio.createGain();
    const peak = Math.max(0.0001, Math.min(1, (Number(tone.gain) || 0.5) * 0.08));

    oscillator.type = tone.type || "square";
    oscillator.frequency.setValueAtTime(Number(tone.frequency) || 440, start);
    envelope.gain.setValueAtTime(0.0001, start);
    envelope.gain.exponentialRampToValueAtTime(peak, Math.min(end, start + 0.006));
    envelope.gain.exponentialRampToValueAtTime(0.0001, end);
    oscillator.connect(envelope);
    envelope.connect(sfxGain);

    activeOscillators.add(oscillator);
    const cleanup = () => {
      activeOscillators.delete(oscillator);
      oscillator.disconnect?.();
      envelope.disconnect?.();
    };
    if (typeof oscillator.addEventListener === "function") {
      oscillator.addEventListener("ended", cleanup, { once: true });
    } else {
      oscillator.onended = cleanup;
    }

    oscillator.start(start);
    oscillator.stop(end + 0.002);
  }

  function playCue(name, delay = 0) {
    const tones = getSoundCue(name);
    if (!tones) return;
    for (const tone of tones) playTone(tone, delay);
  }

  function syncMusicScene() {
    musicController.setIntensity(level);
    if (lifecycle === "playing") musicController.setScene("gameplay");
    else if (lifecycle === "paused") musicController.setScene("paused");
    else if (lifecycle === "gameover") musicController.setScene("gameover");
    else musicController.setScene("menu");
  }

  function shouldStartMusicGraph() {
    return (
      (lifecycle === "menu" || lifecycle === "playing")
      && settings.musicEnabled
      && settings.masterVolume > 0
      && settings.musicVolume > 0
    );
  }

  function setScreen(nextScreen) {
    screen = nextScreen || "menu";
    if (screen !== "game") {
      lifecycle = "menu";
      modeId = null;
      level = 1;
    }
    syncMusicScene();
  }

  function handleUiEvent(type) {
    const cueName = MENU_AUDIO_EVENTS[type];
    if (!cueName) return;
    // The first menu interaction is also the browser-safe unlock point for the
    // menu BGM. This still works when SFX are muted.
    if (lifecycle === "menu" && shouldStartMusicGraph()) {
      ensureGraph();
      unlock();
    }
    // Menu/pause interaction sounds are owned here, not in the UI layer.
    playCue(cueName);
  }

  function startGame({ modeId: nextModeId = null, level: nextLevel = 1 } = {}) {
    modeId = nextModeId;
    level = Math.max(1, Math.floor(Number(nextLevel) || 1));
    musicController.stop?.();
    if (settings.musicEnabled && settings.masterVolume > 0 && settings.musicVolume > 0) {
      ensureGraph();
      unlock();
    }
    lifecycle = "playing";
    syncMusicScene();
  }

  function pauseGame() {
    if (lifecycle !== "playing") return;
    lifecycle = "paused";
    syncMusicScene();
  }

  function resumeGame() {
    if (lifecycle !== "paused") return;
    if (settings.musicEnabled && settings.masterVolume > 0 && settings.musicVolume > 0) {
      ensureGraph();
      unlock();
    }
    lifecycle = "playing";
    syncMusicScene();
  }

  function handleGameEvents(events = [], gameState = null) {
    if (!Array.isArray(events) || events.length === 0) return;
    const byType = new Map(events.map((event) => [event.type, event]));

    if (byType.has("GAME_OVER")) {
      playCue("game-over");
      lifecycle = "gameover";
      syncMusicScene();
      return;
    }

    if (byType.has("BLOCK_CARVED")) playCue("carve");
    if (byType.has("BLOCK_FILLED")) playCue("fill");
    if (byType.has("PIECE_HARD_DROPPED")) playCue("hard-drop");

    const lineClear = byType.get("LINES_CLEARED");
    if (lineClear) {
      playCue(lineClearCueName(lineClear.count));
    } else if (byType.has("PIECE_LOCKED")) {
      // Avoid stacking a lock beep under a line-clear phrase from the same tick.
      playCue("lock");
    }

    if (byType.has("GARBAGE_APPLIED")) playCue("garbage");
    if (byType.has("ATTACK_GENERATED")) playCue("attack", lineClear ? 0.15 : 0);

    const levelChanged = byType.get("LEVEL_CHANGED");
    if (levelChanged) {
      level = Math.max(1, Math.floor(Number(levelChanged.level) || level));
      musicController.setIntensity(level);
      playCue("level-up", lineClear ? 0.2 : 0);
    } else if (gameState?.level) {
      level = Math.max(1, Math.floor(Number(gameState.level) || level));
    }
  }

  function setSettings(nextSettings) {
    settings = normalizeSettings({ ...settings, ...(nextSettings || {}) });
    if (lifecycle === "playing" && shouldStartMusicGraph()) {
      ensureGraph();
      unlock();
    }
    applyMixerSettings();
  }

  function stopAll() {
    for (const oscillator of [...activeOscillators]) {
      try {
        oscillator.stop();
      } catch {
        // An oscillator may already be stopped; cleanup still happens on ended.
      }
    }
    activeOscillators.clear();
  }

  function dispose() {
    stopAll();
    musicController.dispose?.();
    const closing = context?.close?.();
    closing?.catch?.(() => {});
    context = null;
    masterGain = null;
    musicGain = null;
    sfxGain = null;
  }

  return {
    unlock,
    setScreen,
    handleUiEvent,
    startGame,
    pauseGame,
    resumeGame,
    handleGameEvents,
    setSettings,
    stopAll,
    dispose,
    getState() {
      return {
        screen,
        lifecycle,
        modeId,
        level,
        settings: { ...settings },
        music: musicController.getState?.() || null
      };
    }
  };
}
