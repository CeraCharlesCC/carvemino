import assert from "node:assert/strict";
import test from "node:test";

import { createI18n, resolveLocale } from "../src/i18n.js";
import { getGameInputAction } from "../src/ui/game-screen.js";
import {
  createOnScreenGameInput,
  getOnScreenGameAction,
  isGameplayActionId,
  isRepeatingGameAction,
  triggerHapticFeedback
} from "../src/ui/game-input.js";
import { getResponsiveShellScale } from "../src/ui/responsive-shell.js";
import {
  claimStartupManualVisit,
  createManualDemoState,
  getManualDemoTarget,
  performManualDemoAction
} from "../src/ui/startup-manual.js";
import { getSculptAction, getTitleScreenAction } from "../src/ui/ui.js";

function createPointerControl(actionId) {
  const pressed = new Set();
  return {
    pressed,
    control: {
      disabled: false,
      dataset: { gameAction: actionId },
      classList: {
        add: (value) => pressed.add(value),
        remove: (value) => pressed.delete(value)
      },
      setPointerCapture() {}
    }
  };
}

function createPointerRoot(...controls) {
  const handlers = new Map();
  return {
    handlers,
    root: {
      addEventListener: (type, handler) => handlers.set(type, handler),
      removeEventListener: (type) => handlers.delete(type),
      contains: (candidate) => controls.includes(candidate)
    }
  };
}

function touchPointerEvent(pointerId, control, overrides = {}) {
  return {
    isPrimary: pointerId === 1,
    pointerType: "touch",
    pointerId,
    target: { closest: () => control },
    preventDefault() {},
    ...overrides
  };
}

test("title screen keyboard actions are explicit and do not use selection keys", () => {
  assert.equal(getTitleScreenAction("Enter"), "start");
  assert.equal(getTitleScreenAction("KeyR"), "records");
  assert.equal(getTitleScreenAction("KeyH"), "manual");
  assert.equal(getTitleScreenAction("KeyO"), "options");

  for (const code of ["Space", "KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown"]) {
    assert.equal(getTitleScreenAction(code), null);
  }
});

test("sculpt action follows projected legal targets", () => {
  const view = {
    focusedPiece: {
      id: "focus"
    },
    sculpt: {
      carve: { targets: [{ x: 0, y: 0 }] },
      fill: { targets: [{ x: 2, y: 0 }] }
    }
  };

  assert.equal(getSculptAction(view, { x: 0, y: 0 }), "CARVE");
  assert.equal(getSculptAction(view, { x: 2, y: 0 }), "FILL");
  assert.equal(getSculptAction(view, { x: 3, y: 0 }), null);

  view.sculpt.fill.targets = [];
  assert.equal(getSculptAction(view, { x: 2, y: 0 }), null);

  view.sculpt.carve.targets = [];
  assert.equal(getSculptAction(view, { x: 0, y: 0 }), null);
});

test("game input translation uses configured bindings with Enter as sculpt fallback", () => {
  const bindings = {
    focusPrevious: "KeyQ",
    focusNext: "KeyE",
    cursorUp: "KeyW",
    cursorLeft: "KeyA",
    cursorDown: "KeyS",
    cursorRight: "KeyD",
    sculpt: "Space",
    hardDrop: "ArrowDown"
  };

  assert.equal(getGameInputAction("KeyQ", bindings), "focusPrevious");
  assert.equal(getGameInputAction("ArrowDown", bindings), "hardDrop");
  assert.equal(getGameInputAction("Space", bindings), "sculpt");
  assert.equal(getGameInputAction("Enter", bindings), "sculpt");
  assert.equal(getGameInputAction("KeyR", bindings), null);
});

test("responsive shell scales up when roomy and always fits within both viewport axes", () => {
  assert.equal(getResponsiveShellScale({
    availableWidth: 700,
    availableHeight: 900,
    shellWidth: 576,
    shellHeight: 680
  }), 1.12);

  assert.equal(getResponsiveShellScale({
    availableWidth: 700,
    availableHeight: 500,
    shellWidth: 576,
    shellHeight: 680
  }), 500 / 680);

  assert.equal(getResponsiveShellScale({
    availableWidth: 288,
    availableHeight: 900,
    shellWidth: 576,
    shellHeight: 680
  }), 0.5);

  assert.equal(getResponsiveShellScale({
    availableWidth: 288,
    availableHeight: 272,
    shellWidth: 576,
    shellHeight: 680
  }), 0.4);
});

// On-screen controls and pointer behavior.

test("on-screen gameplay actions validate data attributes and only repeat cursor movement", () => {
  const control = {
    disabled: false,
    dataset: { gameAction: "cursorLeft" }
  };
  const target = { closest: () => control };
  const root = { contains: (candidate) => candidate === control };

  assert.equal(getOnScreenGameAction(target, root), "cursorLeft");
  assert.equal(isGameplayActionId("hardDrop"), true);
  assert.equal(isGameplayActionId("pause"), false);
  assert.equal(isRepeatingGameAction("cursorLeft"), true);
  assert.equal(isRepeatingGameAction("hardDrop"), false);

  control.dataset.gameAction = "pause";
  assert.equal(getOnScreenGameAction(target, root), null);
});

test("on-screen pointer input exposes a pressed state and feature-detected haptics", () => {
  const button = createPointerControl("hardDrop");
  const { handlers, root } = createPointerRoot(button.control);
  const actions = [];
  const haptics = [];
  const input = createOnScreenGameInput({
    root,
    performAction(actionId) {
      actions.push(actionId);
      return true;
    },
    vibrate(duration) {
      haptics.push(duration);
    }
  });
  let prevented = false;

  handlers.get("pointerdown")(touchPointerEvent(7, button.control, {
    isPrimary: true,
    preventDefault() { prevented = true; }
  }));

  assert.deepEqual(actions, ["hardDrop"]);
  assert.deepEqual(haptics, [8]);
  assert.equal(prevented, true);
  assert.equal(button.pressed.has("is-pressed"), true);

  handlers.get("pointerup")({ pointerId: 7 });
  assert.equal(button.pressed.has("is-pressed"), false);
  input.destroy();
});

test("on-screen input keeps simultaneous touch pointers independent", () => {
  const left = createPointerControl("hardDrop");
  const right = createPointerControl("sculpt");
  const { handlers, root } = createPointerRoot(left.control, right.control);
  const actions = [];
  const input = createOnScreenGameInput({
    root,
    performAction(actionId) {
      actions.push(actionId);
      return true;
    },
    vibrate: null
  });

  handlers.get("pointerdown")(touchPointerEvent(1, left.control));
  handlers.get("pointerdown")(touchPointerEvent(2, right.control));
  assert.deepEqual(actions, ["hardDrop", "sculpt"]);
  assert.equal(left.pressed.has("is-pressed"), true);
  assert.equal(right.pressed.has("is-pressed"), true);

  handlers.get("pointerup")({ pointerId: 1 });
  assert.equal(left.pressed.has("is-pressed"), false);
  assert.equal(right.pressed.has("is-pressed"), true);
  handlers.get("pointercancel")({ pointerId: 2 });
  assert.equal(right.pressed.has("is-pressed"), false);
  input.destroy();
});

test("haptic feedback is optional and never required for controls", () => {
  assert.equal(triggerHapticFeedback(null), false);
  assert.equal(triggerHapticFeedback(() => { throw new Error("unsupported"); }), false);
  assert.equal(triggerHapticFeedback(() => true), true);
});

// Startup manual logic, not markup or styling details.

test("startup manual locale follows browser language with an English fallback", () => {
  assert.equal(resolveLocale(["ja-JP", "en-US"]), "ja");
  assert.equal(resolveLocale(["fr-FR", "en-GB"]), "en");
  assert.equal(resolveLocale(["fr-FR"]), "en");

  const japanese = createI18n({ languages: ["ja"] });
  const english = createI18n({ languages: ["en"] });
  assert.equal(japanese.locale, "ja");
  assert.notEqual(japanese.t("manual.title"), english.t("manual.title"));
  assert.match(japanese.t("orientation.title"), /スマホ.*横持ち.*非対応/);
  assert.match(english.t("orientation.copy"), /portrait/i);
  assert.match(english.t("manual.lab.cell", { x: 2, y: 3, action: "CUT" }), /2.*3.*CUT/);
});

test("startup manual is automatically claimed only once per local storage", () => {
  const values = new Map();
  const storage = {
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, String(value)); }
  };

  assert.equal(claimStartupManualVisit(storage), true);
  assert.equal(claimStartupManualVisit(storage), false);
});

test("interactive focus lab teaches cut, fill, focus switching, and drop without game state", () => {
  const initial = createManualDemoState();
  assert.equal(initial.focusedIndex, 0);
  assert.equal(getManualDemoTarget(initial), "cut");

  const cut = performManualDemoAction(initial, "sculpt");
  assert.equal(cut.lastAction, "cut");
  assert.equal(cut.scrap, 3);
  assert.equal(cut.pieces[0].cells.length, 3);
  assert.equal(getManualDemoTarget(cut), "fill");

  const filled = performManualDemoAction(cut, "sculpt");
  assert.equal(filled.lastAction, "fill");
  assert.equal(filled.scrap, 1);
  assert.equal(filled.pieces[0].cells.length, 4);

  const switched = performManualDemoAction(filled, "focusNext");
  assert.equal(switched.focusedIndex, 1);
  assert.equal(switched.lastAction, "focus");

  const dropped = performManualDemoAction(switched, "hardDrop");
  assert.equal(dropped.pieces[1].locked, true);
  assert.equal(dropped.pieces[1].origin.y, 4);
  assert.equal(dropped.focusedIndex, 0);
  assert.equal(dropped.lastAction, "drop");
});
