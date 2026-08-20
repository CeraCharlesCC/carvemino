import assert from "node:assert/strict";
import test from "node:test";

import { hashJson32Hex, mix32 } from "../src/domain/hash.js";

test("shared JSON hashing keeps the deterministic FNV-1a vectors", () => {
  assert.equal(hashJson32Hex(null), "77074ba4");
  assert.equal(hashJson32Hex({ a: 1 }), "8b9e4511");
  assert.equal(hashJson32Hex(["carver", 42, true]), "5b11f614");
});

test("shared 32-bit mixing keeps the deterministic avalanche vectors", () => {
  assert.equal(mix32(0), 0x00000000);
  assert.equal(mix32(1), 0x688990c0);
  assert.equal(mix32(0x12345678), 0xf5e71c96);
  assert.equal(mix32(0xffffffff), 0x6768824a);
});