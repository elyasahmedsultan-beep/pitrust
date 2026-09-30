export function fixedPiUnits(value: number | string): bigint | null {
  const raw = String(value);
  const match = /^(\d+)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(raw);
  if (!match) return null;
  const exponent = Number(match[3] ?? "0");
  if (!Number.isInteger(exponent) || Math.abs(exponent) > 100) return null;
  let digits = `${match[1]}${match[2] ?? ""}`.replace(/^0+(?=\d)/, "");
  let decimalPlaces = (match[2] ?? "").length - exponent;
  if (decimalPlaces > 8) {
    const excess = decimalPlaces - 8;
    if (!digits.endsWith("0".repeat(excess))) return null;
    digits = digits.slice(0, -excess);
    decimalPlaces = 8;
  }
  if (decimalPlaces < 0) {
    digits += "0".repeat(-decimalPlaces);
    decimalPlaces = 0;
  }
  return BigInt(digits || "0") * 10n ** BigInt(8 - decimalPlaces);
}

export const MIN_FLEXIBLE_PI_UNITS = 1n;
// Keep 8-decimal amounts exactly representable when converted to the Pi SDK's
// JavaScript number type.
export const MAX_FLEXIBLE_PI_UNITS = 100_000_000_000_000n;

export function isFlexiblePiAmount(value: number | string): boolean {
  const units = fixedPiUnits(value);
  return units !== null &&
    units >= MIN_FLEXIBLE_PI_UNITS &&
    units <= MAX_FLEXIBLE_PI_UNITS;
}