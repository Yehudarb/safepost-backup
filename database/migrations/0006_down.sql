-- Revert Migration 0006.
begin;
drop table if exists public.browser_workers cascade;
drop table if exists public.pairing_codes cascade;
commit;
