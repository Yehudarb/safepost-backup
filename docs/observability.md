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

## Monitoring recommendation

- URL: `https://safepost-backup.onrender.com/api/health`
- Expected status: HTTP `200`
- Interval: 60 seconds
- Failure threshold: 3 consecutive checks
- Alert: any HTTP `503`, timeout, or non-JSON response

Use separate JSON-field alerts when either `stale_workers > 0` or
`processing_over_10m > 0` for two consecutive checks. Those signals do not
change job state and do not expose tenant identifiers.
