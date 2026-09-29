# Pactline Escrow Contracts

Pactline protects buyer-seller transactions with digital contracts, escrow status tracking, delivery milestones, and dispute workflows.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/escrow-contracts` — React/Vite Pactline web app and responsive product UI.
- `artifacts/api-server` — Express API routes and Supabase connector client.
- `lib/api-spec/openapi.yaml` — source of truth for API contracts and generated hooks.
- `supabase/schema.sql` — Supabase tables and indexes for escrow data.

## Architecture decisions

- Supabase is accessed from the server through the Replit connector proxy; credentials are never placed in frontend code.
- Contract transitions are explicit API actions so funding, delivery confirmation, release, and disputes are auditable.
- The frontend uses generated OpenAPI React Query hooks rather than hand-written request types.
- Activity history is additive and can be enabled by provisioning the optional `escrow_activity` table.

## Product

- Dashboard summary for total value, locked funds, pending release, disputes, active contracts, and completion health.
- Contract creation, detail view, parties/terms, escrow timeline, and lifecycle actions.
- Dispute creation and review surfaces plus a recent activity ledger.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- Apply `supabase/schema.sql` in the connected Supabase project before using persistent dispute details and activity history.
- Apply `supabase/migrations/202609290002_pi_app_sessions.sql` in the connected Supabase SQL Editor before enabling cookie-based Pi app sessions; the Supabase REST connection cannot run DDL.
- After changing `lib/api-spec/openapi.yaml`, run `pnpm --filter @workspace/api-spec run codegen`.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
