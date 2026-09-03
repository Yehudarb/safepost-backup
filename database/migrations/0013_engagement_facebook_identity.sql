-- Phase 1C.2: preserve the stable Facebook login-account id captured during
-- group sync so Engagement can refuse to scan with a different account.

begin;

alter table public.groups
  add column if not exists facebook_user_id text;

alter table public.engagement_scan_tasks
  add column if not exists facebook_user_id text;

create index if not exists idx_groups_workspace_facebook_user_id
  on public.groups (workspace_id, facebook_user_id)
  where facebook_user_id is not null;

commit;
