---
name: Pi network credential isolation
description: Keep Pi Testnet and Mainnet requests, wallets, and payouts isolated.
---

Use `PI_NETWORK_API_KEY` for all Pi Platform API requests made by `piRequest`, including payment lookup, approval, completion, cancellation, and verification. Do not fall back to `PI_API_KEY` for those requests. Keep the A2U payout path on its separate network-specific API-key and wallet-seed configuration; Testnet A2U must require an explicit opt-in and never fall back to Mainnet credentials. Validate the payment DTO network against the persisted payout intent before completion or reconciliation.

**Why:** Approval and completion paths now use the unified Pi Network API key, while A2U payout credentials remain isolated to avoid confusing a Pi Platform request key with a payout wallet's signing credentials.

**How to apply:** Require `PI_ENV=mainnet` before returning `PI_NETWORK_API_KEY`; use it for all platform payment operations with no legacy fallback. Keep payout key/seed selection and reconciliation scoped to the explicitly selected network.