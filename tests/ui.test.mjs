import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_KEYBINDINGS, GAMEPLAY_ACTIONS } from "../src/config.js";
import { getGameInputAction } from "../src/ui/game-screen.js";
import {
  getOnScreenGameAction,
  isGameplayActionId,
  isRepeatingGameAction
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
