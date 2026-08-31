# SafePost Implementation Progress

## Project status

- **Phases 3–7: BUILT + TESTED** ✅ (locally on fresh dev Supabase)
- Active repository: **`safepost-backup`** (Phase 2 deployed to production, 84ca5b7)
- Branch: `feature/phase3-auth` (local, not pushed; latest 4958df9)
- **Fresh dev Supabase**: `cfluldwfbhprpkptukkm` (new project)
  - All migrations applied (0000–0007) via Management API
  - Demo user + synthetic data seeded
  - `.env.local` ready for `npm run dev`
- Test results: phase3 isolation **11/11**, phase4 demo **6/6**, phase5 pairing **13/13**, phase6 queue **10/10**, phase7 detection **13/13** (jsdom)
- Local backend running on http://localhost:3001 ✅
- Local frontend ready at http://localhost:5173 (run `npm run dev`)
- Last updated: 2026-07-18

## Phase checklist

- [x] Phase 1 — Backup and inventory
- [x] Phase 2 — Repository cleanup (local; awaiting deploy approval)
- [ ] Phase 3 — Authentication and workspaces
- [ ] Phase 4 — Demo and external users
- [ ] Phase 5 — Extension pairing
- [ ] Phase 6 — Queue and scheduling
- [ ] Phase 7 — Facebook extension stability
- [ ] Phase 8 — Backend and frontend refactor
- [ ] Phase 9 — Media, logs, and realtime
- [ ] Phase 10 — Tests, documentation, and release
- [ ] Final acceptance checklist

## Completed work

Phase 1 (non-destructive; no application behavior changed):

- Inspected both repositories (git state, structure, subsystem sizes).
- Produced `docs/INVENTORY.md` (per-subsystem comparison + per-file inventory).
- Produced `docs/RESTORE.md` (full restore procedure).
- Created a source-only file snapshot of both repos:
  `backups/pre-refactor-2026-07-17-0027/{safepost-main,safepost-backup}/`
  (excludes node_modules, .env, .git, dist/build, caches).
- Created git branch `backup/pre-refactor` and tag `pre-refactor-2026-07-17` in
  **both** repos, **local only (not pushed)**.
- Ran all Phase 1 verification checks (all passed).

## Current findings

- **Repository roles are INVERTED vs. the Master Plan.** The plan calls
  `safepost` the main repo and `safepost-backup` the backup. In reality:
  - `safepost-backup` (`.../safepost-backup-clean`, branch `main`) is the
    **live, production-deployed** system (Vercel), with real git history +
    release tags, the fuller backend (`server/index.cjs` 1742 ln) and frontend
    (`App.jsx` 1674 ln), and a clean tree.
  - `safepost` (`.../safepost-dev`, branch `upgrade`) has only 2 "Initial
    Backup" commits, a dirty tree (7 untracked components), no `.env`, but more
    **breadth**: Analytics/AssetLibrary/ContentCalendar/Settings components,
    an AIStudio page, an alternative `backend/` (worker.js/Docker), and the only
    in-repo Supabase migrations.
- **Recommendation (deferred to user):** adopt `safepost-backup` as the primary
  and harvest the unique pieces (migrations + analytics/media/calendar
  components) from `safepost`. Details in `docs/INVENTORY.md`.
- Duplicate extension implementations exist (`extension/` + `safe_post_extension/`
  + `extension.zip`) — must be reduced to one in Phase 2/5.
- Oversized files (`server/index.cjs`, `src/App.jsx`) flagged for Phase 8.

## Files changed

No application code changed. New artifacts only:

- `docs/INVENTORY.md` (new)
- `docs/RESTORE.md` (new)
- `docs/PROGRESS.md` (updated)
- `backups/pre-refactor-2026-07-17-0027/` (new snapshot, both repos)
- git branch `backup/pre-refactor` + tag `pre-refactor-2026-07-17` (both repos, local)

## Database migrations

None created. Existing migrations found only in `safepost` (main):
`supabase/migrations/20260212_fail_fast.sql`, `.../20260212_tags_presets.sql`.
Not applied or modified in Phase 1.

## Tests executed

No automated tests run. Servers deliberately **not started** — running the
backend/extension could trigger real Facebook publishing, which project rules
forbid. Startup was assessed statically (see `docs/INVENTORY.md`):
- `safepost-backup`: expected to start (`.env` + `node_modules` present).
- `safepost` (main): blocked — no `.env` (only `.env.development.local`).

## Known issues

- Repository naming inverted vs. plan (see findings).
- Main repo cannot start without a recreated `.env`.
- Duplicate extension/backend implementations unresolved (later phases).
- Phase 1 git markers are local only; push explicitly if off-machine recovery
  is required.

## Decisions

- Backed up **both** repos (not just one) because the primary is not yet chosen.
- Created branch/tag in both repos, **without pushing**, to keep
  `safepost-backup` unmodified on its remote per CLAUDE.md.
- Did not run servers to avoid any risk of real publishing.

## Phase 2 — Repository cleanup (2026-07-17)

Primary repo chosen: **`safepost-backup`** (production system). All work on local
branch `refactor/phase2-cleanup`; **nothing pushed**, `main` unchanged (af22c06).

### Files changed (committed as 1742c2a)
- Added: `.env.example`, `README.md`, `CHANGELOG.md`, `docs/ARCHITECTURE.md`,
  `src/lib/apiConfig.js`, `public/popup.js`, `safe_post_extension/popup.js`.
- Modified: `.gitignore`, `build.sh`, `server/supabaseClient.cjs`,
  `src/components/panels/AnalyticsPanel.jsx`, `public/manifest.json`,
  `public/popup.html`, `safe_post_extension/{background,extensionStorage,manifest,popup.html}`.
- Removed: `extension/` (v7.0 duplicate), `extension.zip`, tracked `dist/` (15
  files, now git-ignored), obsolete scripts (`test_supabase.cjs`,
  `test_task_deletion.cjs`, `test_upload.txt`, `verify_posting_fix.cjs`,
  `fix_supabase_corrected.cjs`).

### Verification
- `npm run build` succeeds (1636 modules, dist regenerated).
- `node --check` passes on all changed JS.
- Extension build copy + settings popup ship to `dist/` (manifest v7.3).
- `.env` not staged; `safepost-claude-plan/` not staged; `main` untouched.

### Tests executed
No automated test suite exists yet (added in Phase 10). Verification was build +
syntax checks. Servers not started (avoid real publishing).

### Known issues / follow-ups
- **Security:** hardcoded Supabase key removed from working tree but still in git
  history → history scrub + key rotation are deferred scope; do before public.
- **Structural:** extension is still assembled from two locations (`public/` +
  `safe_post_extension/`); a single-source `extension/` normalization needs
  in-Chrome testing before deploy (documented in `docs/ARCHITECTURE.md`).
- Extension settings popup is additive but **untested in Chrome** — load-unpack
  and verify before deploying.

## Phase 3 — Auth & workspaces (2026-07-17)

Branch `feature/phase3-auth` (commit 9fcaa89), local only. `main` untouched.

### Part 1 — DONE (foundation, no enforcement, does not change current behavior)
- **Migrations** `database/migrations/0001..0004` (+ `*_down.sql` + README):
  profiles/workspaces/workspace_members + role enum + new-user trigger;
  `workspace_id`/`created_by` on posts/groups/post_templates/group_sets/system_logs;
  backfill to an "Original Owner" workspace; RLS policies + NOT NULL.
- **Backend** `server/middleware/auth.cjs`: `requireAuth`, `optionalAuth`,
  `requireWorkspaceAccess` (validates Supabase JWT + membership). Permissive
  authenticated Socket.IO handshake + workspace rooms in `server/index.cjs`.
- **Frontend**: Supabase auth client, `AuthContext`, login/register/reset screen,
  `AuthGate`, token + `x-workspace-id` injected into `ApiService`/uploads, socket
  re-handshake on auth change. `.env.example` gains `VITE_SUPABASE_*`.
- **Safety**: with `VITE_SUPABASE_*` unset the dashboard stays OPEN (current
  behavior); backend routes are not yet scoped. Deploying this as-is changes
  nothing until the env vars are set.
- **Verified**: `npm run build` passes (1679 modules); `node --check` passes.

### Part 2 — DONE in code (commit 639a57f), not yet validated against a DB
- **Conditional enforcement** via `AUTH_ENFORCED` env flag + `scopeToWorkspace()`
  / `workspaceFields()` helpers in `server/middleware/auth.cjs`.
- Wired `requireAuth` + `requireWorkspaceAccess` into all dashboard routes and
  scoped every `posts`/`groups`/`post_templates`/`group_sets` query by
  `req.workspaceId`; set `workspace_id`/`created_by` on inserts; strip those from
  task PATCH bodies. 28 routes now authenticated.
- Extension/worker routes (jobs/next, worker/ack, heartbeat, tasks status,
  groups/sync, stream/jobs) intentionally left unauth → Phase 5 pairing.
- Tests: `tests/phase3-isolation.test.cjs` (register/login, 401 unauthorized,
  A≠B isolation, cross-workspace 403, private workspaces).
- **Safety**: with `AUTH_ENFORCED` unset (production today) every route stays
  open + unscoped exactly as before. `node --check` + `npm run build` pass.

### Blocker — needs the FRESH dev Supabase project
To validate: apply migrations `0001..0004` to the dev project, set the dev
`SUPABASE_URL`/`SUPABASE_SERVICE_KEY` + `AUTH_ENFORCED=true` on the backend and
`VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` on the frontend, run the backend,
then `node tests/phase3-isolation.test.cjs`.

Required from user: dev project **URL + anon key + service key** (chosen path:
create a fresh project).

## Phase 4 — Demo & external users (2026-07-17, commit 4ede664)

Branch `feature/phase3-auth`, local only. `main` untouched.

- **Migration 0005**: `is_demo` on workspaces (+down).
- **Demo data** `server/demo/seed.cjs`: synthetic groups/posts/templates/logs
  (fictional, example.com URLs only). Demo posts use `app_source='demo'` → the
  worker (jobs/next filters `backup`) never claims/publishes them.
- **Backend guards**: `req.isDemo` resolved in `requireWorkspaceAccess`;
  `denyDemo` blocks real-effect routes (upload, upload/presigned, worker
  stop/resume, groups/request-sync) with a clear message; `POST /api/demo/reset`
  re-seeds (demo only, scoped).
- **Setup** `scripts/setup-demo.cjs`: create demo account + flag/seed workspace.
- **Frontend**: `DemoBanner` ("Demo Mode — no real posts will be published" +
  Reset + Exit), "Try the demo" login entry, `isDemo` in AuthContext. Demo entry
  appears only when `VITE_DEMO_*` set.
- **Tests** `tests/phase4-demo.test.cjs`: synthetic-only data, upload/worker
  blocked (403), reset works.
- External-user path (register → private workspace → own data) already delivered
  by Phase 3; extension pairing is Phase 5.
- **Verified**: `npm run build` (1680 modules) + `node --check` pass. Untested
  against a live DB.

### Known limitations / follow-ups
- Demo controls disabling in the main dashboard UI is enforced server-side
  (clear 403 message via Toast); per-button disabling in the large `App.jsx`
  is deferred (banner + backend block cover the requirement).
- Everything Phases 3–4 remains **unvalidated against a database**.

## Dev validation — DONE (2026-07-17)

Ran against dev project `hfpsdzfggugoerythnug` with the backend on
`AUTH_ENFORCED=true`:
- Applied base + auth migrations (0000, 0001 tables, 0002, 0005) via SQL editor.
  NOTE: the `auth.users` signup trigger (0001) is **not** used — newer Supabase
  disallows it; replaced by backend `provisionUserWorkspace()` on first access.
- `node scripts/setup-demo.cjs` → demo account + seeded workspace.
- `tests/phase3-isolation.test.cjs` → **11/11 passed** (401s, per-user
  workspaces, A cannot read/modify B, cross-workspace 403).
- `tests/phase4-demo.test.cjs` → **6/6 passed** (synthetic data visible,
  upload/worker blocked in demo, reset works).
- Bug found + fixed: dashboard read routes now include `app_source in
  ('backup','demo')` so demo workspaces show seeded data.

### Not yet applied / deferred to cutover
- `0003` (backfill existing prod rows to Original Owner) and `0004` (RLS policies
  + NOT NULL) — needed for the PRODUCTION cutover, not for dev behavior tests.
  RLS matters once the frontend talks to Supabase directly with the anon key.

## Phase 5 — Extension pairing (backend) (2026-07-17, commit e1623a4)

Branch `feature/phase3-auth`, local only.
- Migration `0006`: `pairing_codes` + `browser_workers` (+down).
- `server/middleware/worker.cjs`: device-token auth (`requireWorker`).
- Worker/pairing endpoints in `index.cjs` (pairing-code, pair, heartbeat,
  jobs/claim scoped to the worker's workspace, jobs/:id/status, logs, list,
  revoke, rename, delete). Realtime status emits to `ws:{workspaceId}`.
- `tests/phase5-pairing.test.cjs`: expiration, single-use, wrong token, revoked,
  cross-workspace revoke denied, demo-cannot-pair, worker job isolation.
- **UI (commit fc82778)**: dashboard `WorkersPanel` (list devices + status +
  pairing-code generator + rename/revoke/remove, opened via a "Devices" button);
  extension popup pairing (enter code → `/api/workers/pair`, stores device token,
  Unpair); background is paired-aware (claims/heartbeats via worker endpoints when
  paired, legacy fallback otherwise). Manifest 7.4. Build + node --check pass.
- **Pending**: apply `0006` on dev + run `tests/phase5-pairing.test.cjs`
  end-to-end; in-Chrome test of the pairing flow before deploy.

## Phase 6 — Queue hardening (2026-07-18, commit b85e04d)

Branch `feature/phase3-auth`, local only.
- Migration `0007`: locking/retry/idempotency columns on `posts` + unique
  idempotency index; `missed_schedule_policy` + `timezone` on workspaces.
- `server/lib/queue.cjs`: error classification, atomic `claimNextJob()` lock (no
  duplicate execution), `extendLock()` on heartbeat, `reportJobStatus()` with
  persistent idempotency + exponential backoff, `sweepExpiredLocks()` +
  `sweepMissedSchedules()`.
- `index.cjs`: worker claim/status endpoints use the locked queue; 60s DB-backed
  sweep interval (survives restarts).
- `QueueTable`: new status badges + attempt/retry visibility.
- `tests/phase6-queue.test.cjs`: locking, idempotency, retry/non-retry, lock
  expiry recovery, missed schedule.
- **Pending validation**: apply `0006` + `0007` on dev, run phase5 + phase6 tests.

## Validation backlog (needs 0006 + 0007 applied to dev)
- `tests/phase5-pairing.test.cjs` and `tests/phase6-queue.test.cjs`.
- One combined SQL block (0006 + 0007) unlocks both.

## Phase 7 — Facebook extension stability (2026-07-18, commit 3efe31c)

Branch `feature/phase3-auth`, local only.
- `safe_post_extension/fbUtils.js`: layered, language-independent (HE+EN) DOM
  detection with diagnostics — findPostComposer/EditableArea/MediaButton/
  FileInput/PublishButton, waitForElement(Enabled), detectLoginState/Captcha/
  Checkpoint/FacebookState (→ Phase 6 error codes), STAGES, buildDiagnostics.
- Loaded before content.js (manifest) + copied by build.sh; manifest 7.5. The
  existing content.js posting logic is untouched (safe adoption path).
- `tests/phase7-detection.test.cjs` (jsdom): **13/13 PASS** — runnable here
  without a DB (the first non-DB validated phase besides 3/4).
- **Pending**: integrate fbUtils into content.js's live flow + verify in Chrome.

## Test status summary — ALL GREEN ✅
- Phase 3 (isolation): 11/11 ✅ (dev)
- Phase 4 (demo): 6/6 ✅ (dev)
- Phase 5 (pairing): 13/13 ✅ (dev)
- Phase 6 (queue): 10/10 ✅ (dev)
- Phase 7 (detection): 13/13 ✅ (jsdom)
- Migrations 0006+0007 applied to dev via the Supabase Management API (PAT).

## ⚠️ CRITICAL — Supabase project names are INVERTED vs. reality
- `namyhsldzufeoycleqxf` is NAMED "safepost-dev" but is the **LIVE PRODUCTION** DB
  (the deployed app connects to it). NEVER run migrations/tests against it.
- `hfpsdzfggugoerythnug` is NAMED "SafePost - Prod" but is the actual **dev**
  project (all our testing ran here; not connected to the live app).
- The prod-URL guard in scripts blocks `namyhsldzufeoycleqxf`. Recommend renaming
  the projects in the dashboard to match reality.

## QA verification run — 2026-08-31 (branch `beta-p0-hardening`)

Ran against a THIRD Supabase project, `tesagheacuzkhecaihte` (QA), which holds a
clone of the real business tables (188 groups, 5.7k logs) — not a fresh DB. psql
17.6 was installed portably (official EDB binaries zip extracted to the session
scratchpad; no admin/UAC, no service, nothing added to PATH).

Migrations 0000→0011 applied. `0003_backfill_owner` WAS required (legacy rows
exist and 0004 sets `workspace_id NOT NULL`); it ran from a scratchpad copy with
`v_owner_email` pointed at a disposable QA user `qa-owner@safepost.local` — the
tracked file keeps its `CHANGE_ME@example.com` placeholder.

**Four real defects found and fixed** (all reproduce on any DB that already had
the business tables — i.e. production too):

1. `0008` dropped the posts→groups FK **by hardcoded name** (`posts_group_id_fkey`).
   The real schema names it `fk_posts_groups`, so the drop silently skipped and
   step 4 died: *cannot drop constraint groups_pkey ... fk_posts_groups depends
   on index groups_pkey*. Now dropped by definition, not by name.
2. `server/lib/queue.cjs` `claimNextJob()` selected `'*, groups(name, url)'` — a
   PostgREST embed needing the very FK 0008 removes. Every claim returned
   PGRST200, the error was swallowed (`{ data }` only), and the function returned
   null: **no job could ever be claimed, so nothing could publish.** Fixed with a
   composite-key group lookup that also supplies `group_url`, which
   `background.js:246` needs to open the Facebook tab and never received.
   → new migration `0010_legacy_column_gaps.sql` also adds `posts.media_paths`
   (every task insert sends it — post creation failed outright) and
   `groups.created_at`; `0000`'s `CREATE TABLE IF NOT EXISTS` is table-level, so
   it never filled column gaps on pre-existing tables despite its header claim.
3. `POST /api/workers/pairing-code` had no `denyDemo`. A demo workspace could
   mint a pairing code — a bearer credential letting a real extension join it and
   claim jobs. Every other real-effect route was already guarded.
4. `0004` ADDS `p_*_member` policies but never removed the pre-auth ones. Postgres
   ORs permissive policies, so `USING (true)` policies for **anon** on posts and
   groups (plus "Allow all access" on post_templates / group_sets) won: anyone
   with the public anon key from the frontend bundle could read, edit and delete
   every workspace's data straight through PostgREST. `pairing_codes` and
   `browser_workers` had RLS fully disabled (0006 ran after 0004) with full anon
   grants. → new migration `0011_isolation_hardening.sql` drops non-workspace
   policies by rule (not by name), enables RLS on the pairing/worker tables, and
   locks `app_config` to service-role. Verified with the anon key: reads return
   `[]`, insert is refused 42501, delete/update touch 0 rows.

Test bug fixed: `phase4-demo` resolved the demo workspace through an
**unauthenticated** anon client, which only worked while RLS was unapplied.

Coverage added: `phase6` regression for the claim/embed bug + `group_url`;
`phase9` now covers **SSE** isolation (previously Socket.IO only) via two paired
workers.

Results — all green against QA with `AUTH_ENFORCED=true WORKER_AUTH_ENFORCED=true`:
validation 7/7, sync ✅, performance ✅, phase3 11/11, phase4 6/6, phase5 13/13,
phase6 12/12, phase7 13/13, phase8 3/3, phase9 5/5, `npm run build` ✅.
Fail-closed confirmed: in `NODE_ENV=production` both flags default to true and
the server refuses to boot with either set to `false`, or with `SUPABASE_URL`
missing, or `EXTENSION_API_KEY` without `EXTENSION_KEY_WORKSPACE_ID`.

Still open: `campaign_templates`, `group_presets` and `system_settings` keep
public `USING (true)` policies (legacy, outside the workspace model) — anon can
still read/write them. Not changed here; decide before beta.

## Group sync — live QA run, 2026-08-31 (branch `beta-p0-hardening`)

Blocker was "SYNC GROUPS clicked, no POST /api/groups/sync, GET /api/groups empty".
Traced live in the existing Chrome profile via the persistent DevTools MCP bridge.

**The wiring was never broken.** The button does NOT message the background worker:
`injectButton()` → `btn.onclick` → `scrapeAndSyncGroups()` runs IN THE CONTENT SCRIPT,
scraping **whatever page is open**, and only then posts
`{action:"SYNC_GROUPS"}` to background.js, which does the `/api/groups/sync` call.
Two things stopped it:

1. **Wrong page.** The tab was on the feed (`facebook.com/`), not the joined-groups
   list. The scraper found 0 groups, so it alerted and never sent the message — no
   POST is emitted by design when the count is zero. `background.js`'s own
   `scanAndSyncGroups()` navigates to `/groups/joins/?nav_source=tab` first; the
   content-script button has no such step and silently depends on the user being
   on the right page.
2. **The button is rebuilt every 5 seconds** (`setInterval(injectButton, 5000)`
   removes and re-appends the node). A CDP click failed outright with "element did
   not become interactive"; measured 2 distinct nodes in 8 seconds. A click landing
   in that window is simply lost — which matches "the click succeeded but nothing
   happened".

On `/groups/joins/` the flow ran end to end: SYNC CLICKED → 172 groups scraped →
SYNC_GROUPS → POST → **172 rows** in QA under `qa_live_9x3qd1's workspace` with
`facebook_user = "Smart Choice gadgets"`, no duplication, no cross-workspace
contamination (the 188 legacy rows stayed in Original Owner). `GET /api/groups`
returns 172 with and without `?user=`.

**Real bug found and fixed:** the manual CORS middleware (`index.cjs`, above the
`cors()` package — it answers OPTIONS itself with `res.end()`, so the package
config never sees a preflight) allowed only
`Content-Type,Authorization,x-requested-with,x-workspace-id`. The content script
calls `/api/profile/sync` from origin `https://www.facebook.com` with
`x-device-token`/`x-worker-id`, so **every** such call died in preflight
("Request header field x-device-token is not allowed"). `syncDetectedFacebookUser`
swallows the failure and returns the locally detected profile, so group sync still
carried the right user and the breakage stayed invisible. Background service-worker
fetches bypass CORS via host_permissions, which is why `/api/groups/sync` worked.
Both CORS lists now carry all four headers the backend actually reads. After the
fix: 0 CORS errors and "✅ Synced Facebook user to server" succeeds.
Covered by `tests/phase10-extension-cors.test.cjs` (`npm run test:phase10`, 7/7).

Not fixed (left for a decision, both are real): the 5-second button churn, and the
content-script sync path having no "navigate to the groups page first" step.

## Publish-outcome correctness — 2026-08-31 (branch `beta-p0-hardening`)

Two live controlled publishes were run against one third-party group (explicitly
authorised by the operator). #2415 published for real; #2435 went into that group's
approval queue — and SafePost recorded it as **SUCCESS**. Root cause:
`waitForModalClosure()` inspected only the OPEN `div[role="dialog"]` and its first
line is `if (!dialog) return true`, so the moment Facebook accepted the submission
into moderation (which closes the composer exactly as a real publish does) it
returned "published" before anything on the page was examined. The pending banner
renders on the GROUP page *after* the dialog closes. The existing `PENDING_REVIEW`
branch therefore could essentially never fire. A second path was worse still: a
closure *timeout* also reported SUCCESS.

Also found and fixed: the previous session's status-callback fix routed paired
workers to the hardened endpoint, but `reportJobStatus()` had no CANCELLED branch —
so the pre-flight moderation report (`CANCELLED` + 'ממתין לאישור מנהל') fell through
to the retry classifier, which treats an absent error code as retryable and would
have **requeued the job and published the same post twice**.

Now: after submit, `verifyPublishOutcome()` requires positive evidence, in order —
pending-approval banner (reusing `detectAdminApprovalBanner`, whose first phrase is
the exact banner observed live) → real permalink → own content located in the feed.
Anything else is `PUBLISH_UNVERIFIED`, added to the queue's NEEDS_USER_ACTION set so
it is terminal and never auto-retried (retrying a submission that did go through
duplicates the post). `findPostPermalink()` now returns null instead of the group
URL — that fallback was what let an unfound permalink pass as proof of publication.
No new status and no schema change: moderation reuses the existing
`CANCELLED` + 'ממתין לאישור מנהל' convention that `requires_moderation`, the
analytics `moderationRate` and the 48h resume sweep already key off.

`tests/phase11-worker-status-callback.test.cjs` grew to **45/45** over the real HTTP
worker route. Regression: phase5 13/13, phase6 12/12, phase7 13/13, phase10 7/7,
test:security, `npm test`, `npm run build` — all green.

Open risk: the 48h moderation resume sweep re-posts a moderation-CANCELLED job (cap
2 attempts). If an admin approves the held post before the sweep fires, that resume
duplicates it. Pre-existing behaviour, not introduced here — decide before beta.

## Moderation resume safety — 2026-08-31 (branch `beta-p0-hardening`)

The 48h moderation resume sweep carried a comment stating that moderation-CANCELLED
posts "reach CANCELLED directly from the content script's pre-flight check". That
was true when written — on that path **nothing had been submitted**, so re-queueing
was harmless. The post-submit moderation detection added earlier the same day
reports CANCELLED with the identical 'ממתין לאישור מנהל' marker for a post that WAS
submitted and is sitting in the group's approval queue. The sweep could not tell
them apart, so after 48h it would have republished a post a moderator may already
have approved — a duplicate Facebook post from an automated system.

Fix: the two cases now carry distinct `error_code` values —
`MODERATION_BLOCKED_NOT_SENT` (pre-flight, nothing sent) and
`MODERATION_PENDING_SUBMITTED` (submitted, awaiting a moderator). The sweep selects
**positively** on the first, which also makes the default safe: legacy rows and
reports that came through the legacy PATCH route (which never persisted error_code)
have no marker and are therefore left CANCELLED for a human instead of being
republished on a guess. Both codes ride only on `status: 'CANCELLED'`, which returns
from reportJobStatus before classifyError, so neither can be mistaken for a
retryable technical error. The resume also clears error_code now, so a re-queued row
does not carry a stale marker into its next attempt.

No schema change: `error_code` already existed on posts.

`tests/phase12-moderation-resume-safety.test.cjs` drives the REAL sweep (seeds rows,
waits for the 60s heartbeat) — 14/14. It proves the un-submitted job still resumes,
the submitted one never does, unmarked legacy rows never do, the attempt cap still
holds, no duplicate rows appear, and genuine technical failures still retry over the
real HTTP worker route.

Regression: phase5 13/13, phase6 12/12, phase7 13/13, phase10 7/7, phase11 45/45,
test:security, `npm test`, `npm run build` — all green.

## P0 — Dry-run hard guard (2026-08-31, branch `beta-p0-hardening`)

INCIDENT: a dry run published a real Facebook post. Root cause is that dry run
never existed in the extension — it was a convention about when the operator or
the agent would interrupt. `executeJob` always ran straight through
`clickPostButton()` → `humanClick()` → `el.click()`.

Publish-path audit (the whole submission surface):
`clickPostButton()` has two strategies — semantic text match and the heuristic
blue-button fallback — and BOTH funnel into `humanClick()`, whose `el.click()` is
the single real submission in the extension. There is no Enter-key, form-submit or
`requestSubmit()` path anywhere (the only `[type="submit"]` occurrence is a
selector string in fbUtils, not an action). Other `.click()` calls are the composer
trigger and the media picker.

Guard, defence in depth:
- `SafePostFB.resolveDryRun()` in fbUtils.js — pure and unit-testable.
- `isDryRunEnabled()` in content.js reads `chrome.storage.local` FRESH on every
  call (toggling takes effect on the next job, no reload) and returns **true** on
  any read failure — an unevaluable setting must never be why a real post goes out.
- `clickPostButton()` returns the `DRY_RUN_BLOCKED` sentinel before it even looks
  for a button; `humanClick()` refuses independently, so a future caller that
  forgets the outer check still cannot publish.
- Both strategies convert a refused click into the sentinel, so a blocked publish
  can never be reported as a successful one.
- The sentinel is handled BEFORE `if (clicked)` — it is a truthy string, and that
  check would otherwise have walked it into the SUCCESS path.

Default: an explicit stored boolean always wins. Unset falls back to the API URL —
a local backend is a QA/dev install and defaults to BLOCKED; a remote backend keeps
publishing, so shipping this does not silently disable production.

Backend: dry run reports `CANCELLED` + `error_code=DRY_RUN_BLOCKED`, which the
existing CANCELLED branch already terminates safely (ended_at, lock and worker
cleared, no requeue). The 48h moderation sweep filters on
`MODERATION_BLOCKED_NOT_SENT`, so a dry run is never resumed. No schema change.

Visible control: a Dry Run Mode toggle at the top of the extension popup, showing
"🛑 ON — publishing is BLOCKED" or "⚠️ OFF — this install CAN publish to Facebook".

`tests/phase15-dry-run-guard.test.cjs` — 34/34. Includes SOURCE INVARIANT checks
(no `.click()` outside the guarded helper, every call site consumes the return,
sentinel handled before the truthy branch) so a future change that adds a publish
path fails the suite. Regression: phase7 13/13, phase11 45/45, phase12 14/14,
phase13 2/2, phase14 8/8, build ✅.

### P2 (recorded, NOT fixed): dashboard worker telemetry
Heartbeat can display as stale and extension version as vUNKNOWN in the dashboard.
The DB is correct — `browser_workers` shows `status=online`, a fresh `last_seen_at`
and `extension_version=9.0` — so this is a dashboard read/render issue, not a
worker problem. Deliberately out of scope of the P0 safety task.

## QA polish — 2026-08-31 (branch `beta-p0-hardening`)

**Popup contrast.** The Dry Run block was added with light "warning" colours
(`#fffbeb` / `#fef2f2`) inside a popup that is dark-only (`color-scheme: dark`,
body `#0d1117`). Its subtitle also inherited the muted `label` grey `#8b949e`, so
"Prevent final Facebook publish" rendered grey-on-cream and was effectively
invisible. Rewritten as `.dryrun` CSS classes using the popup's own GitHub-dark
accents (amber `#e3b341` for ON, red `#ff7b72` for OFF) on `#161b22`, with state
carried by a class instead of per-element inline styles. Measured in the live
popup: title 14.64:1, subtitle 11.21:1, ON state 8.89:1, OFF state 6.86:1 — all
above WCAG AA. The OFF state was measured on a detached clone so the real
dryRunMode setting was never turned off (`settingUntouched: true`).

**Worker telemetry — same bug family as the status-callback one.** A PAIRED
extension heartbeats to `/api/workers/:id/heartbeat`, which writes to
`browser_workers`. The legacy `/api/worker/heartbeat` instead fills the in-memory
`tenantState`, and `/api/system/status` — which feeds the dashboard's worker badge
— read ONLY that memory. For a paired install `lastWorkerCheckin` therefore stayed
null and `lastWorkerVersion` stayed `'UNKNOWN'` forever, so a healthy worker showed
as a stale heartbeat and vUNKNOWN while the database said online/9.0.
`/api/system/status` now also reads the workspace's newest non-revoked
`browser_workers` row and uses whichever source checked in more recently. Unpaired
installs are unaffected. `/api/workers` (the WorkersPanel list) was always
DB-backed and was never wrong. No auth or pairing behaviour changed.

Live after the fix: `worker_status=ACTIVE`, `worker_version=9.0`, checkin age 33s.

`tests/phase16-worker-telemetry.test.cjs` — 13/13, including that a stale heartbeat
still reports OFFLINE (the fix must not pin it ACTIVE) and that a workspace with no
worker does not invent one. Regression: phase15 34/34, phase5 13/13, phase9 5/5,
phase11 45/45, build ✅.

## Next approved phase

Phase 8 (Backend & frontend refactor) — OR the reviewed **production cutover** of
Phases 3–4 (Supabase env on Vercel/Render, prod migrations incl. 0003/0004, owner
account, flip `AUTH_ENFORCED=true`). Reversible.
