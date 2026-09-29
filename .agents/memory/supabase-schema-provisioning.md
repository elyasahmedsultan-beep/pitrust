---
name: Supabase schema provisioning
description: Practical constraint when building against the Replit-managed Supabase connector.
---

The Supabase connector exposes authenticated PostgREST access, but it does not provide a general SQL/DDL operation through the application REST path. A connected project may also contain only part of the expected schema.

**Why:** A first request against a new or partially configured project can return table-not-found or missing-column errors even though the connector itself is healthy.

**How to apply:** Keep the canonical DDL in a checked-in `supabase/schema.sql` file, prefer additive migrations for pre-existing tables, and make optional read models (such as activity feeds) degrade with an explicit server warning rather than masking core write failures.