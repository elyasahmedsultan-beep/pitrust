import assert from "node:assert/strict";
import test from "node:test";
import { isFlexiblePiAmount } from "./piAmount.ts";

test("accepts positive Pi amounts through 1,000,000 with 8-decimal precision", () => {
  for (const amount of [0.00000001, 0.75, 1, 1_000_000, "0.00000001", "1.00000000"]) {
    assert.equal(isFlexiblePiAmount(amount), true, String(amount));
  }
});

test("rejects amounts outside the range or precision", () => {
  for (const amount of [0, -0.1, 0.000000001, 1_000_000.00000001, 1_000_001, "0.000000001", "NaN"]) {
    assert.equal(isFlexiblePiAmount(amount), false, String(amount));
  }
});