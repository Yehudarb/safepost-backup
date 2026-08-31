# Start Here

Use this prompt in Claude Code:

```text
Read these files first:

- CLAUDE.md
- docs/implementation/00-MASTER-PLAN.md
- docs/implementation/01-BACKUP-AND-INVENTORY.md
- docs/PROGRESS.md

Inspect both repositories:

- https://github.com/Yehudarb/safepost
- https://github.com/Yehudarb/safepost-backup

Execute Phase 1 only.

Do not modify application behavior before completing the backup, inventory, startup verification, restoration documentation, branch, tag, and snapshot requirements.

When Phase 1 is complete:

1. Run the required verification checks.
2. Update docs/PROGRESS.md.
3. Provide a concise report of findings.
4. Stop and wait for the next instruction.
```

After each phase, use a prompt like:

```text
Read:

- CLAUDE.md
- docs/implementation/00-MASTER-PLAN.md
- docs/implementation/<CURRENT-PHASE-FILE>.md
- docs/PROGRESS.md

Execute only the current phase.
Do not begin the next phase.
Preserve completed work from earlier phases.
Run tests and update docs/PROGRESS.md before stopping.
```
