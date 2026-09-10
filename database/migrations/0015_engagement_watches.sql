-- Engagement Phase 2A — saved Watches, a short-lived candidate buffer, and
-- durable matched Opportunities.
--
-- Three tables, no change to any existing column. Phase 1's
-- engagement_scan_tasks and engagement_discovered_posts keep their shape and
-- their contracts; this migration only adds beside them.
--
-- STORAGE MODEL: match-then-store.
--
-- Phase 1 stored every scanned post and filtered later. Phase 2A reads comments
-- as well, which multiplies third-party content per scan roughly six-fold, so
-- everything scanned lands in engagement_scan_candidates with a 48-hour expiry,
-- the matcher runs on ingest, and only matches are promoted to
-- engagement_opportunities. Unmatched content is never durable.
--
-- RLS: these tables are reached only by the backend service key, same as the
-- Phase 1 engagement tables. The member policy below mirrors 0012 for parity in
-- environments that have public.is_workspace_member(); production applied a
-- service-role-only variant and should continue to do so.

-- ---------- watches ----------
create table if not exists public.engagement_watches (
  id                 uuid primary key default gen_random_uuid(),
  workspace_id       uuid not null references public.workspaces(id) on delete cascade,
  created_by         uuid references auth.users(id) on delete set null,

  name               text not null check (char_length(name) between 1 and 120),
  query_text         text not null check (char_length(query_text) between 2 and 500),

  -- 'semantic' is deliberately absent from this CHECK. Phase 2A has no
  -- embeddings and no model calls; adding the value before the capability
  -- exists would let a row claim a behaviour the code cannot deliver.
  match_mode         text not null default 'flexible'
                       check (match_mode in ('exact', 'flexible')),

  keywords           jsonb not null default '[]'::jsonb,
  exact_phrases      jsonb not null default '[]'::jsonb,
  exclude_terms      jsonb not null default '[]'::jsonb,
  selected_group_ids jsonb not null default '[]'::jsonb,

  include_posts      boolean not null default true,
  include_comments   boolean not null default false,
  enabled            boolean not null default true,

  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists idx_engagement_watches_ws
  on public.engagement_watches (workspace_id, enabled, created_at desc);

-- ---------- candidate buffer (short-lived) ----------
-- Everything a scan saw, matched or not. Exists so Preview and re-match work
-- against real data without another Facebook visit, and so an unmatched
-- stranger's comment leaves no durable trace.
create table if not exists public.engagement_scan_candidates (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null references public.workspaces(id) on delete cascade,
  scan_task_id      uuid not null references public.engagement_scan_tasks(id) on delete cascade,

  source_type       text not null check (source_type in ('post', 'comment')),
  dedup_key         text not null,
  parent_dedup_key  text,                       -- comments: the parent post's key

  facebook_group_id text not null,
  source_id         text,
  source_url        text,
  author_name       text,

  -- Comments are short; posts are already capped at 2000 upstream. This bound
  -- is defence in depth so a future code path cannot buffer more of someone
  -- else's content than the product decided to hold.
  content           text not null default '' check (char_length(content) <= 2000),

  discovered_at     timestamptz not null default now(),
  expires_at        timestamptz not null default (now() + interval '48 hours')
);

-- One row per item per scan; a re-upload of the same batch is a no-op.
create unique index if not exists uq_engagement_candidate
  on public.engagement_scan_candidates (scan_task_id, dedup_key);
-- The sweep orders by this, so it must not be a sequential scan.
create index if not exists idx_engagement_candidates_expiry
  on public.engagement_scan_candidates (expires_at);
create index if not exists idx_engagement_candidates_ws_scan
  on public.engagement_scan_candidates (workspace_id, scan_task_id);

-- ---------- opportunities (durable) ----------
create table if not exists public.engagement_opportunities (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null references public.workspaces(id) on delete cascade,
  watch_id          uuid not null references public.engagement_watches(id) on delete cascade,
  scan_task_id      uuid references public.engagement_scan_tasks(id) on delete set null,

  source_type       text not null check (source_type in ('post', 'comment')),
  facebook_group_id text not null,
  source_id         text,
  parent_source_id  text,
  parent_dedup_key  text,
  source_url        text,

  -- Excerpt, not full content. A human needs enough to recognise the lead; the
  -- product does not need the rest of a stranger's post.
  excerpt           text not null default '' check (char_length(excerpt) <= 600),
  -- Short parent context for a comment match, so the reviewer can see what was
  -- being replied to without storing the whole parent.
  parent_excerpt    text check (parent_excerpt is null or char_length(parent_excerpt) <= 300),
  author_name       text,
  -- author_profile_url is deliberately NOT a column. It is the most identifying
  -- field available and the product does not need it: the reviewer opens the
  -- source URL, where the author is visible in context.

  matched_terms     jsonb not null default '[]'::jsonb,
  matched_phrase    text,
  match_mode        text not null,
  match_reason      text not null,
  relevance         text not null check (relevance in ('exact', 'strong', 'possible')),

  review_state      text not null default 'new'
                      check (review_state in ('new', 'saved', 'dismissed')),

  dedup_key         text not null,
  discovered_at     timestamptz not null default now()
);

-- One opportunity per (watch, item). A re-scan or a re-match updates rather
-- than duplicating, and two watches may legitimately match the same item.
create unique index if not exists uq_engagement_opportunity
  on public.engagement_opportunities (watch_id, dedup_key);
create index if not exists idx_engagement_opps_ws
  on public.engagement_opportunities (workspace_id, discovered_at desc);
create index if not exists idx_engagement_opps_filter
  on public.engagement_opportunities (workspace_id, source_type, relevance, review_state);

-- ---------- scan coverage metadata ----------
-- Counts only. Never comment text, never author names.
alter table public.engagement_scan_tasks
  add column if not exists watch_id uuid references public.engagement_watches(id) on delete set null,
  add column if not exists posts_seen integer not null default 0,
  add column if not exists visible_comments_seen integer not null default 0,
  add column if not exists comments_matched integer not null default 0,
  add column if not exists comments_with_stable_id integer not null default 0,
  add column if not exists replies_skipped integer not null default 0,
  -- No 'complete' value exists anywhere in this feature. SafePost reads only the
  -- comments already on screen and cannot observe how many it did not see, so
  -- the schema must not offer a word that would let the UI imply otherwise.
  add column if not exists partial_comment_coverage boolean not null default true;

-- ---------- RLS ----------
alter table public.engagement_watches           enable row level security;
alter table public.engagement_scan_candidates   enable row level security;
alter table public.engagement_opportunities     enable row level security;

drop policy if exists p_engagement_watches_member on public.engagement_watches;
create policy p_engagement_watches_member on public.engagement_watches
  for all using (public.is_workspace_member(workspace_id))
       with check (public.is_workspace_member(workspace_id));

drop policy if exists p_engagement_candidates_member on public.engagement_scan_candidates;
create policy p_engagement_candidates_member on public.engagement_scan_candidates
  for all using (public.is_workspace_member(workspace_id))
       with check (public.is_workspace_member(workspace_id));

drop policy if exists p_engagement_opportunities_member on public.engagement_opportunities;
create policy p_engagement_opportunities_member on public.engagement_opportunities
  for all using (public.is_workspace_member(workspace_id))
       with check (public.is_workspace_member(workspace_id));
