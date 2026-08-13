# ShangMethod course importer MVP

This importer converts the five approved PDF + MP3 pilot pairs into the
current ShangMethod transcript format. Source files are never modified.

## Setup

From the project root:

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r scripts/course-import/requirements.txt
```

The importer does not contain a machine-specific source path. Choose the
directory that contains the PDF and MP3 source subdirectories in one of these
ways:

```bash
# Environment variable used as the default by every importer command
export SHANGMETHOD_SOURCE_ROOT="/absolute/path/to/course-materials"

# Or override it for an individual command
.venv/bin/python scripts/course-import/run_pipeline.py \
  --source-root "/absolute/path/to/course-materials"
```

If neither is supplied, the default is `course-materials/` in the project
root. Raw source materials are local inputs and should not be committed.

## Dry run

```bash
.venv/bin/python scripts/course-import/run_pipeline.py
```

The dry run writes:

- inventory and matching reports to `scripts/course-import/reports/`
- extraction artifacts to `scripts/course-import/staging/{lesson-id}/`
- `extracted.json`
- `extracted_preview.txt`
- `debug-page-1.png` with the word-filter boundary marked in red
- `audio-analysis.json`
- `transcript.json`
- `validation.json`

The vocabulary strip is excluded by word coordinates, not removed from or
written back to the source PDF. Filtered samples remain in `pageDebug` for
manual inspection.

## Publish the pilot

After reviewing the staging output:

```bash
.venv/bin/python scripts/course-import/run_pipeline.py --publish
```

Publishing copies each accepted MP3 as `audio.mp3`, copies its transcript,
and regenerates `public/lessons/lessons.json` from every validated transcript.

Use `--lesson-id <id>` to process one pilot lesson. Existing published lesson
directories are protected unless `--replace` is explicitly supplied.

## Matching report

The full 100-PDF inventory is evaluated on every run. The report distinguishes
exact, fuzzy, review, and low-similarity pairs. The five pilot mappings are
locked in `pilot-lessons.json`; low-similarity matches are never inferred from
that report during publishing.

## Current limitations

- Only the supplied vertical bilingual layout is supported.
- PDFs must contain a text layer.
- The first release produces one whole-course segment.
- CID markers and suspicious characters are reported, not silently repaired.
- Vocabulary-column hints are informational and do not block publishing.

## Sentence alignment MVP

The independent alignment flow reads the published English transcript and
audio, but writes only to staging. It never overwrites a published transcript.

Run all three alignment pilots:

```bash
.venv/bin/python scripts/course-import/run_alignment.py --model small
```

Run one lesson:

```bash
.venv/bin/python scripts/course-import/run_alignment.py \
  --lesson-id ted-decluttering-001 \
  --model small
```

The cached Whisper output is reused by default. Pass `--force-transcribe` only
when the audio or Whisper settings change.

Each lesson writes:

```text
scripts/course-import/staging/{lesson-id}/alignment/
├── whisper-words.json
├── authoritative-sentences.json
├── alignment.json
├── alignment-report.json
└── alignment-preview.txt
```

The PDF-derived English remains authoritative. Whisper supplies word
timestamps only. Chinese text is neither split nor aligned. Low-confidence or
unmatched sentences remain explicit in the report; the alignment flow does not
invent timestamps or publish results automatically.

After manually reviewing an alignment, generate a separate test transcript:

```bash
.venv/bin/python scripts/course-import/merge_alignment.py \
  public/lessons/ted-decluttering-001/transcript.json \
  scripts/course-import/staging/ted-decluttering-001/alignment/alignment.json \
  public/lessons/ted-decluttering-001/transcript-v2.json
```

This command never overwrites the source transcript. The complete Chinese
translation stays at the top level; sentence-level `chinese` values remain
empty until a reviewed bilingual mapping exists.

## Publish management

`course-status.json` is the local approval source of truth. A lesson enters
`lessons.json` only when all three conditions are true:

- `importStatus` is `completed`
- `reviewStatus` is `approved`
- `published` is `true`

Version 2 lessons additionally need an alignment marked as `passed` to pass
the publishing validator.

Validate one lesson or every registered lesson:

```bash
.venv/bin/python scripts/course-import/validate_publish.py \
  ted-decluttering-001

.venv/bin/python scripts/course-import/validate_publish.py --all
```

Reports are written to:

```text
scripts/course-import/staging/{lesson-id}/publish-report.json
```

After reviewing the reports and updating `course-status.json`, regenerate the
public manifest:

```bash
.venv/bin/python scripts/course-import/generate_manifest.py
```

Lessons missing from the status file, pending review, rejected, or explicitly
unpublished are omitted from the manifest even if their files already exist.

## Batch transcript v2 generation

Generate v2 transcripts for every course whose `alignmentStatus` is `passed`:

```bash
.venv/bin/python scripts/course-import/batch_generate_v2.py
```

The batch command:

- preserves every original `transcript.json`
- skips an existing `transcript-v2.json`
- skips and reports a missing `alignment.json`
- writes sentence-level English with an empty `chinese` value
- changes only `transcriptVersion` to `2` after a successful generation
- never changes review approval or the published flag

The report is written to:

```text
scripts/course-import/staging/batch-v2-report.json
```

After the batch completes, run the publishing validator and regenerate the
manifest:

```bash
.venv/bin/python scripts/course-import/validate_publish.py --all
.venv/bin/python scripts/course-import/generate_manifest.py
```

## Batch alignment generation

Generate alignments for every course whose `alignmentStatus` is `pending`:

```bash
.venv/bin/python scripts/course-import/batch_generate_alignment.py
```

Limit a pilot run to selected courses by repeating `--lesson-id`:

```bash
.venv/bin/python scripts/course-import/batch_generate_alignment.py \
  --lesson-id ted-keep-goals-secret-001 \
  --lesson-id ted-muscle-growth-001
```

The batch command reuses cached Whisper words, skips an existing alignment,
continues after an individual course failure, and changes only
`alignmentStatus` from `pending` to `passed` after all publish-ready alignment
checks succeed. The report is written to:

```text
scripts/course-import/staging/batch-alignment-report.json
```

## Full source feasibility evaluation

Evaluate every source PDF/MP3 pair without creating or publishing lessons:

```bash
.venv/bin/python scripts/course-import/evaluate_full_import.py
```

The evaluation performs matching, temporary PDF extraction, text corruption
checks, audio metadata analysis, and a conservative alignment feasibility
prediction. It does not run Whisper for all source files and does not modify
course status or the manifest. The only persistent output is:

```text
scripts/course-import/staging/full-import-evaluation.json
```

## Ten-course production test

Run the fixed representative production pilot:

```bash
.venv/bin/python scripts/course-import/batch_production_test.py
```

Each course is extracted, aligned, merged to v2, and publish-validated in
isolation. A failure does not add course status or a manifest entry. A fully
validated course is copied atomically to `public/lessons`, registered as an
approved v2 course, and included the next time the manifest is generated.

The test report is written to:

```text
scripts/course-import/staging/batch-production-test-report.json
```
