---
name: Express router mount order
description: Avoid public endpoints being blocked by broad session middleware in earlier mounted routers.
---

In Express, `router.use(requireSession)` at the root of a mounted router runs for requests entering that router even when none of its endpoint routes match. If it sends a response instead of calling `next()`, later routers never get the request.

**Why:** A public Pi authentication endpoint was unintentionally protected by an earlier escrow router's blanket session middleware, despite being declared before the Pi router's own authenticated routes.

**How to apply:** Scope authentication middleware to its route prefix (for example, `router.use("/pi", requireSession)`). When adding a public route, audit every earlier mounted router for root-level auth and scope or reorder any that could intercept it.