import assert from "node:assert/strict";
import test from "node:test";
import {
  createPiIframeSessionCredential,
  hashPiIframeSessionToken,
  isPiIframeSessionAllowed,
  isPiIframeSessionToken,
  resolvePiIframeSessionUserId,
} from "./piIframeSession.ts";

test("Pi iframe sessions remain disabled even when legacy Sandbox flags are set", () => {
  const legacyTestnetEnvironment = {
    PI_IFRAME_SESSION_ENABLED: "true",
    PI_IFRAME_SESSION_ALLOWED_HOSTS: "supabase-server-hub.replit.app",
    PI_NETWORK: "testnet",
    PI_ENV: "testnet",
  };

  assert.equal(
    isPiIframeSessionAllowed("supabase-server-hub.replit.app", legacyTestnetEnvironment),
    false,
  );
  assert.equal(
    isPiIframeSessionAllowed("pitrustweb.com", legacyTestnetEnvironment),
    false,
  );
});

test("Pi iframe session credentials remain opaque and cannot authenticate an account", async () => {
  const { token, tokenHash } = createPiIframeSessionCredential();
  assert.equal(isPiIframeSessionToken(token), true);
  assert.equal(tokenHash, hashPiIframeSessionToken(token));
  assert.match(tokenHash, /^[a-f0-9]{64}$/);
  assert.notEqual(tokenHash, token);
  assert.equal(isPiIframeSessionToken("not-a-session-token"), false);

  let lookupCalled = false;
  const userId = await resolvePiIframeSessionUserId(
    token,
    "supabase-server-hub.replit.app",
    {
      findPiUidByTokenHash: async () => {
        lookupCalled = true;
        return "testnet-pi-uid";
      },
      findUserIdByPiUid: async () => {
        lookupCalled = true;
        return "canonical-user";
      },
    },
    {
      PI_IFRAME_SESSION_ENABLED: "true",
      PI_NETWORK: "testnet",
      PI_ENV: "testnet",
    },
  );

  assert.equal(userId, null);
  assert.equal(lookupCalled, false);
});