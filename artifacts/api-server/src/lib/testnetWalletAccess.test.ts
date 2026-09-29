import assert from "node:assert/strict";
import test from "node:test";
import { isTestnetWalletHostAllowed } from "./testnetWalletAccess.ts";

const sandboxEnvironment = {
  PI_NETWORK: "testnet",
  PI_IFRAME_SESSION_ENABLED: "true",
  PI_IFRAME_SESSION_ALLOWED_HOSTS: "supabase-server-hub.replit.app",
  NODE_ENV: "production",
};

test("enables wallet routes only on the configured Testnet Sandbox host", () => {
  assert.equal(
    isTestnetWalletHostAllowed("supabase-server-hub.replit.app", sandboxEnvironment),
    true,
  );
  assert.equal(isTestnetWalletHostAllowed("reviewer.example", sandboxEnvironment), false);
  assert.equal(isTestnetWalletHostAllowed("pitrustweb.com", sandboxEnvironment), false);
});

test("keeps the wallet disabled unless the server network is Testnet", () => {
  assert.equal(
    isTestnetWalletHostAllowed("supabase-server-hub.replit.app", {
      ...sandboxEnvironment,
      PI_NETWORK: "mainnet",
    }),
    false,
  );
});

test("allows local and Replit development hosts only outside production", () => {
  const developmentEnvironment = {
    ...sandboxEnvironment,
    PI_IFRAME_SESSION_ENABLED: "false",
    NODE_ENV: "development",
  };
  assert.equal(isTestnetWalletHostAllowed("localhost", developmentEnvironment), true);
  assert.equal(isTestnetWalletHostAllowed("workspace.replit.dev", developmentEnvironment), true);
  assert.equal(isTestnetWalletHostAllowed("localhost", sandboxEnvironment), false);
});