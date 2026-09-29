---
name: Scoped pnpm installs
description: Replit package installation callback limitations in a pnpm workspace
---

When adding a dependency to a single artifact, try the package-management callback first. If it runs `pnpm add` at the workspace root and fails with `ERR_PNPM_ADDING_TO_ROOT`, use `pnpm --filter @workspace/<artifact> add <package>` instead. The callback also rejects `--filter` when passed as a package token.

**Why:** Root installation would place an artifact-only dependency in the wrong package; the callback did not accept a workspace filter.

**How to apply:** Use this fallback only after the callback's root-targeting failure, and keep the artifact's package manifest and workspace lockfile in sync.