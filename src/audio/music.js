const BASE_BPM = 116;
const BPM_PER_LEVEL = 7;
const MAX_BPM = 200;
const MENU_BPM = 104;
const SCHEDULE_AHEAD_SECONDS = 0.18;
const START_DELAY_SECONDS = 0.04;
const SCHEDULER_INTERVAL_MS = 50;

const note = (pitch, beats) => Object.freeze({ pitch, beats });

function bar(bass, entries) {
  return entries.map((entry, index) => Object.freeze({
    ...entry,
    ...(index === 0 && bass ? { bass, bassBeats: 1 } : {})
  }));
}

// Fresh gameplay arrangement of the public-domain Kalinka melody.
const KALINKA_PRE_CHORUS = Object.freeze([
  ...bar("F3", [note("A4", 0.5), note("C5", 0.5), note("Bb4", 0.5), note("A4", 0.25), note("G4", 0.25)]),
  ...bar("C3", [note("F4", 1), note("C4", 1)]),
  ...bar("F3", [note("A4", 0.5), note("C5", 0.5), note("Bb4", 0.5), note("A4", 0.25), note("G4", 0.25)]),
  ...bar("C3", [note("F4", 1), note("C4", 1)]),
  ...bar("Bb2", [note("D4", 1), note("D4", 0.5), note("E4", 0.5)]),
  ...bar("G2", [note("G4", 0.5), note("F4", 0.5), note("E4", 0.5), note("D4", 0.5)]),
  ...bar("C3", [note("C4", 1), note("C4", 1)]),
  ...bar("C3", [note("C4", 1), note("C5", 1)])
]);

const KALINKA_CHORUS_PASS = Object.freeze([
  ...bar("A2", [note("G4", 1), note("E4", 0.5), note("F4", 0.5)]),
  ...bar("A2", [note("G4", 1), note("E4", 0.5), note("F4", 0.5)]),
  ...bar("A2", [note("G4", 1), note("F4", 0.5), note("E4", 0.5)]),
  ...bar("D3", [note("D4", 1), note("A4", 1)]),
  ...bar("A2", [note("G4", 0.75), note("F4", 0.25), note("E4", 0.5), note("F4", 0.5)]),
  ...bar("A2", [note("G4", 1), note("E4", 0.5), note("F4", 0.5)]),
  ...bar("A2", [note("G4", 1), note("F4", 0.5), note("E4", 0.5)]),
  ...bar("D3", [note("D4", 1), note("A4", 1)])
]);

const KALINKA_CHORUS_END = Object.freeze([
  ...KALINKA_CHORUS_PASS.slice(0, -2),
  ...bar("D3", [note("D5", 2)])
]);

const KALINKA_POST_CHORUS = Object.freeze([
  ...bar("F3", [note("A4", 0.5), note("C5", 0.5), note("G4", 0.5), note("A4", 0.5)]),
  ...bar("C3", [note("F4", 1), note("C4", 1)]),
  ...bar("F3", [note("A4", 0.5), note("C5", 0.5), note("G4", 0.5), note("A4", 0.5)]),
  ...bar("C3", [note("F4", 1), note("C4", 1)]),
  ...bar("Bb2", [note("D4", 1), note("D4", 0.5), note("E4", 0.5)]),
  ...bar("G2", [note("G4", 0.5), note("F4", 0.5), note("E4", 0.5), note("D4", 0.5)]),
  ...bar("C3", [note("C5", 1), note("Bb4", 1)]),
  ...bar("A2", [note("A4", 2)])
]);

const GAMEPLAY_LOOP = Object.freeze([
  ...KALINKA_PRE_CHORUS,
  ...KALINKA_CHORUS_PASS,
  ...KALINKA_CHORUS_END,
  ...KALINKA_POST_CHORUS
]);

const menuLead = (pitch, offset, beats) => Object.freeze({ pitch, offset, beats });

function menuBar(bass, chord, melody = []) {
  return Object.freeze({
    beats: 3,
    bass,
    chord: Object.freeze([...chord]),
    melody: Object.freeze(melody)
  });
}

const AM_CHORD = Object.freeze(["A3", "C4", "E4"]);
const E7_CHORD = Object.freeze(["G#3", "B3", "D4"]);
const F_CHORD = Object.freeze(["F3", "A3", "C4"]);

// Menu arrangement of the calm opening phrase of the public-domain
// "Amur Waves" (Amurskie Volny).
const MENU_LOOP = Object.freeze([
  menuBar("A2", AM_CHORD, [menuLead("E4", 0, 4)]),
  menuBar("A2", AM_CHORD, [menuLead("F4", 1, 1), menuLead("E4", 2, 1)]),
  menuBar("A2", AM_CHORD, [menuLead("C5", 0, 4)]),
  menuBar("A2", AM_CHORD, [menuLead("B4", 1, 1), menuLead("A4", 2, 1)]),
  menuBar("E2", E7_CHORD, [menuLead("G#4", 0, 4)]),
  menuBar("E2", E7_CHORD, [menuLead("B4", 1, 1), menuLead("G#4", 2, 1)]),
  menuBar("E2", E7_CHORD, [menuLead("E4", 0, 5)]),
  menuBar("E2", E7_CHORD),
  menuBar("E2", E7_CHORD, [menuLead("E4", 0, 4)]),
  menuBar("E2", E7_CHORD, [menuLead("F4", 1, 1), menuLead("E4", 2, 1)]),
  menuBar("E2", E7_CHORD, [menuLead("D5", 0, 4)]),
  menuBar("E2", E7_CHORD, [menuLead("C5", 1, 1), menuLead("B4", 2, 1)]),
  menuBar("A2", AM_CHORD, [menuLead("A4", 0, 3)]),
  menuBar("F2", F_CHORD, [menuLead("C5", 0, 2), menuLead("D5", 2, 1)]),
  menuBar("E2", E7_CHORD, [menuLead("E5", 0, 5)]),
  menuBar("E2", E7_CHORD)
]);

const NOTE_OFFSETS = Object.freeze({
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11
});

function frequencyForPitch(pitch) {
  const match = /^([A-G])(b|#)?(-?\d+)$/.exec(pitch || "");
  if (!match) return 440;
  const [, letter, accidental = "", octaveText] = match;
  const accidentalOffset = accidental === "#" ? 1 : accidental === "b" ? -1 : 0;
  const midi = (Number(octaveText) + 1) * 12 + NOTE_OFFSETS[letter] + accidentalOffset;
  return 440 * (2 ** ((midi - 69) / 12));
}

export function getGameplayBpm(level = 1) {
  const normalizedLevel = Math.max(1, Math.floor(Number(level) || 1));
  return Math.min(MAX_BPM, BASE_BPM + ((normalizedLevel - 1) * BPM_PER_LEVEL));
}

export function getMenuBpm() {
  return MENU_BPM;
}

export function createMusicController({
  setIntervalFn = globalThis.setInterval?.bind(globalThis),
  clearIntervalFn = globalThis.clearInterval?.bind(globalThis)
} = {}) {
  let audio = null;
  let output = null;
  let scene = "silent";
  let intensity = 1;
  let schedulerHandle = null;
  let nextNoteTime = 0;
  let gameplayLoopIndex = 0;
  let menuLoopIndex = 0;
  const activeOscillators = new Set();

  function stopOscillators() {
    for (const oscillator of activeOscillators) {
      try {
        oscillator.stop(audio?.currentTime || 0);
      } catch {
        // A scheduled oscillator may already have ended.
      }
      oscillator.disconnect?.();
    }
    activeOscillators.clear();
  }

  function stopScheduler({ reset = false } = {}) {
    if (schedulerHandle != null) clearIntervalFn?.(schedulerHandle);
    schedulerHandle = null;
    stopOscillators();
    nextNoteTime = 0;
    if (reset) {
      gameplayLoopIndex = 0;
      menuLoopIndex = 0;
    }
  }

  function scheduleOscillator({ pitch, start, duration, type, gain }) {
    if (!audio || !output || !pitch || duration <= 0) return;
    const oscillator = audio.createOscillator();
    const envelope = audio.createGain();
    const end = start + duration;
    const release = Math.max(start + 0.012, end - 0.012);

    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequencyForPitch(pitch), start);
    envelope.gain.setValueAtTime(0.0001, start);
    envelope.gain.exponentialRampToValueAtTime(gain, Math.min(end, start + 0.006));
    envelope.gain.setValueAtTime(gain, release);
    envelope.gain.exponentialRampToValueAtTime(0.0001, end);
    oscillator.connect(envelope);
    envelope.connect(output);

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

  function scheduleEvent(event, start, secondsPerBeat) {
    const noteDuration = Math.max(0.03, event.beats * secondsPerBeat * 0.82);
    scheduleOscillator({
      pitch: event.pitch,
      start,
      duration: noteDuration,
      type: "square",
      gain: 0.052
    });

    if (event.bass) {
      scheduleOscillator({
        pitch: event.bass,
        start,
        duration: Math.max(0.04, event.bassBeats * secondsPerBeat * 0.68),
        type: "triangle",
        gain: 0.038
      });
    }
  }

  function scheduleMenuBar(event, start, secondsPerBeat) {
    const leadGap = Math.min(0.035, secondsPerBeat * 0.08);
    for (const melodyNote of event.melody) {
      scheduleOscillator({
        pitch: melodyNote.pitch,
        start: start + (melodyNote.offset * secondsPerBeat),
        duration: Math.max(0.05, (melodyNote.beats * secondsPerBeat) - leadGap),
        type: "triangle",
        gain: 0.034
      });
    }

    scheduleOscillator({
      pitch: event.bass,
      start,
      duration: secondsPerBeat * 0.72,
      type: "triangle",
      gain: 0.026
    });

    for (const offset of [1, 2]) {
      for (const pitch of event.chord) {
        scheduleOscillator({
          pitch,
          start: start + (offset * secondsPerBeat),
          duration: secondsPerBeat * 0.24,
          type: "square",
          gain: 0.009
        });
      }
    }
  }

  function isPlayableScene() {
    return scene === "gameplay" || scene === "menu";
  }

  function scheduleAhead() {
    if (!audio || !output || !isPlayableScene()) return;
    const secondsPerBeat = 60 / (scene === "menu" ? MENU_BPM : getGameplayBpm(intensity));
    const horizon = audio.currentTime + SCHEDULE_AHEAD_SECONDS;

    while (nextNoteTime < horizon) {
      if (scene === "menu") {
        const event = MENU_LOOP[menuLoopIndex];
        scheduleMenuBar(event, nextNoteTime, secondsPerBeat);
        nextNoteTime += event.beats * secondsPerBeat;
        menuLoopIndex = (menuLoopIndex + 1) % MENU_LOOP.length;
      } else {
        const event = GAMEPLAY_LOOP[gameplayLoopIndex];
        scheduleEvent(event, nextNoteTime, secondsPerBeat);
        nextNoteTime += event.beats * secondsPerBeat;
        gameplayLoopIndex = (gameplayLoopIndex + 1) % GAMEPLAY_LOOP.length;
      }
    }
  }

  function startScheduler() {
    if (!audio || !output || !isPlayableScene() || schedulerHandle != null) return;
    nextNoteTime = audio.currentTime + START_DELAY_SECONDS;
    scheduleAhead();
    schedulerHandle = setIntervalFn?.(scheduleAhead, SCHEDULER_INTERVAL_MS) ?? null;
  }

  function syncPlayback({ reset = false } = {}) {
    if (isPlayableScene()) {
      startScheduler();
      return;
    }
    stopScheduler({ reset });
  }

  return {
    attach({ context, output: nextOutput } = {}) {
      audio = context || null;
      output = nextOutput || null;
      syncPlayback();
    },
    setScene(nextScene) {
      const normalizedScene = nextScene || "silent";
      if (scene === normalizedScene) return;
      const previousScene = scene;
      stopScheduler();
      scene = normalizedScene;
      if (scene === "menu") menuLoopIndex = 0;
      if (scene === "gameplay" && previousScene !== "paused") gameplayLoopIndex = 0;
      if (scene === "gameover" || scene === "silent") {
        gameplayLoopIndex = 0;
        menuLoopIndex = 0;
      }
      syncPlayback();
    },
    setIntensity(nextIntensity) {
      const next = Math.max(1, Math.floor(Number(nextIntensity) || 1));
      if (intensity === next) return;
      intensity = next;
      if (scene === "gameplay" && audio && output) {
        // Level changes are discrete tempo changes: each level has one fixed
        // BPM, and the scheduler restarts immediately at that new BPM.
        stopScheduler();
        startScheduler();
      }
    },
    stop() {
      scene = "silent";
      stopScheduler({ reset: true });
    },
    dispose() {
      stopScheduler({ reset: true });
      audio = null;
      output = null;
      scene = "silent";
    },
    getState() {
      return {
        scene,
        intensity,
        bpm: scene === "menu" ? MENU_BPM : getGameplayBpm(intensity),
        playing: schedulerHandle != null,
        attached: Boolean(audio && output)
      };
    }
  };
}
