import assert from "node:assert/strict";
import test from "node:test";
import { canCancelPiPayment, hasVerifiedPiTransaction } from "./piPaymentRecovery.ts";

test("recognizes either Pi transaction verification signal", () => {
  assert.equal(hasVerifiedPiTransaction({ status: { transaction_verified: true } }), true);
  assert.equal(hasVerifiedPiTransaction({ transaction: { verified: true } }), true);
  assert.equal(hasVerifiedPiTransaction({ transaction: { verified: false } }), false);
});

test("only allows cancellation when Pi explicitly reports an unverified transaction", () => {
  assert.equal(canCancelPiPayment({ status: { transaction_verified: false } }), true);
  assert.equal(canCancelPiPayment({ transaction: { verified: false } }), true);
  assert.equal(canCancelPiPayment({ status: { transaction_verified: true } }), false);
  assert.equal(canCancelPiPayment({ transaction: { verified: true } }), false);
  assert.equal(canCancelPiPayment({ status: { developer_completed: true } }), false);
  assert.equal(canCancelPiPayment({}), false);
  assert.equal(canCancelPiPayment({ status: { transaction_verified: false }, transaction: { verified: true } }), false);
});