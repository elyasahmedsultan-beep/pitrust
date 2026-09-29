import * as assert from "node:assert/strict";
import { test } from "node:test";
import {
  configuredPiApiKey,
  configuredWalletPrivateSeed,
  payoutExecutionEnabled,
  productionPayoutEnabled,
  testnetPayoutEnabled,
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

test("Testnet A2U uses its dedicated app wallet seed", () => {
  const appWalletSecret = "S_TEST_APP_WALLET_PRIVATE_KEY";
  withEnvironment({
    PI_NETWORK: "testnet",
    PI_TESTNET_APP_WALLET_KEY: appWalletSecret,
    PI_APP_WALLET_KEY: undefined,
    PI_WALLET_SEED: undefined,
  }, () => {
    assert.equal(configuredWalletPrivateSeed(), appWalletSecret);
  });
});

test("Testnet never falls back to mainnet A2U credentials", () => {
  withEnvironment({
    NODE_ENV: "production",
    PI_NETWORK: "testnet",
    PI_A2U_TESTNET_ENABLED: "true",
    PI_TESTNET_API_KEY: undefined,
    PI_TESTNET_APP_WALLET_KEY: undefined,
    PI_API_KEY: "mainnet-api-key",
    PI_APP_WALLET_KEY: "S_MAINNET_WALLET_PRIVATE_KEY",
    PI_WALLET_SEED: undefined,
  }, () => {
    assert.equal(configuredPiApiKey(), undefined);
    assert.equal(configuredWalletPrivateSeed(), undefined);
    assert.equal(testnetPayoutEnabled(), false);
    assert.equal(payoutExecutionEnabled(), false);
  });
});

test("Mainnet never falls back to Testnet or legacy wallet credentials", () => {
  withEnvironment({
    NODE_ENV: "production",
    PI_NETWORK: "mainnet",
    PI_A2U_ENABLED: "true",
    PI_API_KEY: undefined,
    PI_APP_WALLET_KEY: undefined,
    PI_WALLET_SEED: "S_LEGACY_WALLET_PRIVATE_KEY",
    PI_TESTNET_API_KEY: "testnet-api-key",
    PI_TESTNET_APP_WALLET_KEY: "S_TESTNET_WALLET_PRIVATE_KEY",
  }, () => {
    assert.equal(configuredPiApiKey(), undefined);
    assert.equal(configuredWalletPrivateSeed(), undefined);
    assert.equal(productionPayoutEnabled(), false);
    assert.equal(payoutExecutionEnabled(), false);
  });
});

test("Testnet A2U requires its explicit flag and matching network credentials", () => {
  withEnvironment({
    NODE_ENV: "production",
    PI_NETWORK: "testnet",
    PI_A2U_TESTNET_ENABLED: "true",
    PI_TESTNET_API_KEY: "testnet-api-key",
    PI_TESTNET_APP_WALLET_KEY: "S_TESTNET_WALLET_PRIVATE_KEY",
    PI_API_KEY: "mainnet-api-key",
    PI_APP_WALLET_KEY: "S_MAINNET_WALLET_PRIVATE_KEY",
    PI_WALLET_SEED: undefined,
  }, () => {
    assert.equal(configuredPiApiKey(), "testnet-api-key");
    assert.equal(configuredWalletPrivateSeed(), "S_TESTNET_WALLET_PRIVATE_KEY");
    assert.equal(testnetPayoutEnabled(), true);
    assert.equal(payoutExecutionEnabled(), true);
    process.env.PI_A2U_TESTNET_ENABLED = "false";
    assert.equal(testnetPayoutEnabled(), false);
    assert.equal(payoutExecutionEnabled(), false);
  });
});

test("A2U mainnet payout remains gated by explicit production mainnet settings", () => {
  withEnvironment({
    NODE_ENV: "production",
    PI_NETWORK: "mainnet",
    PI_A2U_ENABLED: "true",
    PI_API_KEY: "test-api-key",
    PI_APP_WALLET_KEY: "S_TEST_APP_WALLET_PRIVATE_KEY",
    PI_WALLET_SEED: undefined,
    PI_TESTNET_API_KEY: undefined,
    PI_TESTNET_APP_WALLET_KEY: undefined,
  }, () => {
    assert.equal(productionPayoutEnabled(), true);
    assert.equal(payoutExecutionEnabled(), true);
    process.env.PI_A2U_ENABLED = "false";
    assert.equal(productionPayoutEnabled(), false);
    assert.equal(payoutExecutionEnabled(), false);
  });
});
