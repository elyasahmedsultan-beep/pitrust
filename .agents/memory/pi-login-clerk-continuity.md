---
name: Pi login and Clerk continuity
description: Authentication boundary between Pi app sessions, legacy Clerk accounts, Google links, and privileged routes.
---

Use a server-verified Pi identity to establish the normal site's app-owned HttpOnly session; Pi sign-in must not depend on a Clerk ticket or active Clerk session. Keep existing canonical account IDs and Google links unchanged. New Pi-only sign-ups may receive an app-owned account ID, but they must not silently merge with an unrelated Clerk account.

For normal Pi sign-in, a validated successful `POST /api/pi/session` response is enough to set the in-memory app session and navigate with SPA routing; do not block on Clerk or a follow-up session GET. This does not prove the browser accepted the HttpOnly cookie: reload and protected API access still need a separate cookie round-trip check. Never expose the server app-session token to JavaScript.

Keep Clerk records and provider configuration for existing Google identity management and Clerk-only privileged access. A Pi app session alone must not authorize arbitrator actions. Keep the short-lived Testnet iframe session separate from the normal site's app session.

**Why:** The user approved moving normal Pi authentication away from Clerk while preserving account ownership, Google links, and least-privilege access.

**How to apply:** Verify Pi access tokens server-side, resolve existing accounts by immutable Pi UID, and create an account only on explicit sign-up. Use a separate revocable app-session store and cookie. Do not delete Clerk users or let app-session identity alone satisfy Clerk-only role checks. Treat Google linking for new app-only accounts as a separate migration.

For Pi Browser sign-in and ordinary Pi app sessions, do not mount `ClerkProvider`; bypassing Clerk middleware on the server does not prevent the frontend Clerk client from making Frontend API/session requests. Mount Clerk only for explicit Google account management, OAuth callbacks, and privileged routes.

**Why:** The Clerk frontend client can initiate its own network requests as soon as the provider mounts, even when the Pi app cookie already authenticates the user.

**How to apply:** Resolve Pi Browser/session mode before mounting Clerk. Keep the Google-linking action explicit and preserve Clerk on callback and admin routes.

**Why:** Pi Browser may not return cookies reliably on the immediate follow-up request, while a verified POST response already supplies the server-approved application identity for current-page state.

**How to apply:** Validate the response shape before updating app state, clear user-scoped query state if its account changes, and use SPA navigation. Test cookie persistence separately after reload and on protected API calls.

When a Pi Browser rejects cookies, keep the server app-session token HttpOnly. The Pi SDK access token may be used as a current-page fallback only in volatile memory, scoped to same-origin API requests, and independently verified by the server against the canonical Pi UID. If production cookies use `SameSite=None`, enforce same-origin checks for cookie-authenticated state-changing requests.

**Why:** Persisting a server session token in browser storage increases the impact of script injection, while a cross-site cookie can reintroduce CSRF exposure. The SDK token is already issued to the app and can provide a non-persistent fallback when cookie storage fails.

**How to apply:** Keep the cookie primary, send the fallback only to the app API, verify it server-side, fail closed on identity conflicts, and keep cache keys hashed with a short validity window. Never persist either credential in local or session storage.