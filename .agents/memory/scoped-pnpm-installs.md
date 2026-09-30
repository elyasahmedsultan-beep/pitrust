---
name: Scoped pnpm operations
description: Keep dependency changes targeted to the correct package in a pnpm workspace
---

For dependency changes within one artifact, verify the target package manifest and lockfile after using the package-management callback. The callback may report a successful uninstall without changing a nested artifact manifest. If it uses the workspace root or leaves the target unchanged, use a scoped command such as `pnpm --filter @workspace/<artifact> add|remove <package>`.

**Why:** The callback can target the root package rather than the requested artifact; one uninstall reported success while leaving the artifact manifest untouched.

**How to apply:** Inspect the resulting diff before assuming a package change occurred. Keep the target artifact's manifest and workspace lockfile in sync.