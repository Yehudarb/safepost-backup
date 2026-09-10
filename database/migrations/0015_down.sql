-- Reverses 0015_engagement_watches.sql.
--
-- DESTRUCTIVE: dropping engagement_opportunities discards every matched lead a
-- workspace has collected. The candidate buffer is expendable by design (48h
-- TTL), but opportunities are the product's durable output. Export before
-- running this if the results matter.
--
-- Phase 1's engagement_scan_tasks and engagement_discovered_posts are left
-- intact; only the columns 0015 added to scan_tasks are removed.

drop policy if exists p_engagement_opportunities_member on public.engagement_opportunities;
drop policy if exists p_engagement_candidates_member    on public.engagement_scan_candidates;
drop policy if exists p_engagement_watches_member       on public.engagement_watches;

-- Dropped before engagement_watches: opportunities reference it, and the
-- candidate buffer references scan_tasks.
drop table if exists public.engagement_opportunities;
drop table if exists public.engagement_scan_candidates;

alter table public.engagement_scan_tasks
  drop column if exists partial_comment_coverage,
  drop column if exists replies_skipped,
  drop column if exists comments_with_stable_id,
  drop column if exists comments_matched,
  drop column if exists visible_comments_seen,
  drop column if exists posts_seen,
  drop column if exists watch_id;

drop table if exists public.engagement_watches;
