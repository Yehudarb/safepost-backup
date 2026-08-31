# SafePost Claude Refactor Pack

This folder contains a staged implementation plan for Claude Code.

## Repositories

- Main repository: `https://github.com/Yehudarb/safepost`
- Backup/reference repository: `https://github.com/Yehudarb/safepost-backup`

## How to use this pack

1. Copy this entire folder into the main SafePost repository.
2. Open Claude Code from the directory that contains both repositories.
3. Start with `START-HERE.md`.
4. Ask Claude to execute only one phase at a time.
5. Claude must update `docs/PROGRESS.md` after every phase.
6. Do not allow Claude to continue to the next phase until the current phase is verified.

## Recommended file layout after copying

```text
safepost/
├── CLAUDE.md
├── START-HERE.md
├── README.md
└── docs/
    ├── PROGRESS.md
    └── implementation/
        ├── 00-MASTER-PLAN.md
        ├── 01-BACKUP-AND-INVENTORY.md
        ├── 02-REPOSITORY-CLEANUP.md
        ├── 03-AUTH-AND-WORKSPACES.md
        ├── 04-DEMO-AND-EXTERNAL-USERS.md
        ├── 05-EXTENSION-PAIRING.md
        ├── 06-QUEUE-AND-SCHEDULING.md
        ├── 07-FACEBOOK-EXTENSION-STABILITY.md
        ├── 08-BACKEND-AND-FRONTEND-REFACTOR.md
        ├── 09-MEDIA-LOGS-AND-REALTIME.md
        ├── 10-TESTS-DOCUMENTATION-AND-RELEASE.md
        └── 11-FINAL-ACCEPTANCE-CHECKLIST.md
```

## Important scope

This phase includes:

- Backup and recoverability
- Multi-user authentication
- Workspace isolation
- Demo mode
- External user access
- Chrome extension pairing
- Persistent publishing queue
- Facebook extension stabilization
- Refactoring
- Tests and documentation

This phase does not include:

- Instagram
- TikTok
- Billing
- Subscription plans
- Broad Supabase security cleanup
- Git history secret removal
- Production key rotation
