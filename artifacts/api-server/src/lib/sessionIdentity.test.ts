import test from "node:test";
import assert from "node:assert/strict";
import {
  canUseClerkArbitratorIdentity,
  resolveAuthenticatedUserId,
} from "./sessionIdentity.ts";

test("Pi app session is the normal API identity even when another Clerk account is cached", () => {
  assert.equal(resolveAuthenticatedUserId({
    clerkUserId: "clerk_user_b",
    piIframeSessionUserId: null,
    piAppSessionUserId: "pi_user_a",
  }), "pi_user_a");
});

test("conflicting app and iframe session identities fail closed", () => {
  assert.equal(resolveAuthenticatedUserId({
    clerkUserId: null,
    piIframeSessionUserId: "iframe_user_a",
    piAppSessionUserId: "pi_user_b",
  }), null);
});

test("conflicting Clerk and iframe identities fail closed without an app session", () => {
  assert.equal(resolveAuthenticatedUserId({
    clerkUserId: "clerk_user_a",
    piIframeSessionUserId: "iframe_user_b",
    piAppSessionUserId: null,
  }), null);
});

test("Clerk-only requests retain their canonical identity", () => {
  assert.equal(resolveAuthenticatedUserId({
    clerkUserId: "clerk_user_a",
    piIframeSessionUserId: null,
    piAppSessionUserId: null,
  }), "clerk_user_a");
});

test("Pi app sessions alone never authorize arbitrator actions", () => {
  assert.equal(canUseClerkArbitratorIdentity({
    clerkUserId: null,
    piIframeSessionUserId: null,
    piAppSessionUserId: "pi_user_a",
  }), false);
});

test("a Clerk arbitrator cannot act alongside a different Pi account session", () => {
  assert.equal(canUseClerkArbitratorIdentity({
    clerkUserId: "clerk_admin",
    piIframeSessionUserId: null,
    piAppSessionUserId: "pi_user_a",
  }), false);
});

test("the matching canonical Clerk identity retains arbitrator access", () => {
  assert.equal(canUseClerkArbitratorIdentity({
    clerkUserId: "clerk_admin",
    piIframeSessionUserId: null,
    piAppSessionUserId: "clerk_admin",
  }), true);
});