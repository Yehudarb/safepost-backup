-- Phase 3 — Migration 0002: Add workspace scoping columns to business tables.
-- Non-destructive: adds nullable workspace_id + created_by (backfilled in 0003,
-- then made NOT NULL in 0004 after backfill succeeds).

begin;

-- posts (the main jobs/tasks table)
alter table public.posts            add column if not exists workspace_id uuid references public.workspaces(id) on delete cascade;
alter table public.posts            add column if not exists created_by   uuid references auth.users(id) on delete set null;

-- groups (Facebook groups)
alter table public.groups           add column if not exists workspace_id uuid references public.workspaces(id) on delete cascade;
alter table public.groups           add column if not exists created_by   uuid references auth.users(id) on delete set null;

-- post_templates
alter table public.post_templates   add column if not exists workspace_id uuid references public.workspaces(id) on delete cascade;
alter table public.post_templates   add column if not exists created_by   uuid references auth.users(id) on delete set null;

-- group_sets
alter table public.group_sets       add column if not exists workspace_id uuid references public.workspaces(id) on delete cascade;
alter table public.group_sets       add column if not exists created_by   uuid references auth.users(id) on delete set null;

-- system_logs
alter table public.system_logs      add column if not exists workspace_id uuid references public.workspaces(id) on delete cascade;

-- Indexes for workspace-scoped queries
create index if not exists idx_posts_workspace          on public.posts(workspace_id);
create index if not exists idx_groups_workspace         on public.groups(workspace_id);
create index if not exists idx_post_templates_workspace on public.post_templates(workspace_id);
create index if not exists idx_group_sets_workspace     on public.group_sets(workspace_id);
create index if not exists idx_system_logs_workspace    on public.system_logs(workspace_id);

commit;
