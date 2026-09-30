import assert from "node:assert/strict";
import test from "node:test";
import { describePaymentFailure } from "./paymentFailure.ts";

test("identifies a payment that Pi cannot find on the selected app and network", () => {
  const failure = describePaymentFailure(Object.assign(new Error("upstream details"), {
    status: 404,
    provider: "pi",
    code: "PI_PAYMENT_NOT_FOUND",
  }));
  assert.equal(failure.status, 404);
  assert.equal(failure.code, "PI_PAYMENT_NOT_FOUND");
  assert.match(failure.message, /same network/);
  assert.equal(failure.retryable, false);
});

test("reports an ambiguous payment database query as a server-side schema error", () => {
  const failure = describePaymentFailure(Object.assign(new Error("Supabase request failed"), {
    status: 400,
    provider: "supabase",
    code: "42702",
    details: { code: "42702", message: 'column reference "billing_month" is ambiguous' },
  }));
  assert.equal(failure.status, 502);
  assert.equal(failure.code, "42702");
  assert.match(failure.message, /ambiguous/);
  assert.equal(failure.retryable, true);
  assert.doesNotMatch(failure.message, /billing_month/);
});

test("reports database timeouts without claiming the payment did not commit", () => {
  const failure = describePaymentFailure(Object.assign(new Error("Supabase request failed"), {
    status: 504,
    provider: "supabase",
    code: "SUPABASE_TIMEOUT",
  }));
  assert.equal(failure.status, 504);
  assert.equal(failure.retryable, true);
  assert.match(failure.message, /payment status/);
});

test("preserves safe domain errors and their HTTP status", () => {
  const failure = describePaymentFailure(Object.assign(new Error("Payment contract not found"), {
    status: 404,
  }));
  assert.equal(failure.status, 404);
  assert.equal(failure.message, "Payment contract not found");
});