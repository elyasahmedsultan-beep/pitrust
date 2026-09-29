-- Testnet-only internal wallet. No Pi Platform payment or blockchain transfer
-- is created by any function in this migration.

create table if not exists public.testnet_wallet_accounts (
  user_id text primary key references public.escrow_profiles(user_id) on delete cascade,
  wallet_address text not null unique default (
    'pi-trust-test-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 20)
  ),
  balance numeric(20, 8) not null default 0 check (balance >= 0),
  last_faucet_claim_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.testnet_wallet_transactions (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null default gen_random_uuid(),
  user_id text not null references public.escrow_profiles(user_id) on delete restrict,
  transaction_type text not null check (
    transaction_type in ('faucet_claim', 'transfer', 'escrow_funding', 'escrow_release', 'escrow_refund')
  ),
  direction text not null check (direction in ('credit', 'debit')),
  amount numeric(20, 8) not null check (amount > 0),
  balance_after numeric(20, 8) not null check (balance_after >= 0),
  counterparty_user_id text references public.escrow_profiles(user_id) on delete set null,
  contract_id uuid references public.escrow_contracts(id) on delete restrict,
  idempotency_key uuid,
  status text not null default 'completed' check (status in ('completed', 'pending')),
  created_at timestamptz not null default now()
);

create table if not exists public.testnet_faucet_claims (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references public.escrow_profiles(user_id) on delete restrict,
  transaction_id uuid not null unique references public.testnet_wallet_transactions(id) on delete restrict,
  amount numeric(20, 8) not null check (amount = 100),
  balance_after numeric(20, 8) not null check (balance_after >= 100),
  claimed_at timestamptz not null default now()
);

create index if not exists testnet_wallet_transactions_user_created_idx
  on public.testnet_wallet_transactions (user_id, created_at desc);
create unique index if not exists testnet_wallet_transactions_idempotency_idx
  on public.testnet_wallet_transactions (user_id, idempotency_key)
  where idempotency_key is not null;
create unique index if not exists testnet_wallet_one_escrow_funding_idx
  on public.testnet_wallet_transactions (contract_id)
  where transaction_type = 'escrow_funding';
create unique index if not exists testnet_wallet_one_escrow_release_idx
  on public.testnet_wallet_transactions (contract_id)
  where transaction_type = 'escrow_release';
create unique index if not exists testnet_wallet_one_escrow_refund_idx
  on public.testnet_wallet_transactions (contract_id)
  where transaction_type = 'escrow_refund';

alter table public.testnet_wallet_accounts enable row level security;
alter table public.testnet_wallet_transactions enable row level security;
alter table public.testnet_faucet_claims enable row level security;

revoke all on table public.testnet_wallet_accounts from public, anon, authenticated;
revoke all on table public.testnet_wallet_transactions from public, anon, authenticated;
revoke all on table public.testnet_faucet_claims from public, anon, authenticated;
grant all on table public.testnet_wallet_accounts to service_role;
grant all on table public.testnet_wallet_transactions to service_role;
grant all on table public.testnet_faucet_claims to service_role;

create or replace function public.create_testnet_wallet_for_profile()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.testnet_wallet_accounts (user_id)
  values (new.user_id)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists escrow_profiles_testnet_wallet on public.escrow_profiles;
create trigger escrow_profiles_testnet_wallet
after insert on public.escrow_profiles
for each row execute function public.create_testnet_wallet_for_profile();

insert into public.testnet_wallet_accounts (user_id)
select profile.user_id
from public.escrow_profiles profile
on conflict (user_id) do nothing;

create or replace function public.claim_testnet_faucet(p_user_id text)
returns table(
  success boolean,
  reason text,
  balance numeric,
  remaining_seconds integer,
  next_claim_at timestamptz,
  transaction_id uuid
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_account public.testnet_wallet_accounts%rowtype;
  v_transaction_id uuid;
  v_next_claim_at timestamptz;
  v_now timestamptz := now();
begin
  select * into v_account
  from public.testnet_wallet_accounts
  where user_id = p_user_id
  for update;
  if not found then
    raise exception 'Testnet wallet account does not exist';
  end if;

  if v_account.last_faucet_claim_at is not null then
    v_next_claim_at := v_account.last_faucet_claim_at + interval '72 hours';
    if v_next_claim_at > v_now then
      return query select false, 'cooldown'::text, v_account.balance,
        greatest(1, ceil(extract(epoch from (v_next_claim_at - v_now)))::integer),
        v_next_claim_at, null::uuid;
      return;
    end if;
    if v_account.balance > 10 then
      return query select false, 'balance_too_high'::text, v_account.balance,
        0, v_next_claim_at, null::uuid;
      return;
    end if;
  end if;

  update public.testnet_wallet_accounts as account
  set balance = account.balance + 100,
      last_faucet_claim_at = v_now,
      updated_at = v_now
  where account.user_id = p_user_id
  returning * into v_account;

  insert into public.testnet_wallet_transactions (
    user_id, transaction_type, direction, amount, balance_after, status, created_at
  ) values (
    p_user_id, 'faucet_claim', 'credit', 100, v_account.balance, 'completed', v_now
  ) returning id into v_transaction_id;

  insert into public.testnet_faucet_claims (
    user_id, transaction_id, amount, balance_after, claimed_at
  ) values (
    p_user_id, v_transaction_id, 100, v_account.balance, v_now
  );

  return query select true, null::text, v_account.balance, 0,
    v_account.last_faucet_claim_at + interval '72 hours', v_transaction_id;
end;
$$;

create or replace function public.transfer_testnet_wallet_balance(
  p_sender_user_id text,
  p_recipient text,
  p_amount numeric,
  p_request_id uuid
)
returns table(
  success boolean,
  reason text,
  group_id uuid,
  balance numeric,
  transaction_id uuid
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_recipient_id text;
  v_match_count integer;
  v_sender public.testnet_wallet_accounts%rowtype;
  v_recipient public.testnet_wallet_accounts%rowtype;
  v_existing public.testnet_wallet_transactions%rowtype;
  v_group_id uuid := gen_random_uuid();
  v_sender_transaction_id uuid;
begin
  if p_amount is null or p_amount <= 0 or p_amount <> round(p_amount, 8) then
    return query select false, 'invalid_amount'::text, null::uuid, null::numeric, null::uuid;
    return;
  end if;
  if p_request_id is null or nullif(trim(p_recipient), '') is null then
    return query select false, 'invalid_request'::text, null::uuid, null::numeric, null::uuid;
    return;
  end if;

  if lower(trim(p_recipient)) ~ '^pi-trust-test-[a-f0-9]{20}$' then
    select account.user_id into v_recipient_id
    from public.testnet_wallet_accounts account
    where lower(account.wallet_address) = lower(trim(p_recipient));
  else
    select count(*), min(profile.user_id) into v_match_count, v_recipient_id
    from public.escrow_profiles profile
    join public.testnet_wallet_accounts account on account.user_id = profile.user_id
    where lower(trim(profile.display_name)) = lower(trim(p_recipient));
    if v_match_count > 1 then
      return query select false, 'recipient_ambiguous'::text, null::uuid, null::numeric, null::uuid;
      return;
    end if;
  end if;

  if v_recipient_id is null then
    return query select false, 'recipient_not_found'::text, null::uuid, null::numeric, null::uuid;
    return;
  end if;
  if v_recipient_id = p_sender_user_id then
    return query select false, 'self_transfer'::text, null::uuid, null::numeric, null::uuid;
    return;
  end if;

  perform 1
  from public.testnet_wallet_accounts account
  where account.user_id in (p_sender_user_id, v_recipient_id)
  order by account.user_id
  for update;

  select * into v_sender
  from public.testnet_wallet_accounts
  where user_id = p_sender_user_id;
  if not found then
    raise exception 'Sender Testnet wallet account does not exist';
  end if;
  select * into v_recipient
  from public.testnet_wallet_accounts
  where user_id = v_recipient_id;
  if not found then
    return query select false, 'recipient_not_found'::text, null::uuid, v_sender.balance, null::uuid;
    return;
  end if;

  select * into v_existing
  from public.testnet_wallet_transactions
  where user_id = p_sender_user_id and idempotency_key = p_request_id;
  if found then
    if v_existing.transaction_type <> 'transfer'
      or v_existing.counterparty_user_id is distinct from v_recipient_id
      or v_existing.amount <> p_amount then
      return query select false, 'idempotency_conflict'::text, null::uuid, v_sender.balance, null::uuid;
      return;
    end if;
    return query select true, null::text, v_existing.group_id, v_sender.balance, v_existing.id;
    return;
  end if;

  if v_sender.balance < p_amount then
    return query select false, 'insufficient_balance'::text, null::uuid, v_sender.balance, null::uuid;
    return;
  end if;

  update public.testnet_wallet_accounts as account
  set balance = account.balance - p_amount, updated_at = now()
  where account.user_id = p_sender_user_id
  returning * into v_sender;
  update public.testnet_wallet_accounts as account
  set balance = account.balance + p_amount, updated_at = now()
  where account.user_id = v_recipient_id
  returning * into v_recipient;

  insert into public.testnet_wallet_transactions (
    group_id, user_id, transaction_type, direction, amount, balance_after,
    counterparty_user_id, idempotency_key, status
  ) values (
    v_group_id, p_sender_user_id, 'transfer', 'debit', p_amount, v_sender.balance,
    v_recipient_id, p_request_id, 'completed'
  ) returning id into v_sender_transaction_id;

  insert into public.testnet_wallet_transactions (
    group_id, user_id, transaction_type, direction, amount, balance_after,
    counterparty_user_id, status
  ) values (
    v_group_id, v_recipient_id, 'transfer', 'credit', p_amount, v_recipient.balance,
    p_sender_user_id, 'completed'
  );

  return query select true, null::text, v_group_id, v_sender.balance, v_sender_transaction_id;
end;
$$;

create or replace function public.fund_testnet_escrow_from_wallet(
  p_contract_id uuid,
  p_user_id text
)
returns table(
  success boolean,
  reason text,
  idempotent boolean,
  balance numeric,
  transaction_id uuid
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_contract public.escrow_contracts%rowtype;
  v_account public.testnet_wallet_accounts%rowtype;
  v_existing public.testnet_wallet_transactions%rowtype;
  v_balance numeric(20, 8);
  v_transaction_id uuid;
begin
  select * into v_contract
  from public.escrow_contracts
  where id = p_contract_id
  for update;
  if not found or v_contract.buyer_id is distinct from p_user_id then
    return query select false, 'contract_not_found'::text, false, null::numeric, null::uuid;
    return;
  end if;

  select * into v_existing
  from public.testnet_wallet_transactions
  where contract_id = p_contract_id and transaction_type = 'escrow_funding';
  if found and v_contract.status = 'funded' then
    select account.balance into v_balance
    from public.testnet_wallet_accounts account
    where account.user_id = p_user_id;
    return query select true, null::text, true, v_balance, v_existing.id;
    return;
  end if;
  if v_contract.status <> 'awaiting_funding' or upper(v_contract.currency) <> 'PI' then
    return query select false, 'contract_not_fundable'::text, false, null::numeric, null::uuid;
    return;
  end if;

  select * into v_account
  from public.testnet_wallet_accounts
  where user_id = p_user_id
  for update;
  if not found then
    raise exception 'Buyer Testnet wallet account does not exist';
  end if;
  if v_account.balance < v_contract.amount then
    return query select false, 'insufficient_balance'::text, false, v_account.balance, null::uuid;
    return;
  end if;

  update public.testnet_wallet_accounts as account
  set balance = account.balance - v_contract.amount, updated_at = now()
  where account.user_id = p_user_id
  returning * into v_account;

  insert into public.testnet_wallet_transactions (
    user_id, transaction_type, direction, amount, balance_after,
    counterparty_user_id, contract_id, status
  ) values (
    p_user_id, 'escrow_funding', 'debit', v_contract.amount,
    v_account.balance, v_contract.seller_id, p_contract_id, 'completed'
  ) returning id into v_transaction_id;

  update public.escrow_contracts
  set status = 'funded',
      payment_method = 'Test-Pi',
      next_action = 'Mark delivery in progress',
      updated_at = now()
  where id = p_contract_id;
  insert into public.escrow_activity (
    id, contract_id, type, title, description, actor, tone
  ) values (
    gen_random_uuid()::text, p_contract_id, 'payment_confirmed', 'Test-Pi funding confirmed',
    'The buyer funded this escrow from their internal Testnet wallet.', 'Test-Pi Wallet', 'positive'
  );

  return query select true, null::text, false, v_account.balance, v_transaction_id;
end;
$$;

create or replace function public.release_testnet_escrow_to_wallet(
  p_contract_id uuid,
  p_user_id text
)
returns table(
  success boolean,
  reason text,
  idempotent boolean,
  balance numeric,
  transaction_id uuid
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_contract public.escrow_contracts%rowtype;
  v_account public.testnet_wallet_accounts%rowtype;
  v_existing public.testnet_wallet_transactions%rowtype;
  v_balance numeric(20, 8);
  v_transaction_id uuid;
begin
  select * into v_contract
  from public.escrow_contracts
  where id = p_contract_id
  for update;
  if not found or v_contract.buyer_id is distinct from p_user_id then
    return query select false, 'contract_not_found'::text, false, null::numeric, null::uuid;
    return;
  end if;

  select * into v_existing
  from public.testnet_wallet_transactions
  where contract_id = p_contract_id and transaction_type = 'escrow_release';
  if found and v_contract.status = 'completed' then
    select account.balance into v_balance
    from public.testnet_wallet_accounts account
    where account.user_id = v_contract.seller_id;
    return query select true, null::text, true, v_balance, v_existing.id;
    return;
  end if;
  if v_contract.status <> 'in_delivery' or upper(v_contract.currency) <> 'PI' then
    return query select false, 'contract_not_releasable'::text, false, null::numeric, null::uuid;
    return;
  end if;
  if v_contract.seller_id is null or not exists (
    select 1
    from public.testnet_wallet_transactions funding
    where funding.contract_id = p_contract_id
      and funding.user_id = v_contract.buyer_id
      and funding.transaction_type = 'escrow_funding'
      and funding.direction = 'debit'
      and funding.amount = v_contract.amount
      and funding.status = 'completed'
  ) then
    return query select false, 'testnet_funding_required'::text, false, null::numeric, null::uuid;
    return;
  end if;
  if not exists (
    select 1
    from public.escrow_delivery_evidence delivery
    where delivery.contract_id = p_contract_id
      and delivery.submitter_id = v_contract.seller_id
  ) then
    return query select false, 'delivery_evidence_required'::text, false, null::numeric, null::uuid;
    return;
  end if;
  if exists (
    select 1 from public.disputes dispute
    where dispute.contract_id = p_contract_id and dispute.status = 'open'
  ) then
    return query select false, 'open_dispute'::text, false, null::numeric, null::uuid;
    return;
  end if;

  select * into v_account
  from public.testnet_wallet_accounts
  where user_id = v_contract.seller_id
  for update;
  if not found then
    raise exception 'Seller Testnet wallet account does not exist';
  end if;
  update public.testnet_wallet_accounts as account
  set balance = account.balance + v_contract.amount, updated_at = now()
  where account.user_id = v_contract.seller_id
  returning * into v_account;

  insert into public.testnet_wallet_transactions (
    user_id, transaction_type, direction, amount, balance_after, counterparty_user_id,
    contract_id, status
  ) values (
    v_contract.seller_id, 'escrow_release', 'credit', v_contract.amount,
    v_account.balance, v_contract.buyer_id, p_contract_id, 'completed'
  ) returning id into v_transaction_id;

  update public.escrow_contracts
  set status = 'completed',
      next_action = 'Escrow completed',
      release_date = now(),
      updated_at = now()
  where id = p_contract_id;
  insert into public.escrow_activity (
    id, contract_id, type, title, description, actor, tone
  ) values (
    gen_random_uuid()::text, p_contract_id, 'payment_released', 'Test-Pi released',
    'The escrow amount was credited to the seller’s internal Testnet wallet.', 'Test-Pi Wallet', 'positive'
  );

  return query select true, null::text, false, v_account.balance, v_transaction_id;
end;
$$;

create or replace function public.guard_escrow_status_transition()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
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

  if new.status = 'funded' and not (
    exists (
      select 1 from public.escrow_payment_ledger payment
      where payment.contract_id = new.id and payment.user_id = new.buyer_id
        and payment.amount = new.amount and payment.status = 'confirmed'
        and payment.fee_type is null
    ) or exists (
      select 1 from public.testnet_wallet_transactions wallet
      where wallet.contract_id = new.id and wallet.user_id = new.buyer_id
        and wallet.amount = new.amount and wallet.direction = 'debit'
        and wallet.transaction_type = 'escrow_funding' and wallet.status = 'completed'
    )
  ) then
    raise exception 'funded status requires confirmed Pi payment or Testnet wallet funding';
  end if;
  if new.status = 'in_delivery' and not exists (
    select 1 from public.escrow_delivery_evidence evidence
    where evidence.contract_id = new.id and evidence.submitter_id = new.seller_id
  ) then
    raise exception 'delivery status requires validated delivery evidence';
  end if;
  if new.status = 'disputed' and not exists (
    select 1 from public.disputes dispute
    where dispute.contract_id = new.id and dispute.status = 'open'
  ) then
    raise exception 'disputed status requires an open dispute';
  end if;
  if new.status = 'resolved' and not exists (
    select 1 from public.disputes dispute
    where dispute.contract_id = new.id and dispute.status = 'resolved'
  ) then
    raise exception 'resolved status requires a resolved dispute';
  end if;
  if new.status = 'completed' and not (
    exists (
      select 1 from public.escrow_payout_intents payout
      where payout.contract_id = new.id and payout.status = 'confirmed' and payout.txid is not null
    ) or exists (
      select 1 from public.testnet_wallet_transactions wallet
      where wallet.contract_id = new.id and wallet.user_id = new.seller_id
        and wallet.amount = new.amount and wallet.direction = 'credit'
        and wallet.transaction_type = 'escrow_release' and wallet.status = 'completed'
    )
  ) then
    raise exception 'completed status requires confirmed Pi payout or Testnet wallet release';
  end if;
  return new;
end;
$$;

revoke all on function public.create_testnet_wallet_for_profile() from public, anon, authenticated;
revoke all on function public.claim_testnet_faucet(text) from public, anon, authenticated;
revoke all on function public.transfer_testnet_wallet_balance(text, text, numeric, uuid) from public, anon, authenticated;
revoke all on function public.fund_testnet_escrow_from_wallet(uuid, text) from public, anon, authenticated;
revoke all on function public.release_testnet_escrow_to_wallet(uuid, text) from public, anon, authenticated;

grant execute on function public.claim_testnet_faucet(text) to service_role;
grant execute on function public.transfer_testnet_wallet_balance(text, text, numeric, uuid) to service_role;
grant execute on function public.fund_testnet_escrow_from_wallet(uuid, text) to service_role;
grant execute on function public.release_testnet_escrow_to_wallet(uuid, text) to service_role;