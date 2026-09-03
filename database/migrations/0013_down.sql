begin;

drop index if exists public.idx_groups_workspace_facebook_user_id;
alter table public.engagement_scan_tasks drop column if exists facebook_user_id;
alter table public.groups drop column if exists facebook_user_id;

commit;
