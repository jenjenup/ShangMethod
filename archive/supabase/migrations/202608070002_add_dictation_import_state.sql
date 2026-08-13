-- Track dictation-draft import independently from other local-data imports.
alter table public.user_sync_state
add column dictation_import_completed_at timestamptz;

comment on column public.user_sync_state.dictation_import_completed_at is
  'When this user completed the one-time local dictation-draft import.';
