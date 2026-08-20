import assert from "node:assert/strict";
import test from "node:test";

import { defineCodec, shape as s } from "../src/codec.js";

test("codecs validate, detach, and serialize from one declared shape", () => {
  const codec = defineCodec(s.object({
    id: s.string({ nonEmpty: true }),
    enabled: s.boolean(),
    values: s.array(s.integer({ minimum: 0 }))
  }));
  const source = { id: "alpha", enabled: true, values: [1, 2] };

  const parsed = codec.parse(source, "fixture");
  assert.deepEqual(parsed, source);
  assert.notEqual(parsed, source);
  assert.notEqual(parsed.values, source.values);
  source.values[0] = 99;
  assert.equal(parsed.values[0], 1);
  assert.equal(codec.stringify(parsed, "fixture"), JSON.stringify(parsed));
  assert.throws(() => codec.assert({ ...parsed, extra: true }, "fixture"), /fixture\.extra is not supported/);
});

test("discriminated codecs reject fields from inactive variants and prototype names", () => {
  const codec = defineCodec(s.discriminatedUnion("type", {
    linear: s.object({ type: s.literal("linear"), step: s.integer({ minimum: 0 }) }),
    curve: s.object({ type: s.literal("curve"), points: s.array(s.integer(), { minimumLength: 2 }) })
  }));

  assert.throws(
    () => codec.assert({ type: "curve", points: [3, 2], step: 1 }, "progression"),
    /progression\.step is not supported/
  );
  assert.throws(
    () => codec.assert({ type: "constructor" }, "progression"),
    /progression\.type is unsupported/
  );
});

test("JSON codecs reject values that cannot round-trip as plain JSON data", () => {
  const codec = defineCodec(s.json());
  const sparse = [];
  sparse.length = 1;
  const circular = {};
  circular.self = circular;

  assert.throws(() => codec.parse(sparse, "payload"), /sparse array entries/);
  assert.throws(() => codec.parse(circular, "payload"), /circular references/);
  assert.throws(() => codec.parse({ value: Number.NaN }, "payload"), /finite JSON numbers/);
  assert.throws(() => codec.parse(new Date(), "payload"), /plain JSON objects/);
});
