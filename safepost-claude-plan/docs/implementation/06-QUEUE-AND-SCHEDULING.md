# Phase 6 — Queue and Scheduling

## Goal

Persist publishing jobs, locks, retries, scheduling, and duplicate prevention.

## Persistent job statuses

Use clear statuses:

```text
DRAFT
SCHEDULED
PENDING
READY
CLAIMED
OPENING_PAGE
WAITING_FOR_PAGE
OPENING_COMPOSER
FILLING_CONTENT
UPLOADING_MEDIA
WAITING_FOR_MEDIA
READY_TO_PUBLISH
PUBLISHING
VERIFYING
SUCCESS
FAILED
CANCELLED
EXPIRED
NEEDS_USER_ACTION
```

## Job model

Include fields similar to:

```text
id
workspace_id
post_id
worker_id
platform
scheduled_at
status
attempt_count
max_attempts
claimed_at
lock_expires_at
last_attempt_at
next_attempt_at
idempotency_key
error_code
error_message
external_post_url
created_at
updated_at
```

Current platform:

```text
facebook_groups
```

## Job locking

When a worker claims a job:

- Assign it to the worker.
- Store `claimed_at`.
- Store `lock_expires_at`.
- Prevent another worker from claiming it.
- Extend the lock through heartbeat.
- Expire the lock after disconnect.
- Return the job safely to the queue when appropriate.

## Duplicate prevention

Use persistent idempotency.

Before retrying, verify:

- Job is not already successful.
- Another worker is not processing it.
- A valid post URL was not already recorded.
- Previous attempt is not still active.
- The same post was not already published to the same group.

Do not rely only on an in-memory `Map`.

## Error categories

Retryable:

```text
NETWORK_TIMEOUT
PAGE_LOAD_TIMEOUT
COMPOSER_NOT_READY
MEDIA_UPLOAD_TIMEOUT
TEMPORARY_SERVER_ERROR
WORKER_DISCONNECTED
```

Needs user action or non-retryable:

```text
FACEBOOK_LOGGED_OUT
GROUP_NOT_FOUND
NO_GROUP_ACCESS
POSTING_NOT_ALLOWED
ACCOUNT_RESTRICTED
CHECKPOINT_REQUIRED
CAPTCHA_REQUIRED
INVALID_MEDIA
```

Use exponential backoff.

## Missed schedules

Store all times in UTC.

Display in the user's timezone.

Default:

```text
Asia/Jerusalem
```

Workspace setting:

```text
publish_immediately
reschedule
cancel
ask_user
```

## Restart resilience

Queue state must survive:

- Backend restart
- Render restart
- Worker restart
- Browser restart

## Tests

Test:

- Scheduled job creation
- Claiming
- Locking
- Lock expiration
- Duplicate prevention
- Retryable failure
- User-action failure
- Cancellation
- Missed schedule
- Server restart recovery
- Worker disconnect recovery

## Verification

- No duplicate execution under simultaneous claims.
- Queue survives restart.
- Retry state is visible.
- Missed schedules are handled predictably.
- `docs/PROGRESS.md` is updated.

## Stop condition

Stop after queue and scheduling.
