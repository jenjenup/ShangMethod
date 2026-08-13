-- Track learning-record import independently from vocabulary import.
alter table public.user_sync_state
add column learning_records_import_completed_at timestamptz;

comment on column public.user_sync_state.learning_records_import_completed_at is
  'When this user completed the one-time local learning-record import.';
