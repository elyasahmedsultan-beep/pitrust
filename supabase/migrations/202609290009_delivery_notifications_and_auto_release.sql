-- Delivery submission, durable in-app notifications, recipient snapshots, and
-- a database-claimed 72-hour auto-release path. Apply through the documented
-- Supabase migration workflow; this file is not applied automatically by the
-- API server.

begin;

alter table public.escrow_contracts
  add column if not exists submitted_at timestamptz;

alter table public.escrow_contracts
  drop constraint if exists escrow_contracts_status_check,
  add constraint escrow_contracts_status_check
    check (status in (
      'draft', 'awaiting_funding', 'funded', 'submitted', 'in_delivery',
      'completed', 'disputed', 'resolved', 'refunded', 'cancelled'
    ));

alter table public.escrow_payout_intents
  add column if not exists recipient_wallet_address text,
  add column if not exists submitted_at timestamptz,
  add column if not exists auto_release boolean not null default false;

create table if not exists public.escrow_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  contract_id uuid not null references public.escrow_contracts(id) on delete cascade,
  type text not null,
  title text not null,
  message text not null,
  dedupe_key text not null unique,
  created_at timestamptz not null default now(),
  read_at timestamptz
);

create index if not exists escrow_notifications_user_recent_idx
  on public.escrow_notifications (user_id, created_at desc);
alter table public.escrow_notifications enable row level security;
drop policy if exists escrow_notifications_service_access on public.escrow_notifications;
create policy escrow_notifications_service_access on public.escrow_notifications
  for all to service_role using (true) with check (true);

create or replace function public.enqueue_escrow_notification(
  p_user_id text,
  p_contract_id uuid,
  p_type text,
  p_title text,
  p_message text,
  p_dedupe_key text
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  notification_id uuid;
begin
  if nullif(btrim(p_user_id), '') is null
    or nullif(btrim(p_type), '') is null
    or nullif(btrim(p_dedupe_key), '') is null then
    raise exception 'notification recipient, type, and dedupe key are required';
  end if;
  insert into public.escrow_notifications
    (user_id, contract_id, type, title, message, dedupe_key)
  values
    (p_user_id, p_contract_id, p_type, p_title, p_message, p_dedupe_key)
  on conflict (dedupe_key) do nothing
  returning id into notification_id;
  if notification_id is null then
    select existing.id into notification_id
    from public.escrow_notifications existing
    where existing.dedupe_key = p_dedupe_key;
  end if;
  return notification_id;
end;
$$;

revoke all on function public.enqueue_escrow_notification(text, uuid, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.enqueue_escrow_notification(text, uuid, text, text, text, text)
  to service_role;

-- The Pi UID remains escrow_payout_intents.recipient_address. Persist the
-- associated Stellar G-address once, so later profile edits cannot redirect
-- an already reserved payout.
create or replace function public.snapshot_payout_wallet_address()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  profile_wallet_address text;
begin
  if tg_op = 'UPDATE' then
    if new.recipient_address is distinct from old.recipient_address then
      raise exception 'payout recipient Pi UID is immutable';
    end if;
    if old.recipient_wallet_address is not null
      and new.recipient_wallet_address is distinct from old.recipient_wallet_address then
      raise exception 'payout destination wallet snapshot is immutable';
    end if;
    if old.recipient_wallet_address is not null then
      return new;
    end if;
  end if;

  select profile.wallet_address into profile_wallet_address
  from public.escrow_profiles profile
  where profile.pi_uid = new.recipient_address;

  if new.recipient_wallet_address is null then
    new.recipient_wallet_address := profile_wallet_address;
  elsif new.recipient_wallet_address is distinct from profile_wallet_address then
    raise exception 'payout wallet address does not belong to its persisted Pi UID';
  end if;

  if nullif(new.recipient_wallet_address, '') is null
    or new.recipient_wallet_address !~ '^G[A-Z2-7]{55}$' then
    raise exception 'a valid registered Pi payout wallet address is required';
  end if;
  return new;
end;
$$;

drop trigger if exists escrow_payout_wallet_snapshot on public.escrow_payout_intents;
create trigger escrow_payout_wallet_snapshot
before insert or update of recipient_address, recipient_wallet_address on public.escrow_payout_intents
for each row execute function public.snapshot_payout_wallet_address();

create or replace function public.set_payout_submitted_at()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if old.status is distinct from new.status and new.status = 'submitted'
    and new.submitted_at is null then
    new.submitted_at := now();
  end if;
  if old.submitted_at is not null and new.submitted_at is distinct from old.submitted_at then
    raise exception 'payout submitted timestamp is immutable';
  end if;
  return new;
end;
$$;

drop trigger if exists escrow_payout_submitted_at on public.escrow_payout_intents;
create trigger escrow_payout_submitted_at
before update on public.escrow_payout_intents
for each row execute function public.set_payout_submitted_at();

create or replace function public.submit_escrow_delivery(
  p_contract_id uuid,
  p_seller_id text,
  p_evidence jsonb
) returns table(
  delivery_id uuid,
  contract_id uuid,
  submitter_id text,
  evidence jsonb,
  created_at timestamptz,
  submitted_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  c public.escrow_contracts%rowtype;
  delivery public.escrow_delivery_evidence%rowtype;
  submitted_time timestamptz;
begin
  select * into c
  from public.escrow_contracts
  where id = p_contract_id
  for update;
  if not found or c.seller_id is distinct from p_seller_id then
    raise exception 'identified contract seller required';
  end if;
  if c.status <> 'funded' then
    raise exception 'delivery can only be submitted for a funded contract';
  end if;
  if p_evidence is null or jsonb_typeof(p_evidence) <> 'object' then
    raise exception 'delivery evidence object is required';
  end if;

  insert into public.escrow_delivery_evidence
    (contract_id, submitter_id, evidence)
  values
    (c.id, p_seller_id, p_evidence)
  returning * into delivery;

  submitted_time := coalesce(c.submitted_at, now());
  update public.escrow_contracts
    set status = 'submitted',
        submitted_at = submitted_time,
        next_action = 'Buyer review; automatic release after 72 hours without a dispute',
        updated_at = now()
    where id = c.id;

  insert into public.escrow_activity
    (id, contract_id, type, title, description, actor, tone)
  values
    (gen_random_uuid()::text, c.id, 'delivery_submitted', 'Delivery submitted',
     'The seller submitted delivery evidence. The buyer has 72 hours to review or open a dispute.',
     'Escrow system', 'neutral');

  perform public.enqueue_escrow_notification(
    c.buyer_id, c.id, 'delivery_submitted', 'Delivery ready for review',
    'The seller submitted delivery evidence. Review it or open a dispute within 72 hours; otherwise eligible Pi escrow is released automatically.',
    'delivery-submitted:' || c.id::text || ':' || delivery.id::text
  );
  perform public.enqueue_escrow_notification(
    c.seller_id, c.id, 'delivery_submitted_seller', 'Delivery submitted',
    'Your delivery evidence was submitted. The buyer has 72 hours to review or open a dispute.',
    'delivery-submitted-seller:' || c.id::text || ':' || delivery.id::text
  );

  return query select delivery.id, delivery.contract_id, delivery.submitter_id,
    delivery.evidence, delivery.created_at, submitted_time;
end;
$$;

revoke all on function public.submit_escrow_delivery(uuid, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.submit_escrow_delivery(uuid, text, jsonb)
  to service_role;

create or replace function public.claim_eligible_escrow_auto_release(
  p_intent_id uuid,
  p_network text
) returns table(
  intent_id uuid,
  contract_id uuid,
  amount numeric,
  platform_fee numeric,
  inviter_reward numeric,
  seller_amount numeric,
  recipient_uid text,
  recipient_wallet_address text,
  inviter_id text,
  payment_id text,
  txid text,
  network text,
  purpose text,
  dispute_id text,
  seller_id text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  c public.escrow_contracts%rowtype;
  payout public.escrow_payout_intents%rowtype;
  recipient_pi_uid text;
  recipient_wallet text;
  contract_inviter text;
  fee_percentage numeric;
  calculated_fee numeric(20, 8);
  calculated_reward numeric(20, 8);
begin
  if p_network is distinct from 'Pi Network' then
    raise exception 'automatic A2U release is only enabled for explicitly selected Pi Mainnet';
  end if;
  if p_intent_id is null then
    raise exception 'payout intent id is required';
  end if;

  for c in
    select contract.*
    from public.escrow_contracts contract
    where contract.status = 'submitted'
      and contract.submitted_at <= now() - interval '72 hours'
      and contract.currency = 'PI'
      and contract.seller_id is not null
      and not exists (
        select 1 from public.disputes dispute
        where dispute.contract_id = contract.id and dispute.status in ('open', 'under_review')
      )
      and not exists (
        select 1 from public.escrow_payout_intents existing
        where existing.contract_id = contract.id
      )
      and exists (
        select 1 from public.escrow_delivery_evidence delivery
        where delivery.contract_id = contract.id
          and delivery.submitter_id = contract.seller_id
      )
      and exists (
        select 1 from public.escrow_payment_ledger payment
        where payment.contract_id = contract.id
          and payment.user_id = contract.buyer_id
          and payment.amount = contract.amount
          and payment.status = 'confirmed'
          and payment.fee_type is null
      )
    order by contract.submitted_at, contract.id
    for update of contract skip locked
    limit 12
  loop
    select profile.pi_uid, profile.wallet_address
      into recipient_pi_uid, recipient_wallet
    from public.escrow_profiles profile
    where profile.user_id = c.seller_id;

    if nullif(recipient_pi_uid, '') is null
      or nullif(recipient_wallet, '') is null
      or recipient_wallet !~ '^G[A-Z2-7]{55}$' then
      perform public.enqueue_escrow_notification(
        c.seller_id, c.id, 'wallet_link_required', 'Payout paused: connect your Pi wallet',
        'The automatic release is paused because your registered Pi account or G-address is missing or invalid. Update your profile; no Pi transfer was broadcast.',
        'auto-release-wallet-required:' || c.id::text
      );
      continue;
    end if;

    select profile.referred_by into contract_inviter
    from public.escrow_profiles profile
    where profile.user_id = c.buyer_id;
    fee_percentage := public.get_app_setting_numeric('transaction_fee_percentage');
    if fee_percentage is null or fee_percentage < 0 or fee_percentage >= 100 then
      raise exception 'transaction fee setting is unavailable or invalid';
    end if;
    calculated_fee := round(c.amount * fee_percentage / 100, 8);
    calculated_reward := case when contract_inviter is null then 0
      else round(calculated_fee * 0.10, 8) end;

    insert into public.escrow_payout_intents (
      id, contract_id, inviter_id, amount, platform_fee, inviter_reward,
      seller_amount, recipient_address, recipient_wallet_address, status,
      network, purpose, auto_release, created_at, updated_at
    ) values (
      p_intent_id, c.id, contract_inviter, c.amount, calculated_fee,
      calculated_reward, c.amount - calculated_fee, recipient_pi_uid,
      recipient_wallet, 'creating', p_network, 'standard_release', true,
      now(), now()
    ) returning * into payout;

    return query select payout.id, payout.contract_id, payout.amount,
      payout.platform_fee, payout.inviter_reward, payout.seller_amount,
      payout.recipient_address, payout.recipient_wallet_address,
      payout.inviter_id, payout.pi_payment_id, payout.txid, payout.network,
      payout.purpose, payout.dispute_id, c.seller_id;
    return;
  end loop;
end;
$$;

revoke all on function public.claim_eligible_escrow_auto_release(uuid, text)
  from public, anon, authenticated;
grant execute on function public.claim_eligible_escrow_auto_release(uuid, text)
  to service_role;

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
  select * into c from public.escrow_contracts
  where id = p_contract_id for update;
  if not found or (
    p_user_id is distinct from c.buyer_id and
    p_user_id is distinct from c.seller_id
  ) then
    raise exception 'contract participant required';
  end if;
  if c.status not in ('funded', 'submitted', 'in_delivery') then
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
    where payment.contract_id = c.id and payment.user_id = c.buyer_id
      and payment.status = 'confirmed' and payment.fee_type is null
      and payment.amount = c.amount
  ) then
    raise exception 'confirmed contract payment required';
  end if;

  select * into fee from public.escrow_payment_ledger
  where pi_payment_id = p_pi_payment_id and contract_id = c.id
    and user_id = p_user_id and fee_type = 'dispute'
    and status = 'fee_confirmed' and amount > 0 and consumed_at is null
  for update;
  if not found then
    raise exception 'unconsumed confirmed dispute fee required';
  end if;

  insert into public.disputes
    (id, contract_id, reason, description, status, requested_resolution,
     resolution, created_at, updated_at)
  values
    (p_dispute_id, c.id, p_reason, p_description, 'open',
     p_requested_resolution, null, now(), now());
  update public.escrow_payment_ledger
    set consumed_at = now(), consumed_by_dispute_id = p_dispute_id,
        updated_at = now()
    where id = fee.id and consumed_at is null;
  if not found then
    raise exception 'dispute fee was already consumed';
  end if;
  update public.escrow_contracts
    set status = 'disputed', dispute_count = dispute_count + 1,
        next_action = 'Review open dispute', updated_at = now()
    where id = c.id;

  perform public.enqueue_escrow_notification(
    c.buyer_id, c.id, 'dispute_opened', 'Escrow dispute opened',
    'A participant opened a dispute. Funds remain held until an authorized resolution is completed.',
    'dispute-opened:' || p_dispute_id || ':' || c.buyer_id
  );
  if c.seller_id is distinct from c.buyer_id then
    perform public.enqueue_escrow_notification(
      c.seller_id, c.id, 'dispute_opened', 'Escrow dispute opened',
      'A participant opened a dispute. Funds remain held until an authorized resolution is completed.',
      'dispute-opened:' || p_dispute_id || ':' || c.seller_id
    );
  end if;
  return query select p_dispute_id;
end;
$$;

revoke all on function public.create_dispute_with_consumed_fee(text, uuid, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.create_dispute_with_consumed_fee(text, uuid, text, text, text, text, text)
  to service_role;

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
  select * into c from public.escrow_contracts
  where id = payout.contract_id for update;
  if c.status = 'completed' and payout.status = 'confirmed' then
    return query select payout.status, c.id;
    return;
  end if;
  if c.status not in ('in_delivery', 'submitted')
    or (c.status = 'submitted' and not payout.auto_release)
    or (c.status = 'in_delivery' and payout.auto_release)
    or c.currency <> 'PI'
    or payout.purpose <> 'standard_release'
    or payout.status not in ('completing', 'manual_reconciliation')
    or nullif(payout.recipient_wallet_address, '') is null
    or payout.seller_amount <> payout.amount - payout.platform_fee
    or payout.inviter_reward <> (
      case
      when payout.inviter_id is null then 0::numeric
      else round(payout.platform_fee * 0.10, 8)
      end
    ) then
    raise exception 'payout intent is not eligible for confirmed settlement';
  end if;
  if payout.auto_release and (
    c.submitted_at is null
    or c.submitted_at > now() - interval '72 hours'
    or exists (
      select 1 from public.disputes dispute
      where dispute.contract_id = c.id and dispute.status in ('open', 'under_review')
    )
  ) then
    raise exception 'automatic release is not yet eligible or an open dispute exists';
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
  insert into public.escrow_activity
    (id, contract_id, type, title, description, actor, tone)
  values
    (gen_random_uuid()::text, c.id, 'payment_released', 'Payment released',
     'Pi confirmed the seller A2U payout and the platform fee was settled.',
     'Escrow system', 'positive');
  perform public.enqueue_escrow_notification(
    c.seller_id, c.id, 'payment_released', 'Escrow payment released',
    'Pi verified the payout to your registered wallet. The transaction is complete.',
    'payout-confirmed:' || payout.id::text || ':' || c.seller_id
  );
  perform public.enqueue_escrow_notification(
    c.buyer_id, c.id, 'payment_released', 'Escrow payment released',
    'Pi verified the seller payout. The contract is complete.',
    'payout-confirmed:' || payout.id::text || ':' || c.buyer_id
  );
  return query select 'confirmed'::text, c.id;
end;
$$;

revoke all on function public.settle_confirmed_escrow_payout(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.settle_confirmed_escrow_payout(uuid, text, text)
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
  if old.submitted_at is not null and new.submitted_at is distinct from old.submitted_at then
    raise exception 'delivery submitted timestamp is immutable';
  end if;
  if old.submitted_at is null and new.submitted_at is not null
    and (old.status <> 'funded' or new.status <> 'submitted') then
    raise exception 'delivery submitted timestamp can only be set when seller evidence is submitted';
  end if;
  if new.status is not distinct from old.status then return new; end if;

  if not (
    (old.status = 'draft' and new.status in ('awaiting_funding', 'cancelled')) or
    (old.status = 'awaiting_funding' and new.status in ('funded', 'cancelled')) or
    (old.status = 'funded' and new.status in ('submitted', 'disputed', 'refunded')) or
    (old.status = 'submitted' and new.status in ('in_delivery', 'disputed', 'completed')) or
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

  if new.status = 'submitted' and (
    new.submitted_at is null
    or not exists (
      select 1 from public.escrow_delivery_evidence evidence
      where evidence.contract_id = new.id and evidence.submitter_id = new.seller_id
    )
  ) then raise exception 'submitted status requires timestamped seller delivery evidence'; end if;
  if new.status = 'in_delivery' and not exists (
    select 1 from public.escrow_delivery_evidence evidence
    where evidence.contract_id = new.id and evidence.submitter_id = new.seller_id
  ) then raise exception 'delivery status requires validated seller delivery evidence'; end if;
  if new.status = 'disputed' and not exists (
    select 1 from public.disputes dispute
    where dispute.contract_id = new.id and dispute.status = 'open'
  ) then raise exception 'disputed status requires an open dispute'; end if;

  if old.status = 'funded' and new.status = 'refunded' and not exists (
    select 1 from public.testnet_wallet_transactions wallet
    where wallet.contract_id = new.id and wallet.user_id = new.buyer_id
      and wallet.amount = new.amount and wallet.direction = 'credit'
      and wallet.transaction_type = 'escrow_refund' and wallet.status = 'completed'
  ) then raise exception 'funded Testnet cancellation requires a completed wallet refund'; end if;

  if new.status = 'completed' and old.status in ('in_delivery', 'submitted') and not (
    exists (select 1 from public.escrow_payout_intents payout
      where payout.contract_id = new.id and payout.purpose = 'standard_release'
        and payout.status = 'confirmed' and nullif(payout.txid, '') is not null
        and payout.recipient_wallet_address is not null
        and (
          (old.status = 'in_delivery' and payout.auto_release = false) or
          (old.status = 'submitted' and payout.auto_release = true
            and new.submitted_at <= now() - interval '72 hours'
            and not exists (select 1 from public.disputes dispute
              where dispute.contract_id = new.id and dispute.status in ('open', 'under_review')))
        ))
    or (old.status = 'in_delivery' and exists (
      select 1 from public.testnet_wallet_transactions wallet
      where wallet.contract_id = new.id and wallet.user_id = new.seller_id
        and wallet.amount = new.amount and wallet.direction = 'credit'
        and wallet.transaction_type = 'escrow_release' and wallet.status = 'completed'
    ))
  ) then raise exception 'completed status requires a confirmed Pi payout or Testnet wallet release'; end if;

  if old.status = 'disputed' and new.status in ('completed', 'refunded') and not exists (
    select 1 from public.escrow_payout_intents payout
    join public.disputes dispute on dispute.id = payout.dispute_id
    where payout.contract_id = new.id
      and payout.purpose = (case when new.status = 'completed' then 'arbitration_release' else 'arbitration_refund' end)
      and payout.status = 'confirmed' and nullif(payout.txid, '') is not null
      and dispute.contract_id = new.id and dispute.status = 'resolved'
      and dispute.decision = (case when new.status = 'completed' then 'release' else 'refund' end)
      and dispute.decided_by = payout.arbitrator_id and dispute.decided_at is not null
  ) then raise exception 'arbitration status requires a matching confirmed payout and resolved decision'; end if;

  return new;
end;
$$;

revoke all on function public.claim_eligible_escrow_auto_release(uuid, text)
  from public, anon, authenticated;
grant execute on function public.claim_eligible_escrow_auto_release(uuid, text)
  to service_role;

notify pgrst, 'reload schema';
commit;