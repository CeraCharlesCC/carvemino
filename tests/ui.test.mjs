import assert from "node:assert/strict";
import test from "node:test";

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
