# SafePost — Session Log (2026-08-07)

## ⚠️ Regression introduced and reverted in this session

An audit earlier in this session concluded that `/api/queue`, `/api/system/status`,
`/api/worker/heartbeat`, `/api/worker/stop` and `/api/worker/resume` were "missing"
and added new implementations near the top of `server/index.cjs`.

**That conclusion was wrong.** All five already existed further down the same file
(lines ~1750–2110). Express matches the *first* registered route, so the new
handlers shadowed the real ones.

### Symptom this caused

The dashboard's Worker panel showed **"No Signal"** and **"vUNKNOWN"**.

The unpaired extension posts its heartbeat to `/api/worker/heartbeat`. The real
handler sets the module-level `lastWorkerCheckin` / `lastWorkerVersion` /
`lastWorkerOrigin` / `lastWorkerExtensionId` variables, which `/api/system/status`
reads back. The shadowing duplicate answered `200 OK` without ever setting them —
so the extension *was* connecting the whole time, and the server was silently
discarding every check-in.

The source comment at `server/index.cjs:2194` already warned about this exact
regression having happened once before.

### Also reverted

The group-sync upsert had its `{ onConflict: 'workspace_id,facebook_user,id' }`
removed in favour of "batching". That composite key is what lets the same Facebook
group exist once per account; without it every account collapses onto a single row.
The "duplicate key" error that motivated the change came from a flawed test that fed
two rows with the same id in one payload — something `/api/groups/sync` can never
produce, since it de-dupes via `seenGroupIds` before upserting.

### Current state

All five endpoints appear exactly once (the originals). `onConflict` restored.
Verified live against a running backend:

```
status before heartbeat → worker_status: OFFLINE, worker_version: UNKNOWN
POST /api/worker/heartbeat {manifest_version:"9.0", origin_folder:"safe_post_extension"}
status after heartbeat  → worker_status: ACTIVE,  worker_version: 9.0
```

`/api/queue` returns full task objects again (the stub returned only 4 fields, which
would also have broken the queue table's group/content/failure columns).
`worker/stop` → `worker_stopped:true`, `worker/resume` → `worker_stopped:false`.
Same group id under two different `facebook_user` values → 2 rows retained.

---

## What was actually added (and kept)

| Item | File | Notes |
|---|---|---|
| Validation tests | `server/tests/validation.test.cjs` | 7 Joi schema cases, 7 passing |
| Sync integration test | `server/tests/sync.test.cjs` | Now asserts the composite key holds |
| Performance benchmarks | `server/tests/performance.test.cjs` | 4 queries, all <500ms |
| `npm test` scripts | `package.json` | Runs the three suites in sequence |
| API reference | `API.md` | Endpoint shapes taken from the real handlers |
| Structured logger | `server/lib/logger.cjs` | **Not yet wired into anything** |

Cleanup of some `console.debug` calls in `src/App.jsx` (profile polling fallback)
was also kept — behaviour unchanged.

---

## Verified, not claimed

These were checked against the code this session:

- No `eval` / `new Function` in `server/index.cjs`.
- Secrets come from `process.env`, not literals.
- Rate limiting present: 500/min general, 20/15min on upload + AI.
- Input validation via Joi on `/api/posts` and status updates.
- `runDispatchTick` releases `dispatchLockActive` in a `finally` block.
- Interactive controls in `src/App.jsx` carry `aria-label` + `title`.

## Not verified

No claim is made about overall test coverage, success rates, or a numeric quality
score — none of those were measured. There are no frontend component tests, no E2E
tests, and no extension integration tests.

---

## Lesson for next time

`Grep` without `output_mode: "content"` returns *filenames only*. Reading
"Found 1 file" as "the endpoint is missing" is what started this. Before adding any
route, grep for it with `output_mode: "content"` and confirm the line numbers.
