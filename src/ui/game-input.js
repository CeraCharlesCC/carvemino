import { GAMEPLAY_ACTIONS, GAMEPLAY_ACTION_IDS } from "../config.js";
import { DEFAULT_INPUT_REPEAT_DELAY, DEFAULT_INPUT_REPEAT_INTERVAL } from "./input-constants.js";

const GAMEPLAY_ACTION_ID_SET = new Set(GAMEPLAY_ACTIONS.map(({ id }) => id));
const REPEATING_GAME_ACTIONS = new Set([
  GAMEPLAY_ACTION_IDS.cursorUp,
  GAMEPLAY_ACTION_IDS.cursorLeft,
  GAMEPLAY_ACTION_IDS.cursorDown,
  GAMEPLAY_ACTION_IDS.cursorRight
]);

export function formatKeyLabel(code) {
  if (!code) return "-";
  if (code === "Space") return "SPACE";
  if (code === "ShiftLeft") return "L SHIFT";
  if (code === "ShiftRight") return "R SHIFT";
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  if (code.startsWith("Arrow")) return code.slice(5).toUpperCase();
  return code.replace(/([a-z])([A-Z])/g, "$1 $2").toUpperCase();
}

export function getGameInputAction(code, bindings = {}) {
  const action = GAMEPLAY_ACTIONS.find(({ id }) => bindings[id] === code)?.id;
  if (action) return action;
  return code === "Enter" ? GAMEPLAY_ACTION_IDS.sculpt : null;
}

export function isGameplayActionId(actionId) {
  return GAMEPLAY_ACTION_ID_SET.has(actionId);
}

export function isRepeatingGameAction(actionId) {
  return REPEATING_GAME_ACTIONS.has(actionId);
}

export function getOnScreenGameAction(target, root) {
  const control = target?.closest?.("[data-game-action]");
  if (!control || control.disabled) return null;
  if (root?.contains && !root.contains(control)) return null;
  return isGameplayActionId(control.dataset?.gameAction) ? control.dataset.gameAction : null;
}

export function triggerHapticFeedback(vibrate = globalThis.navigator?.vibrate) {
  if (typeof vibrate !== "function") return false;
  try {
    vibrate.call(globalThis.navigator, 8);
    return true;
  } catch {
    return false;
  }
}

export function createOnScreenGameInput({
  root,
  performAction,
  vibrate = globalThis.navigator?.vibrate,
  repeatDelay = DEFAULT_INPUT_REPEAT_DELAY,
  repeatInterval = DEFAULT_INPUT_REPEAT_INTERVAL
}) {
  if (!root || typeof root.addEventListener !== "function") {
    throw new Error("on-screen game input root is required");
  }
  if (typeof performAction !== "function") {
    throw new Error("on-screen game input requires an action dispatcher");
  }

  const activePointers = new Map();

  function clearPointer(pointerId) {
    const active = activePointers.get(pointerId);
    if (!active) return;
    if (active.timeout !== null) clearTimeout(active.timeout);
    if (active.interval !== null) clearInterval(active.interval);
    activePointers.delete(pointerId);
    if (![...activePointers.values()].some(({ control }) => control === active.control)) {
      active.control?.classList?.remove("is-pressed");
    }
  }

  function startRepeat(pointerId, actionId) {
    if (!isRepeatingGameAction(actionId)) return;
    const active = activePointers.get(pointerId);
    if (!active) return;
    active.timeout = setTimeout(() => {
      const current = activePointers.get(pointerId);
      if (!current) return;
      if (performAction(actionId) === false) {
        clearPointer(pointerId);
        return;
      }
      current.interval = setInterval(() => {
        if (performAction(actionId) === false) clearPointer(pointerId);
      }, repeatInterval);
    }, repeatDelay);
  }

  function handlePointerDown(event) {
    if (event.isPrimary === false && event.pointerType === "mouse") return;
    const actionId = getOnScreenGameAction(event.target, root);
    if (!actionId) return;
    const control = event.target?.closest?.("[data-game-action]");

    clearPointer(event.pointerId);
    activePointers.set(event.pointerId, { actionId, control, timeout: null, interval: null });
    control?.classList?.add("is-pressed");
    control?.setPointerCapture?.(event.pointerId);
    event.preventDefault();
    if (performAction(actionId) === false) {
      clearPointer(event.pointerId);
      return;
    }
    triggerHapticFeedback(vibrate);
    startRepeat(event.pointerId, actionId);
  }

  function handlePointerEnd(event) {
    clearPointer(event.pointerId);
  }

  function handleAccessibleClick(event) {
    // Mouse/touch clicks were already dispatched on pointerdown. A detail of 0
    // is the browser convention for keyboard/programmatic button activation.
    if (event.detail !== 0) return;
    const actionId = getOnScreenGameAction(event.target, root);
    if (!actionId) return;
    event.preventDefault();
    performAction(actionId);
  }

  root.addEventListener("pointerdown", handlePointerDown);
  root.addEventListener("pointerup", handlePointerEnd);
  root.addEventListener("pointercancel", handlePointerEnd);
  root.addEventListener("lostpointercapture", handlePointerEnd);
  root.addEventListener("click", handleAccessibleClick);

  return {
    destroy() {
      for (const pointerId of activePointers.keys()) clearPointer(pointerId);
      root.removeEventListener("pointerdown", handlePointerDown);
      root.removeEventListener("pointerup", handlePointerEnd);
      root.removeEventListener("pointercancel", handlePointerEnd);
      root.removeEventListener("lostpointercapture", handlePointerEnd);
      root.removeEventListener("click", handleAccessibleClick);
    }
  };
}