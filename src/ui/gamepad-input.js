import { GAMEPLAY_ACTION_IDS } from "../config.js";
import { DEFAULT_INPUT_REPEAT_DELAY, DEFAULT_INPUT_REPEAT_INTERVAL } from "./input-constants.js";

export const GAMEPAD_START_ACTION = "controllerStart";
export const DEFAULT_GAMEPAD_PRESS_THRESHOLD = 0.6;
export const DEFAULT_GAMEPAD_RELEASE_THRESHOLD = 0.4;
export const GAMEPAD_CONTROLLER_TYPES = Object.freeze({
  generic: "generic",
  nintendo: "nintendo",
  xbox: "xbox",
  playstation: "playstation"
});

const BUTTON_BINDINGS = Object.freeze([
  // The standard mapping normalizes these by physical position, not printed label:
  // button 0 is the bottom face button and button 1 is the right face button.
  Object.freeze({ button: 0, actionId: GAMEPLAY_ACTION_IDS.hardDrop }),
  Object.freeze({ button: 1, actionId: GAMEPLAY_ACTION_IDS.sculpt }),
  Object.freeze({ button: 4, actionId: GAMEPLAY_ACTION_IDS.focusPrevious }),
  Object.freeze({ button: 5, actionId: GAMEPLAY_ACTION_IDS.focusNext }),
  Object.freeze({ button: 9, actionId: GAMEPAD_START_ACTION })
]);

const FACE_BUTTON_LABELS = Object.freeze({
  [GAMEPAD_CONTROLLER_TYPES.generic]: Object.freeze({
    [GAMEPLAY_ACTION_IDS.sculpt]: "RIGHT FACE",
    [GAMEPLAY_ACTION_IDS.hardDrop]: "BOTTOM FACE"
  }),
  [GAMEPAD_CONTROLLER_TYPES.nintendo]: Object.freeze({
    [GAMEPLAY_ACTION_IDS.sculpt]: "A",
    [GAMEPLAY_ACTION_IDS.hardDrop]: "B"
  }),
  [GAMEPAD_CONTROLLER_TYPES.xbox]: Object.freeze({
    [GAMEPLAY_ACTION_IDS.sculpt]: "B",
    [GAMEPLAY_ACTION_IDS.hardDrop]: "A"
  }),
  [GAMEPAD_CONTROLLER_TYPES.playstation]: Object.freeze({
    [GAMEPLAY_ACTION_IDS.sculpt]: "CIRCLE",
    [GAMEPLAY_ACTION_IDS.hardDrop]: "CROSS"
  })
});

const DIRECTION_BINDINGS = Object.freeze([
  Object.freeze({ name: "up", button: 12, actionId: GAMEPLAY_ACTION_IDS.cursorUp }),
  Object.freeze({ name: "down", button: 13, actionId: GAMEPLAY_ACTION_IDS.cursorDown }),
  Object.freeze({ name: "left", button: 14, actionId: GAMEPLAY_ACTION_IDS.cursorLeft }),
  Object.freeze({ name: "right", button: 15, actionId: GAMEPLAY_ACTION_IDS.cursorRight })
]);

const STANDARD_BUTTON_COUNT = 17;
const EMPTY_DIRECTIONS = Object.freeze({ up: false, down: false, left: false, right: false });

function finiteAxis(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(-1, Math.min(1, value));
}

function isButtonPressed(button) {
  if (!button) return false;
  return button.pressed === true || Number(button.value) >= 0.5;
}

function axisDirections(value, previousNegative, previousPositive, pressThreshold, releaseThreshold) {
  const negative = value <= -(previousNegative ? releaseThreshold : pressThreshold);
  const positive = value >= (previousPositive ? releaseThreshold : pressThreshold);
  return { negative, positive };
}

function gamepadKey(gamepad) {
  return `${gamepad.index}:${gamepad.id || ""}`;
}

export function getGamepadControllerType(gamepadOrId) {
  const id = String(typeof gamepadOrId === "string" ? gamepadOrId : gamepadOrId?.id || "").toLowerCase();
  if (/nintendo|switch|joy[- ]?con|057e/.test(id)) return GAMEPAD_CONTROLLER_TYPES.nintendo;
  if (/playstation|dualsense|dualshock|sony|054c/.test(id)) return GAMEPAD_CONTROLLER_TYPES.playstation;
  if (/xbox|xinput|microsoft|045e/.test(id)) return GAMEPAD_CONTROLLER_TYPES.xbox;
  return GAMEPAD_CONTROLLER_TYPES.generic;
}

export function getGamepadFaceButtonLabels(controllerType = GAMEPAD_CONTROLLER_TYPES.generic) {
  return FACE_BUTTON_LABELS[controllerType] || FACE_BUTTON_LABELS[GAMEPAD_CONTROLLER_TYPES.generic];
}

export function mapPhysicalFaceActionForMenu(actionId, controllerType = GAMEPAD_CONTROLLER_TYPES.generic) {
  // Nintendo keeps A on the right and B on the bottom, so the gameplay mapping
  // already doubles as the familiar A-confirm/B-back menu layout. Xbox,
  // PlayStation, and unknown standard pads put their confirm button on the
  // bottom face position, so swap only the two face-button actions in menus.
  if (controllerType === GAMEPAD_CONTROLLER_TYPES.nintendo) return actionId;
  if (actionId === GAMEPLAY_ACTION_IDS.hardDrop) return GAMEPLAY_ACTION_IDS.sculpt;
  if (actionId === GAMEPLAY_ACTION_IDS.sculpt) return GAMEPLAY_ACTION_IDS.hardDrop;
  return actionId;
}

export function isStandardGamepad(gamepad) {
  return Boolean(gamepad && gamepad.connected !== false && gamepad.mapping === "standard");
}

export function normalizeStandardGamepad(gamepad, previous = null, {
  pressThreshold = DEFAULT_GAMEPAD_PRESS_THRESHOLD,
  releaseThreshold = DEFAULT_GAMEPAD_RELEASE_THRESHOLD
} = {}) {
  if (!isStandardGamepad(gamepad)) return null;
  if (!(releaseThreshold >= 0 && pressThreshold > releaseThreshold && pressThreshold <= 1)) {
    throw new Error("gamepad thresholds must satisfy 0 <= release < press <= 1");
  }

  const previousStick = previous?.stick || EMPTY_DIRECTIONS;
  const horizontal = axisDirections(
    finiteAxis(gamepad.axes?.[0]),
    previousStick.left,
    previousStick.right,
    pressThreshold,
    releaseThreshold
  );
  const vertical = axisDirections(
    finiteAxis(gamepad.axes?.[1]),
    previousStick.up,
    previousStick.down,
    pressThreshold,
    releaseThreshold
  );
  const stick = {
    up: vertical.negative,
    down: vertical.positive,
    left: horizontal.negative,
    right: horizontal.positive
  };
  const dpad = Object.fromEntries(DIRECTION_BINDINGS.map(({ name, button }) => (
    [name, isButtonPressed(gamepad.buttons?.[button])]
  )));
  const directions = Object.fromEntries(DIRECTION_BINDINGS.map(({ name }) => (
    [name, dpad[name] || stick[name]]
  )));
  const buttons = Object.fromEntries(BUTTON_BINDINGS.map(({ actionId, button }) => (
    [actionId, isButtonPressed(gamepad.buttons?.[button])]
  )));
  const rawButtons = Array.from({ length: STANDARD_BUTTON_COUNT }, (_, index) => (
    isButtonPressed(gamepad.buttons?.[index])
  ));

  return {
    index: gamepad.index,
    id: gamepad.id || "",
    buttons,
    rawButtons,
    dpad,
    stick,
    directions
  };
}

export function createGamepadActionTracker({
  repeatDelay = DEFAULT_INPUT_REPEAT_DELAY,
  repeatInterval = DEFAULT_INPUT_REPEAT_INTERVAL,
  pressThreshold = DEFAULT_GAMEPAD_PRESS_THRESHOLD,
  releaseThreshold = DEFAULT_GAMEPAD_RELEASE_THRESHOLD
} = {}) {
  let previous = null;
  const nextRepeatAt = Object.fromEntries(DIRECTION_BINDINGS.map(({ name }) => [name, null]));

  function reset() {
    previous = null;
    for (const { name } of DIRECTION_BINDINGS) nextRepeatAt[name] = null;
  }

  function update(gamepad, now = 0) {
    const snapshot = normalizeStandardGamepad(gamepad, previous, { pressThreshold, releaseThreshold });
    if (!snapshot) {
      reset();
      return { actions: [], activityActions: [], meaningful: false, snapshot: null };
    }

    const actions = new Set();
    const activityActions = new Set();
    let meaningful = snapshot.rawButtons.some((pressed, index) => (
      pressed && !previous?.rawButtons?.[index]
    ));

    for (const { actionId } of BUTTON_BINDINGS) {
      if (snapshot.buttons[actionId] && !previous?.buttons?.[actionId]) {
        actions.add(actionId);
        activityActions.add(actionId);
      }
    }

    for (const { name, actionId } of DIRECTION_BINDINGS) {
      const dpadEdge = snapshot.dpad[name] && !previous?.dpad?.[name];
      const stickEdge = snapshot.stick[name] && !previous?.stick?.[name];
      if (dpadEdge || stickEdge) {
        activityActions.add(actionId);
        if (stickEdge) meaningful = true;
      }

      if (!snapshot.directions[name]) {
        nextRepeatAt[name] = null;
        continue;
      }
      if (!previous?.directions?.[name]) {
        actions.add(actionId);
        nextRepeatAt[name] = now + repeatDelay;
        continue;
      }
      if (nextRepeatAt[name] !== null && now >= nextRepeatAt[name]) {
        actions.add(actionId);
        nextRepeatAt[name] = now + repeatInterval;
      }
    }

    previous = snapshot;
    return {
      actions: [...actions],
      activityActions: [...activityActions],
      meaningful,
      snapshot
    };
  }

  return { reset, update };
}

export function createGamepadInput({
  performAction,
  performStart = () => false,
  onActivity = () => {},
  navigatorObject = globalThis.navigator,
  windowObject = globalThis.window,
  documentObject = globalThis.document,
  requestFrame = globalThis.requestAnimationFrame?.bind(globalThis),
  cancelFrame = globalThis.cancelAnimationFrame?.bind(globalThis),
  now = globalThis.performance?.now?.bind(globalThis.performance) || Date.now,
  repeatDelay = DEFAULT_INPUT_REPEAT_DELAY,
  repeatInterval = DEFAULT_INPUT_REPEAT_INTERVAL,
  pressThreshold = DEFAULT_GAMEPAD_PRESS_THRESHOLD,
  releaseThreshold = DEFAULT_GAMEPAD_RELEASE_THRESHOLD
} = {}) {
  if (typeof performAction !== "function") {
    throw new Error("gamepad input requires an action dispatcher");
  }

  const getGamepads = navigatorObject?.getGamepads;
  if (typeof getGamepads !== "function") {
    return {
      destroy() {},
      getActiveGamepad: () => null
    };
  }

  const trackers = new Map();
  let activeKey = null;
  let frameHandle = null;
  let destroyed = false;

  function isVisible() {
    return documentObject?.visibilityState !== "hidden";
  }

  function readGamepads() {
    try {
      return Array.from(getGamepads.call(navigatorObject) || []);
    } catch {
      return [];
    }
  }

  function makeTracker() {
    return createGamepadActionTracker({
      repeatDelay,
      repeatInterval,
      pressThreshold,
      releaseThreshold
    });
  }

  function dispatch(actions) {
    for (const actionId of actions) {
      if (actionId === GAMEPAD_START_ACTION) performStart();
      else performAction(actionId);
    }
  }

  function scan(timestamp, emit) {
    const seen = new Set();
    const results = [];
    for (const gamepad of readGamepads()) {
      if (!isStandardGamepad(gamepad)) continue;
      const key = gamepadKey(gamepad);
      seen.add(key);
      let entry = trackers.get(key);
      if (!entry) {
        entry = { index: gamepad.index, id: gamepad.id || "", tracker: makeTracker() };
        trackers.set(key, entry);
      }
      results.push({ key, entry, result: entry.tracker.update(gamepad, timestamp) });
    }

    for (const key of trackers.keys()) {
      if (seen.has(key)) continue;
      trackers.delete(key);
      if (activeKey === key) activeKey = null;
    }

    if (emit) {
      const activeResultBefore = results.find(({ key }) => key === activeKey);
      const candidates = results.filter(({ result }) => result.meaningful);
      const candidate = candidates[candidates.length - 1] || null;
      const activeChanged = candidate && candidate.key !== activeKey;
      if (candidate) {
        activeKey = candidate.key;
        onActivity({ index: candidate.entry.index, id: candidate.entry.id });
      }
      const activeResult = results.find(({ key }) => key === activeKey) || activeResultBefore;
      if (activeResult) {
        const actions = activeChanged
          ? [...new Set([...activeResult.result.actions, ...activeResult.result.activityActions])]
          : activeResult.result.actions;
        dispatch(actions);
      }
    }

    return results.length;
  }

  function scheduleFrame() {
    if (destroyed || frameHandle !== null || !isVisible() || trackers.size === 0
        || typeof requestFrame !== "function") return;
    frameHandle = requestFrame((timestamp) => {
      frameHandle = null;
      if (destroyed || !isVisible()) return;
      const supportedCount = scan(Number.isFinite(timestamp) ? timestamp : now(), true);
      if (supportedCount > 0) scheduleFrame();
    });
  }

  function handleConnected(event) {
    const gamepad = event?.gamepad;
    if (!isStandardGamepad(gamepad)) return;
    const key = gamepadKey(gamepad);
    let entry = trackers.get(key);
    if (!entry) {
      entry = { index: gamepad.index, id: gamepad.id || "", tracker: makeTracker() };
      trackers.set(key, entry);
    }
    const result = entry.tracker.update(gamepad, now());
    if (isVisible() && result.meaningful) {
      activeKey = key;
      onActivity({ index: entry.index, id: entry.id });
      dispatch([...new Set([...result.actions, ...result.activityActions])]);
    }
    scheduleFrame();
  }

  function handleDisconnected(event) {
    const disconnected = event?.gamepad;
    if (!disconnected) return;
    for (const [key, entry] of trackers) {
      if (entry.index !== disconnected.index) continue;
      trackers.delete(key);
      if (activeKey === key) activeKey = null;
    }
    scheduleFrame();
  }

  function handleVisibilityChange() {
    if (!isVisible()) {
      if (frameHandle !== null && typeof cancelFrame === "function") cancelFrame(frameHandle);
      frameHandle = null;
      return;
    }
    scan(now(), false);
    scheduleFrame();
  }

  windowObject?.addEventListener?.("gamepadconnected", handleConnected);
  windowObject?.addEventListener?.("gamepaddisconnected", handleDisconnected);
  documentObject?.addEventListener?.("visibilitychange", handleVisibilityChange);
  scan(now(), false);
  scheduleFrame();

  return {
    getActiveGamepad() {
      const entry = activeKey ? trackers.get(activeKey) : null;
      return entry ? { index: entry.index, id: entry.id } : null;
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      if (frameHandle !== null && typeof cancelFrame === "function") cancelFrame(frameHandle);
      frameHandle = null;
      trackers.clear();
      activeKey = null;
      windowObject?.removeEventListener?.("gamepadconnected", handleConnected);
      windowObject?.removeEventListener?.("gamepaddisconnected", handleDisconnected);
      documentObject?.removeEventListener?.("visibilitychange", handleVisibilityChange);
    }
  };
}
