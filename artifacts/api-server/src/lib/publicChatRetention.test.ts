import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPublicChatRetentionResource,
  getPublicChatRetentionCutoff,
  isPublicChatRetentionEnabled,
  PUBLIC_CHAT_RETENTION_DAYS,
  PUBLIC_CHAT_RETENTION_INTERVAL_MS,
} from "./publicChatRetentionPolicy.ts";

test("public chat retention deletes messages older than exactly three days", () => {
  const now = new Date("2026-09-29T12:34:56.000Z");
  const resource = buildPublicChatRetentionResource(now);
  const encodedCutoff = resource.split("created_at=lt.")[1];

  assert.equal(PUBLIC_CHAT_RETENTION_DAYS, 3);
  assert.equal(getPublicChatRetentionCutoff(now), "2026-09-26T12:34:56.000Z");
  assert.equal(decodeURIComponent(encodedCutoff), getPublicChatRetentionCutoff(now));
  assert.match(resource, /^public_chat_messages\?created_at=lt\./);
});

test("public chat retention runs hourly", () => {
  assert.equal(PUBLIC_CHAT_RETENTION_INTERVAL_MS, 60 * 60 * 1000);
});

test("public chat retention is enabled only in production", () => {
  assert.equal(isPublicChatRetentionEnabled("production"), true);
  assert.equal(isPublicChatRetentionEnabled("development"), false);
  assert.equal(isPublicChatRetentionEnabled("test"), false);
});