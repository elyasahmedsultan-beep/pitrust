---
name: Pi SDK bootstrap and identity
description: Pi web SDK availability, Testnet initialization, and app URL registration.
---

For Pi web apps, include `https://sdk.minepi.com/pi-sdk.js` in the HTML. Pi Browser does not inject `window.Pi`. Call `Pi.init` before any other SDK method, and set `sandbox: true` for Testnet. `Pi.init` does not take a client ID; app identity comes from app registration and URL mapping in the Pi Developer Portal. Testnet sandbox access uses the registered Sandbox URL rather than assuming the live App URL is routed to Testnet.

**Why:** Pi authentication can fail before any backend request if the SDK script is missing, but similar frontend error text can also conceal later backend or identity-provider failures.

**How to apply:** Load the official script before enabling Pi actions, gate those actions on successful SDK initialization, and verify registered App/Sandbox URLs separately from client code.

A Replit preview may load `window.Pi` and finish `Pi.init` while the Pi SDK still reports an origin-mismatch warning for its `postMessage` target. SDK readiness alone does not prove the Pi Browser bridge or app registration is usable.

**Why:** The preview browser can execute the downloaded SDK without providing the Pi Browser authentication context.

**How to apply:** When `Pi.authenticate` times out before any backend request, inspect the actual browser family and exact Developer Portal URL mapping before investigating Clerk, cookies, or API routes.