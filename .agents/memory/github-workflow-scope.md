---
name: GitHub workflow scope
description: Permission requirements when managing GitHub Actions files through the Replit GitHub connection.
---

Before creating or updating files under `.github/workflows` through GitHub's API, verify the connection can request the provider's `workflow` permission. Repository access alone may not be sufficient, and Git Data API routes should not be used to bypass a missing permission.

**Why:** The connected Replit GitHub OAuth scope set included `repo` but did not include `workflow`; GitHub documents the additional permission for workflow-file updates.

**How to apply:** Inspect the reauthorization scope set after an authorization-related failure. If `workflow` is unavailable, leave the GitHub repository unchanged and ask the user to add the workflow through GitHub or provide a connection that can write workflow files.