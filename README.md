# ShangMethod

ShangMethod is an English intensive-listening learning app. A learner chooses
a lesson, completes repeated dictation, compares the result with the original
transcript, and finishes with a recitation exercise.

The current learning flow includes:

1. Choose a lesson by audio duration.
2. Listen repeatedly and save a dictation draft.
3. Compare the draft with sentence-level English, translation, dictionary and
   vocabulary tools.
4. Practice recitation with the source audio and a browser recording.

Guests keep their learning data in the browser. Signed-in users can import and
sync vocabulary entries, learning records and dictation drafts through
CloudBase PostgreSQL.

## Technology

- Next.js 16 App Router
- React 19 and TypeScript
- Tencent CloudBase Web Auth
- Tencent CloudBase PostgreSQL with Row Level Security
- Browser `localStorage` for guest-first persistence
- Static lesson manifests, transcripts and dictionary files under `public/`
- Python course-import and sentence-alignment tools under
  `scripts/course-import/`

## Local development

Requirements:

- Node.js compatible with the Next.js version declared in `package.json`
- npm

Install dependencies:

```bash
npm install
```

Copy the environment variable template and fill in the CloudBase environment
used for local development:

```bash
cp .env.example .env.local
```

Start the development server:

```bash
npm run dev
```

Open `http://localhost:3000`.

## Environment variables

The main web app uses these browser-visible build-time variables:

```env
NEXT_PUBLIC_CLOUDBASE_ENV_ID=
NEXT_PUBLIC_CLOUDBASE_REGION=
```

- `NEXT_PUBLIC_CLOUDBASE_ENV_ID`: CloudBase environment ID.
- `NEXT_PUBLIC_CLOUDBASE_REGION`: region matching that environment, currently
  expected to be a CloudBase region such as `ap-shanghai`.

Do not commit `.env.local` or other files containing environment-specific
values. Variables prefixed with `NEXT_PUBLIC_` are included in the browser
bundle and must be configured before `next build` runs.

The optional course importer uses a separate local-only variable:

```env
SHANGMETHOD_SOURCE_ROOT=
```

It points to the directory containing the expected PDF and MP3 source
subdirectories. Importer commands also accept `--source-root`, which overrides
the environment variable. See `scripts/course-import/README.md` for details.

## CloudBase

The browser client is initialized in `lib/cloudbase/client.ts`. Authentication
and user-owned data access use the current CloudBase user session; no admin
secret is included in the web app.

The PostgreSQL schema is defined in:

```text
cloudbase/migrations/202608130001_create_user_data_tables.sql
```

It defines the following user-owned tables:

- `profiles`
- `vocabulary_entries`
- `learning_records`
- `dictation_drafts`
- `user_sync_state`

The migration enables RLS and applies ownership policies based on the current
CloudBase identity. Apply and verify the migration in the target CloudBase
PostgreSQL environment before using account sync.

For a deployed Web app, add every production or preview host that needs SDK
access to the CloudBase Web security-source list. Keep the configured region
consistent with the selected CloudBase environment.

## Production checks

Run the available checks before deployment:

```bash
npx tsc --noEmit
npm run lint
npm run build
```

The repository currently stores lesson metadata and transcripts in
`public/lessons`. Audio delivery and licensing must be reviewed separately
before a public production release; large media is better maintained in
object storage/CDN than in normal Git history.

## Project documentation

- `docs/project-status.md`: current architecture, completed work, risks and
  deployment status.
- `docs/cloudbase-e2e-test.md`: CloudBase end-to-end acceptance checklist.
- `scripts/course-import/README.md`: local lesson import and alignment tools.
- `THIRD_PARTY_NOTICES.md`: third-party data notices.
