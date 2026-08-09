-- Revert Migration 0004. Removes RLS policies, NOT NULL constraints, helper.

begin;

alter table public.posts          alter column workspace_id drop not null;
alter table public.groups         alter column workspace_id drop not null;
alter table public.post_templates alter column workspace_id drop not null;
alter table public.group_sets     alter column workspace_id drop not null;

do $$
declare t text;
begin
  foreach t in array array['posts','groups','post_templates','group_sets','system_logs']
  loop
    execute format('drop policy if exists p_%1$s_member on public.%1$s;', t);
    execute format('alter table public.%1$s disable row level security;', t);
  end loop;
end
$$;

drop policy if exists p_members_self on public.workspace_members;
drop policy if exists p_workspaces_member on public.workspaces;
drop policy if exists p_profiles_self on public.profiles;

alter table public.workspace_members disable row level security;
alter table public.workspaces        disable row level security;
alter table public.profiles          disable row level security;

drop function if exists public.is_workspace_member(uuid);

commit;
