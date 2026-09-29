import assert from "node:assert/strict";
import test from "node:test";
import { ESCROW_SERVICE_DEPOSIT, verifyEscrowServiceDepositPayment } from "./escrowServiceDepositRules.ts";
import type { EscrowServiceDepositPayment } from "./escrowServiceDepositRules.ts";

const payment: EscrowServiceDepositPayment = {
  identifier: "pi-payment-1",
  amount: 1,
  memo: ESCROW_SERVICE_DEPOSIT.memo,
  direction: "user_to_app",
  network: "Pi Network",
  user_uid: "pi-user-1",
  metadata: { type: "escrow" },
};

test("accepts the exact Mainnet U2A escrow service deposit", () => {
  assert.doesNotThrow(() => verifyEscrowServiceDepositPayment("pi-payment-1", payment, "pi-user-1", "Pi Network"));
});

const mismatches: Array<[string, EscrowServiceDepositPayment]> = [
  ["payment identifier", { ...payment, identifier: "other" }],
  ["amount", { ...payment, amount: 2 }],
  ["memo", { ...payment, memo: "different memo" }],
  ["direction", { ...payment, direction: "app_to_user" }],
  ["network", { ...payment, network: "Pi Testnet" }],
  ["Pi UID", { ...payment, user_uid: "another-user" }],
  ["metadata", { ...payment, metadata: { type: "escrow", contractId: "spoofed" } }],
  ["cancelled payment", { ...payment, status: { cancelled: true } }],
];

for (const [label, candidate] of mismatches) {
  test(`rejects a mismatched ${label}`, () => {
    assert.throws(() => verifyEscrowServiceDepositPayment(
      "pi-payment-1",
      candidate,
      "pi-user-1",
      "Pi Network",
    ));
  });
}

test("rejects processing when the app is not configured for Mainnet", () => {
  assert.throws(() => verifyEscrowServiceDepositPayment("pi-payment-1", payment, "pi-user-1", "Pi Testnet"));
});