begin;

-- Preserve existing administrator values while introducing independent fees.
do $$
declare
  key_column text;
  value_column text;
begin
  if to_regclass('public.app_settings') is null then
    create table public.app_settings (
      "key" text primary key,
      "value" numeric not null,
      updated_at timestamptz not null default now()
    );
  end if;

  select column_name into key_column
  from information_schema.columns
  where table_schema = 'public' and table_name = 'app_settings'
    and column_name in ('key', 'setting_key', 'name')
  order by case column_name when 'key' then 1 when 'setting_key' then 2 else 3 end
  limit 1;
  select column_name into value_column
  from information_schema.columns
  where table_schema = 'public' and table_name = 'app_settings'
    and column_name in ('value', 'setting_value')
  order by case column_name when 'value' then 1 else 2 end
  limit 1;

  if key_column is not null and value_column is not null then
    execute format(
      'insert into public.app_settings (%I, %I) values
        ($1, 1), ($2, 0.25), ($3, 0.25)
       on conflict (%I) do nothing',
      key_column, value_column, key_column
    ) using 'listing_ad_fee_pi', 'listing_ad_edit_fee_pi', 'listing_ad_delete_fee_pi';
  elsif exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'app_settings'
      and column_name = 'listing_ad_fee_pi'
  ) then
    alter table public.app_settings
      add column if not exists listing_ad_edit_fee_pi numeric(20, 8) not null default 0.25,
      add column if not exists listing_ad_delete_fee_pi numeric(20, 8) not null default 0.25;
  else
    raise exception 'Unsupported app_settings layout; add listing fee keys without replacing existing settings';
  end if;
end;
$$;

alter table public.escrow_listing_ad_payments
  add column if not exists operation text not null default 'publication',
  add column if not exists update_payload jsonb;
alter table public.escrow_listing_ad_payments
  drop constraint if exists escrow_listing_ad_payments_amount_check,
  drop constraint if exists escrow_listing_ad_payments_memo_check,
  drop constraint if exists escrow_listing_ad_payments_operation_check,
  add constraint escrow_listing_ad_payments_amount_range_check
    check (amount >= 0.00000001 and amount <= 1000000),
  add constraint escrow_listing_ad_payments_memo_check
    check (memo in ('Listing publication fee', 'Listing edit fee', 'Listing deletion fee')),
  add constraint escrow_listing_ad_payments_operation_check
    check (operation in ('publication', 'edit', 'delete')),
  add constraint escrow_listing_ad_payments_update_payload_check
    check (
      (operation = 'edit' and jsonb_typeof(update_payload) = 'object')
      or (operation <> 'edit' and update_payload is null)
    );
drop index if exists public.escrow_listing_ad_payments_one_open_per_listing_idx;
create unique index escrow_listing_ad_payments_one_open_per_listing_idx
  on public.escrow_listing_ad_payments (listing_id)
  where status in ('pending', 'approved');

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
set search_path = public, pg_temp
as $$
declare
  v_intent public.escrow_listing_ad_payments%rowtype;
  v_listing public.escrow_listings%rowtype;
  v_status text;
  v_txid text;
begin
  if p_status not in ('pending', 'approved', 'confirmed') or nullif(p_payment_id, '') is null then
    raise exception 'Invalid listing ad payment state';
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
    raise exception 'Listing ad payment intent does not match this payment';
  end if;
  if p_status = 'confirmed' and nullif(p_txid, '') is null then
    raise exception 'A verified transaction ID is required';
  end if;
  if v_intent.txid is not null and p_txid is not null and v_intent.txid <> p_txid then
    raise exception 'Listing ad transaction ID cannot be rebound';
  end if;

  select * into v_listing
  from public.escrow_listings
  where id = v_intent.listing_id
  for update;
  if not found or v_listing.owner_id <> p_user_id then
    raise exception 'Listing owner does not match payment';
  end if;
  if v_intent.status <> 'confirmed' and (
    (v_intent.operation = 'publication' and v_listing.active)
    or (v_intent.operation in ('edit', 'delete') and not v_listing.active)
  ) then
    raise exception 'Listing state changed before payment confirmation';
  end if;

  v_status := case
    when v_intent.status = 'confirmed' or p_status = 'confirmed' then 'confirmed'
    when v_intent.status = 'approved' or p_status = 'approved' then 'approved'
    else 'pending'
  end;
  v_txid := coalesce(v_intent.txid, p_txid);
  update public.escrow_listing_ad_payments
  set pi_payment_id = p_payment_id, txid = v_txid, status = v_status, updated_at = now()
  where id = p_intent_id;

  if v_status = 'confirmed' and v_intent.status <> 'confirmed' then
    if v_intent.operation = 'publication' then
      update public.escrow_listings set active = true, updated_at = now()
      where id = v_intent.listing_id;
    elsif v_intent.operation = 'delete' then
      update public.escrow_listings set active = false, updated_at = now()
      where id = v_intent.listing_id;
    else
      update public.escrow_listings
      set title = case when v_intent.update_payload ? 'title'
            then v_intent.update_payload ->> 'title' else title end,
          description = case when v_intent.update_payload ? 'description'
            then v_intent.update_payload ->> 'description' else description end,
          amount = case when v_intent.update_payload ? 'amount'
            then (v_intent.update_payload ->> 'amount')::numeric else amount end,
          updated_at = now()
      where id = v_intent.listing_id;
    end if;
  end if;

  return query select * from public.escrow_listing_ad_payments where id = p_intent_id;
end;
$$;
revoke all on function public.record_verified_listing_ad_payment(
  uuid, text, text, text, numeric, text, text, text
) from public, anon, authenticated;
grant execute on function public.record_verified_listing_ad_payment(
  uuid, text, text, text, numeric, text, text, text
) to service_role;

-- Funding reservations are recorded before calling Pi's approval API. This
-- serializes a user's cancellation against a payment already in progress.
alter table public.escrow_payment_ledger
  drop constraint if exists escrow_payment_ledger_status_check,
  add constraint escrow_payment_ledger_status_check
    check (status in ('approved', 'confirmed', 'payout_pending', 'payout_confirmed', 'fee_confirmed', 'cancelled'));

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
  select * into c from public.escrow_contracts where id = p_contract_id for update;
  if not found then raise exception 'Pi payment contract does not exist'; end if;

  if p_fee_type is null then
    if p_user_id is distinct from c.buyer_id or p_amount <> c.amount
      or p_status = 'fee_confirmed'
      or c.status not in ('awaiting_funding', 'funded')
    then
      raise exception 'contract funding payment must match an active buyer contract';
    end if;
    if exists (
      select 1 from public.escrow_payment_ledger active_payment
      where active_payment.contract_id = p_contract_id
        and active_payment.fee_type is null
        and active_payment.status in ('approved', 'confirmed')
        and active_payment.pi_payment_id <> p_pi_payment_id
    ) then
      raise exception 'another contract funding payment is already active';
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
  values (p_pi_payment_id, p_contract_id, p_user_id, p_status, p_amount, p_txid, p_fee_type, now())
  on conflict (pi_payment_id) do update
    set status = case
          when existing.status = 'approved' and excluded.status = 'confirmed' then 'confirmed'
          else existing.status end,
        txid = coalesce(existing.txid, excluded.txid),
        updated_at = now()
  where existing.contract_id = excluded.contract_id
    and existing.user_id = excluded.user_id
    and existing.amount = excluded.amount
    and existing.fee_type is not distinct from excluded.fee_type
    and existing.status <> 'cancelled'
    and (existing.txid is null or excluded.txid is null or existing.txid = excluded.txid)
  returning existing.* into saved;
  if saved.id is null then raise exception 'Pi payment idempotency conflict'; end if;
  return query select saved.id, saved.status;
end;
$$;
revoke all on function public.record_verified_pi_payment(text, uuid, text, text, numeric, text, text)
  from public, anon, authenticated;
grant execute on function public.record_verified_pi_payment(text, uuid, text, text, numeric, text, text)
  to service_role;

create or replace function public.cancel_verified_contract_funding_payment(
  p_pi_payment_id text, p_contract_id uuid, p_user_id text
) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare c public.escrow_contracts%rowtype;
begin
  select * into c from public.escrow_contracts where id = p_contract_id for update;
  if not found or c.buyer_id is distinct from p_user_id then return false; end if;
  if c.status not in ('awaiting_funding', 'cancelled') then return false; end if;
  update public.escrow_payment_ledger
  set status = 'cancelled', updated_at = now()
  where pi_payment_id = p_pi_payment_id and contract_id = p_contract_id
    and user_id = p_user_id and fee_type is null and status = 'approved' and txid is null;
  return true;
end;
$$;
revoke all on function public.cancel_verified_contract_funding_payment(text, uuid, text)
  from public, anon, authenticated;
grant execute on function public.cancel_verified_contract_funding_payment(text, uuid, text)
  to service_role;

create or replace function public.cancel_unfunded_escrow_contract(
  p_contract_id uuid, p_actor_id text
) returns table(success boolean, reason text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare c public.escrow_contracts%rowtype;
begin
  select * into c from public.escrow_contracts where id = p_contract_id for update;
  if not found then return query select false, 'contract_not_found'; return; end if;
  if p_actor_id is distinct from c.buyer_id and p_actor_id is distinct from c.seller_id then
    return query select false, 'not_participant'; return;
  end if;
  if c.status not in ('draft', 'awaiting_funding') then
    return query select false, 'contract_not_cancellable'; return;
  end if;
  if exists (
    select 1 from public.escrow_payment_ledger
    where contract_id = p_contract_id and fee_type is null and status in ('approved', 'confirmed')
  ) or exists (
    select 1 from public.testnet_wallet_transactions
    where contract_id = p_contract_id and transaction_type = 'escrow_funding'
      and status = 'completed'
  ) then
    return query select false, 'funding_payment_active'; return;
  end if;
  update public.escrow_contracts
  set status = 'cancelled', next_action = 'Contract cancelled before funding', updated_at = now()
  where id = p_contract_id;
  return query select true, 'cancelled';
end;
$$;
revoke all on function public.cancel_unfunded_escrow_contract(uuid, text)
  from public, anon, authenticated;
grant execute on function public.cancel_unfunded_escrow_contract(uuid, text)
  to service_role;

create or replace function public.refund_testnet_escrow_to_wallet(
  p_contract_id uuid, p_user_id text
) returns table(success boolean, reason text, idempotent boolean, balance numeric, transaction_id uuid)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  c public.escrow_contracts%rowtype;
  account_row public.testnet_wallet_accounts%rowtype;
  existing public.testnet_wallet_transactions%rowtype;
  new_balance numeric(20, 8);
  new_transaction_id uuid;
begin
  select * into c from public.escrow_contracts where id = p_contract_id for update;
  if not found then return query select false, 'contract_not_found', false, null::numeric, null::uuid; return; end if;
  if c.buyer_id is distinct from p_user_id then
    return query select false, 'buyer_only', false, null::numeric, null::uuid; return;
  end if;
  select * into existing from public.testnet_wallet_transactions
  where contract_id = p_contract_id and transaction_type = 'escrow_refund' for update;
  if found and c.status = 'refunded' then
    select balance into new_balance from public.testnet_wallet_accounts where user_id = p_user_id;
    return query select true, 'refunded', true, new_balance, existing.id; return;
  end if;
  if c.status <> 'funded' or c.currency <> 'PI'
    or exists (select 1 from public.disputes where contract_id = p_contract_id and status = 'open')
    or exists (select 1 from public.escrow_delivery_evidence where contract_id = p_contract_id)
  then
    return query select false, 'contract_not_refundable', false, null::numeric, null::uuid; return;
  end if;
  if not exists (
    select 1 from public.testnet_wallet_transactions
    where contract_id = p_contract_id and user_id = p_user_id and amount = c.amount
      and direction = 'debit' and transaction_type = 'escrow_funding' and status = 'completed'
  ) then
    return query select false, 'testnet_funding_required', false, null::numeric, null::uuid; return;
  end if;
  select * into account_row from public.testnet_wallet_accounts where user_id = p_user_id for update;
  if not found then return query select false, 'wallet_not_found', false, null::numeric, null::uuid; return; end if;
  new_balance := account_row.balance + c.amount;
  update public.testnet_wallet_accounts set balance = new_balance, updated_at = now()
  where user_id = p_user_id;
  insert into public.testnet_wallet_transactions (
    user_id, transaction_type, direction, amount, balance_after, counterparty_user_id,
    contract_id, status
  ) values (
    p_user_id, 'escrow_refund', 'credit', c.amount, new_balance, c.seller_id,
    p_contract_id, 'completed'
  ) returning id into new_transaction_id;
  update public.escrow_contracts set status = 'refunded',
    next_action = 'Testnet escrow refund confirmed', updated_at = now()
  where id = p_contract_id;
  return query select true, 'refunded', false, new_balance, new_transaction_id;
end;
$$;
revoke all on function public.refund_testnet_escrow_to_wallet(uuid, text)
  from public, anon, authenticated;
grant execute on function public.refund_testnet_escrow_to_wallet(uuid, text)
  to service_role;

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
  if new.status is not distinct from old.status then return new; end if;

  if not (
    (old.status = 'draft' and new.status in ('awaiting_funding', 'cancelled')) or
    (old.status = 'awaiting_funding' and new.status in ('funded', 'cancelled')) or
    (old.status = 'funded' and new.status in ('in_delivery', 'disputed', 'refunded')) or
    (old.status = 'in_delivery' and new.status in ('disputed', 'completed')) or
    (old.status = 'disputed' and new.status in ('completed', 'refunded'))
  ) then
    raise exception 'invalid escrow status transition: % -> %', old.status, new.status;
  end if;

  if new.status = 'funded' and not (
    exists (select 1 from public.escrow_payment_ledger payment
      where payment.contract_id = new.id and payment.user_id = new.buyer_id
        and payment.amount = new.amount and payment.status = 'confirmed' and payment.fee_type is null)
    or exists (select 1 from public.testnet_wallet_transactions wallet
      where wallet.contract_id = new.id and wallet.user_id = new.buyer_id
        and wallet.amount = new.amount and wallet.direction = 'debit'
        and wallet.transaction_type = 'escrow_funding' and wallet.status = 'completed')
  ) then raise exception 'funded status requires confirmed Pi payment or Testnet wallet funding'; end if;

  if new.status = 'in_delivery' and not exists (
    select 1 from public.escrow_delivery_evidence evidence
    where evidence.contract_id = new.id and evidence.submitter_id = new.seller_id
  ) then raise exception 'delivery status requires validated seller delivery evidence'; end if;
  if new.status = 'disputed' and not exists (
    select 1 from public.disputes dispute where dispute.contract_id = new.id and dispute.status = 'open'
  ) then raise exception 'disputed status requires an open dispute'; end if;

  if old.status = 'funded' and new.status = 'refunded' and not exists (
    select 1 from public.testnet_wallet_transactions wallet
    where wallet.contract_id = new.id and wallet.user_id = new.buyer_id
      and wallet.amount = new.amount and wallet.direction = 'credit'
      and wallet.transaction_type = 'escrow_refund' and wallet.status = 'completed'
  ) then raise exception 'funded Testnet cancellation requires a completed wallet refund'; end if;

  if old.status = 'in_delivery' and new.status = 'completed' and not (
    exists (select 1 from public.escrow_payout_intents payout
      where payout.contract_id = new.id and payout.purpose = 'standard_release'
        and payout.status = 'confirmed' and nullif(payout.txid, '') is not null)
    or exists (select 1 from public.testnet_wallet_transactions wallet
      where wallet.contract_id = new.id and wallet.user_id = new.seller_id
        and wallet.amount = new.amount and wallet.direction = 'credit'
        and wallet.transaction_type = 'escrow_release' and wallet.status = 'completed')
  ) then raise exception 'completed status requires a confirmed Pi payout or Testnet wallet release'; end if;

  if old.status = 'disputed' and new.status in ('completed', 'refunded') and not exists (
    select 1 from public.escrow_payout_intents payout
    join public.disputes dispute on dispute.id = payout.dispute_id
    where payout.contract_id = new.id
      and payout.purpose = case when new.status = 'completed' then 'arbitration_release' else 'arbitration_refund' end
      and payout.status = 'confirmed' and nullif(payout.txid, '') is not null
      and dispute.contract_id = new.id and dispute.status = 'resolved'
      and dispute.decision = case when new.status = 'completed' then 'release' else 'refund' end
      and dispute.decided_by = payout.arbitrator_id and dispute.decided_at is not null
  ) then raise exception 'arbitration status requires a matching confirmed payout and resolved decision'; end if;

  return new;
end;
$$;

commit;