# Changelog

All notable changes to SafePost are documented here.
Format loosely follows [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased] — Phase 2: Repository cleanup

### Added
- `.env.example` documenting all required/optional environment variables.
- `src/lib/apiConfig.js` — single resolver for the backend API base URL.
- Chrome extension **settings popup**: configurable API server URL, connection
  test (`/api/health`), worker identity, and version display.
- Configurable backend URL in the extension service worker (saved value in
  `chrome.storage.local`, falls back to the built-in default).
- `README.md`, `CHANGELOG.md`, `docs/ARCHITECTURE.md`.

### Changed
- Frontend `AnalyticsPanel` now uses the shared API base instead of a hardcoded
  production URL.
- `build.sh` and `server/supabaseClient.cjs` no longer contain hardcoded
  Supabase credentials — values must come from the environment.
- Extension version bumped to **7.3**.

### Removed
- Duplicate/obsolete Chrome extension directory `extension/` (v7.0). The active
  implementation is `safe_post_extension/`.
- Committed build output `dist/` (now git-ignored and regenerated on build).
- Packaged `extension.zip` (now git-ignored).
- Obsolete one-off scripts: `test_supabase.cjs`, `test_task_deletion.cjs`,
  `test_upload.txt`, `verify_posting_fix.cjs`, `fix_supabase_corrected.cjs`.

### Security
- Removed hardcoded Supabase service key from tracked files (`build.sh`,
  `server/supabaseClient.cjs`). NOTE: the key still exists in **git history** —
  history scrubbing and key rotation are deferred scope (see plan) and should be
  done before/independently of this cleanup reaching production.

### Notes
- All changes are on branch `refactor/phase2-cleanup`, not yet deployed.
- Behavior is preserved: no API URL configured → same production endpoints as
  before.

## [2.1.1] and earlier

See `BACKUP_LOG.md` and `DAILY_PROGRESS.md` for the pre-refactor history,
including the v2.2.0 and v2.4.0 backup tags.
