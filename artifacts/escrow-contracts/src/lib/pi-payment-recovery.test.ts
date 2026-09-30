import assert from "node:assert/strict";
import test from "node:test";
import { incompletePiPaymentAction } from "./pi-payment-recovery.ts";

test("completes an incomplete payment after the wallet transaction is verified", () => {
  assert.equal(
    incompletePiPaymentAction({
      identifier: "payment-1",
      status: { transaction_verified: true },
      transaction: { txid: "tx-1" },
    }, false),
    "complete",
  );
});

test("cancels only when Pi explicitly reports no verified wallet transaction", () => {
  assert.equal(
    incompletePiPaymentAction({
      identifier: "payment-2",
      status: { transaction_verified: false },
      transaction: { txid: "tx-2", verified: false },
    }, true),
    "cancel",
  );
  assert.equal(incompletePiPaymentAction({ identifier: "payment-3" }, true), "manual_reconciliation");
  assert.equal(
    incompletePiPaymentAction({
      identifier: "payment-unsupported",
      status: { transaction_verified: false },
    }, false),
    "manual_reconciliation",
  );
});

test("requires manual reconciliation for inconsistent completed or verified payments", () => {
  assert.equal(
    incompletePiPaymentAction({
      identifier: "payment-4",
      status: { transaction_verified: true },
    }, true),
    "manual_reconciliation",
  );
  assert.equal(
    incompletePiPaymentAction({
      identifier: "payment-5",
      status: { developer_completed: true },
    }, true),
    "manual_reconciliation",
  );
});