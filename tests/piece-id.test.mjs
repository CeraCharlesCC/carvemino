import test from "node:test";
import assert from "node:assert/strict";

import {
  formatGeneratedPieceId,
  parseGeneratedPieceNumber
} from "../src/domain/game/piece-id.js";

test("generated piece IDs use one canonical format", () => {
  assert.equal(formatGeneratedPieceId(1), "p1");
  assert.equal(formatGeneratedPieceId(42), "p42");
  assert.equal(parseGeneratedPieceNumber("p1"), 1n);
  assert.equal(parseGeneratedPieceNumber("p42"), 42n);

  for (const pieceId of ["p0", "p01", "P1", "p-1", "custom-piece"]) {
    assert.equal(parseGeneratedPieceNumber(pieceId), null);
  }
});
