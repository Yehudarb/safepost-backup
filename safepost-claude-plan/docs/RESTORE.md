# SafePost Restore Guide

This document explains how to restore the SafePost system to its **pre-refactor**
state captured in Phase 1. It covers both repositories, the database schema, the
Chrome extension, environment configuration, and prior deployment behavior.

> Phase 1 snapshot timestamp: **2026-07-17 00:27** (local)
> Do not delete or overwrite `safepost-backup` — it is the read-only safety net.

---

## 1. Recovery points created in Phase 1

| Artifact | Location | Purpose |
|----------|----------|---------|
| File snapshot (both repos, source only) | `safepost-claude-plan/backups/pre-refactor-2026-07-17-0027/` | Independent copy, no git needed |
| Git branch | `backup/pre-refactor` (in both repos, local) | Restore committed state via git |
| Git tag | `pre-refactor-2026-07-17` (in both repos, local) | Immutable marker of pre-refactor HEAD |

The file snapshot **excludes** `node_modules`, `.env`, `dist`/build output,
git history, and caches. Reinstall dependencies and recreate `.env` after
restoring (see sections below).

### Repository locations

| Role (per plan) | GitHub remote | Local working tree |
|-----------------|---------------|--------------------|
| Main | `github.com/Yehudarb/safepost` | `.../scratch/app/safepost-dev` (branch `upgrade`) |
| Backup / production | `github.com/Yehudarb/safepost-backup` | `.../scratch/safepost-backup-clean` (branch `main`) |

> NOTE: The repository roles are **inverted from reality** — see
> `docs/INVENTORY.md`. The `safepost-backup` repo currently holds the live,
> production-deployed system (Vercel). Read the inventory before choosing a
> primary in Phase 2.

---

## 2. Restore from the git tag (preferred)

Restores the exact committed state. Nothing was pushed in Phase 1, so these
markers exist only in the local clones listed above.

```bash
# In the target repo working tree:
git fetch --all                       # if restoring on another machine, push the tag first
git checkout pre-refactor-2026-07-17  # detached HEAD at the snapshot
# or recover the branch:
git checkout backup/pre-refactor
```

To make the tag/branch available elsewhere (only when you explicitly decide to):

```bash
git push origin backup/pre-refactor
git push origin pre-refactor-2026-07-17
```

---

## 3. Restore from the file snapshot (no git)

```bash
SNAP="safepost-claude-plan/backups/pre-refactor-2026-07-17-0027"
# Backup/production system:
cp -r "$SNAP/safepost-backup/." <target-dir>/
# Main/experimental system:
cp -r "$SNAP/safepost-main/." <target-dir>/
```

Then restore dependencies and environment (sections 4–6).

---

## 4. Restore the frontend

1. Restore source (`src/`, `index.html`, `public/`, `vite.config.js`,
   `tailwind.config.js`, `postcss.config.js`, `package.json`,
   `package-lock.json`).
2. `npm install`
3. Dev: `npm run dev` (Vite). Build: `npm run build` → `dist/`.
4. The production frontend is deployed on **Vercel** from the `safepost-backup`
   repo `main` branch (`vercel.json` present). Redeploy by pushing to `main`.

---

## 5. Restore the backend

The backend is an Express server: `server/index.cjs` (entry point).

1. Restore `server/` and `package.json`.
2. `npm install`
3. Recreate `.env` (section 6).
4. Start:
   - Production: `npm run start` → `NODE_ENV=production node server/index.cjs`
   - Dev (server + Vite): `npm run start-all`

> The `safepost` (main) working tree also contains an alternative backend under
> `backend/` (`server.js`, `worker.js`, `Dockerfile`) and `docker-compose.yml`.
> This is a separate/experimental architecture — see inventory. The active,
> production backend is `server/index.cjs` in the `safepost-backup` repo.

---

## 6. Restore environment configuration

`.env` is **not** included in any snapshot (contains secrets). Recreate it in the
backend/repo root with at least:

```env
SUPABASE_URL=<your-supabase-project-url>
SUPABASE_SERVICE_KEY=<service-role-key>
# additional keys may be required by main repo (AI providers, etc.)
```

- Supabase project URL + service key drive the database and queue.
- Do **not** commit `.env`. Do **not** store Facebook passwords, cookies, or
  session tokens.

---

## 7. Restore the database schema

- Supabase (Postgres) is the primary datastore for jobs/queue.
- SQL migrations exist **only in the `safepost` (main) repo** under
  `supabase/migrations/`:
  - `20260212_fail_fast.sql`
  - `20260212_tags_presets.sql`
- The `safepost-dev` working tree also contains a local `database.sqlite` and a
  `create_system_settings.sql` (experimental / local dev artifacts).
- To restore: apply the Supabase migrations to the target Supabase project via
  the Supabase SQL editor or CLI. Verify against the live schema before applying,
  since production may already contain these changes.

---

## 8. Restore the Chrome extension

Both repos ship an extension under `extension/`:
`manifest.json`, `background.js`, `content.js`, `popup.html`, `icons/`.
A packaged `extension.zip` and a `safe_post_extension/` copy also exist in the
backup repo.

1. Restore the `extension/` directory.
2. Load unpacked in Chrome: `chrome://extensions` → Developer mode → *Load
   unpacked* → select `extension/`.
3. The extension receives publishing jobs from the backend and posts through the
   Facebook account already logged into the browser. Confirm the backend URL it
   targets before enabling.

---

## 9. Previous deployment behavior

| Component | Platform | Trigger |
|-----------|----------|---------|
| Frontend + API | Vercel (`vercel.json`) | Push to `safepost-backup` `main` |
| Backend (server) | `render.yaml` present (Render) | Manual / repo deploy |
| Extension | Manual load-unpacked in Chrome | User installs |

Production URL (frontend): `https://safepost-backup.vercel.app/`

To roll production back to the pre-refactor state: check out
`pre-refactor-2026-07-17` in the `safepost-backup` repo, push to `main` (or
Vercel's configured branch), and let Vercel redeploy.

---

## 10. Verification after restore

- `npm install` completes without errors.
- `npm run build` produces `dist/`.
- Backend starts and connects to Supabase (check logs, no auth errors).
- Extension loads unpacked without manifest errors.
- Do **not** trigger a real publish to verify — confirm connectivity only.
