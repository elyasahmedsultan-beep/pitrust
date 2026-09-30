-- Restore the arbitration settlement checks after the Testnet wallet migration
-- replaced the shared contract-status guard. Keep wallet funding/release valid.
begin;

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
    (old.status = 'disputed' and new.status in ('completed', 'refunded'))
  ) then
    raise exception 'invalid escrow status transition: % -> %', old.status, new.status;
  end if;

  if new.status = 'funded' and not (
    exists (
      select 1
      from public.escrow_payment_ledger payment
      where payment.contract_id = new.id
        and payment.user_id = new.buyer_id
        and payment.amount = new.amount
        and payment.status = 'confirmed'
        and payment.fee_type is null
    ) or exists (
      select 1
      from public.testnet_wallet_transactions wallet
      where wallet.contract_id = new.id
        and wallet.user_id = new.buyer_id
        and wallet.amount = new.amount
        and wallet.direction = 'debit'
        and wallet.transaction_type = 'escrow_funding'
        and wallet.status = 'completed'
    )
  ) then
    raise exception 'funded status requires confirmed Pi payment or Testnet wallet funding';
  end if;

  if new.status = 'in_delivery' and not exists (
    select 1
    from public.escrow_delivery_evidence evidence
    where evidence.contract_id = new.id
      and evidence.submitter_id = new.seller_id
  ) then
    raise exception 'delivery status requires validated seller delivery evidence';
  end if;

  if new.status = 'disputed' and not exists (
    select 1
    from public.disputes dispute
    where dispute.contract_id = new.id
      and dispute.status = 'open'
  ) then
    raise exception 'disputed status requires an open dispute';
  end if;

  if old.status = 'in_delivery' and new.status = 'completed' and not (
    exists (
      select 1
      from public.escrow_payout_intents payout
      where payout.contract_id = new.id
        and payout.purpose = 'standard_release'
        and payout.status = 'confirmed'
        and nullif(payout.txid, '') is not null
    ) or exists (
      select 1
      from public.testnet_wallet_transactions wallet
      where wallet.contract_id = new.id
        and wallet.user_id = new.seller_id
        and wallet.amount = new.amount
        and wallet.direction = 'credit'
        and wallet.transaction_type = 'escrow_release'
        and wallet.status = 'completed'
    )
  ) then
    raise exception 'completed status requires a confirmed Pi payout or Testnet wallet release';
  end if;

  if old.status = 'disputed'
    and new.status in ('completed', 'refunded')
    and not exists (
      select 1
      from public.escrow_payout_intents payout
      join public.disputes dispute on dispute.id = payout.dispute_id
      where payout.contract_id = new.id
        and payout.purpose = case
          when new.status = 'completed' then 'arbitration_release'
          else 'arbitration_refund'
        end
        and payout.status = 'confirmed'
        and nullif(payout.txid, '') is not null
        and dispute.contract_id = new.id
        and dispute.status = 'resolved'
        and dispute.decision = case
          when new.status = 'completed' then 'release'
          else 'refund'
        end
        and dispute.decided_by = payout.arbitrator_id
        and dispute.decided_at is not null
    )
  then
    raise exception 'arbitration status requires a matching confirmed payout and resolved decision';
  end if;

  return new;
end;
$$;

commit;