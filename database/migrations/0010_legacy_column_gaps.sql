-- Migration 0010: fill column gaps left on PRE-EXISTING business tables.
--
-- ROOT CAUSE
-- ----------
-- 0000_base_schema.sql creates the business tables with CREATE TABLE IF NOT
-- EXISTS. On a database that already had `posts`/`groups` (every real
-- environment — dev clones and production alike), those CREATEs are skipped
-- entirely, so any column 0000 declares but the legacy table lacks is NEVER
-- added. 0000's own header claims it "only fills gaps", but IF NOT EXISTS
-- operates at table granularity, not column granularity.
--
-- IMPACT (found on the QA project, 2026-08-31)
-- - `posts.media_paths` was missing. Every task insert in server/index.cjs
--   sends media_paths, so ALL post creation failed against such a database.
-- - `groups.created_at` was missing, while 0000 declares it not-null.
--
-- Idempotent and safe to re-run. Existing groups rows get the migration
-- timestamp as their created_at (the original creation time is unrecoverable).

begin;

alter table public.posts  add column if not exists media_paths jsonb;
alter table public.groups add column if not exists created_at timestamptz not null default now();

commit;
