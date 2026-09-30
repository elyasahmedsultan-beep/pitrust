const MIN_PI_UNITS = 100n;
const MAX_PI_UNITS = 100_000_000n;

export function isFlexiblePiAmount(value: string): boolean {
  if (value.length > 10 || !/^(?:0|1)(?:\.\d{1,8})?$/.test(value)) return false;
  const [whole, fraction = ""] = value.split(".");
  const units = BigInt(whole) * MAX_PI_UNITS +
    BigInt((fraction + "00000000").slice(0, 8));
  return units >= MIN_PI_UNITS && units <= MAX_PI_UNITS;
}