-- Phase 5 — Migration 0006: browser workers + pairing codes.
-- Each Chrome extension install pairs to exactly one workspace via a
-- short-lived single-use code, then authenticates with a scoped device token
-- (only the token HASH is stored server-side).

begin;

-- Pairing codes: random, short-lived, single-use, scoped to one workspace.
create table if not exists public.pairing_codes (
  id           uuid primary key default gen_random_uuid(),
  code         text not null unique,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  expires_at   timestamptz not null,
  used_at      timestamptz,
  created_at   timestamptz not null default now()
);
create index if not exists idx_pairing_codes_code on public.pairing_codes(code);

-- Browser workers: one paired extension installation.
create table if not exists public.browser_workers (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null references public.workspaces(id) on delete cascade,
  user_id           uuid references auth.users(id) on delete set null,
  worker_name       text not null default 'Chrome Extension',
  device_token_hash text not null,
  extension_version text,
  browser_version   text,
  status            text not null default 'offline',
  last_seen_at      timestamptz,
  current_job_id    bigint,
  revoked_at        timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists idx_browser_workers_workspace on public.browser_workers(workspace_id);
create index if not exists idx_browser_workers_token      on public.browser_workers(device_token_hash);

drop trigger if exists trg_browser_workers_updated_at on public.browser_workers;
create trigger trg_browser_workers_updated_at
  before update on public.browser_workers
  for each row execute function public.set_updated_at();

commit;
