# Testnet internal wallet provisioning

The Test-Pi wallet, faucet, internal transfers, and wallet-funded escrow settlement require the additive migration:

`supabase/migrations/202609280001_testnet_internal_wallet.sql`

Apply this migration only to the Supabase project confirmed for Pi Testnet, after the marketplace escrow schema has been provisioned. Do not apply it to the PiTrust Mainnet project.

The Replit Supabase connection in this workspace is available through PostgREST and does not provide a SQL DDL execution operation. The migration is therefore checked in but has not been applied from this workspace. Until it is applied to Testnet, the new wallet endpoints will fail closed with a service-unavailable response. Do not replace the connection with Replit's managed database.

The migration creates Testnet wallet accounts and an auditable transaction/faucet ledger, plus atomic database functions for faucet claims, transfers, escrow funding, and seller release. It makes no Pi Platform API calls and creates no blockchain transactions.