import { mix32 } from "../hash.js";

export function hashSeed(seed, salt) {
  return mix32(seed ^ salt) || 1;
}

function nextRandomU32(stream) {
  let x = stream.state >>> 0 || 1;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  stream.state = x >>> 0 || 1;
  return stream.state;
}

export function randomInt(stream, maxExclusive) {
  if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) {
    throw new Error("maxExclusive must be a positive integer");
  }
  return nextRandomU32(stream) % maxExclusive;
}
