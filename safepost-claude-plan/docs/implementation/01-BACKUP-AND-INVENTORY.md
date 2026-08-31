# Phase 1 — Backup and Inventory

## Goal

Preserve the existing system before any behavioral refactor and understand both repositories.

## Required actions

1. Inspect both repositories.
2. Determine which implementation is more complete for:
   - Frontend
   - Backend
   - Queue
   - Extension background worker
   - Extension content script
   - Analytics
   - Uploads
   - Documentation
3. Verify how each repository currently starts.
4. Record active and obsolete files.
5. Do not change application behavior in this phase.

## Backup requirements

Create:

```text
backups/
└── pre-refactor-YYYY-MM-DD-HHMM/
```

Include:

- Frontend source
- Backend source
- Extension source
- Database schemas and migrations
- Configuration examples
- Documentation
- Package manifests
- Lock files

Exclude:

- `node_modules`
- `.env`
- plaintext credentials
- build output
- temporary files
- caches

Also create:

- Branch: `backup/pre-refactor`
- Tag: `pre-refactor-YYYY-MM-DD`
- Document: `docs/RESTORE.md`

## Restore document

Explain how to restore:

- Frontend
- Backend
- Database schema
- Chrome extension
- Environment configuration
- Previous deployment behavior

## Inventory report

Create:

```text
docs/INVENTORY.md
```

For every important file, record:

- Repository
- Path
- Purpose
- Whether it is active
- Whether it should be kept
- Whether a better version exists in the other repository
- Known risks

## Verification

Before completing this phase:

- Verify the backup exists.
- Verify the branch exists.
- Verify the tag exists.
- Verify `safepost-backup` was not modified.
- Verify both applications can still be started or document exact blockers.
- Update `docs/PROGRESS.md`.

## Stop condition

Stop after Phase 1. Do not begin cleanup or refactoring.
