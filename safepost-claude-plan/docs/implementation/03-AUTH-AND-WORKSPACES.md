# Phase 3 — Authentication and Workspaces

## Goal

Add separate user accounts and strict workspace-based data isolation.

## Authentication

Use Supabase Auth.

Support:

- Registration with email and password
- Login
- Logout
- Password reset
- Persistent session
- Protected routes
- Session expiration handling
- Friendly errors

Every dashboard API request must send the Supabase access token.

The backend must validate the token before private operations.

Create middleware similar to:

```text
requireAuth
optionalAuth
requireWorkspaceAccess
```

Never trust `user_id` from the frontend.

## Database model

Create versioned migrations for:

```text
profiles
workspaces
workspace_members
```

Every new user should receive:

- One personal workspace
- Membership role `owner`

Prepare support for:

```text
owner
admin
editor
viewer
```

## Workspace ownership

Add `workspace_id` and `created_by` to all relevant private records:

- Facebook groups
- Posts
- Templates
- Media
- Publishing jobs
- Workers
- Logs
- Settings
- Analytics-related records

## Existing data migration

Create an original owner workspace.

Associate all existing records with it:

- Existing groups
- Existing posts
- Existing templates
- Existing media
- Existing jobs
- Existing workers
- Existing logs

Do not expose these records to new users.

## Mandatory isolation

All backend queries must be scoped to an authorized workspace.

Every route must verify resource ownership.

Add the minimum Supabase policies required for authentication and isolation.

Do not perform a broad unrelated Supabase cleanup in this phase.

## Realtime authentication

Prepare authenticated Socket.io handshake validation.

Users must join only authorized workspace rooms.

## Tests

At minimum test:

- Registration
- Login
- Logout
- Unauthorized route access
- User A cannot read User B data
- User A cannot modify User B data
- New user receives a private workspace
- Existing owner data remains private

## Verification

- Two independent users can log in.
- Each sees only their own workspace.
- Existing owner data is invisible to the new account.
- Protected routes reject anonymous requests.
- `docs/PROGRESS.md` is updated.

## Stop condition

Stop after authentication and workspace isolation.
