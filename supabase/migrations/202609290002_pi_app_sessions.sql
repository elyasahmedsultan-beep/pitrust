begin;

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

commit;