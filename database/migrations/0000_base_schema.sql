-- Phase 3 prerequisite — Migration 0000: base business tables.
--
-- Idempotent (CREATE TABLE IF NOT EXISTS): on a DB that already has some of
-- these (e.g. posts/groups), the existing tables are left untouched and only
-- the MISSING ones are created. This lets a partial dev project be brought up
-- to the full schema before the auth migrations (0001+) run.
--
-- Columns are inferred from the application's queries. Existing tables keep
-- their real definitions; this only fills gaps (e.g. system_logs, app_config).

begin;

create extension if not exists "pgcrypto";

-- Facebook groups
create table if not exists public.groups (
  id            text primary key,
  name          text,
  url           text,
  facebook_user text,
  created_at    timestamptz not null default now()
);

-- Posts / scheduled tasks
create table if not exists public.posts (
  id             bigint generated always as identity primary key,
  group_id       text references public.groups(id) on delete set null,
  content        text,
  media_url      text,
  media_paths    jsonb,
  status         text not null default 'PENDING',
  scheduled_time timestamptz,
  ended_at       timestamptz,
  failure_reason text,
  proof_url      text,
  app_source     text default 'backup',
  facebook_user  text,
  created_at     timestamptz not null default now()
);

-- Post templates
create table if not exists public.post_templates (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  content    text,
  media_url  text,
  app_source text default 'backup',
  created_at timestamptz not null default now()
);

-- Group sets (folders)
create table if not exists public.group_sets (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  group_ids  jsonb,
  created_at timestamptz not null default now()
);

-- System logs
create table if not exists public.system_logs (
  id         bigint generated always as identity primary key,
  log_level  text,
  source     text,
  message    text,
  created_at timestamptz not null default now()
);

-- App config (dynamic extension selectors, etc.)
create table if not exists public.app_config (
  config_key  text primary key,
  config_data jsonb,
  updated_at  timestamptz not null default now()
);

commit;
