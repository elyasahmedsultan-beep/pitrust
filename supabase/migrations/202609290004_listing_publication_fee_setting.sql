begin;

do $$
declare
  key_column text;
  value_column text;
  has_updated_at boolean;
begin
  if to_regclass('public.app_settings') is null then
    create table public.app_settings (
      "key" text primary key,
      "value" numeric not null,
      updated_at timestamptz not null default now()
    );
    insert into public.app_settings ("key", "value")
    values ('listing_ad_fee_pi', 1);
    return;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'app_settings' and column_name = 'key'
  ) and exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'app_settings' and column_name = 'value'
  ) then
    key_column := 'key';
    value_column := 'value';
  elsif exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'app_settings' and column_name = 'setting_key'
  ) and exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'app_settings' and column_name = 'setting_value'
  ) then
    key_column := 'setting_key';
    value_column := 'setting_value';
  elsif exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'app_settings' and column_name = 'setting_name'
  ) and exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'app_settings' and column_name = 'setting_value'
  ) then
    key_column := 'setting_name';
    value_column := 'setting_value';
  elsif exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'app_settings' and column_name = 'name'
  ) and exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'app_settings' and column_name = 'value'
  ) then
    key_column := 'name';
    value_column := 'value';
  elsif exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'app_settings'
      and column_name = 'transaction_fee_percentage'
  ) and exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'app_settings'
      and column_name = 'dispute_resolution_fee_pi'
  ) then
    alter table public.app_settings
      add column if not exists listing_ad_fee_pi numeric;
    update public.app_settings
      set listing_ad_fee_pi = 1
      where listing_ad_fee_pi is null;
  else
    raise exception 'Unsupported app_settings layout; listing publication fee was not seeded';
  end if;

  if key_column is not null then
    select exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'app_settings'
        and column_name = 'updated_at'
    ) into has_updated_at;

    if has_updated_at then
      execute format(
        'insert into public.app_settings (%I, %I, updated_at) ' ||
        'select $1, $2, now() where not exists ' ||
        '(select 1 from public.app_settings where %I = $1)',
        key_column, value_column, key_column
      ) using 'listing_ad_fee_pi', 1;
    else
      execute format(
        'insert into public.app_settings (%I, %I) ' ||
        'select $1, $2 where not exists ' ||
        '(select 1 from public.app_settings where %I = $1)',
        key_column, value_column, key_column
      ) using 'listing_ad_fee_pi', 1;
    end if;
  end if;
end;
$$;

alter table public.app_settings enable row level security;
revoke all on table public.app_settings from public, anon, authenticated;
grant select, insert, update on table public.app_settings to service_role;

commit;