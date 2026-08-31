# Phase 8 — Backend and Frontend Refactor

## Goal

Make the codebase modular and maintainable without changing approved behavior.

## Backend structure

Refactor toward:

```text
server/
├── app.cjs
├── server.cjs
├── config/
│   ├── env.cjs
│   └── supabase.cjs
├── middleware/
│   ├── auth.cjs
│   ├── workspace.cjs
│   ├── errors.cjs
│   └── rateLimit.cjs
├── routes/
│   ├── auth.routes.cjs
│   ├── posts.routes.cjs
│   ├── groups.routes.cjs
│   ├── templates.routes.cjs
│   ├── workers.routes.cjs
│   ├── jobs.routes.cjs
│   ├── media.routes.cjs
│   └── analytics.routes.cjs
├── controllers/
├── services/
│   ├── queue.service.cjs
│   ├── worker.service.cjs
│   ├── publishing.service.cjs
│   ├── scheduling.service.cjs
│   ├── media.service.cjs
│   └── logging.service.cjs
├── validators/
├── realtime/
└── utils/
```

Keep route handlers small.

Put business logic in services.

Use centralized error handling.

Validate:

- Request bodies
- Route parameters
- Query parameters
- Workspace access

## Frontend pages

Create pages:

```text
Login
Register
Forgot Password
Dashboard
Create Post
Queue
Groups
Workers
Templates
Media Library
Analytics
Settings
Demo
```

## Frontend hooks

Create hooks:

```text
useAuth
useWorkspace
usePosts
useQueue
useWorkers
useGroups
useTemplates
useMedia
useSocket
usePublishingForm
```

## Providers

Use:

```text
AuthProvider
WorkspaceProvider
RealtimeProvider
```

Do not keep all API logic, WebSocket logic, state, forms, modals, and page rendering inside one `App.jsx`.

## Dashboard requirements

Show:

- Current workspace
- Logged-in user
- Logout
- Worker status
- Extension version
- Scheduled posts
- Active jobs
- Failed jobs
- Jobs requiring action
- Successful posts
- Retry status
- Timeline
- Demo status

Filters:

- Date
- Status
- Group
- Worker
- Post type

## Behavior preservation

Before moving code:

- Add characterization tests where practical.
- Preserve route contracts unless intentionally versioned.
- Document renamed endpoints.
- Avoid broad UI redesign.

## Verification

- Existing approved workflows still work.
- Files are modular.
- No duplicate active implementations remain.
- Tests pass.
- `docs/PROGRESS.md` is updated.

## Stop condition

Stop after refactoring.
