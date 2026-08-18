import assert from "node:assert/strict";
import test from "node:test";
import { createQrMatrix } from "../src/ui/qr-code-generator.js";

function assertBooleanSquare(matrix, expectedSize) {
  assert.equal(matrix.length, expectedSize);
  for (const row of matrix) {
    assert.equal(row.length, expectedSize);
    assert.ok(row.every((module) => typeof module === "boolean"));
  }
}

function assertFinderPattern(matrix, top, left) {
  for (let row = 0; row < 7; row += 1) {
    for (let column = 0; column < 7; column += 1) {
      const expected = (
        row === 0 || row === 6 || column === 0 || column === 6
        || (row >= 2 && row <= 4 && column >= 2 && column <= 4)
      );
      assert.equal(matrix[top + row][left + column], expected);
    }
  }
}

test("QR generator returns deterministic Model 2 matrices", () => {
  const first = createQrMatrix("cm1o.d.ABC_def-123");
  const second = createQrMatrix("cm1o.d.ABC_def-123");

  assertBooleanSquare(first, 25);
  assert.deepEqual(second, first);
  assertFinderPattern(first, 0, 0);
  assertFinderPattern(first, first.length - 7, 0);
  assertFinderPattern(first, 0, first.length - 7);
  assert.notDeepEqual(createQrMatrix("cm1o.d.ABC_def-124"), first);
});

test("QR generator selects the smallest byte-mode version that fits", () => {
  const cases = [
    [17, 21],
    [18, 25],
    [32, 25],
    [33, 29],
    [1000, 105],
    [2953, 177]
  ];

  for (const [length, expectedSize] of cases) {
    assert.equal(createQrMatrix("A".repeat(length)).length, expectedSize);
  }
  assert.throws(() => createQrMatrix("A".repeat(2954)), /too long/i);
});

test("QR generator measures Unicode payloads as UTF-8 bytes", () => {
  assertBooleanSquare(createQrMatrix("é".repeat(8)), 21);
  assertBooleanSquare(createQrMatrix("é".repeat(9)), 25);
  assertBooleanSquare(createQrMatrix("CARVEMINO 😀"), 21);
});
