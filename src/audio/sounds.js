const cue = (...tones) => Object.freeze(tones.map((tone) => Object.freeze(tone)));

export const SOUND_CUES = Object.freeze({
  "menu-select": cue(
    { frequency: 520, duration: 0.025, gain: 0.72 }
  ),
  "menu-confirm": cue(
    { frequency: 330, duration: 0.04, gain: 0.9 },
    { frequency: 660, duration: 0.055, gain: 0.8, delay: 0.045 }
  ),
  "menu-back": cue(
    { frequency: 440, duration: 0.035, gain: 0.7 },
    { frequency: 260, duration: 0.045, gain: 0.7, delay: 0.035 }
  ),
  carve: cue(
    { frequency: 760, duration: 0.03, gain: 0.72 },
    { frequency: 560, duration: 0.035, gain: 0.58, delay: 0.018 }
  ),
  fill: cue(
    { frequency: 420, duration: 0.035, gain: 0.62 },
    { frequency: 630, duration: 0.04, gain: 0.68, delay: 0.03 }
  ),
  "hard-drop": cue(
    { frequency: 210, duration: 0.045, gain: 0.82 },
    { frequency: 120, duration: 0.07, gain: 0.68, delay: 0.025 }
  ),
  lock: cue(
    { frequency: 150, duration: 0.05, gain: 0.64 }
  ),
  "line-clear-1": cue(
    { frequency: 480, duration: 0.055, gain: 0.7 },
    { frequency: 640, duration: 0.065, gain: 0.72, delay: 0.045 }
  ),
  "line-clear-2": cue(
    { frequency: 480, duration: 0.05, gain: 0.72 },
    { frequency: 600, duration: 0.05, gain: 0.72, delay: 0.04 },
    { frequency: 760, duration: 0.075, gain: 0.76, delay: 0.08 }
  ),
  "line-clear-3": cue(
    { frequency: 480, duration: 0.045, gain: 0.74 },
    { frequency: 600, duration: 0.045, gain: 0.74, delay: 0.035 },
    { frequency: 720, duration: 0.045, gain: 0.74, delay: 0.07 },
    { frequency: 900, duration: 0.08, gain: 0.8, delay: 0.105 }
  ),
  "line-clear-4": cue(
    { frequency: 440, duration: 0.05, gain: 0.76 },
    { frequency: 554, duration: 0.05, gain: 0.76, delay: 0.04 },
    { frequency: 659, duration: 0.05, gain: 0.78, delay: 0.08 },
    { frequency: 880, duration: 0.11, gain: 0.86, delay: 0.12 }
  ),
  "level-up": cue(
    { frequency: 660, duration: 0.05, gain: 0.66 },
    { frequency: 880, duration: 0.08, gain: 0.72, delay: 0.05 }
  ),
  garbage: cue(
    { frequency: 105, duration: 0.09, gain: 0.78 },
    { frequency: 92, duration: 0.1, gain: 0.7, delay: 0.055 }
  ),
  attack: cue(
    { frequency: 260, duration: 0.035, gain: 0.58 },
    { frequency: 390, duration: 0.05, gain: 0.62, delay: 0.03 }
  ),
  "game-over": cue(
    { frequency: 420, duration: 0.08, gain: 0.72 },
    { frequency: 315, duration: 0.1, gain: 0.72, delay: 0.075 },
    { frequency: 210, duration: 0.16, gain: 0.78, delay: 0.17 }
  )
});

export function getSoundCue(name) {
  return SOUND_CUES[name] || null;
}

export function lineClearCueName(count) {
  const normalized = Math.max(1, Math.min(4, Math.floor(Number(count) || 1)));
  return `line-clear-${normalized}`;
}