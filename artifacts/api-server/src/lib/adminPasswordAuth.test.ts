import assert from "node:assert/strict";
import test from "node:test";
import {
  ADMIN_SESSION_TTL_MS,
  configuredAdminPassword,
  createAdminSessionToken,
  isValidAdminSessionToken,
  verifyAdminPassword,
} from "./adminPasswordAuth.ts";

const SESSION_SECRET = "test-session-secret-with-adequate-entropy";
const PASSWORD = "a-test-admin-password-long-enough";

test("admin password is read from ADMIN_PASSWORD", () => {
  assert.equal(configuredAdminPassword({ ADMIN_PASSWORD: "configured-password" }), "configured-password");
  assert.equal(configuredAdminPassword({}), null);
});

test("admin password comparison is exact and rejects short configured secrets", () => {
  assert.equal(verifyAdminPassword(PASSWORD, PASSWORD), true);
  assert.equal(verifyAdminPassword(`${PASSWORD} `, PASSWORD), false);
  assert.equal(verifyAdminPassword(null, PASSWORD), false);
  assert.equal(verifyAdminPassword(PASSWORD, "short"), false);
});

test("admin session token is signed and expires after its fixed lifetime", () => {
  const now = 1_800_000_000_000;
  const token = createAdminSessionToken(SESSION_SECRET, PASSWORD, now);

  assert.equal(isValidAdminSessionToken(token, SESSION_SECRET, PASSWORD, now), true);
  assert.equal(
    isValidAdminSessionToken(token, SESSION_SECRET, PASSWORD, now + ADMIN_SESSION_TTL_MS),
    false,
  );
  assert.equal(isValidAdminSessionToken(token, "different-secret", PASSWORD, now), false);
  assert.equal(isValidAdminSessionToken(token, SESSION_SECRET, `${PASSWORD}-rotated`, now), false);
});

test("admin session token rejects tampering and malformed input", () => {
  const now = 1_800_000_000_000;
  const token = createAdminSessionToken(SESSION_SECRET, PASSWORD, now);
  const [payload, signature] = token.split(".");

  assert.equal(isValidAdminSessionToken(`${payload}.AAAA`, SESSION_SECRET, PASSWORD, now), false);
  assert.equal(isValidAdminSessionToken("not-a-session", SESSION_SECRET, PASSWORD, now), false);
  assert.equal(isValidAdminSessionToken(null, SESSION_SECRET, PASSWORD, now), false);
  assert.ok(signature);
});