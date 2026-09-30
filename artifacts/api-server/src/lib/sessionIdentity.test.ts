import test from "node:test";
import assert from "node:assert/strict";
import {
  canUseClerkArbitratorIdentity,
  resolveAuthenticatedUserId,
  shouldInvokeClerkMiddleware,
} from "./sessionIdentity.ts";

test("Pi session endpoints do not invoke Clerk before or after sign-in", () => {
  assert.equal(shouldInvokeClerkMiddleware("/pi/session", false), false);
  assert.equal(shouldInvokeClerkMiddleware("/pi/session", true), false);
  assert.equal(shouldInvokeClerkMiddleware("/listing-ad-fee", false), false);
  assert.equal(shouldInvokeClerkMiddleware("/listing-ad-fee", true), false);
  assert.equal(shouldInvokeClerkMiddleware("/pi/iframe-session/identity", false), false);
});

test("a resolved Pi session bypasses Clerk for normal API routes", () => {
  assert.equal(shouldInvokeClerkMiddleware("/profile", true), false);
  assert.equal(shouldInvokeClerkMiddleware("/chat/rooms", true), false);
  assert.equal(shouldInvokeClerkMiddleware("/contracts", true), false);
});

test("Clerk remains enabled for privileged and account-linking routes", () => {
  assert.equal(shouldInvokeClerkMiddleware("/admin/disputes/123/decide", true), true);
  assert.equal(shouldInvokeClerkMiddleware("/admin/listing-ad-fee", true), true);
  assert.equal(shouldInvokeClerkMiddleware("/pi/link", true), true);
  assert.equal(shouldInvokeClerkMiddleware("/profile", false), true);
});

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

test("a verified Pi access token resolves the existing Pi account and rejects identity conflicts", () => {
  assert.equal(resolveAuthenticatedUserId({
    clerkUserId: null,
    piIframeSessionUserId: null,
    piAppSessionUserId: null,
    piAccessTokenUserId: "pi_user_a",
  }), "pi_user_a");
  assert.equal(resolveAuthenticatedUserId({
    clerkUserId: null,
    piIframeSessionUserId: "iframe_user_a",
    piAppSessionUserId: "pi_user_a",
    piAccessTokenUserId: "pi_user_b",
  }), null);
});

test("a Pi access token cannot authorize a mismatched Clerk arbitrator identity", () => {
  assert.equal(canUseClerkArbitratorIdentity({
    clerkUserId: "clerk_admin",
    piIframeSessionUserId: null,
    piAppSessionUserId: null,
    piAccessTokenUserId: "pi_user_a",
  }), false);
});