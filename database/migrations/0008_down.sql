-- Down migration for 0008: restore the single-column primary key on groups.id.
-- NOTE: this is lossy — any per-user duplicate rows for the same group id are
-- collapsed to a single arbitrary row before the old key is restored.

begin;

-- Collapse to one row per id (arbitrary winner) so a single-column PK is valid.
delete from public.groups a
 using public.groups b
 where a.ctid < b.ctid
   and a.id = b.id;

alter table public.groups drop constraint if exists groups_pkey;
alter table public.groups add constraint groups_pkey primary key (id);

drop index if exists public.idx_groups_ws_user;

alter table public.groups alter column facebook_user drop not null;
alter table public.groups alter column facebook_user drop default;

-- The posts→groups FK is intentionally NOT recreated (a group id may legitimately
-- be absent, and the app scopes lookups by facebook_user + workspace instead).

commit;
