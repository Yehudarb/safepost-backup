-- Revert Migration 0014.
--
-- Only the uniqueness rule is reversible. Duplicate rows collapsed by the up
-- migration are NOT recreated: they were redundant representations of the same
-- Facebook group, their metadata was merged into the surviving row, and nothing
-- referenced them. Reverting therefore restores the ability to create such rows
-- again, not the rows themselves.

begin;

drop index if exists public.uq_groups_workspace_group;

commit;
