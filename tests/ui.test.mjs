import assert from "node:assert/strict";
import test from "node:test";

import { getSingleplayerMode } from "../src/app/catalog.js";
import { getSculptAction, getTitleScreenAction } from "../src/ui/ui.js";

test("title screen keyboard actions are explicit and do not use selection keys", () => {
  assert.equal(getTitleScreenAction("Enter"), "start");
  assert.equal(getTitleScreenAction("KeyR"), "records");
  assert.equal(getTitleScreenAction("KeyO"), "options");

  for (const code of ["Space", "KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown"]) {
    assert.equal(getTitleScreenAction(code), null);
  }
});

test("sculpt action follows the cursor target and current resources", () => {
  const rules = getSingleplayerMode("classic").rules;
  const view = {
    scrap: rules.sculpting.fillCost,
    focusedPiece: {
      cells: [{ x: 0, y: 0 }, { x: 1, y: 0 }],
      carved: 0,
      carveLimit: 2
    },
    editableFillCells: [{ x: 2, y: 0 }]
  };

  assert.equal(getSculptAction(view, { x: 0, y: 0 }, rules), "CARVE");
  assert.equal(getSculptAction(view, { x: 2, y: 0 }, rules), "FILL");
  assert.equal(getSculptAction(view, { x: 3, y: 0 }, rules), null);

  view.scrap = rules.sculpting.fillCost - 1;
  assert.equal(getSculptAction(view, { x: 2, y: 0 }, rules), null);

  view.focusedPiece.carved = view.focusedPiece.carveLimit;
  assert.equal(getSculptAction(view, { x: 0, y: 0 }, rules), null);
});
