---
name: Supabase minimal responses
description: Handle empty bodies returned by PostgREST for writes requesting minimal responses.
---

PostgREST returns no response body for `Prefer: return=minimal`; a successful insert can therefore return an empty `201` response. The shared Supabase request wrapper must treat an empty body as `undefined` when that preference was requested, rather than calling `response.json()` unconditionally.

**Why:** Pi iframe-session creation failed after valid Testnet authentication because the profile or session insert succeeded but parsing its intentionally empty response raised a `SyntaxError`, which the route surfaced as 503.

**How to apply:** For Supabase write requests with a minimal-return preference, handle empty successful responses explicitly. Continue parsing non-empty JSON responses and fail explicitly on unexpected empty bodies.