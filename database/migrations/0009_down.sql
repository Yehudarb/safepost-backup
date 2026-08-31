-- Revert Migration 0009.
begin;
drop index if exists public.idx_posts_variant_label;
alter table public.posts  drop column if exists variant_label;
alter table public.groups drop column if exists timezone;
commit;
