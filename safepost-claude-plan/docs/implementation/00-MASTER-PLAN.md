# SafePost Master Plan

## Mission

Refactor, stabilize, and extend SafePost while preserving the existing working version.

SafePost currently provides a dashboard for creating and scheduling Facebook group posts. A Chrome extension receives publishing jobs and performs posting through the Facebook account currently logged into the user's browser.

## Primary objectives

1. Preserve the current implementation in a recoverable backup.
2. Select one clean primary codebase.
3. Stabilize Facebook publishing.
4. Add separate user accounts.
5. Isolate all data by workspace.
6. Allow external users to use SafePost without seeing the owner's Facebook data.
7. Add a safe demo experience using synthetic data.
8. Pair each Chrome extension with exactly one user workspace.
9. Persist jobs, locks, retries, schedules, and logs.
10. Refactor oversized frontend and backend files.
11. Add automated tests and complete documentation.
12. Prepare the architecture for future Instagram support without implementing Instagram now.

## Repositories

- Main: `https://github.com/Yehudarb/safepost`
- Backup/reference: `https://github.com/Yehudarb/safepost-backup`

## Target architecture

```text
safepost/
├── frontend/
│   ├── src/
│   ├── public/
│   └── package.json
├── server/
│   ├── config/
│   ├── middleware/
│   ├── routes/
│   ├── controllers/
│   ├── services/
│   ├── validators/
│   ├── realtime/
│   ├── workers/
│   └── app.cjs
├── extension/
│   ├── manifest.json
│   ├── background.js
│   ├── content.js
│   ├── popup/
│   └── shared/
├── database/
│   ├── migrations/
│   └── schema.sql
├── docs/
├── tests/
├── backups/
├── .env.example
├── README.md
└── CHANGELOG.md
```

## Multi-user data model

Use a model similar to:

```text
profiles
workspaces
workspace_members
social_accounts
facebook_groups
post_templates
posts
publishing_jobs
browser_workers
pairing_codes
media_assets
task_logs
audit_logs
```

Every private business record must include:

```text
workspace_id
created_by
created_at
updated_at
```

## Roles

Prepare the schema for:

```text
owner
admin
editor
viewer
```

In the first release, every new user may receive one personal workspace with the `owner` role.

## Mandatory isolation

A user must never see or control another user's:

- Facebook groups
- Posts
- Templates
- Media
- Workers
- Worker status
- Publishing jobs
- Logs
- Analytics
- Settings
- Social account information

Never trust a frontend-supplied `user_id`. Derive the user from a validated session token.

## Platform architecture

Keep a platform field in jobs:

```text
platform = facebook_groups
```

Future integrations should be possible through:

```text
platform
social_account_id
workspace_id
worker_id
publishing_jobs
```

## Deferred scope

Do not implement:

- Instagram
- TikTok
- Billing
- Payments
- Subscription management
- Advanced organization management
- Broad Supabase security audit
- Git history secret removal
- Production key rotation
- Large unrelated UI redesign

Minimum authentication and workspace isolation are still mandatory.

## Implementation order

1. Backup and inventory
2. Repository cleanup
3. Authentication and workspace isolation
4. Demo and external users
5. Extension pairing
6. Queue and scheduling
7. Facebook extension stability
8. Backend and frontend refactor
9. Media, logs, and realtime
10. Tests, documentation, and release
11. Final acceptance verification

## Global acceptance requirements

- Existing code is recoverable.
- Backup repository remains preserved.
- One active extension implementation exists.
- Users can register, log in, log out, and reset passwords.
- Each user receives a private workspace.
- Existing data belongs only to the original owner workspace.
- Demo users see synthetic data only.
- Demo users cannot trigger real jobs.
- External users can pair their own extension.
- Workers receive jobs only from their workspace.
- Queue state survives server restarts.
- Job locking prevents duplicate execution.
- Retry logic distinguishes temporary failures from user-action failures.
- Publishing success is verified.
- Tests cover authentication, isolation, pairing, queues, and demo restrictions.
- Instagram and TikTok remain unimplemented.
