-- Revert Migration 0001. Drops auth/workspace foundation.
-- WARNING: destroys all workspace/membership/profile data.

begin;

drop trigger if exists trg_on_auth_user_created on auth.users;
drop function if exists public.handle_new_user();

drop table if exists public.workspace_members cascade;
drop table if exists public.workspaces cascade;
drop table if exists public.profiles cascade;

drop type if exists public.workspace_role;
-- set_updated_at() is shared; leave it in place.

commit;
