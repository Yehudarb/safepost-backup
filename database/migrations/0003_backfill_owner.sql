-- Phase 3 — Migration 0003: Backfill existing data to the ORIGINAL OWNER.
--
-- Prerequisite: the original owner must already exist as a Supabase auth user
-- (register through the app, or create in the Supabase dashboard). The trigger
-- from 0001 will have given them a personal workspace; this migration instead
-- creates a dedicated "Original Owner" workspace and assigns ALL pre-existing
-- rows (workspace_id IS NULL) to it.
--
-- >>> EDIT THIS before running: set the owner's email. <<<

begin;

do $$
declare
  v_owner_email text := 'CHANGE_ME@example.com';   -- <<< EDIT
  v_owner_id    uuid;
  v_ws_id       uuid;
begin
  select id into v_owner_id from auth.users where email = v_owner_email;
  if v_owner_id is null then
    raise exception 'Owner user % not found in auth.users. Create the account first.', v_owner_email;
  end if;

  -- Reuse an existing "Original Owner" workspace or create one.
  select id into v_ws_id
    from public.workspaces
   where created_by = v_owner_id and name = 'Original Owner'
   limit 1;

  if v_ws_id is null then
    insert into public.workspaces (name, is_personal, created_by)
    values ('Original Owner', false, v_owner_id)
    returning id into v_ws_id;
  end if;

  -- Ensure the owner is a member with the owner role.
  insert into public.workspace_members (workspace_id, user_id, role)
  values (v_ws_id, v_owner_id, 'owner')
  on conflict (workspace_id, user_id) do update set role = 'owner';

  -- Assign every pre-existing (unscoped) row to the owner workspace.
  update public.posts          set workspace_id = v_ws_id, created_by = coalesce(created_by, v_owner_id) where workspace_id is null;
  update public.groups         set workspace_id = v_ws_id, created_by = coalesce(created_by, v_owner_id) where workspace_id is null;
  update public.post_templates set workspace_id = v_ws_id, created_by = coalesce(created_by, v_owner_id) where workspace_id is null;
  update public.group_sets     set workspace_id = v_ws_id, created_by = coalesce(created_by, v_owner_id) where workspace_id is null;
  update public.system_logs    set workspace_id = v_ws_id where workspace_id is null;

  raise notice 'Backfill complete. Owner workspace %', v_ws_id;
end
$$;

commit;
