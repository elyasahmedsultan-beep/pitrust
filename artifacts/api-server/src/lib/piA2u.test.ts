import * as assert from "node:assert/strict";
import { test } from "node:test";
import { StrKey } from "@stellar/stellar-sdk";
import {
  matchesPayoutPayment,
  payoutPaymentIsCompleted,
  payoutPaymentMetadata,
  type PiA2UPayment,
  type PayoutSnapshot,
} from "./piA2u.ts";
import {
  configuredPiNetwork,
  configuredPiApiKey,
  configuredWalletPrivateSeed,
  payoutExecutionEnabled,
  productionPayoutEnabled,
} from "./piA2uConfig.ts";

type TestEnvironment = Record<string, string | undefined>;

function withEnvironment(
  values: TestEnvironment,
  run: () => void,
): void {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(values)) {
    previous.set(key, process.env[key]);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    run();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

test("Mainnet Pi requests use PI_ENV, PI_API_KEY, and the Mainnet app wallet", () => {
  withEnvironment({
    PI_ENV: "mainnet",
    PI_API_KEY: "mainnet-api-key",
    PI_APP_WALLET_KEY: "S_MAINNET_WALLET_PRIVATE_KEY",
    PI_TESTNET_API_KEY: "testnet-api-key",
    PI_TESTNET_APP_WALLET_KEY: "S_TESTNET_WALLET_PRIVATE_KEY",
  }, () => {
    assert.equal(configuredPiNetwork(), "mainnet");
    assert.equal(configuredPiApiKey(), "mainnet-api-key");
    assert.equal(configuredWalletPrivateSeed(), "S_MAINNET_WALLET_PRIVATE_KEY");
  });
});

test("legacy PI_NETWORK cannot enable Pi traffic without PI_ENV=mainnet", () => {
  withEnvironment({
    NODE_ENV: "production",
    PI_ENV: undefined,
    PI_NETWORK: "mainnet",
    PI_A2U_ENABLED: "true",
    PI_API_KEY: "mainnet-api-key",
    PI_APP_WALLET_KEY: "S_MAINNET_WALLET_PRIVATE_KEY",
    PI_TESTNET_API_KEY: "testnet-api-key",
    PI_TESTNET_APP_WALLET_KEY: "S_TESTNET_WALLET_PRIVATE_KEY",
  }, () => {
    assert.equal(configuredPiNetwork(), null);
    assert.equal(configuredPiApiKey(), undefined);
    assert.equal(configuredWalletPrivateSeed(), undefined);
    assert.equal(payoutExecutionEnabled(), false);
  });
});

test("PI_ENV values other than mainnet cannot select Testnet or use its credentials", () => {
  withEnvironment({
    NODE_ENV: "production",
    PI_ENV: "testnet",
    PI_NETWORK: "testnet",
    PI_A2U_ENABLED: "true",
    PI_A2U_TESTNET_ENABLED: "true",
    PI_API_KEY: "mainnet-api-key",
    PI_APP_WALLET_KEY: "S_MAINNET_WALLET_PRIVATE_KEY",
    PI_TESTNET_API_KEY: "testnet-api-key",
    PI_TESTNET_APP_WALLET_KEY: "S_TESTNET_WALLET_PRIVATE_KEY",
    PI_WALLET_SEED: "S_LEGACY_WALLET_PRIVATE_KEY",
  }, () => {
    assert.equal(configuredPiNetwork(), null);
    assert.equal(configuredPiApiKey(), undefined);
    assert.equal(configuredWalletPrivateSeed(), undefined);
    assert.equal(productionPayoutEnabled(), false);
    assert.equal(payoutExecutionEnabled(), false);
  });
});

test("Mainnet A2U payouts remain gated by production mode, flag, and Mainnet credentials", () => {
  withEnvironment({
    NODE_ENV: "production",
    PI_ENV: "mainnet",
    PI_A2U_ENABLED: "true",
    PI_API_KEY: "mainnet-api-key",
    PI_APP_WALLET_KEY: "S_MAINNET_WALLET_PRIVATE_KEY",
    PI_TESTNET_API_KEY: "testnet-api-key",
    PI_TESTNET_APP_WALLET_KEY: "S_TESTNET_WALLET_PRIVATE_KEY",
  }, () => {
    assert.equal(configuredPiApiKey(), "mainnet-api-key");
    assert.equal(configuredWalletPrivateSeed(), "S_MAINNET_WALLET_PRIVATE_KEY");
    assert.equal(productionPayoutEnabled(), true);
    assert.equal(payoutExecutionEnabled(), true);
    process.env.PI_A2U_ENABLED = "false";
    assert.equal(productionPayoutEnabled(), false);
    assert.equal(payoutExecutionEnabled(), false);
  });
});

test("Mainnet A2U is unavailable in development even when Mainnet credentials exist", () => {
  withEnvironment({
    NODE_ENV: "development",
    PI_ENV: "mainnet",
    PI_A2U_ENABLED: "true",
    PI_API_KEY: "mainnet-api-key",
    PI_APP_WALLET_KEY: "S_MAINNET_WALLET_PRIVATE_KEY",
  }, () => {
    assert.equal(productionPayoutEnabled(), false);
    assert.equal(payoutExecutionEnabled(), false);
  });
});

test("payout DTO must match both the persisted Pi UID and registered G-address", () => {
  const walletAddress = StrKey.encodeEd25519PublicKey(new Uint8Array(32));
  const payout: PayoutSnapshot = {
    id: "payout-intent",
    contract_id: "contract-id",
    amount: "2",
    platform_fee: "0.1",
    inviter_reward: "0",
    seller_amount: "1.9",
    recipient_address: "verified-pi-uid",
    recipient_wallet_address: walletAddress,
    inviter_id: null,
    pi_payment_id: null,
    txid: null,
    network: "Pi Network",
  };
  const payment = {
    identifier: "payment-id",
    user_uid: "verified-pi-uid",
    to_address: walletAddress,
    direction: "app_to_user",
    network: "Pi Network",
    amount: "1.9",
    metadata: payoutPaymentMetadata(payout),
    status: { cancelled: false, user_cancelled: false },
  } as unknown as PiA2UPayment;

  assert.equal(matchesPayoutPayment(payment, payout), true);
  assert.equal(matchesPayoutPayment({ ...payment, to_address: `${walletAddress.slice(0, -1)}A` }, payout), false);
  assert.equal(matchesPayoutPayment({ ...payment, user_uid: "different-pi-uid" }, payout), false);
});

test("Pi payment verification fails closed when status or transaction data is null", () => {
  const walletAddress = StrKey.encodeEd25519PublicKey(new Uint8Array(32));
  const payout: PayoutSnapshot = {
    id: "payout-intent",
    contract_id: "contract-id",
    amount: "2",
    platform_fee: "0.1",
    inviter_reward: "0",
    seller_amount: "1.9",
    recipient_address: "verified-pi-uid",
    recipient_wallet_address: walletAddress,
    inviter_id: null,
    pi_payment_id: null,
    txid: null,
    network: "Pi Network",
  };
  const payment = {
    identifier: "payment-id",
    user_uid: "verified-pi-uid",
    to_address: walletAddress,
    direction: "app_to_user",
    network: "Pi Network",
    amount: "1.9",
    metadata: payoutPaymentMetadata(payout),
    status: {
      cancelled: false,
      user_cancelled: false,
      developer_approved: true,
      transaction_verified: true,
      developer_completed: true,
    },
    transaction: { verified: true, txid: "verified-txid" },
  } as unknown as PiA2UPayment;

  assert.equal(matchesPayoutPayment(null, payout), false);
  assert.equal(matchesPayoutPayment({ ...payment, status: null } as unknown as PiA2UPayment, payout), false);
  assert.equal(payoutPaymentIsCompleted(null, "verified-txid"), false);
  assert.equal(payoutPaymentIsCompleted({ ...payment, status: null } as unknown as PiA2UPayment, "verified-txid"), false);
  assert.equal(payoutPaymentIsCompleted({ ...payment, transaction: null }, "verified-txid"), false);
  assert.equal(payoutPaymentIsCompleted(payment, "verified-txid"), true);
});
