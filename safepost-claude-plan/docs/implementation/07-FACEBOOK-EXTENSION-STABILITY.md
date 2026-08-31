# Phase 7 — Facebook Extension Stability

## Goal

Stabilize browser-based Facebook group publishing and improve diagnostics.

## DOM detection strategy

Do not depend on one selector.

Use layered detection:

1. Semantic role
2. `aria-label`
3. Accessible text
4. `contenteditable`
5. Dialog structure
6. Relevant modal containers
7. Nested elements
8. Language-independent signals
9. Hebrew and English interface support
10. Detailed failure diagnostics

## Reusable utilities

Create utilities such as:

```text
findPostComposer
findEditableArea
findMediaButton
findFileInput
findPublishButton
waitForElement
waitForEnabledElement
detectFacebookState
detectCheckpoint
detectCaptcha
detectLoginState
```

## Safe interaction rules

Before clicking:

- Verify visibility.
- Verify enabled state.
- Verify expected dialog ownership.
- Verify current Facebook group.
- Verify login state.
- Avoid broad selectors that may click unrelated controls.

## Publishing stages

The content script should report precise stages:

```text
OPENING_PAGE
WAITING_FOR_PAGE
OPENING_COMPOSER
FILLING_CONTENT
UPLOADING_MEDIA
WAITING_FOR_MEDIA
READY_TO_PUBLISH
PUBLISHING
VERIFYING
```

## Success verification

Do not mark success immediately after clicking Publish.

Verify using one or more signals:

- Composer closes
- Success notification appears
- New post appears
- Expected text or media appears
- Post URL is captured
- No error dialog appears

Use:

```text
VERIFYING
NEEDS_USER_ACTION
```

when success is uncertain.

## User-action detection

Detect and report:

- Logged out
- Captcha
- Checkpoint
- Account restriction
- Group unavailable
- No posting access
- Composer failure
- Media upload failure
- Disabled Publish button

## Manifest V3 lifecycle

Persist in `chrome.storage.local`:

- Worker identity
- Server URL
- Device token
- Current job
- Current stage
- Attempt state
- Recovery metadata

Use `chrome.alarms` for:

- Heartbeat
- Recovery
- Stalled-job detection

Do not rely on global variables.

## Code separation

- Background worker coordinates jobs.
- Content script performs page actions.
- Shared utilities contain selectors, waits, and message contracts.
- Popup contains settings and diagnostics.

## Diagnostic records

Record:

```text
job_id
worker_id
extension_version
current_url
group_url
page_title
current_stage
selector_strategy
selectors_attempted
element_found
elapsed_time
error_code
error_message
timestamp
```

Never store Facebook cookies or session tokens.

## Tests or test utilities

Cover:

- Login detection
- Group-page validation
- Composer detection
- Text insertion
- Image upload
- Publish-button detection
- Captcha detection
- Checkpoint detection
- Service-worker recovery
- Duplicate prevention

## Verification

- Text-only publishing works.
- Image publishing works where currently supported.
- Errors are categorized.
- Success is verified.
- Worker restart does not cause duplicate publishing.
- `docs/PROGRESS.md` is updated.

## Stop condition

Stop after Facebook extension stabilization.
