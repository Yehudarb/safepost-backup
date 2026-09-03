-- Migration 0014: a Facebook group is one row per workspace.
--
-- WHY
-- ---
-- `groups` is keyed PRIMARY KEY (workspace_id, facebook_user, id), and
-- `facebook_user` is only the display label content.js detected at sync time.
-- When that label changes — a different profile name, a Page label, or the ''
-- sentinel becoming a real name — the same Facebook group is inserted a SECOND
-- time instead of updated.
--
-- The consequence surfaced in Engagement: scan creation asks for one group id,
-- resolves two rows, and the `resolved.length !== groupIds.length` guard answers
-- 400 "One or more groups were not found in this workspace." The message is the
-- opposite of the truth — too many were found — and the documented remedy for
-- FACEBOOK_IDENTITY_UNVERIFIED ("re-sync your groups") is exactly the action
-- that triggers it.
--
-- Group identity is (workspace_id, id). A display label must never define it.
--
-- SAFETY
-- ------
-- Nothing references `groups` by foreign key, and `group_sets.group_ids` stores
-- Facebook group ids rather than row references. Collapsing duplicate rows while
-- keeping the same `id` therefore preserves every saved group set.
--
-- Both QA and production currently hold ZERO duplicate (workspace_id, id) pairs,
-- so on those databases the merge below is a no-op and only the constraint is
-- added. The merge exists for any environment that already drifted.

begin;

-- ---------- 1. collapse existing duplicates, deterministically ----------
-- Canonical row per (workspace_id, id), in priority order:
--   1. has a verified facebook_user_id
--   2. most recently created
--   3. has a non-empty display label
--   4. ctid, purely so the choice is stable across runs
with ranked as (
    select
        ctid,
        workspace_id,
        id,
        row_number() over (
            partition by workspace_id, id
            order by
                (facebook_user_id is not null) desc,
                created_at desc nulls last,
                (nullif(facebook_user, '') is not null) desc,
                ctid
        ) as rank
    from public.groups
),
canonical as (
    select ctid, workspace_id, id from ranked where rank = 1
),
-- Carry forward any metadata the canonical row is missing but a duplicate has.
merged as (
    select
        c.ctid as target,
        max(g.name) filter (where g.name is not null)                     as name,
        max(g.url) filter (where g.url is not null)                       as url,
        max(g.facebook_user_id) filter (where g.facebook_user_id is not null) as facebook_user_id,
        max(g.timezone) filter (where g.timezone is not null)             as timezone,
        max(g.last_posted)                                                as last_posted
    from canonical c
    join public.groups g
      on g.workspace_id = c.workspace_id and g.id = c.id
    group by c.ctid
)
update public.groups target
   set name             = coalesce(target.name, merged.name),
       url              = coalesce(target.url, merged.url),
       facebook_user_id = coalesce(target.facebook_user_id, merged.facebook_user_id),
       timezone         = coalesce(target.timezone, merged.timezone),
       last_posted      = greatest(target.last_posted, merged.last_posted)
  from merged
 where target.ctid = merged.target;

-- Remove the non-canonical copies. Their `id` survives on the canonical row, so
-- group sets referencing that Facebook group id are unaffected.
delete from public.groups g
 using (
    select ctid,
           row_number() over (
               partition by workspace_id, id
               order by
                   (facebook_user_id is not null) desc,
                   created_at desc nulls last,
                   (nullif(facebook_user, '') is not null) desc,
                   ctid
           ) as rank
      from public.groups
 ) ranked
 where g.ctid = ranked.ctid and ranked.rank > 1;

-- ---------- 2. one row per Facebook group, per workspace ----------
-- Added as a UNIQUE constraint rather than by replacing the primary key. The
-- existing PK stays valid and is now strictly implied by this one, so publishing
-- and group sync keep working while a second row becomes impossible. Replacing a
-- primary key on a live table is a bigger change than this defect warrants.
create unique index if not exists uq_groups_workspace_group
    on public.groups (workspace_id, id);

commit;
