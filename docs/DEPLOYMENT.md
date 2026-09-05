# SafePost Phase 1 Deployment Runbook

## Release gates

- Keep `ENGAGEMENT_ENABLED=false` during migrations and application deployment.
- Keep every `workspaces.engagement_enabled` value false initially.
- Engagement workers must report extension version 9.2 or newer through their
  authenticated pairing/heartbeat record.
- Turn Publishing Dry Run on explicitly for the controlled smoke test. A remote
  API URL does not default to Dry Run.
- Record the reviewed extension ZIP SHA-256 before installing it.

## Database prechecks

Verify the production project reference from the connection hostname and the
Supabase dashboard before running SQL. Do not print the connection string.

```sql
select current_database(), current_user;

select count(*) as groups_rows,
       pg_size_pretty(pg_total_relation_size('public.groups')) as groups_size
from public.groups;

-- Must return zero rows before migration 0014.
select workspace_id, id, count(*) as duplicate_count
from public.groups
group by workspace_id, id
having count(*) > 1
order by duplicate_count desc;

-- Run after 0013 and before 0014. Must return zero rows.
select workspace_id, id, count(distinct facebook_user_id) as identity_count
from public.groups
where facebook_user_id is not null
group by workspace_id, id
having count(distinct facebook_user_id) > 1;

select status, count(*)
from public.posts
where status in ('SENT', 'PROCESSING')
group by status;
```

Take a database backup or verified restore point. Wait for active publishing
jobs to drain before the migration window. Conflicting stable identities require
manual review rather than automatic reconciliation.

## Deployment order

1. Verify the reviewed Git commit, clean worktree, tests, frontend build and
   extension artifact checksum.
2. Confirm the Render fleet flag and every workspace flag are false.
3. Pause automatic application promotion and pause group sync.
4. Run the prechecks and take the database restore point.
5. Apply `0012_engagement.sql`, then `0013_engagement_facebook_identity.sql`,
   then `0014_group_identity_uniqueness.sql`, each with stop-on-error behavior.
6. Verify the new tables, columns, RLS policies, indexes and zero logical group
   duplicates.
7. Deploy the backend immediately after 0014, with Engagement still disabled.
8. Verify backend health, authentication, publishing and group sync. Resume
   group sync only after the new `(workspace_id, id)` upsert succeeds.
9. Deploy the frontend, then install the reviewed extension artifact.
10. Verify worker heartbeat version 9.2 or newer before enabling the fleet.
11. Enable the fleet while workspace flags remain false, then enable one
    controlled workspace and perform the supervised smoke scan.

The transition window must stay short. A new backend before 0014 can fail group
sync because its conflict target is not available. An old backend after 0014 can
conflict with the new uniqueness rule when a Facebook display label changes.

## Rollback and shutdown

The first incident response is to set `ENGAGEMENT_ENABLED=false` and restart the
backend, then clear any enabled workspace flags. Roll back frontend, backend or
extension artifacts only after the feature is disabled.

Database down migrations are not the preferred incident response. If schema
rollback is explicitly approved, use reverse order: `0014_down.sql`, then
`0013_down.sql`, then `0012_down.sql`. Migration 0014 cannot recreate duplicate
rows it reconciled; 0013 removes identity bindings; 0012 destroys Engagement
tasks and discovered posts.

## Production visibility

- Monitor `ENGAGEMENT_SCAN_CREATED`, `ENGAGEMENT_SCAN_CLAIMED`, completion,
  failure, cancellation, retry and `STALE_SCAN_CLAIM` entries in `system_logs`.
- Monitor scan status/error counts, attempts, duration, discovered post counts,
  worker version/last-seen and stale `RUNNING` leases.
- The periodic backend sweep logs aggregate `swept`, `requeued` and `failed`
  counts only when it recovers expired Engagement leases.
- Facebook activity-lock lifecycle events remain browser-console-only. They are
  intentionally not centralized in Phase 1E because doing so requires a new
  authenticated telemetry pipeline. Do not include account IDs or Facebook
  content when collecting those diagnostics manually.
- Continue monitoring publishing success/failure, queue latency,
  `COMPOSER_NOT_READY`, CAPTCHA/checkpoint states and `/api/health`.
