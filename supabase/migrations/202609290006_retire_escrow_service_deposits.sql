-- Apply only after deploying code that no longer calls the deposit endpoints
-- and reconciling all open or approved Pi deposit payments.
-- Historical payment records are preserved under retired names for audit.
begin;

drop function if exists public.record_verified_escrow_service_deposit(
  uuid, text, text, text, text, text
);

do $$
begin
  if to_regclass('public.escrow_service_deposits') is not null then
    if to_regclass('public.escrow_service_deposits_retired') is not null then
      raise exception 'Both active and retired escrow deposit tables exist; reconcile them before retirement';
    end if;
    alter table public.escrow_service_deposits
      rename to escrow_service_deposits_retired;
  end if;

  if to_regclass('public.escrow_service_deposit_intents') is not null then
    if to_regclass('public.escrow_service_deposit_intents_retired') is not null then
      raise exception 'Both active and retired escrow deposit intent tables exist; reconcile them before retirement';
    end if;
    alter table public.escrow_service_deposit_intents
      rename to escrow_service_deposit_intents_retired;
  end if;

  if to_regclass('public.escrow_service_deposits_retired') is not null then
    revoke all on table public.escrow_service_deposits_retired
      from public, anon, authenticated, service_role;
    execute 'drop policy if exists escrow_service_deposits_service_access on public.escrow_service_deposits_retired';
  end if;

  if to_regclass('public.escrow_service_deposit_intents_retired') is not null then
    revoke all on table public.escrow_service_deposit_intents_retired
      from public, anon, authenticated, service_role;
    execute 'drop policy if exists escrow_service_deposit_intents_service_access on public.escrow_service_deposit_intents_retired';
  end if;
end;
$$;

commit;