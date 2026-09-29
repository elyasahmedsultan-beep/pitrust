alter table public.escrow_contracts
  add column if not exists buyer_id text,
  add column if not exists seller_id text,
  add column if not exists pipeline text not null default 'custom_terms',
  add column if not exists metadata jsonb not null default '{}'::jsonb;

alter table public.escrow_contracts
  drop constraint if exists escrow_contracts_currency_check,
  add constraint escrow_contracts_currency_check
    check (currency = 'PI' or char_length(currency) = 3);

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

alter table public.escrow_contracts
  alter column amount type numeric(20, 8);

alter table public.escrow_contracts
  drop constraint if exists escrow_contracts_pipeline_check,
  add constraint escrow_contracts_pipeline_check
    check (pipeline in ('digital', 'shippable', 'local_property', 'custom_terms')),
  drop constraint if exists escrow_contracts_status_check,
  add constraint escrow_contracts_status_check
    check (status in ('draft', 'awaiting_funding', 'funded', 'in_delivery', 'completed', 'disputed', 'resolved', 'cancelled')),
  drop constraint if exists escrow_contracts_distinct_participants_check,
  add constraint escrow_contracts_distinct_participants_check
    check (buyer_id is null or seller_id is null or buyer_id <> seller_id);

create table if not exists public.escrow_payment_ledger (
  id uuid primary key default gen_random_uuid(),
  pi_payment_id text not null unique,
  contract_id uuid not null references public.escrow_contracts(id) on delete restrict,
  user_id text not null,
  status text not null check (status in ('approved', 'confirmed', 'payout_pending', 'payout_confirmed', 'fee_confirmed')),
  amount numeric(20, 8) not null check (amount > 0),
  txid text,
  fee_type text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.escrow_payment_ledger
  add column if not exists consumed_at timestamptz,
  add column if not exists consumed_by_dispute_id text;

create table if not exists public.escrow_listings (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null,
  title text not null,
  description text not null default '',
  amount numeric(20, 8) not null check (amount > 0),
  currency text not null check (currency = 'PI' or char_length(currency) = 3),
  pipeline text not null check (pipeline in ('digital', 'shippable', 'local_property', 'custom_terms')),
  metadata jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.escrow_listings
  drop constraint if exists escrow_listings_currency_check,
  add constraint escrow_listings_currency_check
    check (currency = 'PI' or char_length(currency) = 3);

create table if not exists public.escrow_profiles (
  user_id text primary key,
  display_name text not null,
  bio text not null default '',
  wallet_address text,
  referral_code text not null unique,
  referred_by text references public.escrow_profiles(user_id),
  referral_balance numeric(20, 8) not null default 0 check (referral_balance >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.escrow_profiles add column if not exists pi_uid text;
create unique index if not exists escrow_profiles_pi_uid_unique_idx
  on public.escrow_profiles (pi_uid) where pi_uid is not null;

create or replace function public.prevent_pi_uid_reassignment()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if old.pi_uid is not null then
      raise exception 'verified Pi UID cannot be unlinked';
    end if;
    return old;
  end if;
  if old.pi_uid is not null and new.pi_uid is distinct from old.pi_uid then
    raise exception 'verified Pi UID cannot be reassigned';
  end if;
  return new;
end;
$$;
drop trigger if exists escrow_profiles_pi_uid_immutable on public.escrow_profiles;
create trigger escrow_profiles_pi_uid_immutable
before update of pi_uid or delete on public.escrow_profiles
for each row execute function public.prevent_pi_uid_reassignment();

create table if not exists public.escrow_referral_ledger (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null unique references public.escrow_contracts(id) on delete restrict,
  inviter_id text not null references public.escrow_profiles(user_id),
  gross_amount numeric(20, 8) not null check (gross_amount > 0),
  reward_amount numeric(20, 8) not null check (reward_amount >= 0),
  created_at timestamptz not null default now()
);

create table if not exists public.escrow_delivery_evidence (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references public.escrow_contracts(id) on delete cascade,
  submitter_id text not null,
  evidence jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists public.escrow_evidence (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references public.escrow_contracts(id) on delete cascade,
  uploader_id text not null,
  category text not null check (category in ('receipt', 'deed', 'title', 'deliverable')),
  file_name text not null,
  content_type text not null,
  size_bytes bigint not null check (size_bytes between 1 and 10485760),
  object_key text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.escrow_signatures (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references public.escrow_contracts(id) on delete cascade,
  signer_id text not null,
  document_hash text not null,
  signed_at timestamptz not null default now(),
  unique (contract_id, signer_id)
);

create table if not exists public.escrow_messages (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references public.escrow_contracts(id) on delete cascade,
  sender_id text not null,
  content text not null check (char_length(content) between 1 and 5000),
  source_text text,
  translated_text text,
  target_language text,
  created_at timestamptz not null default now()
);

create table if not exists public.escrow_monthly_badge_audits (
  id uuid primary key default gen_random_uuid(),
  intent_id uuid not null unique default gen_random_uuid(),
  user_id text not null,
  billing_month date not null,
  pi_uid text not null,
  network text not null check (network in ('Pi Network', 'Pi Testnet')),
  payment_id text unique,
  amount numeric(20, 8) not null default 2 check (amount = 2),
  status text not null check (status in ('pending', 'confirmed', 'manual_reconciliation')),
  txid text,
  created_at timestamptz not null default now(),
  unique (user_id, billing_month)
);
alter table public.escrow_monthly_badge_audits
  add column if not exists intent_id uuid default gen_random_uuid(),
  add column if not exists pi_uid text,
  add column if not exists network text,
  alter column payment_id drop not null;
alter table public.escrow_monthly_badge_audits
  drop constraint if exists escrow_monthly_badge_audits_network_check,
  add constraint escrow_monthly_badge_audits_network_check
    check (network is null or network in ('Pi Network', 'Pi Testnet'));
alter table public.escrow_monthly_badge_audits
  drop constraint if exists escrow_monthly_badge_audits_status_check,
  add constraint escrow_monthly_badge_audits_status_check
    check (status in ('pending', 'confirmed', 'manual_reconciliation'));
update public.escrow_monthly_badge_audits
  set status = 'manual_reconciliation'
  where pi_uid is null or network is null;
create unique index if not exists escrow_monthly_badge_intent_unique_idx
  on public.escrow_monthly_badge_audits (intent_id);
create unique index if not exists escrow_monthly_badge_txid_unique_idx
  on public.escrow_monthly_badge_audits (txid) where txid is not null;

create table if not exists public.escrow_payout_intents (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null unique references public.escrow_contracts(id) on delete restrict,
  inviter_id text references public.escrow_profiles(user_id),
  -- amount is gross confirmed escrow value; all calculations remain NUMERIC.
  amount numeric(20, 8) not null check (amount > 0),
  platform_fee numeric(20, 8) not null check (platform_fee >= 0),
  inviter_reward numeric(20, 8) not null check (inviter_reward >= 0),
  seller_amount numeric(20, 8) not null check (seller_amount >= 0),
  recipient_address text not null,
  pi_payment_id text unique,
  txid text unique,
  network text not null check (network in ('Pi Network', 'Pi Testnet')),
  status text not null check (status in ('creating', 'created', 'submitting', 'submitted', 'completing', 'pending', 'broadcasting', 'confirmed', 'manual_reconciliation', 'failed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (platform_fee = round(amount * 0.03, 8)),
  check (seller_amount = amount - platform_fee),
  check (
    (inviter_id is null and inviter_reward = 0) or
    (inviter_id is not null and inviter_reward = round(platform_fee * 0.10, 8))
  )
);
alter table public.escrow_payout_intents
  add column if not exists network text not null default 'Pi Testnet';
alter table public.escrow_payout_intents
  drop constraint if exists escrow_payout_intents_status_check,
  add constraint escrow_payout_intents_status_check
    check (status in ('creating', 'created', 'submitting', 'submitted', 'completing', 'pending', 'broadcasting', 'confirmed', 'manual_reconciliation', 'failed'));
alter table public.escrow_payout_intents
  drop constraint if exists escrow_payout_intents_network_check,
  add constraint escrow_payout_intents_network_check
    check (network in ('Pi Network', 'Pi Testnet'));
update public.escrow_payout_intents
  set status = 'manual_reconciliation', updated_at = now()
  where status in ('pending', 'broadcasting');

do $$
declare
  table_name text;
  target_table regclass;
  contract_attnum smallint;
  contract_type oid;
  constraint_name text;
  delete_action text;
begin
  foreach table_name in array array[
    'escrow_activity',
    'disputes',
    'escrow_payment_ledger',
    'escrow_referral_ledger',
    'escrow_delivery_evidence',
    'escrow_evidence',
    'escrow_signatures',
    'escrow_messages',
    'escrow_payout_intents'
  ] loop
    target_table := to_regclass(format('public.%I', table_name));
    if target_table is null then
      continue;
    end if;

    select a.attnum, a.atttypid into contract_attnum, contract_type
    from pg_attribute a
    where a.attrelid = target_table
      and a.attname = 'contract_id'
      and not a.attisdropped;
    if not found then
      continue;
    end if;

    for constraint_name in
      select c.conname
      from pg_constraint c
      where c.conrelid = target_table
        and c.contype = 'f'
        and exists (
          select 1 from unnest(c.conkey) as key_column(attnum)
          where key_column.attnum = contract_attnum
        )
    loop
      execute format('alter table %s drop constraint %I', target_table, constraint_name);
    end loop;

    if contract_type <> 'uuid'::regtype then
      execute format(
        'alter table %s alter column contract_id type uuid using contract_id::uuid',
        target_table
      );
    end if;

    delete_action := case
      when table_name in ('escrow_payment_ledger', 'escrow_referral_ledger', 'escrow_payout_intents') then 'restrict'
      else 'cascade'
    end;
    execute format(
      'alter table %s add constraint %I foreign key (contract_id) references public.escrow_contracts(id) on delete %s',
      target_table,
      table_name || '_contract_id_escrow_contracts_fk',
      delete_action
    );
  end loop;
end;
$$;

create index if not exists escrow_listings_active_idx on public.escrow_listings (active, created_at desc);
create index if not exists escrow_messages_contract_poll_idx on public.escrow_messages (contract_id, created_at, id);
create index if not exists escrow_delivery_contract_idx on public.escrow_delivery_evidence (contract_id, created_at desc);
create unique index if not exists escrow_single_delivery_evidence_idx
  on public.escrow_delivery_evidence (contract_id);
create index if not exists escrow_evidence_contract_category_idx on public.escrow_evidence (contract_id, category, created_at desc);
create index if not exists escrow_payment_contract_idx on public.escrow_payment_ledger (contract_id, status);
create unique index if not exists escrow_payment_txid_unique_idx
  on public.escrow_payment_ledger (txid) where txid is not null;
create unique index if not exists escrow_one_dispute_fee_per_participant_idx
  on public.escrow_payment_ledger (contract_id, user_id)
  where fee_type = 'dispute' and status = 'fee_confirmed';
create unique index if not exists escrow_one_confirmed_contract_payment_idx
  on public.escrow_payment_ledger (contract_id)
  where fee_type is null and status = 'confirmed';

alter table public.escrow_contracts enable row level security;
alter table public.escrow_activity enable row level security;
alter table public.disputes enable row level security;
alter table public.escrow_payment_ledger enable row level security;
alter table public.escrow_listings enable row level security;
alter table public.escrow_profiles enable row level security;
alter table public.escrow_referral_ledger enable row level security;
alter table public.escrow_delivery_evidence enable row level security;
alter table public.escrow_evidence enable row level security;
alter table public.escrow_signatures enable row level security;
alter table public.escrow_messages enable row level security;
alter table public.escrow_monthly_badge_audits enable row level security;
alter table public.escrow_payout_intents enable row level security;

drop policy if exists escrow_contracts_service_access on public.escrow_contracts;
create policy escrow_contracts_service_access on public.escrow_contracts
  for all to service_role using (true) with check (true);
drop policy if exists escrow_activity_service_access on public.escrow_activity;
create policy escrow_activity_service_access on public.escrow_activity
  for all to service_role using (true) with check (true);
drop policy if exists disputes_service_access on public.disputes;
create policy disputes_service_access on public.disputes
  for all to service_role using (true) with check (true);
drop policy if exists escrow_listings_public_active_read on public.escrow_listings;
create policy escrow_listings_public_active_read on public.escrow_listings
  for select to anon, authenticated using (active);

drop policy if exists escrow_listings_service_access on public.escrow_listings;
create policy escrow_listings_service_access on public.escrow_listings
  for all to service_role using (true) with check (true);

drop policy if exists escrow_profiles_service_access on public.escrow_profiles;
create policy escrow_profiles_service_access on public.escrow_profiles
  for all to service_role using (true) with check (true);
drop policy if exists escrow_payment_service_access on public.escrow_payment_ledger;
create policy escrow_payment_service_access on public.escrow_payment_ledger
  for all to service_role using (true) with check (true);
drop policy if exists escrow_referrals_service_access on public.escrow_referral_ledger;
create policy escrow_referrals_service_access on public.escrow_referral_ledger
  for all to service_role using (true) with check (true);
drop policy if exists escrow_delivery_service_access on public.escrow_delivery_evidence;
create policy escrow_delivery_service_access on public.escrow_delivery_evidence
  for all to service_role using (true) with check (true);
drop policy if exists escrow_evidence_service_access on public.escrow_evidence;
create policy escrow_evidence_service_access on public.escrow_evidence
  for all to service_role using (true) with check (true);
drop policy if exists escrow_signatures_service_access on public.escrow_signatures;
create policy escrow_signatures_service_access on public.escrow_signatures
  for all to service_role using (true) with check (true);
drop policy if exists escrow_messages_service_access on public.escrow_messages;
create policy escrow_messages_service_access on public.escrow_messages
  for all to service_role using (true) with check (true);
drop policy if exists escrow_badge_service_access on public.escrow_monthly_badge_audits;
create policy escrow_badge_service_access on public.escrow_monthly_badge_audits
  for all to service_role using (true) with check (true);
drop policy if exists escrow_payout_service_access on public.escrow_payout_intents;
create policy escrow_payout_service_access on public.escrow_payout_intents
  for all to service_role using (true) with check (true);

create or replace function public.guard_escrow_status_transition()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' then
    if new.status not in ('draft', 'awaiting_funding') then
      raise exception 'escrow contracts must start in draft or awaiting_funding';
    end if;
    return new;
  end if;
  if new.status is not distinct from old.status then
    return new;
  end if;

  if not (
    (old.status = 'draft' and new.status in ('awaiting_funding', 'cancelled')) or
    (old.status = 'awaiting_funding' and new.status in ('funded', 'cancelled')) or
    (old.status = 'funded' and new.status in ('in_delivery', 'disputed')) or
    (old.status = 'in_delivery' and new.status in ('disputed', 'completed')) or
    (old.status = 'disputed' and new.status = 'resolved')
  ) then
    raise exception 'invalid escrow status transition: % -> %', old.status, new.status;
  end if;

  if new.status = 'funded' and not exists (
    select 1 from public.escrow_payment_ledger p
    where p.contract_id = new.id and p.user_id = new.buyer_id
      and p.amount = new.amount and p.status = 'confirmed' and p.fee_type is null
  ) then
    raise exception 'funded status requires a confirmed Pi payment';
  end if;
  if new.status = 'in_delivery' and not exists (
    select 1 from public.escrow_delivery_evidence e
    where e.contract_id = new.id and e.submitter_id = new.seller_id
  ) then
    raise exception 'delivery status requires validated delivery evidence';
  end if;
  if new.status = 'disputed' and not exists (
    select 1 from public.disputes d where d.contract_id = new.id and d.status = 'open'
  ) then
    raise exception 'disputed status requires an open dispute';
  end if;
  if new.status = 'resolved' and not exists (
    select 1 from public.disputes d where d.contract_id = new.id and d.status = 'resolved'
  ) then
    raise exception 'resolved status requires a resolved dispute';
  end if;
  if new.status = 'completed' and not exists (
    select 1 from public.escrow_payout_intents p
    where p.contract_id = new.id and p.status = 'confirmed' and p.txid is not null
  ) then
    raise exception 'completed status requires confirmed Pi A2U payout';
  end if;
  return new;
end;
$$;
drop trigger if exists escrow_contract_status_guard on public.escrow_contracts;
create trigger escrow_contract_status_guard
before insert or update of status on public.escrow_contracts
for each row execute function public.guard_escrow_status_transition();

create or replace function public.create_dispute_with_consumed_fee(
  p_dispute_id text,
  p_contract_id uuid,
  p_user_id text,
  p_pi_payment_id text,
  p_reason text,
  p_description text,
  p_requested_resolution text
) returns table(dispute_id text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  c public.escrow_contracts%rowtype;
  fee public.escrow_payment_ledger%rowtype;
begin
  select * into c from public.escrow_contracts where id = p_contract_id for update;
  if not found or (
    p_user_id is distinct from c.buyer_id and
    p_user_id is distinct from c.seller_id
  ) then
    raise exception 'contract participant required';
  end if;
  if c.status not in ('funded', 'in_delivery') then
    raise exception 'dispute can only be opened for funded or delivery contracts';
  end if;
  if exists (
    select 1 from public.escrow_payout_intents payout
    where payout.contract_id = c.id
  ) then
    raise exception 'payout intent exists; dispute requires payout reconciliation';
  end if;
  if not exists (
    select 1 from public.escrow_payment_ledger p
    where p.contract_id = c.id and p.user_id = c.buyer_id
      and p.status = 'confirmed' and p.fee_type is null and p.amount = c.amount
  ) then
    raise exception 'confirmed contract payment required';
  end if;
  select * into fee from public.escrow_payment_ledger
  where pi_payment_id = p_pi_payment_id and contract_id = c.id
    and user_id = p_user_id and fee_type = 'dispute'
    and status = 'fee_confirmed' and amount = 1 and consumed_at is null
  for update;
  if not found then
    raise exception 'unconsumed confirmed 1 Pi dispute fee required';
  end if;

  insert into public.disputes
    (id, contract_id, reason, description, status, requested_resolution, resolution, created_at, updated_at)
  values
    (p_dispute_id, c.id, p_reason, p_description, 'open', p_requested_resolution, null, now(), now());
  update public.escrow_payment_ledger
    set consumed_at = now(), consumed_by_dispute_id = p_dispute_id, updated_at = now()
    where id = fee.id and consumed_at is null;
  if not found then
    raise exception 'dispute fee was already consumed';
  end if;
  update public.escrow_contracts
    set status = 'disputed', dispute_count = dispute_count + 1,
        next_action = 'Review open dispute', updated_at = now()
    where id = c.id;
  return query select p_dispute_id::text;
end;
$$;

create or replace function public.record_verified_pi_payment(
  p_pi_payment_id text,
  p_contract_id uuid,
  p_user_id text,
  p_status text,
  p_amount numeric,
  p_txid text default null,
  p_fee_type text default null
) returns table(id uuid, status text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  c public.escrow_contracts%rowtype;
  saved public.escrow_payment_ledger%rowtype;
begin
  if p_status not in ('approved', 'confirmed', 'fee_confirmed') then
    raise exception 'unsupported verified Pi payment status';
  end if;
  select * into c from public.escrow_contracts where id = p_contract_id for share;
  if not found then
    raise exception 'Pi payment contract does not exist';
  end if;
  if p_fee_type is null then
    if p_user_id is distinct from c.buyer_id or p_amount <> c.amount then
      raise exception 'contract funding payment must match the buyer and contract amount';
    end if;
    if p_status = 'fee_confirmed' then
      raise exception 'contract funding cannot use fee status';
    end if;
  elsif p_fee_type = 'dispute' then
    if p_user_id is distinct from c.buyer_id and p_user_id is distinct from c.seller_id then
      raise exception 'dispute fee payer must be a contract participant';
    end if;
    if p_amount <> 1 or c.status not in ('funded', 'in_delivery') or p_status = 'confirmed' then
      raise exception 'dispute fee must be 1 Pi on an active funded contract';
    end if;
  else
    raise exception 'unsupported verified Pi fee type';
  end if;
  if p_status in ('confirmed', 'fee_confirmed') and nullif(p_txid, '') is null then
    raise exception 'completed Pi payments require a verified transaction id';
  end if;

  insert into public.escrow_payment_ledger as existing
    (pi_payment_id, contract_id, user_id, status, amount, txid, fee_type, updated_at)
  values
    (p_pi_payment_id, p_contract_id, p_user_id, p_status, p_amount, p_txid, p_fee_type, now())
  on conflict (pi_payment_id) do update
    set status = case
          when existing.status = 'approved' and excluded.status in ('confirmed', 'fee_confirmed')
            then excluded.status
          else existing.status
        end,
        txid = coalesce(existing.txid, excluded.txid),
        updated_at = now()
    where existing.contract_id = excluded.contract_id
      and existing.user_id = excluded.user_id
      and existing.amount = excluded.amount
      and existing.fee_type is not distinct from excluded.fee_type
      and (existing.txid is null or excluded.txid is null or existing.txid = excluded.txid)
  returning existing.* into saved;

  if saved.id is null then
    raise exception 'Pi payment idempotency conflict';
  end if;
  return query select saved.id, saved.status;
end;
$$;

revoke all on function public.record_verified_pi_payment(text, uuid, text, text, numeric, text, text) from public, anon, authenticated;
grant execute on function public.record_verified_pi_payment(text, uuid, text, text, numeric, text, text) to service_role;
revoke all on function public.create_dispute_with_consumed_fee(text, uuid, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.create_dispute_with_consumed_fee(text, uuid, text, text, text, text, text) to service_role;

create or replace function public.prepare_escrow_payout(
  p_intent_id uuid,
  p_contract_id uuid,
  p_actor_id text,
  p_network text
) returns table(
  intent_id uuid,
  created boolean,
  status text,
  amount numeric,
  platform_fee numeric,
  inviter_reward numeric,
  seller_amount numeric,
  recipient_uid text,
  inviter_id text,
  payment_id text,
  txid text,
  network text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  c public.escrow_contracts%rowtype;
  payout public.escrow_payout_intents%rowtype;
  recipient_pi_uid text;
  contract_inviter text;
  calculated_fee numeric(20, 8);
  calculated_reward numeric(20, 8);
begin
  if p_network not in ('Pi Network', 'Pi Testnet') then
    raise exception 'unsupported Pi payout network';
  end if;
  select * into c from public.escrow_contracts where id = p_contract_id for update;
  if not found or c.buyer_id is distinct from p_actor_id or c.seller_id is null then
    raise exception 'buyer and accepted seller are required for payout';
  end if;
  select * into payout from public.escrow_payout_intents
  where contract_id = c.id for update;
  if found then
    return query select payout.id, false, payout.status, payout.amount,
      payout.platform_fee, payout.inviter_reward, payout.seller_amount,
      payout.recipient_address, payout.inviter_id, payout.pi_payment_id,
      payout.txid, payout.network;
    return;
  end if;
  if c.status <> 'in_delivery' then
    raise exception 'contract is not ready for payout';
  end if;
  if c.currency <> 'PI' then
    raise exception 'only PI-denominated contracts can use Pi A2U payout';
  end if;
  if not exists (
    select 1 from public.escrow_payment_ledger payment
    where payment.contract_id = c.id and payment.user_id = c.buyer_id
      and payment.amount = c.amount and payment.status = 'confirmed'
      and payment.fee_type is null
  ) then
    raise exception 'confirmed escrow funding is required';
  end if;
  if not exists (
    select 1 from public.escrow_delivery_evidence delivery
    where delivery.contract_id = c.id and delivery.submitter_id = c.seller_id
  ) then
    raise exception 'seller delivery evidence is required';
  end if;
  if exists (
    select 1 from public.disputes dispute
    where dispute.contract_id = c.id and dispute.status = 'open'
  ) then
    raise exception 'open dispute prevents payout';
  end if;
  select profile.pi_uid into recipient_pi_uid
  from public.escrow_profiles profile where profile.user_id = c.seller_id;
  if recipient_pi_uid is null then
    raise exception 'seller must link a verified Pi account before payout';
  end if;
  select profile.referred_by into contract_inviter
  from public.escrow_profiles profile where profile.user_id = c.buyer_id;
  calculated_fee := round(c.amount * 0.03, 8);
  calculated_reward := case
    when contract_inviter is null then 0
    else round(calculated_fee * 0.10, 8)
  end;

  insert into public.escrow_payout_intents (
    id, contract_id, inviter_id, amount, platform_fee, inviter_reward,
    seller_amount, recipient_address, status, network, created_at, updated_at
  ) values (
    p_intent_id, c.id, contract_inviter, c.amount, calculated_fee,
    calculated_reward, c.amount - calculated_fee, recipient_pi_uid,
    'creating', p_network, now(), now()
  ) returning * into payout;
  return query select payout.id, true, payout.status, payout.amount,
    payout.platform_fee, payout.inviter_reward, payout.seller_amount,
    payout.recipient_address, payout.inviter_id, payout.pi_payment_id,
    payout.txid, payout.network;
end;
$$;

create or replace function public.store_escrow_payout_payment(
  p_intent_id uuid,
  p_payment_id text,
  p_manual boolean default false
) returns table(status text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  payout public.escrow_payout_intents%rowtype;
begin
  update public.escrow_payout_intents as current_payout
    set pi_payment_id = p_payment_id,
        status = case when p_manual or current_payout.status = 'manual_reconciliation'
          then 'manual_reconciliation' else 'created' end,
        updated_at = now()
    where current_payout.id = p_intent_id
      and (current_payout.pi_payment_id is null or current_payout.pi_payment_id = p_payment_id)
      and current_payout.status in ('creating', 'manual_reconciliation', 'created')
    returning * into payout;
  if payout.id is null then
    raise exception 'payout payment id conflicts with persisted state';
  end if;
  return query select payout.status;
end;
$$;

create or replace function public.claim_escrow_payout_submission(p_intent_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  changed integer;
begin
  update public.escrow_payout_intents
    set status = 'submitting', updated_at = now()
    where id = p_intent_id and status = 'created'
      and pi_payment_id is not null and txid is null;
  get diagnostics changed = row_count;
  return changed = 1;
end;
$$;

create or replace function public.record_escrow_payout_txid(
  p_intent_id uuid,
  p_payment_id text,
  p_txid text
) returns table(status text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  payout public.escrow_payout_intents%rowtype;
begin
  update public.escrow_payout_intents as current_payout
    set txid = p_txid,
        status = case when current_payout.status = 'manual_reconciliation'
          then 'manual_reconciliation'
          when current_payout.status = 'completing' then 'completing'
          else 'submitted' end,
        updated_at = now()
    where current_payout.id = p_intent_id and current_payout.pi_payment_id = p_payment_id
      and (current_payout.txid is null or current_payout.txid = p_txid)
      and current_payout.status in ('submitting', 'submitted', 'completing', 'manual_reconciliation')
    returning * into payout;
  if payout.id is null then
    raise exception 'payout txid conflicts with persisted state';
  end if;
  return query select payout.status;
end;
$$;

create or replace function public.claim_escrow_payout_completion(p_intent_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  changed integer;
begin
  update public.escrow_payout_intents
    set status = 'completing', updated_at = now()
    where id = p_intent_id and status = 'submitted'
      and pi_payment_id is not null and txid is not null;
  get diagnostics changed = row_count;
  return changed = 1;
end;
$$;

create or replace function public.mark_escrow_payout_manual(p_intent_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  changed integer;
begin
  update public.escrow_payout_intents
    set status = 'manual_reconciliation', updated_at = now()
    where id = p_intent_id and status <> 'confirmed';
  get diagnostics changed = row_count;
  return changed = 1;
end;
$$;

create or replace function public.reserve_monthly_badge_audit(
  p_intent_id uuid,
  p_user_id text,
  p_pi_uid text,
  p_network text,
  p_billing_month date
) returns table(intent_id uuid, status text, payment_id text, amount numeric, billing_month date)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  audit public.escrow_monthly_badge_audits%rowtype;
begin
  if p_network not in ('Pi Network', 'Pi Testnet')
    or p_billing_month <> date_trunc('month', now() at time zone 'UTC')::date then
    raise exception 'invalid badge billing month or Pi network';
  end if;
  if not exists (
    select 1 from public.escrow_profiles profile
    where profile.user_id = p_user_id and profile.pi_uid = p_pi_uid
  ) then
    raise exception 'verified Pi profile link required';
  end if;
  insert into public.escrow_monthly_badge_audits
    (intent_id, user_id, billing_month, pi_uid, network, amount, status)
  values
    (p_intent_id, p_user_id, p_billing_month, p_pi_uid, p_network, 2, 'pending')
  on conflict (user_id, billing_month) do nothing;

  select * into audit from public.escrow_monthly_badge_audits as current_badge
  where current_badge.user_id = p_user_id
    and current_badge.billing_month = p_billing_month for update;
  if audit.pi_uid is distinct from p_pi_uid or audit.network is distinct from p_network then
    raise exception 'badge audit identity or network does not match existing intent';
  end if;
  if audit.status = 'manual_reconciliation' then
    raise exception 'existing badge audit requires manual reconciliation';
  end if;
  return query select audit.intent_id, audit.status, audit.payment_id,
    audit.amount, audit.billing_month;
end;
$$;

create or replace function public.record_monthly_badge_payment(
  p_intent_id uuid,
  p_user_id text,
  p_payment_id text,
  p_status text,
  p_txid text default null
) returns table(status text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  audit public.escrow_monthly_badge_audits%rowtype;
begin
  if p_status not in ('pending', 'confirmed') then
    raise exception 'invalid monthly badge payment state';
  end if;
  update public.escrow_monthly_badge_audits as current_badge
    set payment_id = p_payment_id,
        status = case when p_status = 'confirmed' then 'confirmed' else current_badge.status end,
        txid = case when p_status = 'confirmed' then p_txid else current_badge.txid end
    where current_badge.intent_id = p_intent_id and current_badge.user_id = p_user_id
      and (current_badge.payment_id is null or current_badge.payment_id = p_payment_id)
      and (p_status <> 'confirmed' or nullif(p_txid, '') is not null)
    returning * into audit;
  if audit.intent_id is null then
    raise exception 'badge payment conflicts with persisted monthly audit';
  end if;
  return query select audit.status;
end;
$$;

create or replace function public.settle_confirmed_escrow_payout(
  p_intent_id uuid,
  p_payment_id text,
  p_txid text
) returns table(status text, contract_id uuid)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  payout public.escrow_payout_intents%rowtype;
  c public.escrow_contracts%rowtype;
  referral public.escrow_referral_ledger%rowtype;
  inserted_count integer;
begin
  select * into payout from public.escrow_payout_intents
  where id = p_intent_id for update;
  if not found or payout.pi_payment_id is distinct from p_payment_id
    or payout.txid is distinct from p_txid then
    raise exception 'payout payment id or txid is not persisted';
  end if;
  select * into c from public.escrow_contracts where id = payout.contract_id for update;
  if c.status = 'completed' and payout.status = 'confirmed' then
    return query select payout.status, c.id;
    return;
  end if;
  if c.status <> 'in_delivery'
    or c.currency <> 'PI'
    or payout.status not in ('completing', 'manual_reconciliation')
    or payout.seller_amount <> payout.amount - payout.platform_fee
    or payout.inviter_reward <> (
      case when payout.inviter_id is null then 0
      else round(payout.platform_fee * 0.10, 8) end
    ) then
    raise exception 'payout intent is not eligible for confirmed settlement';
  end if;

  update public.escrow_payout_intents
    set status = 'confirmed', updated_at = now()
    where id = payout.id;

  if payout.inviter_id is not null and payout.inviter_reward > 0 then
    insert into public.escrow_referral_ledger
      (contract_id, inviter_id, gross_amount, reward_amount)
    values
      (c.id, payout.inviter_id, payout.amount, payout.inviter_reward)
    on conflict (contract_id) do nothing;
    get diagnostics inserted_count = row_count;
    if inserted_count = 1 then
      update public.escrow_profiles
        set referral_balance = referral_balance + payout.inviter_reward,
            updated_at = now()
        where user_id = payout.inviter_id;
      if not found then
        raise exception 'referral recipient profile is missing';
      end if;
    else
      select * into referral from public.escrow_referral_ledger
      where contract_id = c.id;
      if referral.inviter_id is distinct from payout.inviter_id
        or referral.reward_amount <> payout.inviter_reward then
        raise exception 'existing referral credit does not match payout intent';
      end if;
    end if;
  end if;

  update public.escrow_contracts
    set status = 'completed', next_action = null,
        release_date = now(), updated_at = now()
    where id = c.id;
  return query select 'confirmed'::text, c.id;
end;
$$;

revoke all on function public.prepare_escrow_payout(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.prepare_escrow_payout(uuid, uuid, text, text) to service_role;
revoke all on function public.store_escrow_payout_payment(uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.store_escrow_payout_payment(uuid, text, boolean) to service_role;
revoke all on function public.claim_escrow_payout_submission(uuid) from public, anon, authenticated;
grant execute on function public.claim_escrow_payout_submission(uuid) to service_role;
revoke all on function public.record_escrow_payout_txid(uuid, text, text) from public, anon, authenticated;
grant execute on function public.record_escrow_payout_txid(uuid, text, text) to service_role;
revoke all on function public.claim_escrow_payout_completion(uuid) from public, anon, authenticated;
grant execute on function public.claim_escrow_payout_completion(uuid) to service_role;
revoke all on function public.mark_escrow_payout_manual(uuid) from public, anon, authenticated;
grant execute on function public.mark_escrow_payout_manual(uuid) to service_role;
revoke all on function public.reserve_monthly_badge_audit(uuid, text, text, text, date) from public, anon, authenticated;
grant execute on function public.reserve_monthly_badge_audit(uuid, text, text, text, date) to service_role;
revoke all on function public.record_monthly_badge_payment(uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.record_monthly_badge_payment(uuid, text, text, text, text) to service_role;
revoke all on function public.settle_confirmed_escrow_payout(uuid, text, text) from public, anon, authenticated;
grant execute on function public.settle_confirmed_escrow_payout(uuid, text, text) to service_role;