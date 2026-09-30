---
name: Artifact production build environment
description: Why scoped web-artifact production builds need their own preview environment.
---

Vite artifact production builds can require the same `PORT` and `BASE_PATH` values that the managed workflow supplies at runtime. A recursive workspace build may not provide each artifact's own values, so an unrelated artifact can fail before the target app is built.

**Why:** Production-build verification in this workspace only succeeded when the target artifact was built with its configured preview environment; the aggregate failure was environmental, not a source-code build error.

**How to apply:** For a web artifact, check its configured preview path and run its scoped production build with the matching `PORT` and `BASE_PATH`. Treat a recursive build failure as inconclusive until the target artifact's own build has run.