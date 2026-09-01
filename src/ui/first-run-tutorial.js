import {
  FIRST_RUN_TUTORIAL_STORAGE_KEY,
  PROFILE_STORAGE_KEY,
  STARTUP_MANUAL_STORAGE_KEY
} from "../config.js";

export const FIRST_RUN_STAGES = Object.freeze({
  fresh: "fresh",
  menuAcknowledged: "menu-acknowledged",
  tutorialOfferResolved: "tutorial-offer-resolved",
  complete: "complete"
});

const VALID_STAGES = new Set(Object.values(FIRST_RUN_STAGES));
const CURSOR_ACTIONS = new Set(["cursorUp", "cursorLeft", "cursorDown", "cursorRight"]);
export const TUTORIAL_CLEAR_READING_DELAY_MS = 7000;

function defaultStorage() {
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

export function createFirstRunTutorialStore(storage = defaultStorage()) {
  let stage = FIRST_RUN_STAGES.fresh;
  try {
    const saved = storage?.getItem?.(FIRST_RUN_TUTORIAL_STORAGE_KEY);
    if (VALID_STAGES.has(saved)) {
      // An accepted tutorial that did not finish cleanly (tab closed/crash) is
      // still a resolved one-time offer. Do not force it again on next launch.
      stage = saved === FIRST_RUN_STAGES.tutorialOfferResolved
        ? FIRST_RUN_STAGES.complete
        : saved;
    } else if (storage?.getItem?.(STARTUP_MANUAL_STORAGE_KEY) === "1"
        || storage?.getItem?.(PROFILE_STORAGE_KEY) != null) {
      stage = FIRST_RUN_STAGES.complete;
    }
  } catch {
    stage = FIRST_RUN_STAGES.complete;
  }

  function persist(nextStage) {
    stage = nextStage;
    try {
      storage?.setItem?.(FIRST_RUN_TUTORIAL_STORAGE_KEY, stage);
    } catch {
      // Persistence is optional. The in-memory state still prevents repeated prompts.
    }
    return stage;
  }

  persist(stage);

  return {
    getStage: () => stage,
    shouldShowMenuControls: () => stage === FIRST_RUN_STAGES.fresh,
    shouldOfferTutorial: () => stage === FIRST_RUN_STAGES.menuAcknowledged,
    acknowledgeMenu: () => persist(FIRST_RUN_STAGES.menuAcknowledged),
    acceptTutorial: () => persist(FIRST_RUN_STAGES.tutorialOfferResolved),
    declineTutorial: () => persist(FIRST_RUN_STAGES.complete),
    completeTutorial: () => persist(FIRST_RUN_STAGES.complete),
    abandonTutorial: () => persist(FIRST_RUN_STAGES.complete)
  };
}

const GUIDE_BASE = Object.freeze({
  move: Object.freeze({ step: "move", messageKey: "tutorial.guide.move", control: "move" }),
  cut: Object.freeze({ step: "cut", messageKey: "tutorial.guide.cut", control: "sculpt" }),
  moveSecond: Object.freeze({ step: "move-second", messageKey: "tutorial.guide.moveSecond", control: "move" }),
  cutAgain: Object.freeze({ step: "cut-again", messageKey: "tutorial.guide.cutAgain", control: "sculpt" }),
  moveFill: Object.freeze({ step: "move-fill", messageKey: "tutorial.guide.moveFill", control: "move" }),
  fill: Object.freeze({ step: "fill", messageKey: "tutorial.guide.fill", control: "sculpt" }),
  drop: Object.freeze({ step: "drop", messageKey: "tutorial.guide.drop", control: "drop" }),
  clear: Object.freeze({ step: "clear", messageKey: "tutorial.guide.clear", control: null })
});

function sameCell(a, b) {
  return Boolean(a && b && a.x === b.x && a.y === b.y);
}

function guideFor(step, plan) {
  const base = GUIDE_BASE[step];
  if (!base) throw new Error(`Unknown tutorial step: ${String(step)}`);
  let targetCell = null;
  let targetKind = null;
  if (step === "move" || step === "cut") {
    targetCell = plan?.cutTargets?.[0] || plan?.moveTarget || null;
    targetKind = "carve";
  } else if (step === "moveSecond" || step === "cutAgain") {
    targetCell = plan?.cutTargets?.[1] || null;
    targetKind = "carve";
  } else if (step === "moveFill" || step === "fill") {
    targetCell = plan?.fillTarget || null;
    targetKind = "fill";
  }
  return Object.freeze({
    ...base,
    targetCell: targetCell ? Object.freeze({ ...targetCell }) : null,
    targetKind
  });
}

export function createTutorialCoordinator({
  onGuide = () => {},
  onRelease = () => {},
  onComplete = () => {},
  scheduleRelease = globalThis.setTimeout?.bind(globalThis),
  cancelRelease = globalThis.clearTimeout?.bind(globalThis),
  clearReadingDelayMs = TUTORIAL_CLEAR_READING_DELAY_MS
} = {}) {
  let step = null;
  let plan = null;
  let releaseTimer = null;

  function cancelPendingRelease() {
    if (releaseTimer == null) return;
    cancelRelease?.(releaseTimer);
    releaseTimer = null;
  }

  function releaseAfterReadingTime() {
    cancelPendingRelease();
    if (typeof scheduleRelease !== "function" || clearReadingDelayMs <= 0) {
      onRelease();
      return;
    }
    releaseTimer = scheduleRelease(() => {
      releaseTimer = null;
      if (step === "clear") onRelease();
    }, clearReadingDelayMs);
  }

  function setStep(nextStep) {
    step = nextStep;
    onGuide(guideFor(nextStep, plan));
  }

  function start(nextPlan) {
    if (!nextPlan?.cutTargets?.[0] || !nextPlan?.cutTargets?.[1] || !nextPlan?.fillTarget) {
      throw new Error("tutorial plan with two cut targets and one fill target is required");
    }
    cancelPendingRelease();
    plan = nextPlan;
    setStep("move");
  }

  function stop() {
    cancelPendingRelease();
    step = null;
    plan = null;
  }

  function handleAction(actionId, context = {}) {
    if (!CURSOR_ACTIONS.has(actionId) || !step || !plan) return false;
    const movementSteps = {
      move: { target: plan.moveTarget || plan.cutTargets[0], next: "cut" },
      moveSecond: { target: plan.cutTargets[1], next: "cutAgain" },
      moveFill: { target: plan.fillTarget, next: "fill" }
    };
    const movement = movementSteps[step];
    if (!movement || !sameCell(context.cursor, movement.target)) return false;
    setStep(movement.next);
    return true;
  }

  function handleEvents(events = []) {
    let changed = false;
    for (const event of events) {
      if (step === "cut" && event.type === "BLOCK_CARVED" && sameCell(event.cell, plan.cutTargets[0])) {
        setStep("moveSecond");
        changed = true;
      } else if (step === "cutAgain" && event.type === "BLOCK_CARVED" && sameCell(event.cell, plan.cutTargets[1])) {
        setStep("moveFill");
        changed = true;
      } else if (step === "fill" && event.type === "BLOCK_FILLED") {
        if (!sameCell(event.cell, plan.fillTarget)) continue;
        setStep("drop");
        changed = true;
      } else if (step === "drop" && event.type === "PIECE_HARD_DROPPED") {
        setStep("clear");
        releaseAfterReadingTime();
        changed = true;
      } else if (step === "clear" && event.type === "LINES_CLEARED") {
        cancelPendingRelease();
        step = null;
        plan = null;
        onComplete();
        changed = true;
      }
    }
    return changed;
  }

  return {
    start,
    stop,
    handleAction,
    handleEvents,
    getStep: () => step
  };
}
