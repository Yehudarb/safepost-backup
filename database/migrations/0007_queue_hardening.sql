-- Phase 6 — Migration 0007: persistent locking, retries, idempotency.
-- Adds locking/retry fields to posts (the job table) and scheduling policy to
-- workspaces. Non-destructive (add column if not exists).

begin;

-- Locking + retry + idempotency on the job/posts table.
alter table public.posts add column if not exists worker_id         uuid references public.browser_workers(id) on delete set null;
alter table public.posts add column if not exists claimed_at        timestamptz;
alter table public.posts add column if not exists lock_expires_at   timestamptz;
alter table public.posts add column if not exists attempt_count     integer not null default 0;
alter table public.posts add column if not exists max_attempts      integer not null default 3;
alter table public.posts add column if not exists next_attempt_at   timestamptz;
alter table public.posts add column if not exists last_attempt_at   timestamptz;
alter table public.posts add column if not exists error_code        text;
alter table public.posts add column if not exists idempotency_key   text;
alter table public.posts add column if not exists external_post_url text;
alter table public.posts add column if not exists platform          text not null default 'facebook_groups';

-- Indexes for claim / sweep queries.
create index if not exists idx_posts_claimable    on public.posts(status, lock_expires_at);
create index if not exists idx_posts_next_attempt on public.posts(next_attempt_at);
create unique index if not exists uq_posts_idempotency
    on public.posts(workspace_id, idempotency_key) where idempotency_key is not null;

-- Missed-schedule policy + timezone on workspaces.
-- policy: publish_immediately | reschedule | cancel | ask_user
alter table public.workspaces add column if not exists missed_schedule_policy text not null default 'publish_immediately';
alter table public.workspaces add column if not exists timezone text not null default 'Asia/Jerusalem';

commit;
