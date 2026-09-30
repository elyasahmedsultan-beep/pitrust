import assert from "node:assert/strict";
import test from "node:test";
import { paymentErrorMessage } from "./pi-payment-error.ts";

test("shows the server error body instead of a generic SDK failure", () => {
  assert.equal(
    paymentErrorMessage(
      { message: "HTTP 502 Bad Gateway", data: { error: "Contract funding state update failed" } },
      "Payment failed",
    ),
    "Contract funding state update failed",
  );
});

test("supports response envelopes and strips control characters", () => {
  assert.equal(
    paymentErrorMessage(
      { response: { data: { message: "Listing\u0000 publication was not saved" } } },
      "Payment failed",
    ),
    "Listing  publication was not saved",
  );
});

test("uses a safe fallback when no server message is available", () => {
  assert.equal(paymentErrorMessage({}, "Payment failed"), "Payment failed");
});