# SafePost

SafePost is a dashboard + Chrome extension for scheduling and publishing posts to
Facebook groups. The dashboard creates and schedules jobs; a Chrome extension
polls the backend and performs the actual posting through the Facebook account
already logged into the user's browser.

> This is the **primary** repository (`safepost-backup`), selected during the
> Phase 1/2 refactor. See `docs/ARCHITECTURE.md` and the plan under
> `safepost-claude-plan/` for the full roadmap.

## Stack

- **Frontend:** React + Vite + Tailwind (deployed on Vercel)
- **Backend:** Node.js + Express (`server/index.cjs`), deployed on Render
- **Database:** Supabase (Postgres) — jobs, groups, logs
- **Extension:** Chrome MV3 service worker (`safe_post_extension/`)
- **Realtime:** Socket.IO + SSE job stream

## Getting started (local dev)

1. Install dependencies:
   ```bash
   npm install
   ```
2. Create your environment file:
   ```bash
   cp .env.example .env
   # fill in SUPABASE_URL and SUPABASE_SERVICE_KEY
   ```
3. Run backend + frontend together:
   ```bash
   npm run start-all
   ```
   or separately: `npm run dev` (frontend) and `npm run start` (backend).

The frontend talks to the backend at `VITE_API_URL` (default
`http://localhost:3001`; falls back to the production backend if unset).

## Chrome extension

The active extension source is **`safe_post_extension/`** (Manifest V3).

- Load unpacked: `chrome://extensions` → Developer mode → **Load unpacked** →
  select `safe_post_extension/`.
- Open the extension popup to configure the **API Server URL**, run a
  **connection test**, and view the **worker identity** and **version**.
- If no API URL is set, the extension falls back to the built-in production URL.
- Engagement claims require extension `9.2` or newer. The backend rejects an
  older or unidentified worker before it can acquire a scan lease.

> Only one extension implementation is active. The former `extension/` directory
> (v7.0) was removed in Phase 2; it remains recoverable in the pre-refactor
> backup and git history.

## Build

```bash
npm run build              # frontend plus verified extension artifact
npm run build:extension    # extension only
```

`safe_post_extension/manifest.json` is the authoritative extension release
version. `npm run build:extension` copies only that source tree into
`dist/extension/` and emits `dist/safepost-extension-<version>.zip` plus its
SHA-256. `dist/` is generated output and is not committed.

## Deployment

- **Frontend:** Vercel, on push to `main` (`vercel.json`).
- **Backend:** Render (`render.yaml`). Credentials come from the platform
  environment — never hardcoded.

Production URL: https://safepost-backup.vercel.app/

Engagement must initially deploy with `ENGAGEMENT_ENABLED=false`. See
`docs/DEPLOYMENT.md` before applying migrations or enabling a workspace.

## Configuration & secrets

- All secrets live in `.env` (git-ignored). `.env.example` documents the keys.
- Never commit Supabase keys, and never store Facebook passwords, cookies, or
  session tokens.

## Documentation

- `docs/DEPLOYMENT.md` - Phase 1 deployment and rollback runbook

- `docs/ARCHITECTURE.md` — system architecture and data flow
- `CHANGELOG.md` — notable changes
- `safepost-claude-plan/docs/` — refactor plan, inventory, restore, progress
