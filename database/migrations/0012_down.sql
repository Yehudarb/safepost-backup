-- Revert Migration 0012 (Engagement Phase 1A).
--
-- Drops the discovered posts before the scan tasks they reference, and removes
-- the workspace flag last. Nothing outside the engagement feature is touched, so
-- reverting this leaves publishing exactly as it was.

begin;

drop policy if exists p_engagement_discovered_posts_member on public.engagement_discovered_posts;
drop policy if exists p_engagement_scan_tasks_member       on public.engagement_scan_tasks;

drop index if exists public.uq_engagement_dedup;
drop index if exists public.idx_engagement_posts_ws_found;
drop index if exists public.idx_engagement_posts_task;
drop index if exists public.idx_engagement_scans_claimable;
drop index if exists public.idx_engagement_scans_ws_created;

drop table if exists public.engagement_discovered_posts;
drop table if exists public.engagement_scan_tasks;

alter table public.workspaces drop column if exists engagement_enabled;

commit;
