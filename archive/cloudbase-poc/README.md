# ShangMethod CloudBase Auth PoC

This is an isolated test application. It does not import, wrap, or replace the
ShangMethod Supabase authentication or synchronization implementation.

## Local configuration

Copy `.env.example` to `.env.local`. The PoC uses only the CloudBase environment
ID and region. It signs in explicitly with a test user account, so it does not
require a Publishable Key. Never place an API Key, SecretId, SecretKey, access
token, or refresh token in this directory.

## Database diagnostic

Run `sql/001_poc_identity_rpc.sql` in the CloudBase PostgreSQL SQL editor after
reviewing it. The function returns only the current authenticated user's ID.

Run `sql/002_poc_vocabulary_entries.sql` to create the isolated business-table
PoC. It uses a separate table and does not read or write ShangMethod's formal
`vocabulary_entries` table.

## Run

Install this subproject's dependencies, then run `npm run dev` from this
directory. Open `http://127.0.0.1:4173`.
