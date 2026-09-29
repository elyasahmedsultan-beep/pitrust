-- Arbitration payouts are intents only: these functions never submit a Pi
-- payment. The trusted server must verify the Pi SDK payment DTO before calling
-- settle_confirmed_arbitration_payout.
--
-- Assumption: service_role callers authenticate the human actor and pass the
-- corresponding escrow_profiles.user_id. A database boolean is not a substitute
-- for an external authorization workflow.
-- Apply after both existing 202609270001 migrations. Those earlier files share
-- a version prefix, so reconcile migration history or use the SQL Editor
-- instructions in supabase/ARBITRATION_SETUP.md instead of blindly running db push.

alter table public.escrow_profiles
  add column if not exists is_arbitrator boolean not null default false;

alter table public.disputes
  add column if not exists decision text,
  add column if not exists decided_by text,
  add column if not exists decided_at timestamptz;

alter table public.disputes
  drop constraint if exists disputes_decision_check,
  add constraint disputes_decision_check
    check (decision is null or decision in ('release', 'refund')),
  drop constraint if exists disputes_decision_audit_check,
  add constraint disputes_decision_audit_check
    check (
      (decision is null and decided_by is null and decided_at is null) or
      (decision is not null and nullif(btrim(decided_by), '') is not null and decided_at is not null)
    );

alter table public.escrow_payout_intents
  add column if not exists purpose text not null default 'standard_release',
  add column if not exists dispute_id text,
  add column if not exists arbitrator_id text,
  add column if not exists reason text;

alter table public.escrow_payout_intents
  drop constraint if exists escrow_payout_intents_purpose_check,
  add constraint escrow_payout_intents_purpose_check
    check (purpose in ('standard_release', 'arbitration_release', 'arbitration_refund')),
  drop constraint if exists escrow_payout_intents_dispute_id_fkey,
  add constraint escrow_payout_intents_dispute_id_fkey
    foreign key (dispute_id) references public.disputes(id) on delete restrict,
  drop constraint if exists escrow_payout_intents_arbitration_fields_check,
  add constraint escrow_payout_intents_arbitration_fields_check
    check (
      (purpose = 'standard_release' and dispute_id is null and arbitrator_id is null and reason is null) or
      (purpose in ('arbitration_release', 'arbitration_refund')
        and dispute_id is not null
        and nullif(btrim(arbitrator_id), '') is not null
        and nullif(btrim(reason), '') is not null)
    );

create index if not exists escrow_payout_intents_dispute_idx
  on public.escrow_payout_intents (dispute_id)
  where dispute_id is not null;

alter table public.escrow_contracts
  drop constraint if exists escrow_contracts_status_check,
  add constraint escrow_contracts_status_check
    check (status in (
      'draft', 'awaiting_funding', 'funded', 'in_delivery', 'completed',
      'disputed', 'resolved', 'refunded', 'cancelled'
    ));

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
    -- Historical 'resolved' rows remain readable, but new disputes can only
    -- terminate after the corresponding Pi payout is confirmed.
    (old.status = 'disputed' and new.status in ('completed', 'refunded'))
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
  if old.status = 'in_delivery' and new.status = 'completed' and not exists (
    select 1 from public.escrow_payout_intents p
    where p.contract_id = new.id and p.purpose = 'standard_release'
      and p.status = 'confirmed' and p.txid is not null
  ) then
    raise exception 'completed status requires confirmed standard Pi A2U payout';
  end if;
  if old.status = 'disputed' and new.status in ('completed', 'refunded') and not exists (
    select 1
    from public.escrow_payout_intents p
    join public.disputes d on d.id = p.dispute_id
    where p.contract_id = new.id
      and p.purpose = case when new.status = 'completed'
        then 'arbitration_release' else 'arbitration_refund' end
      and p.status = 'confirmed'
      and nullif(p.txid, '') is not null
      and d.contract_id = new.id
      and d.status = 'resolved'
      and d.decision = case when new.status = 'completed'
        then 'release' else 'refund' end
      and d.decided_by = p.arbitrator_id
      and d.decided_at is not null
  ) then
    raise exception 'arbitration status requires matching confirmed payout and resolved decision';
  end if;
  return new;
end;
$$;

create or replace function public.prepare_arbitration_payout(
  p_intent_id uuid,
  p_dispute_id text,
  p_actor_id text,
  p_decision text,
  p_reason text,
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
  network text,
  purpose text,
  dispute_id text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  c public.escrow_contracts%rowtype;
  d public.disputes%rowtype;
  payout public.escrow_payout_intents%rowtype;
  target_contract_id uuid;
  recipient_pi_uid text;
  contract_inviter text;
  fee_percentage numeric;
  calculated_fee numeric(20, 8);
  calculated_reward numeric(20, 8);
  target_purpose text;
  funding_count integer;
begin
  if p_decision is null or p_decision not in ('release', 'refund') then
    raise exception 'arbitration decision must be release or refund';
  end if;
  if nullif(btrim(p_actor_id), '') is null
    or nullif(btrim(p_reason), '') is null then
    raise exception 'arbitrator and human-readable reason are required';
  end if;
  if p_network is null or p_network not in ('Pi Network', 'Pi Testnet') then
    raise exception 'unsupported Pi payout network';
  end if;
  target_purpose := case when p_decision = 'release'
    then 'arbitration_release' else 'arbitration_refund' end;

  -- Lock order used by both arbitration RPCs: contract, dispute, payout intent.
  select dispute.contract_id into target_contract_id
  from public.disputes dispute
  where dispute.id = p_dispute_id;
  if not found then
    raise exception 'dispute does not exist';
  end if;
  select * into c from public.escrow_contracts
  where id = target_contract_id for update;
  if not found then
    raise exception 'dispute contract does not exist';
  end if;
  select * into d from public.disputes
  where id = p_dispute_id for update;
  if not found or d.contract_id <> c.id then
    raise exception 'dispute does not match its contract';
  end if;
  if not exists (
    select 1 from public.escrow_profiles profile
    where profile.user_id = p_actor_id and profile.is_arbitrator = true
  ) then
    raise exception 'active arbitrator profile required';
  end if;

  select * into payout from public.escrow_payout_intents
  where contract_id = c.id for update;
  if found then
    if payout.id <> p_intent_id
      or payout.purpose <> target_purpose
      or payout.dispute_id is distinct from p_dispute_id
      or payout.arbitrator_id is distinct from p_actor_id
      or payout.reason is distinct from p_reason
      or payout.network is distinct from p_network then
      raise exception 'another payout exists or arbitration request conflicts with persisted intent';
    end if;
    return query select payout.id, false, payout.status, payout.amount,
      payout.platform_fee, payout.inviter_reward, payout.seller_amount,
      payout.recipient_address, payout.inviter_id, payout.pi_payment_id,
      payout.txid, payout.network, payout.purpose, payout.dispute_id;
    return;
  end if;

  if c.status <> 'disputed' or c.currency <> 'PI' or c.seller_id is null then
    raise exception 'a PI-denominated disputed contract with an accepted seller is required';
  end if;
  if d.status not in ('open', 'under_review') or d.decision is not null then
    raise exception 'dispute is not open for arbitration';
  end if;
  select count(*) into funding_count
  from public.escrow_payment_ledger payment
  where payment.contract_id = c.id
    and payment.user_id = c.buyer_id
    and payment.amount = c.amount
    and payment.status = 'confirmed'
    and payment.fee_type is null
    and nullif(payment.txid, '') is not null;
  if funding_count <> 1 then
    raise exception 'exactly one confirmed buyer escrow funding payment with txid is required';
  end if;

  if p_decision = 'release' then
    if not exists (
      select 1 from public.escrow_delivery_evidence delivery
      where delivery.contract_id = c.id and delivery.submitter_id = c.seller_id
    ) then
      raise exception 'seller delivery evidence is required for arbitration release';
    end if;
    select profile.pi_uid into recipient_pi_uid
    from public.escrow_profiles profile
    where profile.user_id = c.seller_id;
    if nullif(recipient_pi_uid, '') is null then
      raise exception 'seller must link a verified Pi account before arbitration release';
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
  else
    select profile.pi_uid into recipient_pi_uid
    from public.escrow_profiles profile
    where profile.user_id = c.buyer_id;
    if nullif(recipient_pi_uid, '') is null then
      raise exception 'buyer must link a verified Pi account before arbitration refund';
    end if;
    contract_inviter := null;
    calculated_fee := 0;
    calculated_reward := 0;
  end if;

  insert into public.escrow_payout_intents (
    id, contract_id, inviter_id, amount, platform_fee, inviter_reward,
    seller_amount, recipient_address, status, network, purpose,
    dispute_id, arbitrator_id, reason, created_at, updated_at
  ) values (
    p_intent_id, c.id, contract_inviter, c.amount, calculated_fee,
    calculated_reward, c.amount - calculated_fee, recipient_pi_uid,
    'creating', p_network, target_purpose, p_dispute_id, p_actor_id,
    p_reason, now(), now()
  ) returning * into payout;

  return query select payout.id, true, payout.status, payout.amount,
    payout.platform_fee, payout.inviter_reward, payout.seller_amount,
    payout.recipient_address, payout.inviter_id, payout.pi_payment_id,
    payout.txid, payout.network, payout.purpose, payout.dispute_id;
end;
$$;

create or replace function public.settle_confirmed_arbitration_payout(
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
  d public.disputes%rowtype;
  referral public.escrow_referral_ledger%rowtype;
  target_contract_id uuid;
  funding_count integer;
  inserted_count integer;
  expected_decision text;
  expected_contract_status text;
  expected_recipient text;
begin
  if nullif(p_payment_id, '') is null or nullif(p_txid, '') is null then
    raise exception 'verified Pi payment id and transaction id are required';
  end if;
  -- Read identifiers first, then acquire locks in contract/dispute/payout order.
  select payout.contract_id into target_contract_id
  from public.escrow_payout_intents payout
  where payout.id = p_intent_id;
  if not found then
    raise exception 'arbitration payout intent does not exist';
  end if;
  select * into c from public.escrow_contracts
  where id = target_contract_id for update;
  if not found then
    raise exception 'arbitration payout contract does not exist';
  end if;
  select dispute.* into d
  from public.disputes dispute
  join public.escrow_payout_intents candidate
    on candidate.dispute_id = dispute.id
  where candidate.id = p_intent_id
  for update of dispute;
  if not found then
    raise exception 'arbitration payout dispute does not exist';
  end if;
  select * into payout from public.escrow_payout_intents
  where id = p_intent_id for update;
  if not found or payout.contract_id <> c.id
    or payout.dispute_id is distinct from d.id
    or d.contract_id <> c.id
    or payout.pi_payment_id is distinct from p_payment_id
    or payout.txid is distinct from p_txid then
    raise exception 'persisted payout, dispute, payment id, or txid does not match';
  end if;

  if payout.purpose not in ('arbitration_release', 'arbitration_refund') then
    raise exception 'payout is not an arbitration payout';
  end if;
  expected_decision := case when payout.purpose = 'arbitration_release'
    then 'release' else 'refund' end;
  expected_contract_status := case when expected_decision = 'release'
    then 'completed' else 'refunded' end;

  if payout.status = 'confirmed'
    and c.status = expected_contract_status
    and d.status = 'resolved'
    and d.decision = expected_decision
    and d.decided_by = payout.arbitrator_id
    and d.resolution = payout.reason
    and d.decided_at is not null then
    return query select payout.status, c.id;
    return;
  end if;
  if c.status <> 'disputed'
    or c.currency <> 'PI'
    or payout.status not in ('completing', 'manual_reconciliation')
    or payout.amount <> c.amount
    or nullif(payout.recipient_address, '') is null
    or nullif(payout.arbitrator_id, '') is null
    or nullif(btrim(payout.reason), '') is null
    or d.status not in ('open', 'under_review')
    or d.decision is not null then
    raise exception 'arbitration payout is not eligible for confirmed settlement';
  end if;
  -- Role changes block new reservations, not settlement of a previously
  -- authorized and independently Pi-verified transfer. Rechecking the current
  -- role here could strand funds after Pi completes but before SQL settles.
  select count(*) into funding_count
  from public.escrow_payment_ledger payment
  where payment.contract_id = c.id
    and payment.user_id = c.buyer_id
    and payment.amount = c.amount
    and payment.status = 'confirmed'
    and payment.fee_type is null
    and nullif(payment.txid, '') is not null;
  if funding_count <> 1 then
    raise exception 'confirmed buyer escrow funding no longer matches contract';
  end if;

  if expected_decision = 'release' then
    select profile.pi_uid into expected_recipient
    from public.escrow_profiles profile where profile.user_id = c.seller_id;
    if nullif(expected_recipient, '') is null
      or payout.recipient_address is distinct from expected_recipient
      or payout.platform_fee < 0 or payout.platform_fee > payout.amount
      or payout.seller_amount <> payout.amount - payout.platform_fee
      or payout.inviter_reward <> (
        case when payout.inviter_id is null then 0::numeric
          else round(payout.platform_fee * 0.10, 8)
        end
      )
      or (payout.inviter_id is not null and not exists (
        select 1 from public.escrow_profiles inviter
        where inviter.user_id = payout.inviter_id
      ))
      or not exists (
        select 1 from public.escrow_delivery_evidence delivery
        where delivery.contract_id = c.id and delivery.submitter_id = c.seller_id
      ) then
      raise exception 'arbitration release recipient, fee, reward, or delivery evidence is inconsistent';
    end if;
  else
    select profile.pi_uid into expected_recipient
    from public.escrow_profiles profile where profile.user_id = c.buyer_id;
    if nullif(expected_recipient, '') is null
      or payout.recipient_address is distinct from expected_recipient
      or payout.platform_fee <> 0
      or payout.inviter_id is not null
      or payout.inviter_reward <> 0
      or payout.seller_amount <> payout.amount then
      raise exception 'arbitration refund must return gross amount to verified buyer with no fee or reward';
    end if;
  end if;

  update public.escrow_payout_intents
    set status = 'confirmed', updated_at = now()
    where id = payout.id;
  update public.disputes
    set status = 'resolved',
        decision = expected_decision,
        decided_by = payout.arbitrator_id,
        decided_at = now(),
        resolution = payout.reason,
        updated_at = now()
    where id = d.id;

  if expected_decision = 'release'
    and payout.inviter_id is not null and payout.inviter_reward > 0 then
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
        or referral.gross_amount <> payout.amount
        or referral.reward_amount <> payout.inviter_reward then
        raise exception 'existing referral credit does not match arbitration payout';
      end if;
    end if;
  end if;

  update public.escrow_contracts
    set status = expected_contract_status,
        next_action = null,
        release_date = case when expected_decision = 'release' then now() else release_date end,
        updated_at = now()
    where id = c.id;
  return query select 'confirmed'::text, c.id;
end;
$$;

revoke all on function public.prepare_arbitration_payout(uuid, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.prepare_arbitration_payout(uuid, text, text, text, text, text)
  to service_role;
revoke all on function public.settle_confirmed_arbitration_payout(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.settle_confirmed_arbitration_payout(uuid, text, text)
  to service_role;

notify pgrst, 'reload schema';