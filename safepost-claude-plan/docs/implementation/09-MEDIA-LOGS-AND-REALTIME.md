# Phase 9 — Media, Logs, and Realtime

## Goal

Improve uploads, diagnostics, auditability, and isolated realtime updates.

## Media management

Support:

- MIME validation
- File-size validation
- Image preview
- Video preview where supported
- Upload progress
- Cancellation
- Retry
- Orphan cleanup
- Workspace ownership
- Clear failure states

Never return success when the upload failed.

Recommended metadata:

```text
workspace_id
file_url
mime_type
file_size
width
height
duration
upload_status
created_by
created_at
```

## Facebook groups

Recommended fields:

```text
id
workspace_id
name
facebook_group_url
facebook_group_id
active
notes
created_by
created_at
updated_at
```

Validate group URLs.

Prevent duplicates within one workspace.

Allow the same group URL in different workspaces.

## Structured task logs

Create `task_logs` with:

```text
id
workspace_id
job_id
worker_id
level
event
message
metadata
created_at
```

Timeline example:

```text
20:30:00 — Job created
20:35:00 — Job sent to worker
20:35:03 — Facebook group opened
20:35:08 — Composer found
20:35:13 — Text inserted
20:35:18 — Media upload started
20:35:26 — Media upload completed
20:35:29 — Publish clicked
20:35:35 — Publication verified
```

## Audit logs

Track important events:

```text
LOGIN
LOGOUT
WORKER_PAIRED
WORKER_REVOKED
GROUP_CREATED
GROUP_DELETED
POST_CREATED
POST_CANCELLED
JOB_RETRIED
JOB_PUBLISHED
```

## Realtime isolation

Authenticate Socket.io connections.

Join only authorized rooms:

```text
workspace:{workspaceId}
user:{userId}
worker:{workerId}
```

Do not use unrestricted global broadcasts.

Realtime events:

- Worker connected
- Worker disconnected
- Job stage changed
- Job succeeded
- Job failed
- Retry scheduled
- User action required

## Diagnostics UI

Add a “View technical details” view containing:

- Stage
- Worker
- Extension version
- Error code
- Error message
- Selectors attempted
- Current page
- Timeline

Do not expose sensitive browser data.

## Verification

- Upload failures are real failures.
- Logs are workspace-isolated.
- Realtime updates are workspace-isolated.
- Timeline is visible.
- `docs/PROGRESS.md` is updated.

## Stop condition

Stop after media, logs, and realtime.
