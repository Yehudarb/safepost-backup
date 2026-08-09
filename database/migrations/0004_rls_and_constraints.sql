-- Phase 3 — Migration 0004: RLS isolation policies + NOT NULL constraints.
--
-- Run AFTER 0003 backfill succeeds. RLS is defense-in-depth: the backend uses
-- the service_role key (which bypasses RLS) and is the primary isolation layer,
-- but these policies protect against any direct anon/authenticated access.

begin;

-- Membership check helper (security definer to read membership under RLS).
create or replace function public.is_workspace_member(ws uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.workspace_members m
    where m.workspace_id = ws and m.user_id = auth.uid()
  );
$$;

-- ---------- enable RLS ----------
alter table public.profiles          enable row level security;
alter table public.workspaces        enable row level security;
alter table public.workspace_members enable row level security;
alter table public.posts             enable row level security;
alter table public.groups            enable row level security;
alter table public.post_templates    enable row level security;
alter table public.group_sets        enable row level security;
alter table public.system_logs       enable row level security;

-- ---------- profiles ----------
drop policy if exists p_profiles_self on public.profiles;
create policy p_profiles_self on public.profiles
  for all using (id = auth.uid()) with check (id = auth.uid());

-- ---------- workspaces ----------
drop policy if exists p_workspaces_member on public.workspaces;
create policy p_workspaces_member on public.workspaces
  for select using (public.is_workspace_member(id));

-- ---------- workspace_members ----------
drop policy if exists p_members_self on public.workspace_members;
create policy p_members_self on public.workspace_members
  for select using (public.is_workspace_member(workspace_id));

-- ---------- business tables: members only ----------
do $$
declare t text;
begin
  foreach t in array array['posts','groups','post_templates','group_sets','system_logs']
  loop
    execute format('drop policy if exists p_%1$s_member on public.%1$s;', t);
    execute format(
      'create policy p_%1$s_member on public.%1$s for all
         using (public.is_workspace_member(workspace_id))
         with check (public.is_workspace_member(workspace_id));', t);
  end loop;
end
$$;

-- ---------- lock down columns now that data is backfilled ----------
alter table public.posts          alter column workspace_id set not null;
alter table public.groups         alter column workspace_id set not null;
alter table public.post_templates alter column workspace_id set not null;
alter table public.group_sets     alter column workspace_id set not null;
-- system_logs.workspace_id stays nullable (system-level logs may be unscoped).

commit;
