import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { DEFAULT_KEYBINDINGS, GAMEPLAY_ACTIONS } from "../src/config.js";
import { getGameInputAction } from "../src/ui/game-screen.js";
import {
  createOnScreenGameInput,
  getOnScreenGameAction,
  isGameplayActionId,
  isRepeatingGameAction,
  triggerHapticFeedback
} from "../src/ui/game-input.js";
import { getResponsiveShellScale } from "../src/ui/responsive-shell.js";
import { getSculptAction, getTitleScreenAction } from "../src/ui/ui.js";

test("title screen keyboard actions are explicit and do not use selection keys", () => {
  assert.equal(getTitleScreenAction("Enter"), "start");
  assert.equal(getTitleScreenAction("KeyR"), "records");
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

test("gameplay action metadata owns labels and default keybindings", () => {
  assert.deepEqual(
    Object.fromEntries(GAMEPLAY_ACTIONS.map(({ id, defaultKeybinding }) => [id, defaultKeybinding])),
    DEFAULT_KEYBINDINGS
  );
  assert(GAMEPLAY_ACTIONS.every(({ id, label }) => id && label));
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
  const handlers = new Map();
  const pressedClasses = new Set();
  const control = {
    disabled: false,
    dataset: { gameAction: "hardDrop" },
    classList: {
      add: (value) => pressedClasses.add(value),
      remove: (value) => pressedClasses.delete(value)
    },
    setPointerCapture() {}
  };
  const target = { closest: () => control };
  const root = {
    addEventListener: (type, handler) => handlers.set(type, handler),
    removeEventListener: (type) => handlers.delete(type),
    contains: (candidate) => candidate === control
  };
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

  handlers.get("pointerdown")({
    isPrimary: true,
    pointerType: "touch",
    pointerId: 7,
    target,
    preventDefault() { prevented = true; }
  });

  assert.deepEqual(actions, ["hardDrop"]);
  assert.deepEqual(haptics, [8]);
  assert.equal(prevented, true);
  assert.equal(pressedClasses.has("is-pressed"), true);

  handlers.get("pointerup")({ pointerId: 7 });
  assert.equal(pressedClasses.has("is-pressed"), false);
  input.destroy();
});

test("on-screen input keeps simultaneous touch pointers independent", () => {
  const handlers = new Map();
  const makeControl = (actionId) => {
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
  };
  const left = makeControl("hardDrop");
  const right = makeControl("sculpt");
  const root = {
    addEventListener: (type, handler) => handlers.set(type, handler),
    removeEventListener: (type) => handlers.delete(type),
    contains: (candidate) => candidate === left.control || candidate === right.control
  };
  const actions = [];
  const input = createOnScreenGameInput({
    root,
    performAction(actionId) {
      actions.push(actionId);
      return true;
    },
    vibrate: null
  });
  const eventFor = (pointerId, control) => ({
    isPrimary: pointerId === 1,
    pointerType: "touch",
    pointerId,
    target: { closest: () => control },
    preventDefault() {}
  });

  handlers.get("pointerdown")(eventFor(1, left.control));
  handlers.get("pointerdown")(eventFor(2, right.control));
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

test("controller markup covers tablet rails, phone deck, and pause access", () => {
  const markup = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const styles = readFileSync(new URL("../styles.css", import.meta.url), "utf8");

  assert.match(markup, /tablet-control-rail-left[\s\S]*data-game-action="focusPrevious"/);
  assert.match(markup, /tablet-control-rail-right[\s\S]*data-game-action="focusNext"/);
  assert.match(markup, /game-control-surface[\s\S]*data-game-action="hardDrop"/);
  assert.match(markup, /game-control-surface[\s\S]*data-game-action="sculpt"/);
  assert.equal((markup.match(/data-pause-game/g) || []).length, 2);
  assert.doesNotMatch(styles, /data-active-screen="game"\]\s+\.game-control-surface/);
  assert.doesNotMatch(styles, /data-active-screen="game"\]\s+\.tablet-control-rail/);
  assert.match(styles, /\.drop-button\s*\{[\s\S]*?top:\s*var\(--deck-action-stagger\)/);
  assert.match(styles, /\.sculpt-button\s*\{[\s\S]*?top:\s*calc\(0px\s*-\s*var\(--deck-action-stagger\)\)/);
  assert.match(styles, /orientation:\s*portrait[\s\S]*?\.console-layout\s*\{[\s\S]*?height:\s*100%[\s\S]*?display:\s*flex/);
  assert.match(styles, /orientation:\s*portrait[\s\S]*?\.game-control-surface\s*\{[\s\S]*?margin:\s*auto\s+0\s+0/);
  assert.match(styles, /\.rail-drop-button\s*\{\s*grid-area:\s*2\s*\/\s*1/);
  assert.match(styles, /\.rail-sculpt-button\s*\{\s*grid-area:\s*1\s*\/\s*2/);
});

test("input hints follow the visible keyboard, handheld, and tablet-rail controls", () => {
  const markup = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const styles = readFileSync(new URL("../styles.css", import.meta.url), "utf8");

  assert.match(markup, /data-input-hint="keyboard">WASD \/ ARROWS SELECT/);
  assert.match(markup, /data-input-hint="touch">D-PAD SELECT/);
  assert.match(markup, /data-input-hint="handheld"><kbd>SELECT<\/kbd><span>CYCLE FOCUS/);
  assert.match(markup, /data-input-hint="tablet-rail"><kbd>−<\/kbd><span>&lt; FOCUS &gt;<\/span><kbd>\+/);
  assert.match(markup, /pause-hint" data-input-hint="keyboard">ESC RESUME/);
  assert.match(markup, /pause-hint" data-input-hint="touch">START RESUME/);

  assert.match(styles, /\[data-input-hint="touch"\],[\s\S]*?\[data-input-hint="tablet-rail"\][\s\S]*?display:\s*none/);
  assert.match(styles, /@media\s*\(hover:\s*none\)\s*and\s*\(pointer:\s*coarse\)\s*\{[\s\S]*?\[data-input-hint="keyboard"\]\s*\{\s*display:\s*none[\s\S]*?\.menu-footer \[data-input-hint="touch"\]\s*\{\s*display:\s*inline/);
  assert.match(styles, /orientation:\s*portrait[\s\S]*?\.focus-nav\[data-input-hint="handheld"\]\s*\{\s*display:\s*flex/);
  assert.match(styles, /orientation:\s*landscape[\s\S]*?min-width:\s*900px[\s\S]*?min-height:\s*600px[\s\S]*?\.focus-nav\[data-input-hint="tablet-rail"\]\s*\{\s*display:\s*flex/);
});
