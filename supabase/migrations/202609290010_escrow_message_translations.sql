create table if not exists public.escrow_message_translations (
  message_id uuid not null references public.escrow_messages(id) on delete cascade,
  target_language text not null check (target_language in ('en', 'ar', 'zh-CN', 'id', 'vi')),
  source_language text not null check (source_language in ('en', 'ar', 'zh-CN', 'id', 'vi')),
  translated_text text check (
    translated_text is null or char_length(btrim(translated_text)) between 1 and 6000
  ),
  created_at timestamptz not null default now(),
  primary key (message_id, target_language)
);

create index if not exists escrow_message_translations_target_idx
  on public.escrow_message_translations (target_language, message_id);

alter table public.escrow_message_translations enable row level security;
revoke all on table public.escrow_message_translations from public, anon, authenticated;
grant select, insert, update, delete on table public.escrow_message_translations to service_role;

drop policy if exists escrow_message_translations_service_access
  on public.escrow_message_translations;
create policy escrow_message_translations_service_access
  on public.escrow_message_translations
  for all to service_role using (true) with check (true);