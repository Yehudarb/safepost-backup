-- Down for 0010. WARNING: dropping media_paths destroys stored media references.
begin;

alter table public.groups drop column if exists created_at;
alter table public.posts  drop column if exists media_paths;

commit;
