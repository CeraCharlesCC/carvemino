const FNV1A_OFFSET_BASIS = 0x811c9dc5;
const FNV1A_PRIME = 0x01000193;
const MIX32_MULTIPLIER_A = 0x7feb352d;
const MIX32_MULTIPLIER_B = 0x846ca68b;

export function mix32(value) {
  let x = value >>> 0;
  x = Math.imul(x ^ (x >>> 16), MIX32_MULTIPLIER_A);
  x = Math.imul(x ^ (x >>> 15), MIX32_MULTIPLIER_B);
  return (x ^ (x >>> 16)) >>> 0;
}

function hashText32(text) {
  let hash = FNV1A_OFFSET_BASIS;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, FNV1A_PRIME);
  }
  return hash >>> 0;
}

export function hashJson32Hex(value) {
  return hashText32(JSON.stringify(value)).toString(16).padStart(8, "0");
}