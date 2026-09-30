import assert from "node:assert/strict";
import test from "node:test";
import { configuredPiNetworkApiKey } from "./piA2uConfig.ts";

test("payment-platform requests use only PI_NETWORK_API_KEY on the configured Mainnet", () => {
  const previous = {
    PI_ENV: process.env.PI_ENV,
    PI_NETWORK_API_KEY: process.env.PI_NETWORK_API_KEY,
    PI_API_KEY: process.env.PI_API_KEY,
  };

  try {
    process.env.PI_ENV = "mainnet";
    process.env.PI_NETWORK_API_KEY = " unified-network-key ";
    process.env.PI_API_KEY = "legacy-key";
    assert.equal(configuredPiNetworkApiKey(), "unified-network-key");

    delete process.env.PI_NETWORK_API_KEY;
    assert.equal(configuredPiNetworkApiKey(), undefined);

    process.env.PI_ENV = "testnet";
    process.env.PI_NETWORK_API_KEY = "unified-network-key";
    assert.equal(configuredPiNetworkApiKey(), undefined);
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});