# Pactline arbitration database setup

The dashboard code alone does **not** enable financial decisions. Apply
`migrations/202609270002_arbitration_payouts.sql` to the intended Supabase project
before using Release or Refund. This workspace's Supabase connection is REST-only;
adding the file does not run it.

Two earlier migrations share the `202609270001` version prefix:
`202609270001_clerk_ids_and_configurable_dispute_fee.sql` and
`202609270001_dynamic_payment_fees.sql`. Supabase's version-tracked migration
command cannot reliably distinguish them. Do not rename migrations already
recorded in a live project's history, and do not assume `db push` has applied
both. Confirm the marketplace escrow schema, the dynamic-fee function and both
payment fee settings are in place. Back up the database, then run the new SQL
file in Supabase SQL Editor after those prerequisites. Reconcile the existing
migration history separately before returning to automatic migration deploys.

After applying the SQL, check that both RPCs exist:

```sql
select
  to_regprocedure('public.prepare_arbitration_payout(uuid,text,text,text,text,text)') as prepare_rpc,
  to_regprocedure('public.settle_confirmed_arbitration_payout(uuid,text,text)') as settle_rpc;
```

The migration adds `is_arbitrator` with a default of `false`; it does not grant
the role to anyone. Confirm that the intended Clerk-linked profile already has
`is_arbitrator = true` before opening `/admin`. Existing `true` values are
preserved. Role checks run on the server for every privileged request.

The old HTTP route that merely marked a dispute resolved is disabled. Existing
contracts already in the historical `resolved` state are not silently converted
to `completed` or `refunded`; investigate any without a confirmed payout before
considering them settled:

```sql
select c.id, c.status
from public.escrow_contracts c
where c.status = 'resolved'
  and not exists (
    select 1 from public.escrow_payout_intents p
    where p.contract_id = c.id and p.status = 'confirmed' and p.txid is not null
  );
```

Testnet A2U requires `PI_NETWORK=testnet`, `PI_A2U_TESTNET_ENABLED=true`, and
the dedicated `PI_TESTNET_API_KEY` and `PI_TESTNET_APP_WALLET_KEY` from a
Testnet Pi app. Mainnet A2U remains separately gated by production mode,
`PI_NETWORK=mainnet`, `PI_A2U_ENABLED=true`, and mainnet credentials. Never reuse
API keys or wallet seeds across networks. Do not enable mainnet transfers until
the migration and controlled end-to-end verification are complete. Gemini is
advisory and cannot start a payment.