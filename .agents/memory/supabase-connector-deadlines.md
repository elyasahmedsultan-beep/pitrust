---
name: Supabase connector deadlines
description: Timeout behavior for Supabase calls made through the Replit connector proxy.
---

`ReplitConnectors.proxy` does not accept `AbortSignal` in its proxy options. Bound application response time with a `Promise.race` deadline; a timed-out connector request may still finish remotely, so the result is unknown rather than guaranteed cancelled.

**Why:** Passing a fetch signal to the connector proxy fails TypeScript validation, while unbounded PostgREST calls can leave payment callbacks waiting for tens of seconds.

**How to apply:** Use a short proxy-call deadline and make retry/error copy tell callers to check payment status before retrying. Preserve idempotency for operations whose remote outcome can outlive the local request.