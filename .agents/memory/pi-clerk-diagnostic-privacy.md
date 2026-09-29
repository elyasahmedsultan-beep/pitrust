---
name: Pi and Clerk diagnostic privacy
description: Privacy constraints for browser and server-side authentication diagnostics.
---

For Pi/Clerk authentication diagnostics, do not log or persist cookies, access tokens, session tokens, session IDs, or raw error payloads. General HTTP request logging must redact session identifiers embedded in URL paths; redacting headers alone does not cover them. Persist only allowlisted outcomes, HTTP statuses, and short validated error codes, never free-form reasons.

**Why:** Authentication identifiers can appear in request paths or error payloads even when cookie and authorization headers are already redacted. The user explicitly requires diagnostics to avoid exposing cookies or tokens.

**How to apply:** When changing Pi/Clerk diagnostics, sanitize URL fields before logging and keep cross-context browser storage limited to safe summary fields. Never log raw Pi auth responses, Clerk session values, cookies, or free-form provider errors.