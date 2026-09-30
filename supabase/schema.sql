create table if not exists public.escrow_contracts (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  reference text not null,
  buyer_name text not null,
  seller_name text not null,
  amount numeric(20, 8) not null check (amount > 0),
  currency text not null check (currency = 'PI' or char_length(currency) = 3),
  status text not null default 'draft',
  due_date date not null,
  payment_method text not null,
  next_action text,
  dispute_count integer not null default 0,
  release_date timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  buyer_id text,
  seller_id text,
  pipeline text not null default 'custom_terms',
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists public.escrow_activity (
  id text primary key,
  contract_id uuid not null references public.escrow_contracts(id) on delete cascade,
  type text not null,
  title text not null,
  description text not null,
  actor text not null,
  tone text not null default 'neutral',
  created_at timestamptz not null default now()
);

create table if not exists public.disputes (
  id text primary key,
  contract_id uuid not null references public.escrow_contracts(id) on delete cascade,
  reason text not null,
  description text not null,
  status text not null default 'open',
  requested_resolution text not null,
  resolution text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table if exists public.disputes
  add column if not exists description text,
  add column if not exists requested_resolution text,
  add column if not exists resolution text,
  add column if not exists updated_at timestamptz not null default now();

create index if not exists escrow_contracts_updated_at_idx
  on public.escrow_contracts (updated_at desc);
create index if not exists escrow_activity_created_at_idx
  on public.escrow_activity (created_at desc);
create index if not exists disputes_contract_id_idx
  on public.disputes (contract_id);

do $$
begin
  if to_regclass('public.app_settings') is null then
    create table public.app_settings (
      "key" text primary key,
      "value" numeric not null,
      updated_at timestamptz not null default now()
    );
    insert into public.app_settings ("key", "value")
    values
      ('transaction_fee_percentage', 3),
      ('dispute_resolution_fee_pi', 1),
      ('listing_ad_fee_pi', 1),
      ('listing_ad_edit_fee_pi', 0.25),
      ('listing_ad_delete_fee_pi', 0.25);
  end if;
end;
$$;

alter table public.app_settings enable row level security;
revoke all on table public.app_settings from public, anon, authenticated;
grant select on table public.app_settings to service_role;

create table if not exists public.pi_iframe_sessions (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
  pi_uid text not null,
  pi_username text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  check (expires_at > created_at)
);

create index if not exists pi_iframe_sessions_expires_at_idx
  on public.pi_iframe_sessions (expires_at);

alter table public.pi_iframe_sessions enable row level security;
revoke all on table public.pi_iframe_sessions from public, anon, authenticated;
grant select, insert, delete on table public.pi_iframe_sessions to service_role;

create table if not exists public.pi_app_sessions (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
  pi_uid text not null,
  pi_username text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  check (expires_at > created_at)
);

create index if not exists pi_app_sessions_expires_at_idx
  on public.pi_app_sessions (expires_at);

alter table public.pi_app_sessions enable row level security;
revoke all on table public.pi_app_sessions from public, anon, authenticated;
grant select, insert, delete on table public.pi_app_sessions to service_role;