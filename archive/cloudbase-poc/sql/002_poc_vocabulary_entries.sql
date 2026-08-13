-- Isolated vocabulary-like table for CloudBase RDB and RLS verification.
-- This table is not used by ShangMethod and can be removed after the PoC.

create table public.poc_vocabulary_entries (
  id uuid primary key default gen_random_uuid(),
  user_id bigint not null references auth.users (id) on delete cascade,
  lesson_id text not null,
  normalized_word text not null,
  meaning text,
  write_count integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint poc_vocabulary_entries_owner_lesson_word_key
    unique (user_id, lesson_id, normalized_word)
);

create trigger poc_vocabulary_entries_set_updated_at
before update on public.poc_vocabulary_entries
for each row execute function public.set_updated_at();

alter table public.poc_vocabulary_entries enable row level security;

revoke all on table public.poc_vocabulary_entries from anon;
grant select, insert, update, delete
on table public.poc_vocabulary_entries
to authenticated;

create policy "poc_vocabulary_entries_select_own"
on public.poc_vocabulary_entries
for select
to authenticated
using ((select auth.uid())::bigint = user_id);

create policy "poc_vocabulary_entries_insert_own"
on public.poc_vocabulary_entries
for insert
to authenticated
with check ((select auth.uid())::bigint = user_id);

create policy "poc_vocabulary_entries_update_own"
on public.poc_vocabulary_entries
for update
to authenticated
using ((select auth.uid())::bigint = user_id)
with check ((select auth.uid())::bigint = user_id);

create policy "poc_vocabulary_entries_delete_own"
on public.poc_vocabulary_entries
for delete
to authenticated
using ((select auth.uid())::bigint = user_id);
