import assert from "node:assert/strict";
import test from "node:test";
import {
  createPiIframeSessionCredential,
  DEFAULT_PI_IFRAME_SESSION_ALLOWED_HOSTS,
  hashPiIframeSessionToken,
  isPiIframeSessionAllowed,
  isPiIframeSessionToken,
  PI_IFRAME_SESSION_TTL_SECONDS,
  resolvePiIframeSessionUserId,
} from "./piIframeSession.ts";

const enabledTestnet = {
  PI_IFRAME_SESSION_ENABLED: "true",
  PI_NETWORK: "testnet",
};

test("Pi iframe sessions are disabled unless explicitly enabled on Testnet", () => {
  assert.equal(
    isPiIframeSessionAllowed("supabase-server-hub.replit.app", {
      ...enabledTestnet,
      PI_IFRAME_SESSION_ENABLED: "false",
    }),
    false,
  );
  assert.equal(
    isPiIframeSessionAllowed("supabase-server-hub.replit.app", {
      ...enabledTestnet,
      PI_NETWORK: "mainnet",
    }),
    false,
  );
});

test("Pi iframe sessions are restricted to an exact allowlisted Sandbox host", () => {
  assert.equal(
    isPiIframeSessionAllowed("supabase-server-hub.replit.app", enabledTestnet),
    true,
  );
  assert.equal(
    isPiIframeSessionAllowed("other.replit.app", enabledTestnet),
    false,
  );
  assert.equal(
    isPiIframeSessionAllowed("supabase-server-hub.replit.app", {
      ...enabledTestnet,
      PI_IFRAME_SESSION_ALLOWED_HOSTS: "*.replit.app",
    }),
    false,
  );
  assert.equal(DEFAULT_PI_IFRAME_SESSION_ALLOWED_HOSTS, "supabase-server-hub.replit.app");
});

test("the PiTrust Mainnet domain cannot be allowed by the Sandbox override", () => {
  for (const host of ["pitrustweb.com", "www.pitrustweb.com", "api.pitrustweb.com"]) {
    assert.equal(
      isPiIframeSessionAllowed(host, {
        ...enabledTestnet,
        PI_IFRAME_SESSION_ALLOWED_HOSTS: `${host},supabase-server-hub.replit.app`,
      }),
      false,
    );
  }
});

test("Pi iframe session credentials are opaque, hashed, and short-lived", () => {
  const { token, tokenHash } = createPiIframeSessionCredential();
  assert.equal(isPiIframeSessionToken(token), true);
  assert.equal(tokenHash, hashPiIframeSessionToken(token));
  assert.match(tokenHash, /^[a-f0-9]{64}$/);
  assert.notEqual(tokenHash, token);
  assert.equal(PI_IFRAME_SESSION_TTL_SECONDS, 8 * 60 * 60);
  assert.equal(isPiIframeSessionToken("not-a-session-token"), false);
});

test("a valid Sandbox session resolves to the canonical owner of its verified Pi UID", async () => {
  const { token, tokenHash } = createPiIframeSessionCredential();
  const result = await resolvePiIframeSessionUserId(
    token,
    "supabase-server-hub.replit.app",
    {
      findPiUidByTokenHash: async (hash, now) => {
        assert.equal(hash, tokenHash);
        assert.ok(Number.isFinite(Date.parse(now)));
        return "verified-pi-uid";
      },
      findUserIdByPiUid: async (piUid) => {
        assert.equal(piUid, "verified-pi-uid");
        return "canonical-clerk-user";
      },
    },
    {
      ...enabledTestnet,
      PI_IFRAME_SESSION_ENABLED: "true",
    },
  );

  assert.equal(result, "canonical-clerk-user");
});

test("missing or expired Pi app sessions do not authenticate", async () => {
  const { token } = createPiIframeSessionCredential();
  const lookup = {
    findPiUidByTokenHash: async () => null,
    findUserIdByPiUid: async () => "canonical-clerk-user",
  };
  assert.equal(
    await resolvePiIframeSessionUserId(
      token,
      "supabase-server-hub.replit.app",
      lookup,
      { ...enabledTestnet, PI_IFRAME_SESSION_ENABLED: "true" },
    ),
    null,
  );
});