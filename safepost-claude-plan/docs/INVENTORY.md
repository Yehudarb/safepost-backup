# SafePost Inventory (Phase 1)

Generated: 2026-07-17. Read-only inspection; no application behavior changed.

## Critical finding — repository roles are inverted vs. the plan

The Master Plan lists `safepost` as **Main** and `safepost-backup` as
**Backup/reference**. On disk the reality is reversed:

| | `safepost` (main) | `safepost-backup` (backup/ref) |
|---|---|---|
| Local working tree | `.../scratch/app/safepost-dev` | `.../scratch/safepost-backup-clean` |
| Git remote | `github.com/Yehudarb/safepost` | `github.com/Yehudarb/safepost-backup` |
| Current branch | `upgrade` | `main` |
| Git history | Shallow — 2 commits, both "Initial Backup" | Real history + release tags (`backup-v2.2.0`, `backup-v2.4.0`) |
| Working tree state | Dirty — 7 untracked component files | Clean (only `safepost-claude-plan/` untracked) |
| Deployed to production | No evidence | **Yes — Vercel (`https://safepost-backup.vercel.app/`)** |
| `.env` present locally | No (startup blocker) | Yes (`SUPABASE_URL`, `SUPABASE_SERVICE_KEY`) |

**Implication for Phase 2 ("select one clean primary codebase"):** this is a
user decision. The `safepost-backup` repo is the mature, live, production system;
the `safepost` repo is a broader but shallow-history, experimental expansion. See
recommendation at the end.

---

## Subsystem completeness comparison

| Subsystem | `safepost` (main) | `safepost-backup` | More complete | Notes |
|-----------|-------------------|-------------------|---------------|-------|
| Backend server | `server/index.cjs` — 975 lines | `server/index.cjs` — **1742 lines** | backup | Backup server is larger/more evolved (logging, timeouts, Joi validation, idempotency per git log) |
| Alt backend | `backend/` (`server.js`, `worker.js`, `Dockerfile`), `docker-compose.yml` | — | main (new arch) | Separate experimental architecture; not the production backend |
| Frontend app | `src/App.jsx` — 1243 lines | `src/App.jsx` — **1674 lines** | backup | Backup App larger; production-tested (recent Hebrew/UTF-8 + empty-state fixes) |
| Frontend components | 20 files (Analytics, AssetLibrary, ContentCalendar, Mission/Calendar, Settings, Command Center) | 9 files, organized (`modals/`, `panels/`, `ui/`, ErrorBoundary, QueueTable, Scheduler, Stats, TaskTimer, Toast) | mixed | Main = more breadth (analytics/media/calendar); backup = more structure + production polish |
| Pages / services | `src/pages/AIStudio.jsx`, `src/services/bridge.js` | `src/services/`, `src/utils/timeUtils.js` | mixed | Main adds an AI Studio page |
| Queue / scheduling | in `server/index.cjs` | in `server/index.cjs` (larger) | backup | Both in-server; backup more hardened |
| Extension (background) | `extension/background.js` | `extension/background.js` | ~equal | Same file set; byte-diff not yet compared |
| Extension (content) | `extension/content.js` | `extension/content.js` | ~equal | Both present; main has extra `FIX_CONTENT_SCRIPT.md` notes |
| DB migrations | `supabase/migrations/` (2 SQL files) | none | main | Only main tracks Supabase migrations in-repo |
| Analytics | `AnalyticsDashboard.jsx`, `StatsBar` equiv | `StatsBar.jsx` | main | Main has a dedicated analytics dashboard |
| Uploads / media | `server/uploads/`, `AssetLibrary.jsx` | (server-side handling in index.cjs) | main | Main has an explicit asset library UI |
| Documentation | Many status/fix `.md` files (CURRENT_STATUS, SYSTEM_STATUS, DESIGN, FIXES_APPLIED, etc.) | `BACKUP_LOG.md`, `DAILY_PROGRESS.md` | main (volume) | Main docs are numerous but ad-hoc; backup docs are lean |
| Git hygiene | Shallow history, dirty tree | Clean, tagged releases | backup | Backup is far more recoverable via git |

---

## Per-repo file inventory (important files)

### `safepost-backup` (production system) — `.../safepost-backup-clean`

| Path | Purpose | Active | Keep | Better elsewhere? | Risks |
|------|---------|--------|------|-------------------|-------|
| `server/index.cjs` | Express API + queue + scheduling (1742 ln) | Yes | Yes | No (this is the fullest) | Oversized single file (Phase 8 refactor target) |
| `server/supabaseClient.cjs` | Supabase service client | Yes | Yes | No | Service key via `.env` |
| `src/App.jsx` | Main React app (1674 ln) | Yes | Yes | No | Oversized single file (Phase 8) |
| `src/components/{modals,panels,ui}/` | Structured UI components | Yes | Yes | No | — |
| `src/components/QueueTable.jsx` | Queue table (recently improved empty state) | Yes | Yes | No | — |
| `src/services/`, `src/utils/timeUtils.js` | Client helpers | Yes | Yes | No | — |
| `extension/` | Chrome MV extension (background/content/popup) | Yes | Yes | Compare vs main | Posts via logged-in FB session |
| `extension.zip`, `safe_post_extension/` | Packaged/duplicate extension copies | Partial | Review | — | Duplicate extension impls — Phase 2 must pick ONE |
| `vercel.json`, `render.yaml` | Deploy config (Vercel FE, Render BE) | Yes | Yes | No | Hardcoded settings — verify |
| `.env` | Secrets (Supabase URL + service key) | Yes | Yes (never commit) | — | Must stay out of git/backups |
| `index.html`, `vite.config.js`, `tailwind.config.js` | Build config | Yes | Yes | No | — |
| `BACKUP_LOG.md`, `DAILY_PROGRESS.md` | History notes | Yes | Yes | No | — |
| `fix_supabase_corrected.cjs`, `test_*.cjs`, `verify_posting_fix.cjs` | One-off scripts/tests | Obsolete? | Review | — | Ad-hoc; may reference prod |

### `safepost` (main/experimental) — `.../safepost-dev`

| Path | Purpose | Active | Keep | Better elsewhere? | Risks |
|------|---------|--------|------|-------------------|-------|
| `server/index.cjs` | Express API (975 ln) | Maybe | Compare | Backup version is fuller | Smaller/older than backup's |
| `backend/` (`server.js`, `worker.js`, `Dockerfile`) | Alt worker-based backend | Experimental | Evaluate | — | Parallel architecture; unproven |
| `docker-compose.yml` | Container orchestration | Experimental | Evaluate | — | Not used in current prod |
| `src/App.jsx` | React app (1243 ln) | Maybe | Compare | Backup version is fuller | Behind backup |
| `src/components/AnalyticsDashboard.jsx` | Analytics UI | Untracked | Keep (harvest) | Unique to main | Not in git — snapshot only |
| `src/components/AssetLibrary.jsx` | Media/asset UI | Untracked | Keep (harvest) | Unique to main | Not in git |
| `src/components/ContentCalendar.jsx`, `MissionCalendar.jsx` | Scheduling calendars | Untracked | Keep (harvest) | Unique to main | Not in git |
| `src/components/SettingsDashboard.jsx`, `DashboardCommandCenter.jsx` | Settings/command center | Untracked | Keep (harvest) | Unique to main | Not in git |
| `src/pages/AIStudio.jsx` | AI content studio page | Yes | Evaluate | Unique to main | AI provider keys needed |
| `supabase/migrations/*.sql` | DB migrations | Yes | **Yes** | Unique to main | Verify applied to prod |
| `database.sqlite`, `create_system_settings.sql` | Local dev DB artifacts | Local only | No | — | Do not deploy |
| `extension/`, `safe_post_extension/` | Extension copies | Partial | Compare | — | Duplicate impls |
| Many `*.md` status files | Ad-hoc dev notes | Historical | Archive | — | Noise; not authoritative |
| `.env.development.local` | Local env (no `.env`) | Partial | — | — | Missing prod `.env` → cannot start as-is |

---

## Startup verification

Servers were **not run** (running the backend/extension could trigger real
Facebook publishing — forbidden by project rules). Startup assessed from config.

| Repo | Frontend start | Backend start | Blocker |
|------|----------------|---------------|---------|
| `safepost-backup` | `npm run dev` (Vite) | `npm run start` / `start-all` | None known — `.env` present, `node_modules` present. Should start. |
| `safepost` (main) | `npm run dev` (Vite) | No `start` script; entry is `server/index.cjs` or `backend/server.js` | **No `.env`** (only `.env.development.local`). Backend cannot connect to Supabase until `.env` recreated. |

Environment: Node v24.11.1, npm 11.6.2. Both repos have `node_modules` installed.

---

## Duplicate / obsolete items to resolve in later phases

- **Two extension implementations** per repo (`extension/` + `safe_post_extension/`
  + `extension.zip`). Master plan requires exactly one active extension → resolve
  in Phase 2/5.
- **Two backend architectures** in main (`server/index.cjs` vs `backend/worker.js`).
- **Oversized files**: `server/index.cjs` (1742) and `src/App.jsx` (1674) in
  backup → Phase 8 refactor targets.
- **Ad-hoc one-off scripts** (`fix_supabase_corrected.cjs`, `test_*.cjs`) → review
  for removal in Phase 2.
- **Numerous historical `.md` status files** in main → archive/consolidate.

---

## Recommendation (for Phase 2 — user decision)

Adopt **`safepost-backup`** as the clean **primary** going forward: it is the
live production system, has real git history + release tags, a more evolved
backend and frontend, and a clean tree. Then **harvest** the unique, valuable
pieces from `safepost` (main) into it: the Supabase migrations, and the
Analytics / AssetLibrary / ContentCalendar / Settings / AIStudio components.

This keeps production stability while capturing the breadth of the experimental
repo. Final choice is deferred to the user before Phase 2 begins.
