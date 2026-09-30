import assert from "node:assert/strict";
import test from "node:test";
import { StrKey } from "@stellar/stellar-sdk";
import {
  isValidPiWalletAddress,
  verifiedPiPaymentFromAddress,
} from "./piWallet.ts";

test("accepts checksum-valid Stellar G-addresses", () => {
  const address = StrKey.encodeEd25519PublicKey(new Uint8Array(32));
  assert.equal(isValidPiWalletAddress(address), true);
});

test("rejects malformed or checksum-invalid G-addresses", () => {
  assert.equal(isValidPiWalletAddress("G" + "A".repeat(55)), false);
  assert.equal(isValidPiWalletAddress("not-a-wallet"), false);
  assert.equal(isValidPiWalletAddress(null), false);
});

test("accepts a user's verified from address, never the app destination", () => {
  const address = StrKey.encodeEd25519PublicKey(new Uint8Array(32));
  assert.equal(verifiedPiPaymentFromAddress({
    from_address: address,
    to_address: "app-destination-is-not-used",
    status: {
      developer_approved: true,
      developer_completed: true,
      transaction_verified: true,
    },
    transaction: { verified: true },
  }), address);
});

test("does not capture a wallet before server-confirmed payment completion", () => {
  const address = StrKey.encodeEd25519PublicKey(new Uint8Array(32));
  assert.equal(verifiedPiPaymentFromAddress({
    from_address: address,
    status: {
      developer_approved: true,
      developer_completed: false,
      transaction_verified: true,
    },
    transaction: { verified: true },
  }), null);
});