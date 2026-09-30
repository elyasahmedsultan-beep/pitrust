import test from "node:test";
import assert from "node:assert/strict";
import {
  createPiAppSessionCredential,
  hasPiAppSessionCookie,
  hashPiAppSessionToken,
  isPiAppSessionToken,
  piAppSessionCookieOptions,
  parsePiAppSessionCookie,
  resolvePiAppSession,
} from "./piAppSession.ts";

test("Pi app cookies support secure WebViews and use a root path", () => {
  const secureOptions = piAppSessionCookieOptions(true);
  assert.match(secureOptions, /SameSite=None/);
  assert.match(secureOptions, /Path=\//);
  assert.match(secureOptions, /Secure/);
  assert.match(secureOptions, /HttpOnly/);

  const localOptions = piAppSessionCookieOptions(false);
  assert.match(localOptions, /SameSite=Lax/);
  assert.match(localOptions, /Path=\//);
  assert.doesNotMatch(localOptions, /Secure/);
});

test("Pi app credentials are opaque 43-character tokens hashed with SHA-256", () => {
  const credential = createPiAppSessionCredential();
  assert.equal(isPiAppSessionToken(credential.token), true);
  assert.equal(credential.tokenHash, hashPiAppSessionToken(credential.token));
  assert.equal(credential.tokenHash.length, 64);
});

test("Pi app cookie parsing rejects malformed and unrelated cookies", () => {
  const token = createPiAppSessionCredential().token;
  assert.equal(parsePiAppSessionCookie(`other=x; pi_app_session=${token}`), token);
  assert.equal(parsePiAppSessionCookie(`pitrust_pi_session=${token}`), token);
  assert.equal(parsePiAppSessionCookie("pi_app_session=not-a-token"), null);
  assert.equal(parsePiAppSessionCookie(undefined), null);
  assert.equal(hasPiAppSessionCookie("pi_app_session=not-a-token"), true);
  assert.equal(hasPiAppSessionCookie("pitrust_pi_session=old-token"), true);
  assert.equal(hasPiAppSessionCookie("other=x"), false);
  assert.equal(hasPiAppSessionCookie(undefined), false);
});

test("Pi app session resolution enforces expiry lookup and canonical UID owner", async () => {
  const token = createPiAppSessionCredential().token;
  const result = await resolvePiAppSession(token, {
    findSession: async (hash) => hash === hashPiAppSessionToken(token)
      ? { pi_uid: "uid-1", pi_username: "pioneer" }
      : null,
    findUserIdByPiUid: async (uid) => uid === "uid-1" ? "user_1" : null,
  });
  assert.deepEqual(result, {
    userId: "user_1",
    piUid: "uid-1",
    username: "pioneer",
  });
  assert.equal(await resolvePiAppSession(null, {
    findSession: async () => null,
    findUserIdByPiUid: async () => null,
  }), null);
});