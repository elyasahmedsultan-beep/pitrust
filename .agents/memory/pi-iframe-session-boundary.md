---
name: Pi iframe session boundary
description: Security constraints for Pi-backed application sessions in the Testnet Sandbox.
---

Pi iframe sessions are alternate application credentials only for exact allowlisted Testnet Sandbox hosts. Resolve each token back to the canonical owner of the verified Pi UID; never accept it on Mainnet or use it to grant arbitrator authority. Store only a hash server-side and keep raw Pi and admin-session credentials in client memory, not browser storage or logs.

**Why:** Pi Browser embeds may not have Clerk cookies, so Testnet app routes need a Sandbox-only identity path; account ownership, Mainnet restrictions, and Clerk-only arbitrator access must still hold.

**How to apply:** Gate the session API by exact Testnet Sandbox host and network, preserve the existing Testnet connector, and do not introduce Mainnet database routing as part of this flow.