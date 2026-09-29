---
name: Host-aware API gates
description: Distinguish the direct PiTrust domain from its Replit-hosted Pi Sandbox app at the API boundary.
---

The Replit artifact path proxy preserves the incoming hostname for the API service. With Express configured to trust the immediate proxy hop, `req.hostname` can distinguish a direct custom-domain request from the registered Replit Sandbox host. A blocked direct-site mutation returned 403, while the Sandbox-hosted request continued to normal session authorization.

**Why:** The app uses separate network modes on the direct PiTrust domain and its Replit Sandbox URL, so UI-only gating would leave mutation endpoints reachable.

**How to apply:** When using host-specific API policy, keep explicit hostname rules and verify the behavior through the shared proxy after routing or trust-proxy changes. Do not infer that other hosting topologies preserve the original host without testing.