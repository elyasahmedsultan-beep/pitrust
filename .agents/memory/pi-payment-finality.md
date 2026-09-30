---
name: Pi payment finality
description: Final-success invariant and cancellation safety for Pi payments.
---

Treat a Pi product payment as successful only after the server verifies the completion callback against its persisted intent. Approval, an SDK return, or a cancellation callback is not proof of completion.

**Why:** A listing must remain unpublished unless payment is confirmed. A late contract-payment approval or completion can also move funds after cancellation and detach the transfer from its contract record.

**How to apply:** Resolve a client payment only after server-confirmed completion; reject an SDK finish without confirmation and wait for server-side cancellation cleanup before retrying. Do not expose contract cancellation while Pi approval/completion can race it: persist and atomically bind the funding intent/payment, then serialize cancellation against completion or provide explicit reconciliation.

Cancellation requires positive provider evidence that the wallet transaction is unverified (`transaction_verified === false` or `transaction.verified === false`). After requesting provider cancellation, fetch the payment again and require both confirmed cancellation and still-unverified transaction state before releasing the local intent or ledger reservation. Missing or conflicting verification fields require manual reconciliation.

**Why:** Provider status can change between the first lookup and the cancellation response. Treating missing status as unverified, or trusting a cancellation flag alongside verified/completed state, can release a payment that has already moved on-chain.

**How to apply:** Keep the frontend classifier and server cancellation gate aligned, but let the server's fresh provider lookup decide. Never release local state from the SDK's cancellation callback alone.