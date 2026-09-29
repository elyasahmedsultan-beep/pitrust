import assert from "node:assert/strict";
import test from "node:test";
import { parseSupabaseResponse } from "./supabaseResponse.ts";

test("accepts an empty 201 response when return=minimal was requested", async () => {
  const response = new Response(null, { status: 201 });
  assert.equal(await parseSupabaseResponse(response, true), undefined);
});

test("accepts bodyless no-content responses", async () => {
  const response = new Response(null, { status: 204 });
  assert.equal(await parseSupabaseResponse(response), undefined);
});

test("parses JSON when the response includes a body", async () => {
  const response = Response.json([{ id: "row-1" }], { status: 201 });
  assert.deepEqual(await parseSupabaseResponse<Array<{ id: string }>>(response), [
    { id: "row-1" },
  ]);
});

test("rejects an unexpected empty response body", async () => {
  const response = new Response(null, { status: 200 });
  await assert.rejects(
    parseSupabaseResponse(response),
    /Supabase returned an empty response body/,
  );
});