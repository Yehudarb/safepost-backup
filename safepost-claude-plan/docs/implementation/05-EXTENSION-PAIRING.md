# Phase 5 — Extension Pairing

## Goal

Pair each Chrome extension installation with exactly one SafePost workspace.

## Worker model

Create a browser worker model with fields similar to:

```text
worker_id
workspace_id
user_id
worker_name
device_token_hash
extension_version
browser_version
status
last_seen_at
current_job_id
revoked_at
created_at
updated_at
```

## Pairing flow

```text
User logs into SafePost
        ↓
User requests a pairing code
        ↓
Backend creates a temporary code
        ↓
User enters code in Extension Settings
        ↓
Extension exchanges code for a scoped device token
        ↓
Worker becomes linked to the user's workspace
```

## Pairing-code rules

Pairing codes must be:

- Random
- Short-lived
- Single-use
- Invalidated after success
- Scoped to one workspace
- Stored safely

## Device tokens

The extension must not use the user's main password.

Device tokens must be:

- Scoped to one worker
- Scoped to one workspace
- Revocable
- Rotatable
- Stored in extension local storage
- Validated on every worker request

Prefer storing a token hash on the server when practical.

## Dashboard worker management

Allow users to:

- Name a worker
- View online/offline/busy state
- View last activity
- View extension version
- View browser version
- Revoke a worker
- Remove a worker
- See update warnings

Example:

```text
Office Computer — Online
Home Laptop — Offline
Chrome Extension 2.2.0
Last seen: 2 minutes ago
```

## Worker endpoints

Use worker-specific endpoints:

```text
POST /api/workers/pairing-code
POST /api/workers/pair
POST /api/workers/:workerId/heartbeat
POST /api/workers/:workerId/jobs/claim
POST /api/workers/:workerId/jobs/:jobId/status
POST /api/workers/:workerId/logs
POST /api/workers/:workerId/revoke
```

Validate the device token and workspace assignment every time.

## Communication isolation

Do not use global worker state shared across all users.

Do not broadcast worker commands globally.

Use rooms such as:

```text
workspace:{workspaceId}
user:{userId}
worker:{workerId}
```

## Extension settings

Add:

- API URL
- Pairing code entry
- Connection test
- Worker name
- Paired workspace display
- Unpair button
- Extension version

## Tests

Test:

- Pairing code expiration
- Single-use enforcement
- Wrong workspace rejection
- Revoked token rejection
- Worker receives only its workspace jobs
- Demo user cannot pair a real worker
- User A cannot revoke User B worker

## Verification

- Two users can pair different extension installations.
- Each worker receives only its own workspace jobs.
- Owner worker is invisible to external users.
- `docs/PROGRESS.md` is updated.

## Stop condition

Stop after worker pairing.
