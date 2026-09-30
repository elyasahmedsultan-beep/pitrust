import assert from "node:assert/strict";
import test from "node:test";
import { isTestnetWalletHostAllowed } from "./testnetWalletAccess.ts";

test("Testnet wallet routes stay disabled on every host, including legacy Sandbox settings", () => {
  const legacyTestnetEnvironment = {
    PI_ENV: "testnet",
    PI_NETWORK: "testnet",
    PI_IFRAME_SESSION_ENABLED: "true",
    PI_IFRAME_SESSION_ALLOWED_HOSTS: "supabase-server-hub.replit.app",
    NODE_ENV: "development",
  };

  assert.equal(
    isTestnetWalletHostAllowed("supabase-server-hub.replit.app", legacyTestnetEnvironment),
    false,
  );
  assert.equal(isTestnetWalletHostAllowed("localhost", legacyTestnetEnvironment), false);
  assert.equal(isTestnetWalletHostAllowed("workspace.replit.dev", legacyTestnetEnvironment), false);
  assert.equal(isTestnetWalletHostAllowed("pitrustweb.com", legacyTestnetEnvironment), false);
});