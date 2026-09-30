---
name: Express router mount order
description: Avoid public endpoints being blocked by broad session middleware in earlier mounted routers.
---

In Express, `router.use(requireSession)` at the root of a mounted router runs for requests entering that router even when none of its endpoint routes match. If it sends a response instead of calling `next()`, later routers never get the request.

**Why:** A public listing-fee endpoint skipped Clerk by design, but an earlier mounted payouts router still invoked `requireSession`; that middleware called `getAuth()` before Clerk ran and failed before the public handler.

**How to apply:** Scope authentication middleware to its route prefix (for example, `router.use("/pi", requireSession)`). When adding a public route, audit every earlier mounted router for root-level auth; add a method-and-path-specific exemption or reorder routers if needed.