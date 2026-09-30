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
#variable_conflict use_column
declare
  audit public.escrow_monthly_badge_audits%rowtype;
begin
  if p_network is distinct from 'Pi Network'
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