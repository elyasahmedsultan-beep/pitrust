---
name: Stale artifact workflow processes
description: Diagnose port conflicts when managed artifact workflows fail to restart cleanly.
---

When a managed artifact workflow reports `EADDRINUSE` after a restart, the previous server child may still be listening even though the latest workflow attempt is marked failed. Do not repeat restarts immediately. Stop the exact managed workflow, confirm its port has no listener, then restart one artifact at a time and verify both logs and HTTP health.

**Why:** A second workflow process can fail to bind while the original child continues serving the app, making status and port ownership appear contradictory.

**How to apply:** Use this when a restart fails with a port-in-use error. Inspect the listener and process tree first; stop the managed workflow before considering a targeted process cleanup.