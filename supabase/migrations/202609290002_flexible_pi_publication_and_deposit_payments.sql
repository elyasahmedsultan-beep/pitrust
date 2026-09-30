begin;

-- Pi amounts are stored at 8 decimal places. The minimum is 0.000001 Pi and
-- the maximum is 1 Pi for both product payments.
create table if not exists public.escrow_service_deposit_intents (
  id uuid primary key,
  user_id text not null,
  pi_uid text not null,
  amount numeric(20, 8) not null
    check (amount >= 0.000001 and amount <= 1),
  network text not null check (network = 'Pi Network'),
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'confirmed', 'cancelled')),
  pi_payment_id text unique,
  txid text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists escrow_service_deposit_intents_one_open_per_user_idx
  on public.escrow_service_deposit_intents (user_id)
  where status in ('pending', 'approved');

alter table public.escrow_service_deposits
  drop constraint if exists escrow_service_deposits_amount_check;
alter table public.escrow_service_deposits
  add constraint escrow_service_deposits_amount_range_check
  check (amount >= 0.000001 and amount <= 1);
alter table public.escrow_service_deposits
  add column if not exists intent_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'escrow_service_deposits_intent_id_fkey'
      and conrelid = 'public.escrow_service_deposits'::regclass
  ) then
    alter table public.escrow_service_deposits
      add constraint escrow_service_deposits_intent_id_fkey
      foreign key (intent_id) references public.escrow_service_deposit_intents(id);
  end if;
end;
$$;

create unique index if not exists escrow_service_deposits_intent_id_idx
  on public.escrow_service_deposits (intent_id)
  where intent_id is not null;

grant delete on table public.escrow_service_deposits to service_role;

alter table public.escrow_service_deposit_intents enable row level security;
revoke all on table public.escrow_service_deposit_intents from public, anon, authenticated;
grant select, insert, update on table public.escrow_service_deposit_intents to service_role;

drop policy if exists escrow_service_deposit_intents_service_access
  on public.escrow_service_deposit_intents;
create policy escrow_service_deposit_intents_service_access
  on public.escrow_service_deposit_intents
  for all to service_role using (true) with check (true);

create or replace function public.record_verified_escrow_service_deposit(
  p_intent_id uuid,
  p_payment_id text,
  p_user_id text,
  p_pi_uid text,
  p_status text,
  p_txid text default null
)
returns setof public.escrow_service_deposits
language plpgsql
security definer
set search_path = public
as $$
declare
  v_intent public.escrow_service_deposit_intents%rowtype;
  v_existing public.escrow_service_deposits%rowtype;
  v_status text;
  v_txid text;
begin
  if p_status not in ('pending', 'approved', 'confirmed') then
    raise exception 'Invalid escrow service deposit status';
  end if;
  if p_payment_id is null or length(p_payment_id) = 0 then
    raise exception 'Pi payment ID is required';
  end if;

  select * into v_intent
  from public.escrow_service_deposit_intents
  where id = p_intent_id
  for update;
  if not found
    or v_intent.user_id <> p_user_id
    or v_intent.pi_uid <> p_pi_uid
    or v_intent.network <> 'Pi Network'
    or v_intent.status = 'cancelled'
    or (v_intent.pi_payment_id is not null and v_intent.pi_payment_id <> p_payment_id)
  then
    raise exception 'Escrow service deposit intent does not match this payment';
  end if;
  if p_status = 'confirmed' and nullif(p_txid, '') is null then
    raise exception 'A verified transaction ID is required';
  end if;
  if v_intent.txid is not null and p_txid is not null and v_intent.txid <> p_txid then
    raise exception 'Escrow service deposit transaction ID cannot be rebound';
  end if;

  select * into v_existing
  from public.escrow_service_deposits
  where pi_payment_id = p_payment_id
  for update;

  if found then
    if v_existing.intent_id is distinct from p_intent_id
      or v_existing.user_id <> p_user_id
      or v_existing.pi_uid <> p_pi_uid
      or v_existing.amount <> v_intent.amount
      or v_existing.network <> 'Pi Network'
    then
      raise exception 'Pi payment is already bound to a different escrow deposit';
    end if;
    if v_existing.status = 'confirmed' or p_status = 'confirmed' then
      v_status := 'confirmed';
    elsif v_existing.status = 'approved' or p_status = 'approved' then
      v_status := 'approved';
    else
      v_status := 'pending';
    end if;
    v_txid := coalesce(v_existing.txid, p_txid);
    if v_existing.txid is not null and p_txid is not null and v_existing.txid <> p_txid then
      raise exception 'Pi payment is already bound to a different transaction';
    end if;
    update public.escrow_service_deposits
    set status = v_status, txid = v_txid, updated_at = now()
    where pi_payment_id = p_payment_id;
  else
    if v_intent.status = 'confirmed' or p_status = 'confirmed' then
      v_status := 'confirmed';
    elsif v_intent.status = 'approved' or p_status = 'approved' then
      v_status := 'approved';
    else
      v_status := 'pending';
    end if;
    v_txid := p_txid;
    insert into public.escrow_service_deposits (
      pi_payment_id, intent_id, user_id, pi_uid, product_name, description,
      amount, memo, metadata, network, status, txid
    ) values (
      p_payment_id, p_intent_id, p_user_id, p_pi_uid, 'Escrow Service Deposit',
      'Secure funds held in escrow for freelance service', v_intent.amount,
      'Escrow deposit for job agreement', '{"type":"escrow"}'::jsonb,
      'Pi Network', v_status, v_txid
    );
  end if;

  if v_intent.status = 'confirmed' or v_status = 'confirmed' then
    v_status := 'confirmed';
  elsif v_intent.status = 'approved' or v_status = 'approved' then
    v_status := 'approved';
  else
    v_status := 'pending';
  end if;
  update public.escrow_service_deposit_intents
  set pi_payment_id = p_payment_id,
      txid = coalesce(txid, v_txid),
      status = v_status,
      updated_at = now()
  where id = p_intent_id;

  return query
  select * from public.escrow_service_deposits
  where pi_payment_id = p_payment_id;
end;
$$;

revoke all on function public.record_verified_escrow_service_deposit(
  uuid, text, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.record_verified_escrow_service_deposit(
  uuid, text, text, text, text, text
) to service_role;

create table if not exists public.escrow_listing_ad_payments (
  id uuid primary key,
  listing_id uuid not null references public.escrow_listings(id) on delete cascade,
  user_id text not null,
  pi_uid text not null,
  amount numeric(20, 8) not null
    check (amount >= 0.000001 and amount <= 1),
  memo text not null check (memo = 'Listing publication fee'),
  network text not null check (network in ('Pi Network', 'Pi Testnet')),
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'confirmed', 'cancelled')),
  pi_payment_id text unique,
  txid text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists escrow_listing_ad_payments_one_open_per_listing_idx
  on public.escrow_listing_ad_payments (listing_id)
  where status in ('pending', 'approved', 'confirmed');

alter table public.escrow_listing_ad_payments enable row level security;
revoke all on table public.escrow_listing_ad_payments from public, anon, authenticated;
grant select, insert, update on table public.escrow_listing_ad_payments to service_role;

drop policy if exists escrow_listing_ad_payments_service_access
  on public.escrow_listing_ad_payments;
create policy escrow_listing_ad_payments_service_access
  on public.escrow_listing_ad_payments
  for all to service_role using (true) with check (true);

create or replace function public.record_verified_listing_ad_payment(
  p_intent_id uuid,
  p_payment_id text,
  p_user_id text,
  p_pi_uid text,
  p_amount numeric,
  p_network text,
  p_status text,
  p_txid text default null
)
returns setof public.escrow_listing_ad_payments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_intent public.escrow_listing_ad_payments%rowtype;
  v_listing public.escrow_listings%rowtype;
  v_status text;
  v_txid text;
begin
  if p_status not in ('approved', 'confirmed') then
    raise exception 'Invalid listing publication payment status';
  end if;
  if p_payment_id is null or length(p_payment_id) = 0 then
    raise exception 'Pi payment ID is required';
  end if;

  select * into v_intent
  from public.escrow_listing_ad_payments
  where id = p_intent_id
  for update;
  if not found
    or v_intent.user_id <> p_user_id
    or v_intent.pi_uid <> p_pi_uid
    or v_intent.amount <> p_amount
    or v_intent.network <> p_network
    or v_intent.status = 'cancelled'
    or (v_intent.pi_payment_id is not null and v_intent.pi_payment_id <> p_payment_id)
  then
    raise exception 'Listing publication payment intent does not match this payment';
  end if;
  if p_status = 'confirmed' and nullif(p_txid, '') is null then
    raise exception 'A verified transaction ID is required';
  end if;
  if v_intent.txid is not null and p_txid is not null and v_intent.txid <> p_txid then
    raise exception 'Listing publication transaction ID cannot be rebound';
  end if;

  select * into v_listing
  from public.escrow_listings
  where id = v_intent.listing_id
  for update;
  if not found or v_listing.owner_id <> p_user_id then
    raise exception 'Listing owner does not match payment';
  end if;
  if v_listing.active and v_intent.status <> 'confirmed' then
    raise exception 'Listing was published by another payment';
  end if;

  if v_intent.status = 'confirmed' or p_status = 'confirmed' then
    v_status := 'confirmed';
  else
    v_status := 'approved';
  end if;
  v_txid := coalesce(v_intent.txid, p_txid);
  update public.escrow_listing_ad_payments
  set pi_payment_id = p_payment_id,
      txid = v_txid,
      status = v_status,
      updated_at = now()
  where id = p_intent_id;

  if v_status = 'confirmed' then
    update public.escrow_listings
    set active = true
    where id = v_intent.listing_id;
  end if;

  return query
  select * from public.escrow_listing_ad_payments
  where id = p_intent_id;
end;
$$;

revoke all on function public.record_verified_listing_ad_payment(
  uuid, text, text, text, numeric, text, text, text
) from public, anon, authenticated;
grant execute on function public.record_verified_listing_ad_payment(
  uuid, text, text, text, numeric, text, text, text
) to service_role;

commit;