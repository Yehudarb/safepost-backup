-- Revert Migration 0007.
begin;
drop index if exists public.idx_posts_claimable;
drop index if exists public.idx_posts_next_attempt;
drop index if exists public.uq_posts_idempotency;
alter table public.posts drop column if exists worker_id;
alter table public.posts drop column if exists claimed_at;
alter table public.posts drop column if exists lock_expires_at;
alter table public.posts drop column if exists attempt_count;
alter table public.posts drop column if exists max_attempts;
alter table public.posts drop column if exists next_attempt_at;
alter table public.posts drop column if exists last_attempt_at;
alter table public.posts drop column if exists error_code;
alter table public.posts drop column if exists idempotency_key;
alter table public.posts drop column if exists external_post_url;
alter table public.posts drop column if exists platform;
alter table public.workspaces drop column if exists missed_schedule_policy;
alter table public.workspaces drop column if exists timezone;
commit;
