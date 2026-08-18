const GENERATED_PIECE_ID_PATTERN = /^p([1-9]\d*)$/;

export function formatGeneratedPieceId(pieceNumber) {
  return `p${pieceNumber}`;
}

export function parseGeneratedPieceNumber(pieceId) {
  const match = GENERATED_PIECE_ID_PATTERN.exec(pieceId);
  return match ? BigInt(match[1]) : null;
}
