create table if not exists public.escrow_service_deposits (
  id uuid primary key default gen_random_uuid(),
  pi_payment_id text not null unique,
  user_id text not null,
  pi_uid text not null,
  product_name text not null check (product_name = 'Escrow Service Deposit'),
  description text not null check (description = 'Secure funds held in escrow for freelance service'),
  amount numeric(20, 8) not null check (amount = 1),
  memo text not null check (memo = 'Escrow deposit for job agreement'),
  metadata jsonb not null check (metadata = '{"type":"escrow"}'::jsonb),
  network text not null check (network = 'Pi Network'),
  status text not null check (status in ('pending', 'approved', 'confirmed')),
  txid text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists escrow_service_deposits_user_created_idx
  on public.escrow_service_deposits (user_id, created_at desc);

alter table public.escrow_service_deposits enable row level security;
revoke all on table public.escrow_service_deposits from public, anon, authenticated;
grant select, insert, update on table public.escrow_service_deposits to service_role;

drop policy if exists escrow_service_deposits_service_access on public.escrow_service_deposits;
create policy escrow_service_deposits_service_access on public.escrow_service_deposits
  for all to service_role using (true) with check (true);