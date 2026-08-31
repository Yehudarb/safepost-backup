-- Migration 0011: close the direct-Supabase isolation holes left open after 0004.
--
-- ROOT CAUSE 1 — legacy blanket policies survive 0004
-- ---------------------------------------------------
-- Postgres combines PERMISSIVE policies with OR. 0004 ADDS `p_<table>_member`
-- policies but never removes the pre-auth ones, and those pre-auth policies are
-- `USING (true)` for the anon role (e.g. "Allow anon select on posts",
-- "Allow all access to post_templates", "Public access" on group_sets). The OR
-- means the permissive legacy policy wins: ANY holder of the anon key — which
-- ships inside the frontend bundle and is therefore public — could read, edit
-- and delete EVERY workspace's posts and groups by talking to PostgREST
-- directly and bypassing the backend entirely. Workspace isolation held only in
-- the backend, not in the database.
--
-- Policy names are NOT stable across environments (same trap as the FK name in
-- 0008), so this drops by rule instead of by name: on the workspace-scoped
-- tables, every policy EXCEPT the `p_%_member` / `p_profiles_self` /
-- `p_members_self` / `p_workspaces_member` set is removed.
--
-- ROOT CAUSE 2 — 0006 tables never got RLS
-- ----------------------------------------
-- 0004 ran before 0006, so `pairing_codes` and `browser_workers` were created
-- with RLS DISABLED while anon/authenticated hold full table grants. A pairing
-- code is a bearer credential: reading someone else's code lets an attacker
-- pair their own extension into that workspace and claim its jobs. Also exposed
-- `device_token_hash` and allowed deleting other people's workers.
--
-- `app_config` is written only by the backend (service_role, which bypasses
-- RLS), so it is locked with RLS enabled and no policy at all.
--
-- NOT TOUCHED (legacy, outside the workspace model — reported, not changed):
-- campaign_templates, group_presets, system_settings still carry public
-- USING (true) policies.

begin;

-- ---------- 1. strip non-workspace policies off scoped tables ----------
do $$
declare p record;
begin
  for p in
    select tablename, policyname
      from pg_policies
     where schemaname = 'public'
       and tablename in ('posts','groups','post_templates','group_sets','system_logs',
                         'profiles','workspaces','workspace_members')
       and policyname not in ('p_posts_member','p_groups_member','p_post_templates_member',
                              'p_group_sets_member','p_system_logs_member',
                              'p_profiles_self','p_workspaces_member','p_members_self')
  loop
    raise notice 'dropping legacy policy %.%', p.tablename, p.policyname;
    execute format('drop policy %I on public.%I;', p.policyname, p.tablename);
  end loop;
end
$$;

-- ---------- 2. RLS on the pairing / worker tables ----------
alter table public.pairing_codes   enable row level security;
alter table public.browser_workers enable row level security;

drop policy if exists p_pairing_codes_member on public.pairing_codes;
create policy p_pairing_codes_member on public.pairing_codes
  for all using (public.is_workspace_member(workspace_id))
       with check (public.is_workspace_member(workspace_id));

drop policy if exists p_browser_workers_member on public.browser_workers;
create policy p_browser_workers_member on public.browser_workers
  for all using (public.is_workspace_member(workspace_id))
       with check (public.is_workspace_member(workspace_id));

-- ---------- 3. app_config: backend-only ----------
alter table public.app_config enable row level security;

commit;
