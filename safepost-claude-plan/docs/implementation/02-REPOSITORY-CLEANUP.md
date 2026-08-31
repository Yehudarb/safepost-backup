# Phase 2 — Repository Cleanup

## Goal

Establish one clean primary repository and one active Chrome extension implementation.

## Required actions

1. Select the primary repository based on Phase 1 findings.
2. Reuse the best working code from both repositories.
3. Do not blindly merge all files.
4. Keep only one active extension directory.
5. Archive duplicate extension code inside the backup only.
6. Normalize project structure.
7. Remove obsolete generated files from active source control.
8. Preserve all working features.

## Extension cleanup

Do not leave both:

```text
extension/
safe_post_extension/
```

Choose the most advanced working implementation.

Transfer only missing useful functionality from the other version.

Use one consistent extension version in:

- `manifest.json`
- `background.js`
- `content.js`
- Popup
- Dashboard
- Backend compatibility checks

## Environment configuration

Remove hardcoded URLs.

Frontend:

```env
VITE_API_URL=http://localhost:3001
```

Production values must come from deployment environment variables.

The extension must provide a settings screen for:

- API server URL
- Connection test
- Current worker identity
- Extension version

Create a complete `.env.example` without real credentials.

## Repository cleanup

Remove or archive from the active source tree:

- Duplicate extension directory
- Old SQLite databases
- Generated ZIP packages
- Build output
- Temporary scripts no longer used
- Obsolete status documents
- Dead code proven unused

Do not delete anything before confirming that it exists in backup.

## Documentation

Update:

- Root `README.md`
- `CHANGELOG.md`
- `docs/ARCHITECTURE.md`

## Verification

- One primary repository is documented.
- One extension implementation remains active.
- Development and production URLs are configurable.
- Existing application starts.
- Existing Facebook workflow remains available.
- `docs/PROGRESS.md` is updated.

## Stop condition

Stop after repository cleanup.
