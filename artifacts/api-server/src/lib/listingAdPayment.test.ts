import assert from "node:assert/strict";
import test from "node:test";
import type { PiPayment } from "./pi.ts";
import {
  verifyListingAdPayment,
  type ListingAdPaymentIntentRow,
} from "./listingAdPayment.ts";

const publicationMemo = "Listing publication fee";
const intent: ListingAdPaymentIntentRow = {
  id: "ad-intent-1",
  listing_id: "listing-1",
  user_id: "user-1",
  pi_uid: "pi-user-1",
  amount: 0.125,
  memo: publicationMemo,
  operation: "publication",
  update_payload: null,
  network: "Pi Network",
  status: "pending",
  pi_payment_id: null,
  txid: null,
};

const payment: PiPayment = {
  identifier: "pi-payment-1",
  amount: 0.125,
  memo: publicationMemo,
  direction: "user_to_app",
  network: "Pi Network",
  user_uid: "pi-user-1",
  metadata: { type: "listing_ad", listingId: "listing-1", intentId: "ad-intent-1" },
};

test("accepts a Mainnet payment that exactly matches the server-issued listing intent", () => {
  assert.doesNotThrow(() => verifyListingAdPayment(
    "pi-payment-1", payment, intent, "pi-user-1", "Pi Network",
  ));
});

test("accepts the minimum one-unit Pi publication fee at 8-decimal precision", () => {
  const microIntent = { ...intent, amount: 0.00000001 };
  const microPayment = { ...payment, amount: 0.00000001 };
  assert.doesNotThrow(() => verifyListingAdPayment(
    "pi-payment-1", microPayment, microIntent, "pi-user-1", "Pi Network",
  ));
});

test("matches a paid edit against its exact operation metadata and amount", () => {
  const editIntent = {
    ...intent,
    amount: 0.00000001,
    memo: "Listing edit fee",
    operation: "edit" as const,
    update_payload: { title: "Updated" },
  };
  const editPayment = {
    ...payment,
    amount: 0.00000001,
    memo: "Listing edit fee",
    metadata: { ...payment.metadata, operation: "edit" },
  };
  assert.doesNotThrow(() => verifyListingAdPayment(
    "pi-payment-1", editPayment, editIntent, "pi-user-1", "Pi Network",
  ));
});

test("rejects payment metadata, amount, identity, or network mismatches", () => {
  const mismatches: PiPayment[] = [
    { ...payment, metadata: { ...payment.metadata, listingId: "other-listing" } },
    { ...payment, amount: 0.25 },
    { ...payment, user_uid: "other-user" },
    { ...payment, network: "Pi Testnet" },
    { ...payment, status: { cancelled: true } },
  ];
  for (const candidate of mismatches) {
    assert.throws(() => verifyListingAdPayment(
      "pi-payment-1", candidate, intent, "pi-user-1", "Pi Network",
    ));
  }
});

test("a legacy Testnet payment intent cannot be approved on Mainnet", () => {
  assert.throws(() => verifyListingAdPayment(
    "pi-payment-1",
    { ...payment, network: "Pi Testnet" },
    { ...intent, network: "Pi Testnet" },
    "pi-user-1",
    "Pi Network",
  ));
});