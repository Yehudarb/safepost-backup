-- Revert Migration 0005.
begin;
drop index if exists public.idx_workspaces_is_demo;
alter table public.workspaces drop column if exists is_demo;
commit;
