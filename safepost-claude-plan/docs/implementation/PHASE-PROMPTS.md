# Claude Code Phase Prompts

Use one prompt at a time.

## Phase 1

```text
Read CLAUDE.md, docs/implementation/00-MASTER-PLAN.md,
docs/implementation/01-BACKUP-AND-INVENTORY.md, and docs/PROGRESS.md.

Execute Phase 1 only. Do not change application behavior. Create the backup,
branch, tag, snapshot, inventory, restore documentation, and startup verification.
Update docs/PROGRESS.md and stop.
```

## Phase 2

```text
Read CLAUDE.md, docs/implementation/00-MASTER-PLAN.md,
docs/implementation/02-REPOSITORY-CLEANUP.md, docs/INVENTORY.md,
and docs/PROGRESS.md.

Execute Phase 2 only. Establish one primary repository and one active extension.
Preserve all working functionality. Run verification, update docs/PROGRESS.md,
and stop.
```

## Phase 3

```text
Read CLAUDE.md, docs/implementation/00-MASTER-PLAN.md,
docs/implementation/03-AUTH-AND-WORKSPACES.md, and docs/PROGRESS.md.

Execute Phase 3 only. Implement authentication, workspaces, existing-data
migration, and strict workspace isolation. Add and run isolation tests.
Update docs/PROGRESS.md and stop.
```

## Phase 4

```text
Read CLAUDE.md, docs/implementation/00-MASTER-PLAN.md,
docs/implementation/04-DEMO-AND-EXTERNAL-USERS.md, and docs/PROGRESS.md.

Execute Phase 4 only. Build safe demo mode and independent external-user access.
Ensure demo actions cannot trigger real publishing. Run tests, update
docs/PROGRESS.md, and stop.
```

## Phase 5

```text
Read CLAUDE.md, docs/implementation/00-MASTER-PLAN.md,
docs/implementation/05-EXTENSION-PAIRING.md, and docs/PROGRESS.md.

Execute Phase 5 only. Implement scoped extension pairing, device tokens,
worker management, revocation, and communication isolation. Run tests, update
docs/PROGRESS.md, and stop.
```

## Phase 6

```text
Read CLAUDE.md, docs/implementation/00-MASTER-PLAN.md,
docs/implementation/06-QUEUE-AND-SCHEDULING.md, and docs/PROGRESS.md.

Execute Phase 6 only. Persist jobs, locks, retries, scheduling, missed-job
handling, and idempotency. Run queue tests, update docs/PROGRESS.md, and stop.
```

## Phase 7

```text
Read CLAUDE.md, docs/implementation/00-MASTER-PLAN.md,
docs/implementation/07-FACEBOOK-EXTENSION-STABILITY.md, and docs/PROGRESS.md.

Execute Phase 7 only. Stabilize Facebook DOM automation, diagnostics, lifecycle
recovery, error detection, and success verification. Run relevant tests or
test utilities, update docs/PROGRESS.md, and stop.
```

## Phase 8

```text
Read CLAUDE.md, docs/implementation/00-MASTER-PLAN.md,
docs/implementation/08-BACKEND-AND-FRONTEND-REFACTOR.md, and docs/PROGRESS.md.

Execute Phase 8 only. Refactor backend and frontend without changing approved
behavior. Run tests, update docs/PROGRESS.md, and stop.
```

## Phase 9

```text
Read CLAUDE.md, docs/implementation/00-MASTER-PLAN.md,
docs/implementation/09-MEDIA-LOGS-AND-REALTIME.md, and docs/PROGRESS.md.

Execute Phase 9 only. Improve media handling, group validation, structured logs,
audit logs, diagnostics UI, and isolated realtime events. Run tests, update
docs/PROGRESS.md, and stop.
```

## Phase 10

```text
Read CLAUDE.md, docs/implementation/00-MASTER-PLAN.md,
docs/implementation/10-TESTS-DOCUMENTATION-AND-RELEASE.md,
docs/implementation/11-FINAL-ACCEPTANCE-CHECKLIST.md, and docs/PROGRESS.md.

Execute Phase 10 only. Complete tests, documentation, build verification,
migration guidance, final report, and acceptance evidence. Update
docs/PROGRESS.md and stop.
```
