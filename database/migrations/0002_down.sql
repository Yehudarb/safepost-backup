-- Revert Migration 0002. Drops workspace scoping columns + indexes.

begin;

drop index if exists public.idx_posts_workspace;
drop index if exists public.idx_groups_workspace;
drop index if exists public.idx_post_templates_workspace;
drop index if exists public.idx_group_sets_workspace;
drop index if exists public.idx_system_logs_workspace;

alter table public.posts          drop column if exists workspace_id;
alter table public.posts          drop column if exists created_by;
alter table public.groups         drop column if exists workspace_id;
alter table public.groups         drop column if exists created_by;
alter table public.post_templates drop column if exists workspace_id;
alter table public.post_templates drop column if exists created_by;
alter table public.group_sets     drop column if exists workspace_id;
alter table public.group_sets     drop column if exists created_by;
alter table public.system_logs    drop column if exists workspace_id;

commit;
