-- Migration 0008: save the same Facebook group separately for each user.
--
-- ROOT CAUSE
-- ----------
-- `groups.id` (the Facebook group id) was the SOLE primary key. A group's id is
-- identical no matter which account is a member, so when a DIFFERENT facebook_user
-- synced a group that already existed, the upsert (onConflict=id) OVERWROTE the
-- single row and flipped its `facebook_user`. Net effect: every group could belong
-- to only ONE user at a time — syncing user B wiped user A's copy.
--
-- FIX
-- ---
-- Key groups by (workspace_id, facebook_user, id) so each user keeps their own
-- copy of a shared group. `facebook_user` becomes a concrete value ('' when
-- unknown) so it can take part in the key (Postgres treats NULLs as distinct,
-- which would defeat de-duplication).
--
-- PREREQUISITE FIX (added before first production run): the composite primary
-- key below includes workspace_id, which is a NOT NULL requirement of any
-- primary key. Migration 0002 only adds workspace_id as NULLABLE, and this
-- deployment deliberately does NOT run the full auth backfill chain
-- (0001 creates the workspaces table but 0003/0004, which would normally
-- backfill+enforce workspace_id, are out of scope for now). Without a backfill
-- here, step "4" below fails immediately on any table with existing rows,
-- since every row's workspace_id is NULL. Fix: point every legacy row at one
-- fixed, well-known "Legacy" workspace instead of leaving it null.
--
-- SECOND PREREQUISITE FIX (found only after inspecting the real production
-- schema — it does not match either git branch): production's `groups` table
-- has NO `facebook_user` column at all yet (confirmed via
-- information_schema.columns). The steps below that normalize/constrain
-- facebook_user would fail with "column does not exist" without first adding
-- it. Added as step 0b.

begin;

-- 0a. Legacy-workspace backfill — see PREREQUISITE FIX above. Idempotent: safe
--     to re-run. Requires the `workspaces` table (migration 0001) to already
--     exist; does not require any other part of the auth chain (no RLS, no
--     auth.users dependency — created_by is left null on this row). Only
--     touches rows where workspace_id is currently null — any row that
--     already has a real workspace_id (e.g. from earlier, unrelated testing)
--     is left untouched.
insert into public.workspaces (id, name, is_personal, created_by)
values ('00000000-0000-0000-0000-000000000001', 'Legacy (pre-auth)', false, null)
on conflict (id) do nothing;

update public.groups
   set workspace_id = '00000000-0000-0000-0000-000000000001'
 where workspace_id is null;

-- 0b. Add facebook_user — see SECOND PREREQUISITE FIX above. New column,
--     starts null on all 398 existing rows; normalized to '' in step 2b below.
alter table public.groups add column if not exists facebook_user text;

-- 1. A group id is no longer globally unique — drop the posts→groups FK so a
--    task's group_id can match a per-user row without a single-target constraint.
--    THIRD PREREQUISITE FIX: the constraint is NOT always named
--    `posts_group_id_fkey`. The real (pre-existing) schema names it
--    `fk_posts_groups`, so a name-based drop silently skipped it and step 4
--    then failed with "cannot drop constraint groups_pkey ... fk_posts_groups
--    depends on index groups_pkey". Drop by definition instead of by name so
--    this works on every environment.
do $$
declare c record;
begin
  for c in
    select con.conname
      from pg_constraint con
      join pg_class rel on rel.oid = con.conrelid
      join pg_class ref on ref.oid = con.confrelid
     where con.contype = 'f'
       and rel.relname = 'posts'
       and ref.relname = 'groups'
       and rel.relnamespace = 'public'::regnamespace
  loop
    execute format('alter table public.posts drop constraint %I;', c.conname);
  end loop;
end
$$;

-- 2a. Repair a legacy client bug: some older syncs stored the ENTIRE profile
--     object as a JSON string in facebook_user (e.g.
--     '{"facebook_user":"Smart Choice gadgets","facebook_user_id":"567001936"}').
--     Extract the real name so those rows join back to the account they belong to.
update public.groups
   set facebook_user = regexp_replace(facebook_user, '^\{"facebook_user":"([^"]+)".*\}$', '\1')
 where facebook_user like '{"facebook_user":"%';

-- 2b. Normalize facebook_user: NULL -> '' , then require it.
update public.groups set facebook_user = '' where facebook_user is null;
alter table public.groups alter column facebook_user set default '';
alter table public.groups alter column facebook_user set not null;

-- 3. Collapse any rows that would collide under the new composite key, keeping one.
delete from public.groups a
 using public.groups b
 where a.ctid < b.ctid
   and a.workspace_id  = b.workspace_id
   and a.facebook_user = b.facebook_user
   and a.id            = b.id;

-- 4. Swap the single-column primary key for the composite one.
alter table public.groups drop constraint if exists groups_pkey;
alter table public.groups add constraint groups_pkey
  primary key (workspace_id, facebook_user, id);

-- 5. Helpful index for the common "this user's groups in this workspace" lookup.
create index if not exists idx_groups_ws_user
  on public.groups (workspace_id, facebook_user);

commit;
