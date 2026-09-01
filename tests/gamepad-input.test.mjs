import assert from "node:assert/strict";
import test from "node:test";

import { GAMEPLAY_ACTION_IDS } from "../src/config.js";
import {
  GAMEPAD_CONTROLLER_TYPES,
  createGamepadActionTracker,
  createGamepadInput,
  getGamepadControllerType,
  getGamepadFaceButtonLabels,
  mapPhysicalFaceActionForMenu
} from "../src/ui/gamepad-input.js";

function makeGamepad({
  index = 0,
  id = `pad-${index}`,
  mapping = "standard",
  connected = true,
  pressed = [],
  axes = [0, 0]
} = {}) {
  const buttons = Array.from({ length: 16 }, () => ({ pressed: false, value: 0 }));
  for (const button of pressed) buttons[button] = { pressed: true, value: 1 };
  return { index, id, mapping, connected, buttons, axes };
}

function createEventTarget() {
  const handlers = new Map();
  return {
    addEventListener(type, handler) {
      if (!handlers.has(type)) handlers.set(type, new Set());
      handlers.get(type).add(handler);
    },
    removeEventListener(type, handler) {
      handlers.get(type)?.delete(handler);
    },
    dispatch(type, event = {}) {
      for (const handler of handlers.get(type) || []) handler(event);
    },
    listenerCount(type) {
      return handlers.get(type)?.size || 0;
    }
  };
}

function createFrameHarness() {
  let nextId = 1;
  const callbacks = new Map();
  return {
    request(callback) {
      const id = nextId++;
      callbacks.set(id, callback);
      return id;
    },
    cancel(id) {
      callbacks.delete(id);
    },
    run(timestamp) {
      const pending = [...callbacks.values()];
      callbacks.clear();
      for (const callback of pending) callback(timestamp);
    },
    get size() {
      return callbacks.size;
    }
  };
}

test("Gamepad API support is optional and non-standard pads are ignored", () => {
  const tracker = createGamepadActionTracker();
  assert.notEqual(tracker.update(makeGamepad()).snapshot, null);
  assert.equal(tracker.update(makeGamepad({ mapping: "" })).snapshot, null);
  assert.equal(tracker.update(makeGamepad({ mapping: "xinput" })).snapshot, null);

  const input = createGamepadInput({
    navigatorObject: {},
    performAction() {
      throw new Error("unsupported browsers must not dispatch");
    }
  });
  assert.equal(input.getActiveGamepad(), null);
  input.destroy();
});

test("standard face buttons follow physical position and fire on pressed edges", () => {
  const tracker = createGamepadActionTracker();
  assert.deepEqual(tracker.update(makeGamepad(), 0).actions, []);

  let result = tracker.update(makeGamepad({ pressed: [0] }), 1);
  assert.deepEqual(result.actions, [GAMEPLAY_ACTION_IDS.hardDrop]);
  assert.equal(result.meaningful, true);

  result = tracker.update(makeGamepad({ pressed: [0] }), 2);
  assert.deepEqual(result.actions, []);
  assert.equal(result.meaningful, false);

  assert.deepEqual(tracker.update(makeGamepad(), 3).actions, []);
  assert.deepEqual(
    tracker.update(makeGamepad({ pressed: [0] }), 4).actions,
    [GAMEPLAY_ACTION_IDS.hardDrop]
  );

  tracker.update(makeGamepad(), 5);
  assert.deepEqual(
    tracker.update(makeGamepad({ pressed: [1] }), 6).actions,
    [GAMEPLAY_ACTION_IDS.sculpt]
  );
});

test("controller families provide face labels and conventional menu semantics", () => {
  assert.equal(getGamepadControllerType("Nintendo Switch Pro Controller"), GAMEPAD_CONTROLLER_TYPES.nintendo);
  assert.equal(getGamepadControllerType("Xbox Wireless Controller"), GAMEPAD_CONTROLLER_TYPES.xbox);
  assert.equal(getGamepadControllerType("DualSense Wireless Controller"), GAMEPAD_CONTROLLER_TYPES.playstation);
  assert.equal(getGamepadControllerType("STANDARD GAMEPAD Vendor: 054c Product: 09cc"), GAMEPAD_CONTROLLER_TYPES.playstation);
  assert.equal(getGamepadControllerType("mystery pad"), GAMEPAD_CONTROLLER_TYPES.generic);

  assert.deepEqual(getGamepadFaceButtonLabels(GAMEPAD_CONTROLLER_TYPES.nintendo), {
    sculpt: "A",
    hardDrop: "B"
  });
  assert.deepEqual(getGamepadFaceButtonLabels(GAMEPAD_CONTROLLER_TYPES.xbox), {
    sculpt: "B",
    hardDrop: "A"
  });
  assert.deepEqual(getGamepadFaceButtonLabels(GAMEPAD_CONTROLLER_TYPES.playstation), {
    sculpt: "CIRCLE",
    hardDrop: "CROSS"
  });

  assert.equal(
    mapPhysicalFaceActionForMenu(GAMEPLAY_ACTION_IDS.hardDrop, GAMEPAD_CONTROLLER_TYPES.nintendo),
    GAMEPLAY_ACTION_IDS.hardDrop
  );
  assert.equal(
    mapPhysicalFaceActionForMenu(GAMEPLAY_ACTION_IDS.hardDrop, GAMEPAD_CONTROLLER_TYPES.xbox),
    GAMEPLAY_ACTION_IDS.sculpt
  );
  assert.equal(
    mapPhysicalFaceActionForMenu(GAMEPLAY_ACTION_IDS.sculpt, GAMEPAD_CONTROLLER_TYPES.playstation),
    GAMEPLAY_ACTION_IDS.hardDrop
  );
});

test("all standard button presses count as meaningful activity without inventing actions", () => {
  const tracker = createGamepadActionTracker();
  tracker.update(makeGamepad(), 0);

  const result = tracker.update(makeGamepad({ pressed: [2] }), 1);
  assert.equal(result.meaningful, true);
  assert.deepEqual(result.actions, []);
  assert.deepEqual(result.activityActions, []);
});

test("D-pad directions map to logical cursor actions with shared repeat timing", () => {
  const tracker = createGamepadActionTracker();
  tracker.update(makeGamepad(), 0);

  assert.deepEqual(
    tracker.update(makeGamepad({ pressed: [14] }), 10).actions,
    [GAMEPLAY_ACTION_IDS.cursorLeft]
  );
  assert.deepEqual(tracker.update(makeGamepad({ pressed: [14] }), 249).actions, []);
  assert.deepEqual(
    tracker.update(makeGamepad({ pressed: [14] }), 250).actions,
    [GAMEPLAY_ACTION_IDS.cursorLeft]
  );
  assert.deepEqual(tracker.update(makeGamepad({ pressed: [14] }), 334).actions, []);
  assert.deepEqual(
    tracker.update(makeGamepad({ pressed: [14] }), 335).actions,
    [GAMEPLAY_ACTION_IDS.cursorLeft]
  );
});

test("left-stick normalization uses a deadzone and release hysteresis", () => {
  const tracker = createGamepadActionTracker();
  let result = tracker.update(makeGamepad({ axes: [0.2, -0.2] }), 0);
  assert.deepEqual(result.actions, []);
  assert.equal(result.meaningful, false);

  result = tracker.update(makeGamepad({ axes: [-0.61, 0] }), 1);
  assert.deepEqual(result.actions, [GAMEPLAY_ACTION_IDS.cursorLeft]);
  assert.equal(result.snapshot.stick.left, true);

  result = tracker.update(makeGamepad({ axes: [-0.5, 0] }), 2);
  assert.equal(result.snapshot.stick.left, true);
  assert.deepEqual(result.actions, []);

  result = tracker.update(makeGamepad({ axes: [-0.39, 0] }), 3);
  assert.equal(result.snapshot.stick.left, false);

  result = tracker.update(makeGamepad({ axes: [-0.5, 0] }), 4);
  assert.equal(result.snapshot.stick.left, false);
  assert.deepEqual(result.actions, []);
});

test("right-stick axes and R3 are exposed without creating gameplay actions", () => {
  const tracker = createGamepadActionTracker();
  let result = tracker.update(makeGamepad({ axes: [0, 0, 0.5, -0.75] }), 0);
  assert.deepEqual(result.snapshot.rightStick, { x: 0.5, y: -0.75 });
  assert.equal(result.snapshot.rightStickPressed, false);
  assert.deepEqual(result.actions, []);

  result = tracker.update(makeGamepad({ axes: [0, 0], pressed: [11] }), 1);
  assert.deepEqual(result.snapshot.rightStick, { x: 0, y: 0 });
  assert.equal(result.snapshot.rightStickPressed, true);
  assert.equal(result.snapshot.rightStickJustPressed, true);
  assert.equal(result.meaningful, true);
  assert.deepEqual(result.actions, []);

  result = tracker.update(makeGamepad({ axes: [0, 0], pressed: [11] }), 2);
  assert.equal(result.meaningful, false);
  assert.equal(result.snapshot.rightStickJustPressed, false);
  assert.deepEqual(result.actions, []);
});

test("right-stick drift is ignored but crossing the cursor deadzone is meaningful", () => {
  const tracker = createGamepadActionTracker();
  let result = tracker.update(makeGamepad({ axes: [0, 0, 0.1, -0.1] }), 0);
  assert.equal(result.meaningful, false);

  result = tracker.update(makeGamepad({ axes: [0, 0, 0.23, 0] }), 1);
  assert.equal(result.meaningful, true);
  assert.deepEqual(result.actions, []);

  result = tracker.update(makeGamepad({ axes: [0, 0, 0.5, 0] }), 2);
  assert.equal(result.meaningful, false);
  result = tracker.update(makeGamepad({ axes: [0, 0, 0, 0] }), 3);
  assert.equal(result.meaningful, false);
  result = tracker.update(makeGamepad({ axes: [0, 0, 0, -0.3] }), 4);
  assert.equal(result.meaningful, true);
});

test("D-pad and stick sources in the same direction are deduplicated", () => {
  const tracker = createGamepadActionTracker();
  tracker.update(makeGamepad(), 0);

  let result = tracker.update(makeGamepad({ pressed: [14], axes: [-1, 0] }), 1);
  assert.deepEqual(result.actions, [GAMEPLAY_ACTION_IDS.cursorLeft]);
  assert.deepEqual(result.activityActions, [GAMEPLAY_ACTION_IDS.cursorLeft]);

  result = tracker.update(makeGamepad({ pressed: [14], axes: [-1, 0] }), 241);
  assert.deepEqual(result.actions, [GAMEPLAY_ACTION_IDS.cursorLeft]);

  result = tracker.update(makeGamepad({ pressed: [14], axes: [0, 0] }), 242);
  assert.equal(result.snapshot.directions.left, true);
  assert.deepEqual(result.actions, []);
});

test("adapter tolerates sparse snapshots and switches to the most recently active supported pad", () => {
  let pads = [makeGamepad({ index: 0 }), null, makeGamepad({ index: 2 })];
  const windowObject = createEventTarget();
  const documentObject = { ...createEventTarget(), visibilityState: "visible" };
  const frames = createFrameHarness();
  const actions = [];
  const input = createGamepadInput({
    navigatorObject: { getGamepads: () => pads },
    windowObject,
    documentObject,
    requestFrame: (callback) => frames.request(callback),
    cancelFrame: (id) => frames.cancel(id),
    now: () => 0,
    performAction: (actionId) => actions.push(actionId)
  });

  assert.equal(frames.size, 1);
  assert.equal(input.getActiveGamepad(), null);

  pads = [makeGamepad({ index: 0, pressed: [0] }), null, makeGamepad({ index: 2 })];
  frames.run(10);
  assert.deepEqual(actions, [GAMEPLAY_ACTION_IDS.hardDrop]);
  assert.deepEqual(input.getActiveGamepad(), { index: 0, id: "pad-0" });

  pads = [makeGamepad({ index: 0, pressed: [0] }), null, makeGamepad({ index: 2, pressed: [1] })];
  frames.run(20);
  assert.deepEqual(actions, [GAMEPLAY_ACTION_IDS.hardDrop, GAMEPLAY_ACTION_IDS.sculpt]);
  assert.deepEqual(input.getActiveGamepad(), { index: 2, id: "pad-2" });

  input.destroy();
});

test("the active controller snapshot is delivered on every animation frame", () => {
  let pads = [makeGamepad()];
  const frames = createFrameHarness();
  const states = [];
  const input = createGamepadInput({
    navigatorObject: { getGamepads: () => pads },
    windowObject: createEventTarget(),
    documentObject: { ...createEventTarget(), visibilityState: "visible" },
    requestFrame: (callback) => frames.request(callback),
    cancelFrame: (id) => frames.cancel(id),
    now: () => 0,
    performAction() {},
    onState: (snapshot, timestamp) => states.push({ snapshot, timestamp })
  });

  pads = [makeGamepad({ axes: [0, 0, 0.3, 0] })];
  frames.run(10);
  pads = [makeGamepad({ axes: [0, 0, 0.6, -0.25] })];
  frames.run(20);

  assert.equal(states.length, 2);
  assert.deepEqual(states.map(({ timestamp }) => timestamp), [10, 20]);
  assert.deepEqual(states[1].snapshot.rightStick, { x: 0.6, y: -0.25 });
  assert.deepEqual(input.getActiveGamepad(), { index: 0, id: "pad-0" });
  input.destroy();
});

test("right-stick movement can switch the active controller", () => {
  let pads = [makeGamepad({ index: 0 }), makeGamepad({ index: 1 })];
  const frames = createFrameHarness();
  const activity = [];
  const input = createGamepadInput({
    navigatorObject: { getGamepads: () => pads },
    windowObject: createEventTarget(),
    documentObject: { ...createEventTarget(), visibilityState: "visible" },
    requestFrame: (callback) => frames.request(callback),
    cancelFrame: (id) => frames.cancel(id),
    now: () => 0,
    performAction() {},
    onActivity: (gamepad) => activity.push(gamepad)
  });

  pads = [makeGamepad({ index: 0, axes: [0, 0, 0.3, 0] }), makeGamepad({ index: 1 })];
  frames.run(1);
  pads = [makeGamepad({ index: 0 }), makeGamepad({ index: 1, axes: [0, 0, 0, -0.3] })];
  frames.run(2);

  assert.deepEqual(activity, [{ index: 0, id: "pad-0" }, { index: 1, id: "pad-1" }]);
  assert.deepEqual(input.getActiveGamepad(), { index: 1, id: "pad-1" });
  input.destroy();
});

test("unmapped standard-button activity can take over the active controller without dispatching an action", () => {
  let pads = [makeGamepad({ index: 0 }), makeGamepad({ index: 1 })];
  const frames = createFrameHarness();
  const actions = [];
  const activity = [];
  const input = createGamepadInput({
    navigatorObject: { getGamepads: () => pads },
    windowObject: createEventTarget(),
    documentObject: { ...createEventTarget(), visibilityState: "visible" },
    requestFrame: (callback) => frames.request(callback),
    cancelFrame: (id) => frames.cancel(id),
    now: () => 0,
    performAction: (actionId) => actions.push(actionId),
    onActivity: (gamepad) => activity.push(gamepad)
  });

  pads = [makeGamepad({ index: 0, pressed: [0] }), makeGamepad({ index: 1 })];
  frames.run(1);
  pads = [makeGamepad({ index: 0 }), makeGamepad({ index: 1, pressed: [2] })];
  frames.run(2);

  assert.deepEqual(actions, [GAMEPLAY_ACTION_IDS.hardDrop]);
  assert.deepEqual(input.getActiveGamepad(), { index: 1, id: "pad-1" });
  assert.deepEqual(activity, [{ index: 0, id: "pad-0" }, { index: 1, id: "pad-1" }]);
  input.destroy();
});

test("connection alone does not dispatch held input and disconnect clears the active pad immediately", () => {
  let pads = [makeGamepad({ index: 0, pressed: [0] })];
  const windowObject = createEventTarget();
  const documentObject = { ...createEventTarget(), visibilityState: "visible" };
  const frames = createFrameHarness();
  const actions = [];
  const input = createGamepadInput({
    navigatorObject: { getGamepads: () => pads },
    windowObject,
    documentObject,
    requestFrame: (callback) => frames.request(callback),
    cancelFrame: (id) => frames.cancel(id),
    now: () => 0,
    performAction: (actionId) => actions.push(actionId)
  });

  frames.run(1);
  assert.deepEqual(actions, []);
  assert.equal(input.getActiveGamepad(), null);

  pads = [makeGamepad({ index: 0 })];
  frames.run(2);
  pads = [makeGamepad({ index: 0, pressed: [0] })];
  frames.run(3);
  assert.deepEqual(actions, [GAMEPLAY_ACTION_IDS.hardDrop]);
  assert.deepEqual(input.getActiveGamepad(), { index: 0, id: "pad-0" });

  const disconnected = pads[0];
  pads = [];
  windowObject.dispatch("gamepaddisconnected", { gamepad: disconnected });
  assert.equal(input.getActiveGamepad(), null);

  input.destroy();
  assert.equal(windowObject.listenerCount("gamepadconnected"), 0);
  assert.equal(windowObject.listenerCount("gamepaddisconnected"), 0);
});

test("a first press delivered with gamepadconnected is not swallowed", () => {
  let pads = [];
  const windowObject = createEventTarget();
  const documentObject = { ...createEventTarget(), visibilityState: "visible" };
  const frames = createFrameHarness();
  const actions = [];
  const input = createGamepadInput({
    navigatorObject: { getGamepads: () => pads },
    windowObject,
    documentObject,
    requestFrame: (callback) => frames.request(callback),
    cancelFrame: (id) => frames.cancel(id),
    now: () => 10,
    performAction: (actionId) => actions.push(actionId)
  });

  assert.equal(frames.size, 0);
  const connected = makeGamepad({ pressed: [0] });
  pads = [connected];
  windowObject.dispatch("gamepadconnected", { gamepad: connected });
  assert.deepEqual(actions, [GAMEPLAY_ACTION_IDS.hardDrop]);
  assert.deepEqual(input.getActiveGamepad(), { index: 0, id: "pad-0" });

  frames.run(11);
  assert.deepEqual(actions, [GAMEPLAY_ACTION_IDS.hardDrop]);
  input.destroy();
});

test("polling suspends while hidden and rescans without replaying held input on restore", () => {
  let pads = [makeGamepad()];
  const windowObject = createEventTarget();
  const documentObject = { ...createEventTarget(), visibilityState: "visible" };
  const frames = createFrameHarness();
  const actions = [];
  const input = createGamepadInput({
    navigatorObject: { getGamepads: () => pads },
    windowObject,
    documentObject,
    requestFrame: (callback) => frames.request(callback),
    cancelFrame: (id) => frames.cancel(id),
    now: () => 50,
    performAction: (actionId) => actions.push(actionId)
  });

  assert.equal(frames.size, 1);
  documentObject.visibilityState = "hidden";
  documentObject.dispatch("visibilitychange");
  assert.equal(frames.size, 0);

  pads = [makeGamepad({ pressed: [0] })];
  documentObject.visibilityState = "visible";
  documentObject.dispatch("visibilitychange");
  assert.equal(frames.size, 1);
  frames.run(51);
  assert.deepEqual(actions, []);

  pads = [makeGamepad()];
  frames.run(52);
  pads = [makeGamepad({ pressed: [0] })];
  frames.run(53);
  assert.deepEqual(actions, [GAMEPLAY_ACTION_IDS.hardDrop]);
  input.destroy();
});

test("Start is routed separately and fires once per press", () => {
  let pads = [makeGamepad()];
  const frames = createFrameHarness();
  let starts = 0;
  const actions = [];
  const input = createGamepadInput({
    navigatorObject: { getGamepads: () => pads },
    windowObject: createEventTarget(),
    documentObject: { ...createEventTarget(), visibilityState: "visible" },
    requestFrame: (callback) => frames.request(callback),
    cancelFrame: (id) => frames.cancel(id),
    now: () => 0,
    performAction: (actionId) => actions.push(actionId),
    performStart: () => { starts += 1; }
  });

  pads = [makeGamepad({ pressed: [9] })];
  frames.run(1);
  frames.run(2);
  assert.equal(starts, 1);
  assert.deepEqual(actions, []);

  pads = [makeGamepad()];
  frames.run(3);
  pads = [makeGamepad({ pressed: [9] })];
  frames.run(4);
  assert.equal(starts, 2);
  input.destroy();
});
