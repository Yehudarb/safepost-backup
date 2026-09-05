# SafePost Architecture

## Overview

SafePost has three runtime components plus a managed database:

```text
┌──────────────┐        ┌─────────────────┐        ┌──────────────────┐
│  Dashboard   │  HTTP  │   Backend API   │  SDK   │    Supabase      │
│ (React/Vite) │ ─────▶ │ (Express, Node) │ ─────▶ │   (Postgres)     │
│  on Vercel   │ ◀────▶ │   on Render     │        │  jobs/groups/logs│
└──────────────┘  WS/SSE└─────────────────┘        └──────────────────┘
                                 ▲
                                 │ poll /api/jobs/next, POST status
                                 │ (HTTP)
                        ┌────────┴─────────┐
                        │  Chrome Extension │
                        │  (MV3 service     │
                        │   worker)         │
                        │  posts via the    │
                        │  logged-in FB tab │
                        └───────────────────┘
```

## Components

### Frontend — `src/`
- React + Vite + Tailwind; entry `src/main.jsx`, root `src/App.jsx`.
- Talks to the backend over HTTP (`API_BASE`) and Socket.IO (`BACKEND_URL`).
- Backend URL resolution: `VITE_API_URL` → known prod host → built-in fallback
  (`src/lib/apiConfig.js`, mirrored in `App.jsx` for the socket connection).
- Components organized under `src/components/{modals,panels,ui}`.
- Deployed on **Vercel** (`vercel.json`).

### Backend — `server/`
- `server/index.cjs` — Express app: REST API, job queue, scheduling, realtime
  (Socket.IO + SSE `/api/stream/jobs`), heartbeat, reporting.
- `server/supabaseClient.cjs` — Supabase service client; credentials from env.
- Key endpoints: `/api/health`, `/api/jobs/next`, `/api/tasks/:id/status`,
  `/api/groups/sync`, `/api/worker/heartbeat`, `/api/report/tasks`,
  `/api/system/status`.
- Runs on port `3001` (or `PORT`). Deployed on **Render** (`render.yaml`).

### Chrome extension — `safe_post_extension/` (MV3)
- `background.js` — service worker. Wakes via `chrome.alarms`, polls
  `/api/jobs/next`, executes posting, reports status, sends heartbeats.
  Backend URL is configurable (see below) with a built-in default fallback.
- `content.js` — injected into `facebook.com`; performs the DOM actions to post.
- `extensionStorage.js` — `chrome.storage.local` helpers (last job id, cooldown,
  **API URL**, **worker identity**).
- `facebookActivityLock.js` — persistent MV3 mutex shared by publishing, group
  sync and future engagement automation. Publishing can cooperatively pre-empt
  lower-priority work; owner and operation ID are required for release.
- `popup.html` + `popup.js` — settings screen: API server URL, connection test,
  worker identity, extension version.
- `safe_post_extension/` is the sole extension source. `npm run build:extension`
  validates and copies it to `dist/extension/`, then creates a versioned ZIP and
  SHA-256. Vite's `public/` directory contains web assets only.

### Database — Supabase (Postgres)
- Stores jobs/tasks, groups, logs, reporting data.
- Accessed only from the backend using the service-role key (never the client).

## Data flow (publish a post)

1. User creates/schedules a post in the dashboard → `POST` to backend → row in
   Supabase; dashboard updates via Socket.IO.
2. Extension service worker polls `GET /api/jobs/next` (and/or SSE stream).
3. Extension `content.js` performs the post in the logged-in Facebook tab.
4. Extension reports `POST /api/tasks/:id/status` (success/failure, verified).
5. Backend persists status; dashboard reflects it in realtime; reporting
   endpoints aggregate success/failure.

## Configuration

| Setting | Where | Notes |
|---------|-------|-------|
| `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` | backend env / `.env` | required; never hardcoded |
| `NODE_ENV`, `PORT` | backend env | runtime |
| `ENGAGEMENT_ENABLED` | backend env | fleet kill switch; production default is `false` |
| `ANTHROPIC_API_KEY`, `GEMINI_API_KEY` | backend env | optional AI features |
| `VITE_API_URL` | frontend build env | backend base URL |
| Extension API URL | extension popup → `chrome.storage.local` | falls back to default |
| Worker identity | extension popup → `chrome.storage.local` | generated once, displayed |

## Known structural debt (tracked for later phases)

- `server/index.cjs` (~1.7k lines) and `src/App.jsx` (~1.7k lines) are oversized
  and are refactor targets (Phase 8).
- Hardcoded Supabase key remains in **git history** (removed from working tree in
  Phase 2). History scrubbing + key rotation are deferred scope.
