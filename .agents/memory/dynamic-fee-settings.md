---
name: Dynamic fee settings
description: Payment fee units, migration seeding, and deployment validation.
---

`transaction_fee_percentage` is stored in percentage points (`3` means 3%); `dispute_resolution_fee_pi` is a PI amount. The migration seeds defaults only when it creates the canonical `app_settings` table. Existing tables and values are preserved, and missing or invalid settings cause payment paths to fail closed with a service error.

**Why:** The deployed Supabase table layout could not be inspected during implementation. Avoid silently rewriting an operator-managed settings table or guessing a fee.

**How to apply:** Before enabling live payment processing, verify both setting rows exist in the deployed table and test quotes and payout calculations with sandbox data.