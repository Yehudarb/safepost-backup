-- Migration 0012: Engagement / Opportunities — Phase 1A (backend + database).
--
-- Adds a SECOND, independent job queue for scanning Facebook groups and storing
-- the posts found there. It is deliberately NOT built on `posts`.
--
-- WHY A SEPARATE TABLE RATHER THAN REUSING `posts`
-- ------------------------------------------------
-- Six things in the publishing path read or write `posts` on assumptions that a
-- scan row would silently violate:
--
--   1. queue.cjs claimNextJob() filters `app_source = 'backup'` — a scan row
--      would have to dodge that filter forever, and one missed filter means the
--      publisher opens a Facebook composer on a scan task.
--   2. queue.cjs extendLock() updates EVERY 'PROCESSING' row for a worker, so a
--      running scan would extend a publish job's lock, or the reverse.
--   3. sweepExpiredLocks() / sweepMissedSchedules() would sweep scans into the
--      publish retry machine.
--   4. health.cjs derives queue_depth / processing_jobs / processing_over_10m
--      from `posts`. Scans would corrupt the exact monitoring signals the beta
--      go/no-go depends on.
--   5. reportJobStatus() keys idempotency off external_post_url, which has no
--      meaning for a scan.
--   6. `posts.status` consumers expect publish states, not scan states.
--
-- A separate table costs one migration. Reusing `posts` costs permanent
-- vigilance in six places, each of which is a live-publishing incident if missed.
--
-- PRIMARY KEYS ARE uuid
-- ---------------------
-- Matches what 0000_base_schema.sql declares, avoids the bigint/uuid drift found
-- between production and QA on group_sets, and means the already-tested
-- normalizeUuid() in server/lib/ids.cjs is the only id validator needed.

begin;

-- ---------- feature flag (per workspace) ----------
-- Paired with the ENGAGEMENT_ENABLED backend env var, which is a fleet-wide kill
-- switch. Both default to off, so deploying this migration changes no behaviour.
alter table public.workspaces
  add column if not exists engagement_enabled boolean not null default false;

-- ---------- scan tasks ----------
create table if not exists public.engagement_scan_tasks (
  id                  uuid primary key default gen_random_uuid(),
  workspace_id        uuid not null references public.workspaces(id) on delete cascade,
  created_by          uuid references auth.users(id) on delete set null,

  name                text not null,
  status              text not null default 'QUEUED'
    check (status in ('QUEUED','RUNNING','COMPLETED','FAILED','ABORTED','CANCELLED')),

  -- [{ id, name, url }] resolved from the workspace's own synced `groups` rows.
  -- Phase 1 does not accept arbitrary pasted URLs, so every entry here was
  -- verified to belong to this workspace at creation time.
  target_groups       jsonb  not null default '[]'::jsonb,
  -- Stored for Phase 2 (AI relevance). Phase 1A performs no filtering with it.
  search_instructions text,

  -- Product/safety caps, enforced in the database rather than only in the UI so
  -- a direct API caller cannot request a 50-group scrape.
  max_groups          integer not null default 3
    check (max_groups between 1 and 5),
  max_posts_per_group integer not null default 10
    check (max_posts_per_group between 1 and 25),

  -- Which Facebook account this scan belongs to. `groups` is keyed per
  -- (workspace_id, facebook_user, id) since 0008, so a scan is meaningful only
  -- in the context of one account.
  facebook_user       text,

  -- Lease columns. Same shape as the publish queue's, on their own table so
  -- extendLock()/sweepExpiredLocks() can never reach them.
  worker_id           uuid references public.browser_workers(id) on delete set null,
  claimed_at          timestamptz,
  lock_expires_at     timestamptz,
  attempt_count       integer not null default 0,
  max_attempts        integer not null default 2,

  error_code          text,
  failure_reason      text,

  groups_scanned      integer not null default 0,
  posts_discovered    integer not null default 0,

  created_at          timestamptz not null default now(),
  started_at          timestamptz,
  completed_at        timestamptz
);

-- ---------- discovered posts ----------
create table if not exists public.engagement_discovered_posts (
  id                  uuid primary key default gen_random_uuid(),
  workspace_id        uuid not null references public.workspaces(id) on delete cascade,
  -- Kept on delete set null: a discovered opportunity outlives the scan that
  -- happened to find it. Deleting scan history must not destroy the results.
  scan_task_id        uuid references public.engagement_scan_tasks(id) on delete set null,

  facebook_group_id   text not null,
  facebook_group_name text,
  facebook_post_id    text,
  facebook_post_url   text,

  author_name         text,
  author_profile_url  text,

  -- Retention limit. The backend truncates to 2000 characters; this constraint
  -- is defence in depth so a future code path cannot quietly store more of
  -- someone else's personal content than the product decided to keep.
  post_text           text not null default ''
    check (char_length(post_text) <= 2000),
  is_truncated        boolean not null default false,

  -- Facebook often renders only a relative label ("2h", "לפני שעתיים"). When an
  -- absolute time cannot be derived, posted_at stays null and the literal label
  -- is kept in posted_at_raw. A timestamp is never fabricated.
  posted_at           timestamptz,
  posted_at_raw       text,

  discovered_at       timestamptz not null default now(),

  -- Computed server-side only (server/lib/engagementDedup.cjs). Never accepted
  -- from the extension: a client-supplied key could collide rows or evade the
  -- unique index.
  dedup_key           text not null,
  raw_metadata        jsonb not null default '{}'::jsonb
);

-- ---------- indexes ----------
-- Uniqueness is per workspace, not global. Two tenants may legitimately discover
-- the same public post; a global unique index would both break isolation and
-- leak the existence of another tenant's row through a constraint violation.
create unique index if not exists uq_engagement_dedup
  on public.engagement_discovered_posts (workspace_id, dedup_key);

create index if not exists idx_engagement_posts_ws_found
  on public.engagement_discovered_posts (workspace_id, discovered_at desc);
create index if not exists idx_engagement_posts_task
  on public.engagement_discovered_posts (scan_task_id);

-- Claim path: find QUEUED work whose lock is free or expired.
create index if not exists idx_engagement_scans_claimable
  on public.engagement_scan_tasks (status, lock_expires_at);
create index if not exists idx_engagement_scans_ws_created
  on public.engagement_scan_tasks (workspace_id, created_at desc);

-- ---------- RLS ----------
-- Same convention as 0004/0011. The backend uses the service-role key and
-- bypasses RLS, so workspace scoping in the route handlers remains the primary
-- control; this is defence in depth against direct PostgREST access with the
-- public anon key.
alter table public.engagement_scan_tasks       enable row level security;
alter table public.engagement_discovered_posts enable row level security;

drop policy if exists p_engagement_scan_tasks_member on public.engagement_scan_tasks;
create policy p_engagement_scan_tasks_member on public.engagement_scan_tasks
  for all using (public.is_workspace_member(workspace_id))
       with check (public.is_workspace_member(workspace_id));

drop policy if exists p_engagement_discovered_posts_member on public.engagement_discovered_posts;
create policy p_engagement_discovered_posts_member on public.engagement_discovered_posts
  for all using (public.is_workspace_member(workspace_id))
       with check (public.is_workspace_member(workspace_id));

commit;
