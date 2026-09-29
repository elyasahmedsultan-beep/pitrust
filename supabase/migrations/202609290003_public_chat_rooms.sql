create table if not exists public.public_chat_rooms (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 2 and 60),
  language_code text not null check (language_code in ('en', 'ar', 'zh-CN', 'id', 'vi')),
  active boolean not null default true,
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint public_chat_rooms_language_unique unique (language_code)
);

create table if not exists public.public_chat_room_moderators (
  room_id uuid not null references public.public_chat_rooms(id) on delete cascade,
  user_id text not null,
  assigned_by text not null,
  assigned_at timestamptz not null default now(),
  primary key (room_id, user_id)
);

create table if not exists public.public_chat_messages (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.public_chat_rooms(id) on delete cascade,
  sender_user_id text not null,
  sender_name text not null check (char_length(btrim(sender_name)) between 1 and 100),
  content text,
  source_language text not null check (source_language in ('en', 'ar', 'zh-CN', 'id', 'vi')),
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by text,
  constraint public_chat_messages_content_length
    check (content is null or char_length(content) between 1 and 2000),
  constraint public_chat_messages_deletion_state
    check ((content is null and deleted_at is not null) or (content is not null and deleted_at is null))
);

create table if not exists public.public_chat_message_translations (
  message_id uuid not null references public.public_chat_messages(id) on delete cascade,
  target_language text not null check (target_language in ('en', 'ar', 'zh-CN', 'id', 'vi')),
  translated_text text not null check (char_length(btrim(translated_text)) between 1 and 6000),
  created_at timestamptz not null default now(),
  primary key (message_id, target_language)
);

create index if not exists public_chat_messages_room_poll_idx on public.public_chat_messages (room_id, created_at desc, id desc) where deleted_at is null;
create index if not exists public_chat_moderators_user_idx
  on public.public_chat_room_moderators (user_id, room_id);
create index if not exists public_chat_rooms_active_language_idx
  on public.public_chat_rooms (language_code, id)
  where active;

alter table public.public_chat_rooms enable row level security;
alter table public.public_chat_room_moderators enable row level security;
alter table public.public_chat_messages enable row level security;
alter table public.public_chat_message_translations enable row level security;

revoke all on table public.public_chat_rooms from public, anon, authenticated;
revoke all on table public.public_chat_room_moderators from public, anon, authenticated;
revoke all on table public.public_chat_messages from public, anon, authenticated;
revoke all on table public.public_chat_message_translations from public, anon, authenticated;

grant select, insert, update, delete on table public.public_chat_rooms to service_role;
grant select, insert, update, delete on table public.public_chat_room_moderators to service_role;
grant select, insert, update, delete on table public.public_chat_messages to service_role;
grant select, insert, update, delete on table public.public_chat_message_translations to service_role;

drop policy if exists public_chat_rooms_service_access on public.public_chat_rooms;
create policy public_chat_rooms_service_access on public.public_chat_rooms
  for all to service_role using (true) with check (true);
drop policy if exists public_chat_moderators_service_access on public.public_chat_room_moderators;
create policy public_chat_moderators_service_access on public.public_chat_room_moderators
  for all to service_role using (true) with check (true);
drop policy if exists public_chat_messages_service_access on public.public_chat_messages;
create policy public_chat_messages_service_access on public.public_chat_messages
  for all to service_role using (true) with check (true);
drop policy if exists public_chat_translations_service_access on public.public_chat_message_translations;
create policy public_chat_translations_service_access on public.public_chat_message_translations
  for all to service_role using (true) with check (true);