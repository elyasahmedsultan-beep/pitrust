---
name: Pi network credential isolation
description: Keep Pi Testnet and Mainnet requests, wallets, and payouts isolated.
---

Resolve Pi API credentials and the app wallet seed only from the credentials for the selected network. Testnet A2U must require an explicit opt-in and must never fall back to Mainnet credentials. Validate the Pi payment DTO network against the persisted payout intent before completion or reconciliation.

**Why:** Pi Developer Portal apps are bound to one network, while the server-side A2U SDK uses the network recorded on the Pi payment to choose its blockchain endpoint. A mismatched key or seed can create a payout path that does not match the app's intended environment.

**How to apply:** Keep separate Testnet and Mainnet secrets, require the corresponding network flag and feature gate, and filter reconciliation to intents for the selected network. Never infer the network from the presence of a generic secret.