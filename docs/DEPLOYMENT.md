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

## Auto-deploy controls — do this before anything else

Render and Vercel both build from a push to the tracked branch. A single
`git push` therefore deploys the backend and the frontend at the same moment,
and it does so *before* any migration has run unless auto-deploy is off. The
push must be treated as a deployment action, not as source control.

Disable both, in the provider consoles, and confirm the disabled state visually
before continuing. Menu labels change over time; the control, not the click
path, is what matters.

**Render — backend.** Open the `safepost-backup` service, go to its settings,
and set Auto-Deploy to off. Confirm the setting reads disabled after saving.

**Vercel — frontend.** Use one of the supported project controls, and confirm it
is active before pushing:

- set an Ignored Build Step command that exits 0, so pushes are skipped; or
- point the Production Branch at a branch other than the one being pushed.

Do not rely on `render.yaml` for this. See "Why render.yaml is not the control"
below.

Re-enable both only after step 18, and re-verify the flags afterwards.

## Deployment order

Verify the reviewed Git commit, a clean worktree, the full test suites, the
frontend build and the extension artifact checksum before starting.

### Pre-push — nothing below reaches production until step 9

1. Confirm `ENGAGEMENT_ENABLED=false` on Render.
2. Confirm every `workspaces.engagement_enabled` is false.
3. Create and verify the database restore point.
4. Drain publishing work: wait for `SENT` and `PROCESSING` to reach zero.
5. Pause group sync.
6. Apply `0012_engagement.sql`, then `0013_engagement_facebook_identity.sql`,
   then `0014_group_identity_uniqueness.sql`, each with stop-on-error behavior.
7. Verify the new tables, columns, RLS policies, indexes and zero logical group
   duplicates.
8. **STOP** if the prechecks report duplicate `(workspace_id, id)` rows or
   conflicting `facebook_user_id` values. Resolve those by review, not by
   letting the migration reconcile production ambiguity.

### The push

9. `git push`. With auto-deploy disabled this publishes code without deploying
   anything. If either provider still builds, stop and fix the auto-deploy
   control before going further.

### Post-push — promote one tier at a time

10. Manually deploy the **backend** first, with Engagement still disabled.
11. Verify `/api/health`, authentication, publishing, worker heartbeat and group
    sync. Group sync must succeed against the new `(workspace_id, id)` upsert.
12. Resume group sync.
13. Manually deploy the **frontend**.
14. Install the extension artifact whose SHA-256 was verified during review.
15. Verify the worker heartbeat reports extension version 9.2 or newer.
16. Enable the fleet flag while every workspace flag stays false.
17. Enable exactly one controlled workspace.
18. Run the supervised Engagement smoke scan with Publishing Dry Run explicitly
    on.

The interval between step 6 and step 10 is the compatibility window and must
stay short. A new backend before 0014 can fail group sync because its conflict
target is not available. An old backend after 0014 can conflict with the new
uniqueness rule when a Facebook display label changes. Running the migrations
before the push keeps the window bounded by the operator rather than by build
queue timing.

## Why render.yaml is not the control

`render.yaml` declares the service, but it is not a reliable auto-deploy gate
for this deployment, for two independent reasons.

First, a Blueprint setting can only take effect once Render has processed the
commit that introduces it — which is the very push the gate is meant to stop. A
setting added in this commit cannot protect this commit.

Second, it is not established that this service is Blueprint-managed rather than
dashboard-created; if it is dashboard-created the file is inert. The file also
lists a single `envVars` entry, so a Blueprint sync against a live service whose
configuration was set in the dashboard is not a change to make during a release
window.

The provider console toggle is the authoritative control. Revisit adding
`autoDeploy: false` as a separate change, outside a deployment window, once the
service's Blueprint status has been confirmed.

## Rollback and shutdown

In order:

1. Set `ENGAGEMENT_ENABLED=false` on Render and restart the backend.
2. Clear every enabled `workspaces.engagement_enabled` flag.
3. Only if still required, roll back the frontend, then the backend, then the
   extension artifact.

Rolling the extension back to a build below 9.2 does not reopen Engagement for
old workers: the server answers their claims with `426
EXTENSION_UPGRADE_REQUIRED`, they back off, and no scan is claimed or mutated.
That is the intended behaviour, not a failure to investigate. Publishing is
unaffected by that rejection.

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
