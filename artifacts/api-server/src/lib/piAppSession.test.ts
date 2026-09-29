import test from "node:test";
import assert from "node:assert/strict";
import {
  createPiAppSessionCredential,
  hashPiAppSessionToken,
  isPiAppSessionToken,
  parsePiAppSessionCookie,
  resolvePiAppSession,
} from "./piAppSession.ts";

test("Pi app credentials are opaque 43-character tokens hashed with SHA-256", () => {
  const credential = createPiAppSessionCredential();
  assert.equal(isPiAppSessionToken(credential.token), true);
  assert.equal(credential.tokenHash, hashPiAppSessionToken(credential.token));
  assert.equal(credential.tokenHash.length, 64);
});

test("Pi app cookie parsing rejects malformed and unrelated cookies", () => {
  const token = createPiAppSessionCredential().token;
  assert.equal(parsePiAppSessionCookie(`other=x; pitrust_pi_session=${token}`), token);
  assert.equal(parsePiAppSessionCookie("pitrust_pi_session=not-a-token"), null);
  assert.equal(parsePiAppSessionCookie(undefined), null);
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