-- Down for 0011.
-- NOTE: the dropped legacy `USING (true)` policies are NOT recreated — they were
-- the vulnerability. This only reverts what 0011 added.
begin;

alter table public.app_config disable row level security;

drop policy if exists p_browser_workers_member on public.browser_workers;
drop policy if exists p_pairing_codes_member   on public.pairing_codes;

alter table public.browser_workers disable row level security;
alter table public.pairing_codes   disable row level security;

commit;
