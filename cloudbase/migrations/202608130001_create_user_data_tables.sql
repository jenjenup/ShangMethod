-- ShangMethod user-owned data infrastructure for CloudBase PostgreSQL.
--
-- This migration targets a new CloudBase PostgreSQL environment. It is kept
-- separate from the original Supabase migrations so the two implementations
-- can be reviewed and rolled back independently.
--
-- Prerequisites to verify in the real CloudBase environment before execution:
--   1. auth.users exists and auth.users.id is bigint, as verified in the
--      target CloudBase PostgreSQL environment.
--   2. auth.uid() exists and returns the current JWT subject as text. The
--      target environment uses numeric subjects, so RLS explicitly casts the
--      value to bigint before comparing it with business ownership columns.
--   3. database roles anon and authenticated exist.
--   4. gen_random_uuid() is available. This is used only for the independent
--      vocabulary_entries.id primary key, not for CloudBase user IDs.
--
-- Public course content remains in public/lessons and is not represented here.

create table public.profiles (
  id bigint primary key references auth.users (id) on delete cascade,
  display_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.vocabulary_entries (
  id uuid primary key default gen_random_uuid(),
  user_id bigint not null references auth.users (id) on delete cascade,
  lesson_id text not null,
  lesson_title text,
  word text not null,
  normalized_word text not null,
  meaning text,
  example text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint vocabulary_entries_user_lesson_word_key
    unique (user_id, lesson_id, normalized_word)
);

create table public.learning_records (
  user_id bigint not null references auth.users (id) on delete cascade,
  lesson_id text not null,
  lesson_title text,
  status text not null default 'in-progress',
  last_studied_at timestamptz,
  recitation_completed boolean not null default false,
  proficiency text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, lesson_id),
  constraint learning_records_status_check
    check (status in ('in-progress', 'completed'))
);

create table public.dictation_drafts (
  user_id bigint not null references auth.users (id) on delete cascade,
  lesson_id text not null,
  content text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, lesson_id)
);

create table public.user_sync_state (
  user_id bigint primary key references auth.users (id) on delete cascade,
  schema_version integer not null default 1,
  local_import_completed_at timestamptz,
  learning_records_import_completed_at timestamptz,
  dictation_import_completed_at timestamptz,
  last_sync_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on column public.user_sync_state.local_import_completed_at is
  'When this user completed the one-time local vocabulary import.';

comment on column public.user_sync_state.learning_records_import_completed_at is
  'When this user completed the one-time local learning-record import.';

comment on column public.user_sync_state.dictation_import_completed_at is
  'When this user completed the one-time local dictation-draft import.';

-- Keep updated_at reliable for later conflict resolution and multi-device sync.
create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

create trigger vocabulary_entries_set_updated_at
before update on public.vocabulary_entries
for each row execute function public.set_updated_at();

create trigger learning_records_set_updated_at
before update on public.learning_records
for each row execute function public.set_updated_at();

create trigger dictation_drafts_set_updated_at
before update on public.dictation_drafts
for each row execute function public.set_updated_at();

create trigger user_sync_state_set_updated_at
before update on public.user_sync_state
for each row execute function public.set_updated_at();

alter table public.profiles enable row level security;
alter table public.vocabulary_entries enable row level security;
alter table public.learning_records enable row level security;
alter table public.dictation_drafts enable row level security;
alter table public.user_sync_state enable row level security;

-- Anonymous visitors do not need database access. Course files remain public.
revoke all on table public.profiles from anon;
revoke all on table public.vocabulary_entries from anon;
revoke all on table public.learning_records from anon;
revoke all on table public.dictation_drafts from anon;
revoke all on table public.user_sync_state from anon;

grant select, insert, update, delete on table public.profiles to authenticated;
grant select, insert, update, delete on table public.vocabulary_entries to authenticated;
grant select, insert, update, delete on table public.learning_records to authenticated;
grant select, insert, update, delete on table public.dictation_drafts to authenticated;
grant select, insert, update, delete on table public.user_sync_state to authenticated;

-- profiles: the row id is the authenticated CloudBase user's JWT subject.
create policy "profiles_select_own"
on public.profiles
for select
to authenticated
using ((select auth.uid())::bigint = id);

create policy "profiles_insert_own"
on public.profiles
for insert
to authenticated
with check ((select auth.uid())::bigint = id);

create policy "profiles_update_own"
on public.profiles
for update
to authenticated
using ((select auth.uid())::bigint = id)
with check ((select auth.uid())::bigint = id);

create policy "profiles_delete_own"
on public.profiles
for delete
to authenticated
using ((select auth.uid())::bigint = id);

-- vocabulary_entries: users can only operate on rows they own.
create policy "vocabulary_entries_select_own"
on public.vocabulary_entries
for select
to authenticated
using ((select auth.uid())::bigint = user_id);

create policy "vocabulary_entries_insert_own"
on public.vocabulary_entries
for insert
to authenticated
with check ((select auth.uid())::bigint = user_id);

create policy "vocabulary_entries_update_own"
on public.vocabulary_entries
for update
to authenticated
using ((select auth.uid())::bigint = user_id)
with check ((select auth.uid())::bigint = user_id);

create policy "vocabulary_entries_delete_own"
on public.vocabulary_entries
for delete
to authenticated
using ((select auth.uid())::bigint = user_id);

-- learning_records: users can only operate on rows they own.
create policy "learning_records_select_own"
on public.learning_records
for select
to authenticated
using ((select auth.uid())::bigint = user_id);

create policy "learning_records_insert_own"
on public.learning_records
for insert
to authenticated
with check ((select auth.uid())::bigint = user_id);

create policy "learning_records_update_own"
on public.learning_records
for update
to authenticated
using ((select auth.uid())::bigint = user_id)
with check ((select auth.uid())::bigint = user_id);

create policy "learning_records_delete_own"
on public.learning_records
for delete
to authenticated
using ((select auth.uid())::bigint = user_id);

-- dictation_drafts: users can only operate on rows they own.
create policy "dictation_drafts_select_own"
on public.dictation_drafts
for select
to authenticated
using ((select auth.uid())::bigint = user_id);

create policy "dictation_drafts_insert_own"
on public.dictation_drafts
for insert
to authenticated
with check ((select auth.uid())::bigint = user_id);

create policy "dictation_drafts_update_own"
on public.dictation_drafts
for update
to authenticated
using ((select auth.uid())::bigint = user_id)
with check ((select auth.uid())::bigint = user_id);

create policy "dictation_drafts_delete_own"
on public.dictation_drafts
for delete
to authenticated
using ((select auth.uid())::bigint = user_id);

-- user_sync_state: users can only operate on their own sync marker.
create policy "user_sync_state_select_own"
on public.user_sync_state
for select
to authenticated
using ((select auth.uid())::bigint = user_id);

create policy "user_sync_state_insert_own"
on public.user_sync_state
for insert
to authenticated
with check ((select auth.uid())::bigint = user_id);

create policy "user_sync_state_update_own"
on public.user_sync_state
for update
to authenticated
using ((select auth.uid())::bigint = user_id)
with check ((select auth.uid())::bigint = user_id);

create policy "user_sync_state_delete_own"
on public.user_sync_state
for delete
to authenticated
using ((select auth.uid())::bigint = user_id);
