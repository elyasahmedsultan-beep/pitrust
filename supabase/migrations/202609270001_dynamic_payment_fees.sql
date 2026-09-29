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
      ('dispute_resolution_fee_pi', 1);
  end if;
end;
$$;

alter table public.app_settings enable row level security;
revoke all on table public.app_settings from public, anon, authenticated;
grant select on table public.app_settings to service_role;

create or replace function public.get_app_setting_numeric(p_setting_name text)
returns numeric
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  setting_row jsonb;
  row_key text;
  raw_value text;
begin
  if p_setting_name not in ('transaction_fee_percentage', 'dispute_resolution_fee_pi') then
    raise exception 'unsupported application setting';
  end if;

  for setting_row in
    select to_jsonb(s) from public.app_settings as s
  loop
    row_key := coalesce(
      setting_row ->> 'key',
      setting_row ->> 'setting_key',
      setting_row ->> 'setting_name',
      setting_row ->> 'name'
    );
    if row_key = p_setting_name then
      raw_value := coalesce(setting_row ->> 'value', setting_row ->> 'setting_value');
      exit;
    elsif setting_row ? p_setting_name then
      raw_value := setting_row ->> p_setting_name;
      exit;
    end if;
  end loop;

  if raw_value is null then
    return null;
  end if;
  if raw_value !~ '^[+-]?[0-9]+([.][0-9]+)?$' then
    raise exception 'application fee setting is not numeric';
  end if;
  return raw_value::numeric;
exception
  when undefined_table then return null;
end;
$$;

revoke all on function public.get_app_setting_numeric(text) from public, anon, authenticated;
grant execute on function public.get_app_setting_numeric(text) to service_role;

-- Payout fee is now calculated from app_settings at first payout preparation.
-- Existing payout intents retain their persisted fee and remain idempotent.
do $$
declare
  existing_constraint record;
begin
  for existing_constraint in
    select conname
    from pg_constraint
    where conrelid = 'public.escrow_payout_intents'::regclass
      and contype = 'c'
      and position('platform_fee' in pg_get_constraintdef(oid)) > 0
      and position('0.03' in pg_get_constraintdef(oid)) > 0
  loop
    execute format(
      'alter table public.escrow_payout_intents drop constraint %I',
      existing_constraint.conname
    );
  end loop;
end;
$$;

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
    and status = 'fee_confirmed' and consumed_at is null
  for update;
  if not found then
    raise exception 'unconsumed confirmed dispute fee required';
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
  existing public.escrow_payment_ledger%rowtype;
  configured_dispute_fee numeric;
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
    if c.status not in ('funded', 'in_delivery') or p_status = 'confirmed' then
      raise exception 'dispute fee requires an active funded contract';
    end if;

    if p_status in ('approved', 'fee_confirmed') then
      select * into existing from public.escrow_payment_ledger
      where pi_payment_id = p_pi_payment_id and contract_id = p_contract_id
        and user_id = p_user_id and fee_type = 'dispute'
      for update;
    end if;

    if existing.id is not null then
      if existing.amount <> p_amount or existing.status not in ('approved', 'fee_confirmed') then
        raise exception 'dispute fee does not match its approved payment intent';
      end if;
    else
      configured_dispute_fee := public.get_app_setting_numeric('dispute_resolution_fee_pi');
      if configured_dispute_fee is null or configured_dispute_fee <= 0
        or p_amount <> configured_dispute_fee then
        raise exception 'dispute fee does not match the configured payment amount';
      end if;
    end if;
  else
    raise exception 'unsupported verified Pi fee type';
  end if;
  if p_status in ('confirmed', 'fee_confirmed') and nullif(p_txid, '') is null then
    raise exception 'completed Pi payments require a verified transaction id';
  end if;

  insert into public.escrow_payment_ledger as current_payment
    (pi_payment_id, contract_id, user_id, status, amount, txid, fee_type, updated_at)
  values
    (p_pi_payment_id, p_contract_id, p_user_id, p_status, p_amount, p_txid, p_fee_type, now())
  on conflict (pi_payment_id) do update
    set status = case
          when current_payment.status = 'approved' and excluded.status in ('confirmed', 'fee_confirmed')
            then excluded.status
          else current_payment.status
        end,
        txid = coalesce(current_payment.txid, excluded.txid),
        updated_at = now()
    where current_payment.contract_id = excluded.contract_id
      and current_payment.user_id = excluded.user_id
      and current_payment.amount = excluded.amount
      and current_payment.fee_type is not distinct from excluded.fee_type
      and (current_payment.txid is null or excluded.txid is null or current_payment.txid = excluded.txid)
  returning current_payment.* into saved;

  if saved.id is null then
    raise exception 'Pi payment idempotency conflict';
  end if;
  return query select saved.id, saved.status;
end;
$$;

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
  fee_percentage numeric;
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

  fee_percentage := public.get_app_setting_numeric('transaction_fee_percentage');
  if fee_percentage is null or fee_percentage < 0 or fee_percentage >= 100 then
    raise exception 'transaction fee setting is unavailable or invalid';
  end if;
  calculated_fee := round(c.amount * fee_percentage / 100, 8);
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

revoke all on function public.record_verified_pi_payment(text, uuid, text, text, numeric, text, text) from public, anon, authenticated;
grant execute on function public.record_verified_pi_payment(text, uuid, text, text, numeric, text, text) to service_role;
revoke all on function public.create_dispute_with_consumed_fee(text, uuid, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.create_dispute_with_consumed_fee(text, uuid, text, text, text, text, text) to service_role;
revoke all on function public.prepare_escrow_payout(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.prepare_escrow_payout(uuid, uuid, text, text) to service_role;