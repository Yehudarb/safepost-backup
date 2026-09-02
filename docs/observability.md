# SafePost public health endpoint

`GET /api/health` is public and returns aggregate operational data only.

- HTTP `200` with `status: "healthy"` means the database connectivity probe and
  all aggregate metric queries completed within 2.5 seconds.
- HTTP `503` with `status: "degraded"` means the database was unreachable, the
  deadline expired, or an aggregate metric could not be read.
- Database errors and stack traces are intentionally omitted from the response.

The endpoint performs only read-only queries. Counts use PostgREST `HEAD`
requests, and the connectivity probe selects at most one workspace ID without
returning it to the caller.

## Metric notes

`jobs_at_max_attempts_24h` counts jobs that are `FAILED` at their attempt cap and
were finalised in the last 24 hours. The window matters: `posts` has no column
recording when a job reached its cap, and an all-time count is monotonic — a
workspace carrying an old failed backlog would report a permanently non-zero
value that can never clear, so it could not be alerted on. `ended_at` is the
closest correct timestamp available. Legacy rows with a NULL `ended_at` fall
outside the window, which under-reports rather than over-reports.

`stale_workers` counts paired, non-revoked workers whose last heartbeat is older
than 5 minutes. Keep it for diagnostics, but see below before alerting on it.

## Monitoring recommendation

- URL: `https://safepost-backup.onrender.com/api/health`
- Expected status: HTTP `200`
- Interval: 60 seconds
- Failure threshold: 3 consecutive checks
- Alert: any HTTP `503`, timeout, or non-JSON response

### Primary worker alert

Alert when `online_workers == 0` for two consecutive checks.

Do **not** use `stale_workers > 0` as the primary alert. A Chrome MV3 service
worker is suspended when idle and stops heartbeating until its alarm wakes it, so
a healthy extension routinely crosses the 5-minute staleness threshold —
gaps above 10 minutes have been observed in normal operation. `stale_workers`
therefore produces false alarms, while `online_workers == 0` means no worker can
pick up a job at all, which is the condition that actually stops publishing.

### Queue-depth drop signal

Alert for investigation when `queue_depth` falls sharply between consecutive
checks without matching completion or deletion activity. A legitimate drain shows
up as jobs moving through `processing_jobs` and finishing, or as an audited
`operation=bulk_delete_posts` entry in `system_logs`. A large drop with neither is
worth a human look.

This is a notification only — never wire it to an automatic corrective action,
which would risk compounding a data problem instead of surfacing it. The signal
uses aggregate counts and exposes no ids or content.

### Other diagnostic signals

`processing_over_10m > 0` for two consecutive checks indicates a job stuck after
being claimed. Useful, but lower priority than the two alerts above. None of
these signals change job state or expose tenant identifiers.
