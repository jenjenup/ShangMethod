-- Keep user data attached to the stable lesson id while recording which
-- transcript version was active when the data was last synchronized.
-- NULL remains valid for legacy or externally removed lessons.

alter table public.vocabulary_entries
  add column if not exists transcript_version integer;

alter table public.learning_records
  add column if not exists transcript_version integer;

alter table public.dictation_drafts
  add column if not exists transcript_version integer;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'vocabulary_entries_transcript_version_check'
      and conrelid = 'public.vocabulary_entries'::regclass
  ) then
    alter table public.vocabulary_entries
      add constraint vocabulary_entries_transcript_version_check
      check (transcript_version is null or transcript_version >= 1);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'learning_records_transcript_version_check'
      and conrelid = 'public.learning_records'::regclass
  ) then
    alter table public.learning_records
      add constraint learning_records_transcript_version_check
      check (transcript_version is null or transcript_version >= 1);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'dictation_drafts_transcript_version_check'
      and conrelid = 'public.dictation_drafts'::regclass
  ) then
    alter table public.dictation_drafts
      add constraint dictation_drafts_transcript_version_check
      check (transcript_version is null or transcript_version >= 1);
  end if;
end
$$;

comment on column public.vocabulary_entries.transcript_version is
  'Manifest transcript version active when this vocabulary entry was synchronized.';
comment on column public.learning_records.transcript_version is
  'Manifest transcript version active when this learning record was synchronized.';
comment on column public.dictation_drafts.transcript_version is
  'Manifest transcript version active when this dictation draft was synchronized.';
