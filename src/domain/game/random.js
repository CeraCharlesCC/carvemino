export function hashSeed(seed, salt) {
  let x = (seed ^ salt) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x7feb352d);
  x = Math.imul(x ^ (x >>> 15), 0x846ca68b);
  return (x ^ (x >>> 16)) >>> 0 || 1;
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
