const BYTE_MODE = 0b0100;
const EC_LEVEL_L_BITS = 0b01;
const FORMAT_POLYNOMIAL = 0x537;
const FORMAT_XOR_MASK = 0x5412;
const VERSION_POLYNOMIAL = 0x1f25;
const PAD_BYTES = [0xec, 0x11];

// QR Code Model 2, error-correction level L. Entry 0 is intentionally unused
// so each table can be indexed directly by version number.
const EC_BYTES_PER_BLOCK = [
  0,
  7, 10, 15, 20, 26, 18, 20, 24, 30, 18,
  20, 24, 26, 30, 22, 24, 28, 30, 28, 28,
  28, 28, 30, 30, 26, 28, 30, 30, 30, 30,
  30, 30, 30, 30, 30, 30, 30, 30, 30, 30
];

const EC_BLOCK_COUNT = [
  0,
  1, 1, 1, 1, 1, 2, 2, 2, 2, 4,
  4, 4, 4, 4, 6, 6, 6, 6, 7, 8,
  8, 9, 9, 10, 12, 12, 12, 13, 14, 15,
  16, 17, 18, 19, 19, 20, 21, 22, 24, 25
];

// QR Code Model 2 alignment-pattern center coordinates. Entry 0 is unused;
// version 1 has no alignment patterns.
const ALIGNMENT_PATTERN_CENTERS = [
  [],
  [],
  [6, 18],
  [6, 22],
  [6, 26],
  [6, 30],
  [6, 34],
  [6, 22, 38],
  [6, 24, 42],
  [6, 26, 46],
  [6, 28, 50],
  [6, 30, 54],
  [6, 32, 58],
  [6, 34, 62],
  [6, 26, 46, 66],
  [6, 26, 48, 70],
  [6, 26, 50, 74],
  [6, 30, 54, 78],
  [6, 30, 56, 82],
  [6, 30, 58, 86],
  [6, 34, 62, 90],
  [6, 28, 50, 72, 94],
  [6, 26, 50, 74, 98],
  [6, 30, 54, 78, 102],
  [6, 28, 54, 80, 106],
  [6, 32, 58, 84, 110],
  [6, 30, 58, 86, 114],
  [6, 34, 62, 90, 118],
  [6, 26, 50, 74, 98, 122],
  [6, 30, 54, 78, 102, 126],
  [6, 26, 52, 78, 104, 130],
  [6, 30, 56, 82, 108, 134],
  [6, 34, 60, 86, 112, 138],
  [6, 30, 58, 86, 114, 142],
  [6, 34, 62, 90, 118, 146],
  [6, 30, 54, 78, 102, 126, 150],
  [6, 24, 50, 76, 102, 128, 154],
  [6, 28, 54, 80, 106, 132, 158],
  [6, 32, 58, 84, 110, 136, 162],
  [6, 26, 54, 82, 110, 138, 166],
  [6, 30, 58, 86, 114, 142, 170]
];

class BitWriter {
  #bytes = [];
  #bitLength = 0;

  get bitLength() {
    return this.#bitLength;
  }

  append(value, width) {
    for (let shift = width - 1; shift >= 0; shift -= 1) {
      const byteIndex = Math.floor(this.#bitLength / 8);
      if (byteIndex === this.#bytes.length) this.#bytes.push(0);
      if (((value >>> shift) & 1) !== 0) {
        this.#bytes[byteIndex] |= 0x80 >>> (this.#bitLength % 8);
      }
      this.#bitLength += 1;
    }
  }

  toUint8Array() {
    return Uint8Array.from(this.#bytes);
  }
}

function buildGaloisFieldTables() {
  const exponent = new Uint8Array(512);
  const logarithm = new Uint8Array(256);
  let value = 1;

  for (let power = 0; power < 255; power += 1) {
    exponent[power] = value;
    logarithm[value] = power;
    value <<= 1;
    if ((value & 0x100) !== 0) value ^= 0x11d;
  }

  for (let power = 255; power < exponent.length; power += 1) {
    exponent[power] = exponent[power - 255];
  }

  return { exponent, logarithm };
}

const GF = buildGaloisFieldTables();
const generatorPolynomialCache = new Map();
const totalCodewordCountCache = new Map();

function multiplyInGaloisField(left, right) {
  if (left === 0 || right === 0) return 0;
  return GF.exponent[GF.logarithm[left] + GF.logarithm[right]];
}

function generatorPolynomial(degree) {
  const cached = generatorPolynomialCache.get(degree);
  if (cached) return cached;

  let coefficients = Uint8Array.of(1);
  for (let power = 0; power < degree; power += 1) {
    const root = GF.exponent[power];
    const next = new Uint8Array(coefficients.length + 1);

    for (let index = 0; index < coefficients.length; index += 1) {
      next[index] ^= coefficients[index];
      next[index + 1] ^= multiplyInGaloisField(coefficients[index], root);
    }
    coefficients = next;
  }

  generatorPolynomialCache.set(degree, coefficients);
  return coefficients;
}

function errorCorrectionRemainder(dataBytes, ecByteCount) {
  const divisor = generatorPolynomial(ecByteCount);
  const working = new Uint8Array(dataBytes.length + ecByteCount);
  working.set(dataBytes);

  for (let offset = 0; offset < dataBytes.length; offset += 1) {
    const factor = working[offset];
    if (factor === 0) continue;

    for (let index = 0; index < divisor.length; index += 1) {
      working[offset + index] ^= multiplyInGaloisField(divisor[index], factor);
    }
  }

  return working.slice(dataBytes.length);
}

function matrixSize(version) {
  return 21 + 4 * (version - 1);
}

function totalCodewordCount(version) {
  const cached = totalCodewordCountCache.get(version);
  if (cached !== undefined) return cached;

  // Mark every module reserved for QR function patterns. Whatever remains is
  // available to the payload bit stream (including any final remainder bits).
  const grid = makeModuleGrid(matrixSize(version));
  paintFunctionPatterns(grid, version);
  writeFormatInformation(grid, 0);
  writeVersionInformation(grid, version);

  let dataModuleCount = 0;
  for (const row of grid) {
    for (const module of row) {
      if (module === -1) dataModuleCount += 1;
    }
  }

  const codewordCount = Math.floor(dataModuleCount / 8);
  totalCodewordCountCache.set(version, codewordCount);
  return codewordCount;
}

function dataCodewordCount(version) {
  return totalCodewordCount(version) - EC_BYTES_PER_BLOCK[version] * EC_BLOCK_COUNT[version];
}

function byteCountWidth(version) {
  return version < 10 ? 8 : 16;
}

function selectVersion(byteCount) {
  for (let version = 1; version <= 40; version += 1) {
    const payloadBits = 4 + byteCountWidth(version) + byteCount * 8;
    if (payloadBits <= dataCodewordCount(version) * 8) return version;
  }
  throw new Error("QR data is too long for error-correction level L");
}

function encodeDataBytes(inputBytes, version) {
  const capacityBits = dataCodewordCount(version) * 8;
  const writer = new BitWriter();

  writer.append(BYTE_MODE, 4);
  writer.append(inputBytes.length, byteCountWidth(version));
  for (const byte of inputBytes) writer.append(byte, 8);

  writer.append(0, Math.min(4, capacityBits - writer.bitLength));
  while (writer.bitLength % 8 !== 0) writer.append(0, 1);

  for (let index = 0; writer.bitLength < capacityBits; index += 1) {
    writer.append(PAD_BYTES[index % PAD_BYTES.length], 8);
  }

  return writer.toUint8Array();
}

function splitDataBlocks(dataBytes, version) {
  const blockCount = EC_BLOCK_COUNT[version];
  const ecByteCount = EC_BYTES_PER_BLOCK[version];
  const shortestBlockLength = Math.floor(totalCodewordCount(version) / blockCount);
  const longerBlockCount = totalCodewordCount(version) % blockCount;
  const shorterBlockCount = blockCount - longerBlockCount;
  const shortestDataLength = shortestBlockLength - ecByteCount;
  const blocks = [];
  let offset = 0;

  for (let blockIndex = 0; blockIndex < blockCount; blockIndex += 1) {
    const dataLength = shortestDataLength + (blockIndex >= shorterBlockCount ? 1 : 0);
    const data = dataBytes.slice(offset, offset + dataLength);
    blocks.push({ data, ec: errorCorrectionRemainder(data, ecByteCount) });
    offset += dataLength;
  }

  return blocks;
}

function interleaveCodewords(dataBytes, version) {
  const blocks = splitDataBlocks(dataBytes, version);
  const result = new Uint8Array(totalCodewordCount(version));
  const longestDataLength = Math.max(...blocks.map(({ data }) => data.length));
  const ecByteCount = EC_BYTES_PER_BLOCK[version];
  let outputIndex = 0;

  for (let byteIndex = 0; byteIndex < longestDataLength; byteIndex += 1) {
    for (const { data } of blocks) {
      if (byteIndex < data.length) result[outputIndex++] = data[byteIndex];
    }
  }

  for (let byteIndex = 0; byteIndex < ecByteCount; byteIndex += 1) {
    for (const { ec } of blocks) result[outputIndex++] = ec[byteIndex];
  }

  return result;
}

function alignmentCenters(version) {
  return ALIGNMENT_PATTERN_CENTERS[version];
}

function makeModuleGrid(size) {
  return Array.from({ length: size }, () => {
    const row = new Int8Array(size);
    row.fill(-1);
    return row;
  });
}

function paintFinder(grid, top, left) {
  const size = grid.length;
  for (let row = Math.max(0, top - 1); row <= Math.min(size - 1, top + 7); row += 1) {
    for (let column = Math.max(0, left - 1); column <= Math.min(size - 1, left + 7); column += 1) {
      const localRow = row - top;
      const localColumn = column - left;
      const inside = localRow >= 0 && localRow <= 6 && localColumn >= 0 && localColumn <= 6;
      const outerRing = inside && (localRow === 0 || localRow === 6 || localColumn === 0 || localColumn === 6);
      const center = localRow >= 2 && localRow <= 4 && localColumn >= 2 && localColumn <= 4;
      grid[row][column] = outerRing || center ? 1 : 0;
    }
  }
}

function paintAlignment(grid, centerRow, centerColumn) {
  for (let rowOffset = -2; rowOffset <= 2; rowOffset += 1) {
    for (let columnOffset = -2; columnOffset <= 2; columnOffset += 1) {
      const distance = Math.max(Math.abs(rowOffset), Math.abs(columnOffset));
      grid[centerRow + rowOffset][centerColumn + columnOffset] = distance === 1 ? 0 : 1;
    }
  }
}

function paintFunctionPatterns(grid, version) {
  const size = grid.length;
  const centers = alignmentCenters(version);
  paintFinder(grid, 0, 0);
  paintFinder(grid, size - 7, 0);
  paintFinder(grid, 0, size - 7);

  for (const row of centers) {
    for (const column of centers) {
      if (grid[row][column] === -1) paintAlignment(grid, row, column);
    }
  }

  for (let index = 8; index < size - 8; index += 1) {
    const module = index % 2 === 0 ? 1 : 0;
    if (grid[6][index] === -1) grid[6][index] = module;
    if (grid[index][6] === -1) grid[index][6] = module;
  }
}

function bitLength(value) {
  return value === 0 ? 0 : 32 - Math.clz32(value);
}

function appendBchRemainder(value, polynomial, remainderWidth) {
  let remainder = value << remainderWidth;
  const polynomialWidth = bitLength(polynomial);

  while (bitLength(remainder) >= polynomialWidth) {
    remainder ^= polynomial << (bitLength(remainder) - polynomialWidth);
  }
  return (value << remainderWidth) | remainder;
}

function writeFormatInformation(grid, mask) {
  const size = grid.length;
  const formatValue = (EC_LEVEL_L_BITS << 3) | mask;
  const bits = appendBchRemainder(formatValue, FORMAT_POLYNOMIAL, 10) ^ FORMAT_XOR_MASK;
  const module = (index) => (bits >>> index) & 1;

  for (let index = 0; index <= 5; index += 1) grid[index][8] = module(index);
  grid[7][8] = module(6);
  grid[8][8] = module(7);
  grid[8][7] = module(8);
  for (let index = 9; index < 15; index += 1) grid[8][14 - index] = module(index);

  for (let index = 0; index < 8; index += 1) grid[8][size - 1 - index] = module(index);
  for (let index = 8; index < 15; index += 1) grid[size - 15 + index][8] = module(index);
  grid[size - 8][8] = 1;
}

function writeVersionInformation(grid, version) {
  if (version < 7) return;

  const size = grid.length;
  const bits = appendBchRemainder(version, VERSION_POLYNOMIAL, 12);
  for (let index = 0; index < 18; index += 1) {
    const module = (bits >>> index) & 1;
    const row = Math.floor(index / 3);
    const column = index % 3 + size - 11;
    grid[row][column] = module;
    grid[column][row] = module;
  }
}

function maskIncludes(mask, row, column) {
  switch (mask) {
    case 0: return (row + column) % 2 === 0;
    case 1: return row % 2 === 0;
    case 2: return column % 3 === 0;
    case 3: return (row + column) % 3 === 0;
    case 4: return (Math.floor(row / 2) + Math.floor(column / 3)) % 2 === 0;
    case 5: return (row * column) % 2 + (row * column) % 3 === 0;
    case 6: return ((row * column) % 2 + (row * column) % 3) % 2 === 0;
    case 7: return ((row + column) % 2 + (row * column) % 3) % 2 === 0;
    default: throw new Error(`Invalid QR mask: ${mask}`);
  }
}

function placePayload(grid, codewords, mask) {
  const size = grid.length;
  let bitOffset = 0;
  let upward = true;

  for (let rightColumn = size - 1; rightColumn > 0; rightColumn -= 2) {
    if (rightColumn === 6) rightColumn -= 1;

    for (let step = 0; step < size; step += 1) {
      const row = upward ? size - 1 - step : step;

      for (let columnOffset = 0; columnOffset < 2; columnOffset += 1) {
        const column = rightColumn - columnOffset;
        if (grid[row][column] !== -1) continue;

        const byteIndex = Math.floor(bitOffset / 8);
        const bitIndex = 7 - (bitOffset % 8);
        let dark = byteIndex < codewords.length && ((codewords[byteIndex] >>> bitIndex) & 1) !== 0;
        if (maskIncludes(mask, row, column)) dark = !dark;
        grid[row][column] = dark ? 1 : 0;
        bitOffset += 1;
      }
    }

    upward = !upward;
  }
}

function buildMatrix(version, codewords, mask) {
  const grid = makeModuleGrid(matrixSize(version));
  paintFunctionPatterns(grid, version);
  writeFormatInformation(grid, mask);
  writeVersionInformation(grid, version);
  placePayload(grid, codewords, mask);
  return grid;
}

function sameColorRunPenalty(line) {
  let penalty = 0;
  let runColor = line[0];
  let runLength = 1;

  for (let index = 1; index <= line.length; index += 1) {
    const module = line[index];
    if (index < line.length && module === runColor) {
      runLength += 1;
      continue;
    }

    if (runLength >= 5) penalty += 3 + runLength - 5;
    runColor = module;
    runLength = 1;
  }

  return penalty;
}

function runPenalty(grid) {
  const size = grid.length;
  let penalty = 0;

  for (const row of grid) penalty += sameColorRunPenalty(row);
  for (let column = 0; column < size; column += 1) {
    const values = new Int8Array(size);
    for (let row = 0; row < size; row += 1) values[row] = grid[row][column];
    penalty += sameColorRunPenalty(values);
  }

  return penalty;
}

function blockPenalty(grid) {
  let penalty = 0;
  for (let row = 0; row < grid.length - 1; row += 1) {
    for (let column = 0; column < grid.length - 1; column += 1) {
      const module = grid[row][column];
      if (
        grid[row][column + 1] === module
        && grid[row + 1][column] === module
        && grid[row + 1][column + 1] === module
      ) penalty += 3;
    }
  }
  return penalty;
}

const FINDER_LIKE_PATTERNS = [
  [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0],
  [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1]
];

function matchesPattern(line, offset, pattern) {
  for (let index = 0; index < pattern.length; index += 1) {
    if (line[offset + index] !== pattern[index]) return false;
  }
  return true;
}

function finderLikePenaltyForLine(line) {
  let penalty = 0;
  for (let offset = 0; offset <= line.length - 11; offset += 1) {
    if (FINDER_LIKE_PATTERNS.some((pattern) => matchesPattern(line, offset, pattern))) penalty += 40;
  }
  return penalty;
}

function finderLikePenalty(grid) {
  const size = grid.length;
  let penalty = 0;

  for (const row of grid) penalty += finderLikePenaltyForLine(row);
  for (let column = 0; column < size; column += 1) {
    const values = new Int8Array(size);
    for (let row = 0; row < size; row += 1) values[row] = grid[row][column];
    penalty += finderLikePenaltyForLine(values);
  }

  return penalty;
}

function balancePenalty(grid) {
  const size = grid.length;
  const total = size * size;
  let dark = 0;
  for (const row of grid) {
    for (const module of row) dark += module;
  }

  const fivePercentStepsFromHalf = Math.floor(Math.abs(dark * 20 - total * 10) / total);
  return fivePercentStepsFromHalf * 10;
}

function maskPenalty(grid) {
  return runPenalty(grid) + blockPenalty(grid) + finderLikePenalty(grid) + balancePenalty(grid);
}

export function createQrMatrix(text) {
  const inputBytes = new TextEncoder().encode(String(text));
  const version = selectVersion(inputBytes.length);
  const dataBytes = encodeDataBytes(inputBytes, version);
  const codewords = interleaveCodewords(dataBytes, version);
  let bestMatrix;
  let bestPenalty = Infinity;

  for (let mask = 0; mask < 8; mask += 1) {
    const candidate = buildMatrix(version, codewords, mask);
    const penalty = maskPenalty(candidate);
    if (penalty < bestPenalty) {
      bestMatrix = candidate;
      bestPenalty = penalty;
    }
  }

  return bestMatrix.map((row) => Array.from(row, (module) => module === 1));
}
