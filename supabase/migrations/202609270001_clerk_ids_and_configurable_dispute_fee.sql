-- Apply after 202606020001_marketplace_escrow.sql.
-- This migration keeps contract participants compatible with Clerk IDs and
-- makes dispute-fee validation use the current app_settings value.
-- Legacy FKs from participant IDs to profiles.id are removed, not recreated:
-- Supabase profile IDs are UUIDs, while Clerk IDs are external text values.
-- escrow_profiles is lazily created by the app, so an FK to it would block
-- valid contract creation before both participants have opened their profiles.
begin;

drop policy if exists "Contract visibility restriction" on public.escrow_contracts;

do $$
declare
  participant_column text;
  participant_type text;
  participant_attnum smallint;
  contracts_table regclass;
  legacy_profiles_table regclass;
  profiles_id_attnum smallint;
  has_legacy_participant boolean;
  participant_foreign_key record;
begin
  contracts_table := to_regclass('public.escrow_contracts');
  if contracts_table is null then
    raise exception 'Run the marketplace schema migration before this migration';
  end if;
  -- Prevent a UUID participant row from being inserted after the no-mapping
  -- check but before the column type change.
  lock table public.escrow_contracts in access exclusive mode;

  legacy_profiles_table := to_regclass('public.profiles');
  if legacy_profiles_table is not null then
    select attribute.attnum into profiles_id_attnum
    from pg_attribute attribute
    where attribute.attrelid = legacy_profiles_table
      and attribute.attname = 'id'
      and not attribute.attisdropped;
  end if;

  foreach participant_column in array array['buyer_id', 'seller_id'] loop
    select attribute.attnum, data_type.typname
      into participant_attnum, participant_type
    from pg_attribute attribute
    join pg_type data_type on data_type.oid = attribute.atttypid
    where attribute.attrelid = contracts_table
      and attribute.attname = participant_column
      and not attribute.attisdropped;

    if not found then
      execute format(
        'alter table public.escrow_contracts add column %I text',
        participant_column
      );
      continue;
    end if;

    if participant_type = 'uuid' then
      execute format(
        'select exists (select 1 from public.escrow_contracts where %I is not null)',
        participant_column
      ) into has_legacy_participant;
      if has_legacy_participant then
        raise exception
          'Cannot convert escrow_contracts.% automatically: existing UUID participant IDs need an explicit Clerk identity mapping first',
          participant_column;
      end if;

      for participant_foreign_key in
        select
          constraint_row.conname,
          constraint_row.conrelid,
          constraint_row.confrelid,
          constraint_row.conkey,
          constraint_row.confkey,
          pg_get_constraintdef(constraint_row.oid) as definition
        from pg_constraint constraint_row
        where constraint_row.contype = 'f'
          and (
            (
              constraint_row.conrelid = contracts_table
              and participant_attnum = any(constraint_row.conkey)
            )
            or (
              constraint_row.confrelid = contracts_table
              and participant_attnum = any(constraint_row.confkey)
            )
          )
      loop
        if participant_foreign_key.conrelid <> contracts_table
          or legacy_profiles_table is null
          or profiles_id_attnum is null
          or participant_foreign_key.confrelid <> legacy_profiles_table
          or array_length(participant_foreign_key.conkey, 1) <> 1
          or participant_foreign_key.conkey[1] <> participant_attnum
          or array_length(participant_foreign_key.confkey, 1) <> 1
          or participant_foreign_key.confkey[1] <> profiles_id_attnum then
          raise exception
            'Cannot convert escrow_contracts.% automatically while foreign key % exists (%); only the legacy single-column reference to public.profiles(id) can be removed',
            participant_column,
            participant_foreign_key.conname,
            participant_foreign_key.definition;
        end if;

        execute format(
          'alter table public.escrow_contracts drop constraint %I',
          participant_foreign_key.conname
        );
      end loop;

      execute format(
        'alter table public.escrow_contracts alter column %I type text using %I::text',
        participant_column,
        participant_column
      );
    elsif participant_type not in ('text', 'varchar') then
      raise exception
        'Unexpected type % for escrow_contracts.%; expected uuid or text',
        participant_type,
        participant_column;
    end if;
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
  select * into c
  from public.escrow_contracts
  where id = p_contract_id
  for update;
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
    select 1 from public.escrow_payment_ledger payment
    where payment.contract_id = c.id
      and payment.user_id = c.buyer_id
      and payment.status = 'confirmed'
      and payment.fee_type is null
      and payment.amount = c.amount
  ) then
    raise exception 'confirmed contract payment required';
  end if;

  -- The payment amount was checked against app_settings when it was recorded.
  -- Consume that verified amount so a later fee change does not invalidate it.
  select * into fee
  from public.escrow_payment_ledger
  where pi_payment_id = p_pi_payment_id
    and contract_id = c.id
    and user_id = p_user_id
    and fee_type = 'dispute'
    and status = 'fee_confirmed'
    and amount > 0
    and consumed_at is null
  for update;
  if not found then
    raise exception 'unconsumed confirmed dispute fee required';
  end if;

  insert into public.disputes
    (id, contract_id, reason, description, status, requested_resolution, resolution, created_at, updated_at)
  values
    (p_dispute_id, c.id, p_reason, p_description, 'open', p_requested_resolution, null, now(), now());
  update public.escrow_payment_ledger
    set consumed_at = now(),
        consumed_by_dispute_id = p_dispute_id,
        updated_at = now()
    where id = fee.id and consumed_at is null;
  if not found then
    raise exception 'dispute fee was already consumed';
  end if;
  update public.escrow_contracts
    set status = 'disputed',
        dispute_count = dispute_count + 1,
        next_action = 'Review open dispute',
        updated_at = now()
    where id = c.id;
  return query select p_dispute_id;
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
  prior_payment public.escrow_payment_ledger%rowtype;
  configured_dispute_fee numeric;
begin
  if p_status not in ('approved', 'confirmed', 'fee_confirmed') then
    raise exception 'unsupported verified Pi payment status';
  end if;
  select * into c
  from public.escrow_contracts
  where id = p_contract_id
  for share;
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
    if p_amount is null or p_amount <= 0
      or c.status not in ('funded', 'in_delivery')
      or p_status = 'confirmed' then
      raise exception 'dispute fee must be positive on an active funded contract';
    end if;

    select * into prior_payment
    from public.escrow_payment_ledger
    where pi_payment_id = p_pi_payment_id
    for update;

    if prior_payment.id is null then
      select setting.value into configured_dispute_fee
      from public.app_settings setting
      where setting.key = 'dispute_resolution_fee_pi';
      if not found
        or configured_dispute_fee is null
        or configured_dispute_fee <= 0
        or configured_dispute_fee > 1000000000
        or configured_dispute_fee <> round(configured_dispute_fee, 8) then
        raise exception 'configured dispute fee is unavailable';
      end if;
      if p_amount <> configured_dispute_fee then
        raise exception 'dispute fee does not match the current configured Pi fee';
      end if;
    elsif prior_payment.contract_id is distinct from p_contract_id
      or prior_payment.user_id is distinct from p_user_id
      or prior_payment.amount is distinct from p_amount
      or prior_payment.fee_type is distinct from p_fee_type
      or prior_payment.status not in ('approved', 'fee_confirmed')
      or (
        prior_payment.txid is not null
        and p_txid is not null
        and prior_payment.txid is distinct from p_txid
      ) then
      raise exception 'Pi payment idempotency conflict';
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

alter table public.escrow_contracts
  add column if not exists is_public_listing boolean not null default false;

-- Preserve the existing public-listing / participant visibility rule while
-- comparing Clerk's text subject instead of auth.uid()'s UUID value.
create policy "Contract visibility restriction" on public.escrow_contracts
  as permissive
  for select
  to public
  using (
    is_public_listing = true
    or (auth.jwt() ->> 'sub') = buyer_id
    or (auth.jwt() ->> 'sub') = seller_id
  );

commit;