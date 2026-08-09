-- Phase 4 — Migration 0005: mark demo workspaces.
-- A demo workspace holds synthetic data only and can never trigger real
-- publishing (enforced in the backend + demo posts use app_source='demo',
-- which the worker's jobs/next never claims).

begin;

alter table public.workspaces add column if not exists is_demo boolean not null default false;
create index if not exists idx_workspaces_is_demo on public.workspaces(is_demo) where is_demo;

commit;
