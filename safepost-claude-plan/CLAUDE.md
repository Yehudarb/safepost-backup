# SafePost Project Rules

These rules apply to every Claude Code session in this repository.

## Core rules

- Preserve `safepost-backup` as read-only reference material.
- Never delete or overwrite the backup repository.
- Work on one implementation phase at a time.
- Read `docs/implementation/00-MASTER-PLAN.md` before architectural changes.
- Read the current phase file before modifying code.
- Read and update `docs/PROGRESS.md` in every session.
- Do not begin the next phase without explicit instruction.
- Create reversible database migrations.
- Do not silently delete or rewrite existing production data.
- Do not store Facebook passwords, cookies, or session tokens.
- Do not expose one user or workspace to another.
- Demo users must never trigger real publishing.
- Use one active Chrome extension implementation only.
- Do not hardcode production credentials or server URLs.
- Do not report a publishing operation as successful unless success was verified.
- Run relevant tests and lint checks before completing a phase.
- Document all known failures, skipped work, and assumptions.
- Do not implement Instagram or TikTok during this project phase.

## Required session behavior

Before editing:

1. Inspect the relevant existing implementation.
2. Check `docs/PROGRESS.md`.
3. State which phase is being executed.
4. Identify files expected to change.
5. Preserve working behavior.

After editing:

1. Run relevant tests.
2. Run lint or syntax validation.
3. Update `docs/PROGRESS.md`.
4. List changed files.
5. List database migrations.
6. List known limitations.
7. Stop after the requested phase.
