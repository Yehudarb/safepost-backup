-- Phase — Migration 0009: post variants + group timezone tagging.
-- Two small additive, backward-compatible columns:
--   • posts.variant_label — supports content_variants / A-B testing. Analytics
--     can break down success/failure by which variant of a campaign was sent.
--   • groups.timezone — manual per-group timezone tag. Facebook doesn't expose
--     group location/timezone, so this is opt-in/manual, not auto-detected.
--     Lets the scheduler bias a tagged group's scheduled_time toward a sane
--     local-hour posting window instead of blind UTC jitter. Untagged groups
--     (timezone IS NULL) are completely unaffected — today's behavior is the
--     default. (Note: workspaces.timezone already exists since migration 0007
--     as a workspace-level default; this is a separate, optional per-group
--     override, not a duplicate.)
-- Both are additive, no backfill, no table rewrite — safe on a live table.
-- Apply during a natural lull anyway, per project convention (see README.md).

begin;

alter table public.posts  add column if not exists variant_label text;
alter table public.groups add column if not exists timezone      text;

create index if not exists idx_posts_variant_label
  on public.posts(variant_label) where variant_label is not null;

commit;
