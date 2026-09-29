import assert from "node:assert/strict";
import test from "node:test";
import {
  querySupabaseKeepAlive,
  SUPABASE_KEEP_ALIVE_RESOURCE,
} from "./supabaseKeepAlive.ts";

test("keep-alive reads at most one non-sensitive room identifier", async () => {
  let resource = "";

  await querySupabaseKeepAlive(async <T>(requestedResource: string) => {
    resource = requestedResource;
    return [] as T;
  });

  assert.equal(resource, "public_chat_rooms?select=id&limit=1");
  assert.equal(resource, SUPABASE_KEEP_ALIVE_RESOURCE);
});

test("keep-alive propagates a Supabase read failure", async () => {
  const failure = new Error("database unavailable");

  await assert.rejects(
    querySupabaseKeepAlive(async <T>() => {
      throw failure;
    }),
    failure,
  );
});