# Engagement / Opportunities

Scan selected Facebook groups, extract the posts already in them, and store those
as discovered opportunities. This is the read side of SafePost, separate from
publishing, which is the write side.

**Phase 1A (this document) is backend + database only.** There is no extension
scanner, no DOM parsing, no dashboard UI and no AI. The feature ships disabled.

---

## Why a second queue instead of reusing `posts`

`posts` is the publishing job table. Six things in the publishing path read or
write it on assumptions a scan row would silently violate:

| Assumption | What a scan row would break |
|---|---|
| `queue.cjs claimNextJob()` filters `app_source = 'backup'` | one missed filter and the publisher opens a Facebook composer on a scan task |
| `queue.cjs extendLock()` updates **every** `PROCESSING` row for a worker | a running scan would extend a publish job's lock, or the reverse |
| `sweepExpiredLocks()` / `sweepMissedSchedules()` | scans swept into the publish retry machine |
| `health.cjs` derives `queue_depth`, `processing_jobs`, `processing_over_10m` from `posts` | scans corrupt the monitoring signals the beta go/no-go depends on |
| `reportJobStatus()` keys idempotency off `external_post_url` | meaningless for a scan |
| `posts.status` consumers expect publish states | scans need `QUEUED`/`RUNNING`/`ABORTED` |

A separate table costs one migration. Reusing `posts` costs permanent vigilance
in six places, each of which is a live-publishing incident if missed.

`server/lib/queue.cjs` is **not imported, not extended and not modified** by
anything in this feature.

---

## Phase 1B REQUIREMENT — the Facebook activity lock

**Read this before writing any extension code.**

The architecture review found a race that already exists in production, before
Engagement is involved at all:

- `checkJobs()` in `background.js` is guarded by `isScanning`
- `scanAndSyncGroups()` is guarded by `isGroupScanning`
- **the two guards are independent**

So a `sync_groups` SSE event arriving while a post is publishing can already open
a second Facebook tab on the same session. Engagement would make it a third.

Phase 1B must therefore introduce **one** mutex over the Facebook session:

```
FACEBOOK_ACTIVITY_LOCK = { owner, since }
owner ∈ { 'publishing', 'group_sync', 'engagement' }
```

**All three owners. Not two.**

A lock covering only publishing and engagement would look correct in review,
pass its tests, and leave the original publishing-vs-group_sync race exactly as
it is today — while creating the impression it had been fixed. That is a worse
outcome than not building the lock at all, because nobody would look again.

Rules the lock must satisfy:

1. **Publishing pre-empts.** It is the paid, time-sensitive path. A scan holding
   the lock is aborted and requeued (`SCAN_PREEMPTED_BY_PUBLISH`, which is
   retryable and not a failure).
2. **Staleness.** The lock carries a timestamp and is treated as abandoned after
   ~10 minutes, so a crashed MV3 service worker cannot deadlock the extension.
3. **Separate pacing keys.** The scanner must **never** write
   `last_post_timestamp`. That key drives `checkSafetyCooldown()` and the 3–12
   minute publish cooldown; writing it would delay real posts. Engagement gets
   its own pacing key.
4. **One tab at a time.** No parallel group tabs, in any owner.

---

## Feature flags

Two independent flags. Both default to **off**, and both must be on:

| Flag | Where | Default |
|---|---|---|
| `ENGAGEMENT_ENABLED` | backend environment variable | off (absent = off) |
| `workspaces.engagement_enabled` | database column, per workspace | `false` |

The env flag is compared against the literal string `'true'`. `1`, `yes`, `on`
and `TRUE ` all leave the feature **off** — a feature this new should fail closed
on a typo in an environment variable.

With either flag off, every route under `/api/engagement` answers:

```
404 {"error":"Not found"}
```

404 rather than 403, and the same body whichever flag is off, so the response
never reveals that the feature exists but is disabled for this workspace.

**With the flags off, the deployed system behaves exactly as it did before this
migration.** That is what makes Phase 1A safe to deploy before it is safe to use.

---

## Data model

Migration `database/migrations/0012_engagement.sql` (reverse: `0012_down.sql`).

Primary keys are `uuid` with `gen_random_uuid()` — matching what
`0000_base_schema.sql` declares, avoiding the bigint/uuid drift found between
production and QA on `group_sets`, and making the already-tested
`normalizeUuid()` the only id validator needed.

### `engagement_scan_tasks`

Statuses: `QUEUED` → `RUNNING` → `COMPLETED` | `FAILED` | `ABORTED`, plus
`CANCELLED` from the dashboard.

Lease columns (`worker_id`, `claimed_at`, `lock_expires_at`, `attempt_count`,
`max_attempts`) mirror the publish queue's shape but live on this table, so
`extendLock()` and the publish sweeps can never reach them.

`target_groups` is a jsonb array of `{id, name, url}` **resolved server-side**
from the workspace's own `groups` rows. The client sends group ids only.

### `engagement_discovered_posts`

`post_text` is capped at 2,000 characters by a CHECK constraint as well as by the
backend, because this is other people's personal content and the limit should not
depend on a single code path staying correct.

`posted_at` is nullable. Facebook often renders only a relative label ("2h",
"לפני שעתיים"); when no absolute time can be derived, `posted_at` stays null and
the literal label is kept in `posted_at_raw`. **A timestamp is never fabricated.**

No AI/relevance columns exist yet. `relevance_score`, `relevance_reason` and
`reviewed_at` are deliberately deferred to the migration that implements them.

---

## Scan caps

Product and safety limits, enforced by CHECK constraints **and** at the API layer,
so a direct API caller cannot request a large scrape:

| Limit | Value |
|---|---|
| `max_groups` | 1–5 |
| `max_posts_per_group` | 1–25 |
| posts per ingest HTTP batch | 50 (hard backend cap, independent of the above) |
| `post_text` stored | 2,000 characters |

Reading many posts quickly is not normal user behaviour, and the account doing it
is the user's own. The caps are conservative on purpose.

---

## Deduplication

`server/lib/engagementDedup.cjs`. **Computed server-side only.** A
client-supplied key could be crafted to collide with an existing row or to be
unique on every scan, evading the index entirely.

Priority, first match wins:

1. `fb:<facebook_post_id>` — from `/posts/<id>`, `/permalink/<id>`,
   `story_fbid=`, `fbid=`, `/videos/<id>`, or a `pfbid…` token
2. `url:<canonical>` — canonical URL
3. `hash:<sha256>` — over
   `workspace_id ␀ group_id ␀ author ␀ first 300 chars of normalised text ␀ day bucket`

Canonicalisation forces `https://www.facebook.com` for Facebook's own hosts
(`m.`, `mbasic.`, `web.`), collapses duplicate slashes, strips the trailing slash,
and **strips the query string wholesale**. Facebook regenerates `__cft__`,
`__tn__`, `ref` and `comment_id` on every render, so keeping any of them would
give the same post a different key on each scan. No post identity lives in the
query string. A non-Facebook host is left alone rather than rewritten.

The hash fields are joined with a NUL separator, which cannot occur in any of
them, so `("ab","c")` and `("a","bc")` cannot produce the same material.

Uniqueness is `unique (workspace_id, dedup_key)` — **per workspace, not global**.
Two tenants may legitimately discover the same public post, and a global unique
index would break isolation and leak the existence of another tenant's row
through a constraint violation.

**Known limitation.** The hash fallback keys on truncated text, so an edited post
or a different "See more" expansion between runs can produce a second row. It is
bounded — only posts with neither an id nor a URL — and it is the safer failure.
A looser key would merge two genuinely different posts and silently lose an
opportunity.

---

## API

Mounted at `/api/engagement` from `server/index.cjs` with a single `app.use()`.

| Method | Path | Auth |
|---|---|---|
| GET | `/scans` | dashboard |
| POST | `/scans` | dashboard + `denyDemo` |
| GET | `/scans/:id` | dashboard |
| POST | `/scans/:id/cancel` | dashboard + `denyDemo` |
| GET | `/discovered` | dashboard |
| POST | `/scans/claim` | worker |
| POST | `/scans/:id/posts` | worker |
| POST | `/scans/:id/status` | worker |

Conventions carried over from the existing hardening work:

- `normalizeUuid()` on every id **before** it reaches PostgREST; malformed →
  `400 {"error":"Invalid id"}`
- `scopeToWorkspace()` on every read, `workspaceFields()` on every insert
- `dbFailure()` from `server/lib/httpErrors.cjs` for driver errors — generic 500,
  SQLSTATE `22P02` → 400, never a raw Postgres message

### Server-side enforcement

The backend does not trust the client for any of this:

- **`post_text` truncation** to 2,000 characters, and the `is_truncated` flag
- **the dedup key**, computed from the submitted fields
- **`target_groups`**, resolved from the workspace's own groups
- **`posts_discovered`**, recounted from the table rather than incremented, so a
  retried batch cannot inflate it

---

## Tenant isolation

`req.workspaceId` on worker routes comes from the **verified device token**
(`requireWorker`). The `x-workspace-id` header is never consulted there.

Proven by `tests/phase19-engagement.test.cjs` with two real tenants: workspace A
cannot list, fetch, cancel or ingest into B's scans, cannot see B's discovered
posts, and a spoofed `x-workspace-id` header does not cross the boundary.

Within one workspace, a scan that is `RUNNING` may only be acted on by the worker
holding its lease. Worker ownership is checked **after** the row is read rather
than as a query filter: a finished scan has `worker_id` cleared, so filtering on
it would turn an idempotent duplicate report into a 404 and hide the real reason
a late ingest was refused.

RLS policies `p_engagement_scan_tasks_member` and
`p_engagement_discovered_posts_member` mirror the existing
`p_<table>_member` convention. The backend uses the service-role key and bypasses
RLS, so route-level scoping is the primary control and RLS is defence in depth
against direct PostgREST access with the public anon key.

---

## Audit

Written through `persistTenantSystemLog()`, workspace-scoped, `source =
'engagement'`:

`ENGAGEMENT_SCAN_CREATED` · `ENGAGEMENT_SCAN_CLAIMED` ·
`ENGAGEMENT_SCAN_COMPLETED` · `ENGAGEMENT_SCAN_FAILED` ·
`ENGAGEMENT_SCAN_CANCELLED` · `ENGAGEMENT_SCAN_RETRY_QUEUED`

Identifiers and counts only. **Post bodies, author names and group content are
never written to `system_logs`** — a scan can discover hundreds of other people's
posts, and `system_logs` is surfaced in the dashboard log viewer. Asserted by the
test suite, not just intended.

An audit write failure is logged and swallowed: it must never turn a successful
operation into a reported failure, or the caller would retry something that
already happened.

---

## Error codes

Reused unchanged from the publishing vocabulary, because they already mean the
right thing and `fbUtils.detectFacebookState()` already returns the first three:

`FACEBOOK_LOGGED_OUT` · `CAPTCHA_REQUIRED` · `CHECKPOINT_REQUIRED` ·
`ACCOUNT_RESTRICTED` · `GROUP_NOT_FOUND` · `NO_GROUP_ACCESS` ·
`PAGE_LOAD_TIMEOUT` · `NETWORK_TIMEOUT`

Engagement-specific: `SCAN_PREEMPTED_BY_PUBLISH` (retryable — the scan yielded
the Facebook tab), `SCAN_LIMIT_REACHED`, `NO_POSTS_FOUND`,
`PARSER_NO_STRATEGY_MATCHED` (every extraction strategy failed — the signal that
Facebook's layout moved).

Retry policy: unknown error codes are treated as **needing a human**, not as
retryable. A scan is not time-critical, and silently retrying something we do not
understand against Facebook is the riskier default. Checkpoint, captcha and
restriction codes are terminal — retrying while Facebook is already showing a
checkpoint is how an account gets restricted further.

---

## Testing

```bash
npm run test:engagement-dedup   # pure unit, no database
npm run test:engagement         # two real tenants against a running backend
```

`test:engagement` requires the backend running with `ENGAGEMENT_ENABLED=true`,
and refuses to run against the production project.

The fleet kill switch is exercised against an in-process Express app mounting the
real router, because `server/index.cjs` hardcodes port 3001 and the flag is read
from the server process's own environment.
