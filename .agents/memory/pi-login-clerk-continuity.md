---
name: Pi login and Clerk continuity
description: Authentication boundary between Pi app sessions, legacy Clerk accounts, Google links, and privileged routes.
---

Use a server-verified Pi identity to establish the normal site's app-owned HttpOnly session; Pi sign-in must not depend on a Clerk ticket or active Clerk session. Keep existing canonical account IDs and Google links unchanged. New Pi-only sign-ups may receive an app-owned account ID, but they must not silently merge with an unrelated Clerk account.

Keep Clerk records and provider configuration for existing Google identity management and Clerk-only privileged access. A Pi app session alone must not authorize arbitrator actions. Keep the short-lived Testnet iframe session separate from the normal site's app session.

**Why:** The user approved moving normal Pi authentication away from Clerk while preserving account ownership, Google links, and least-privilege access.

**How to apply:** Verify Pi access tokens server-side, resolve existing accounts by immutable Pi UID, and create an account only on explicit sign-up. Use a separate revocable app-session store and cookie. Do not delete Clerk users or let app-session identity alone satisfy Clerk-only role checks. Treat Google linking for new app-only accounts as a separate migration.