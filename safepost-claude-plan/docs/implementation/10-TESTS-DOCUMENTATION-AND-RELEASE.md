# Phase 10 — Tests, Documentation, and Release

## Goal

Add automated verification, deployment documentation, migration guidance, and a release report.

## Test tools

Use appropriate tools such as:

- Vitest
- React Testing Library
- Supertest
- A suitable Node test runner
- Mocked Supabase services where appropriate

## Backend tests

Cover:

- Registration
- Login
- Unauthorized access
- Workspace isolation
- User A cannot access User B resources
- Creating a post
- Scheduling
- Worker pairing
- Worker authentication
- Job claim
- Job locking
- Lock expiration
- Duplicate prevention
- Retry behavior
- Cancellation
- Missed schedules
- Demo restrictions

## Frontend tests

Cover:

- Protected routes
- Login
- Workspace loading
- Post creation
- Group selection
- Queue filtering
- Worker status
- Demo banner
- Disabled real publishing in demo

## Extension verification

Cover with automated tests or reliable test utilities:

- Login-state detection
- Group validation
- Composer detection
- Text insertion
- Image upload
- Publish detection
- Captcha/checkpoint detection
- Lifecycle recovery
- Duplicate prevention

## Documentation

Create or update:

```text
README.md
CHANGELOG.md
docs/ARCHITECTURE.md
docs/DEVELOPMENT.md
docs/DEPLOYMENT.md
docs/EXTENSION_SETUP.md
docs/MULTI_USER.md
docs/DEMO_MODE.md
docs/RESTORE.md
docs/TROUBLESHOOTING.md
```

## README requirements

Include:

- Overview
- Architecture
- Local setup
- Environment variables
- Database setup
- Frontend startup
- Backend startup
- Extension installation
- Extension pairing
- Demo usage
- Production deployment
- Test commands

## Database migrations

All schema changes must have versioned migration files.

Provide:

- Migration instructions
- Rollback guidance
- Existing data migration explanation
- Owner workspace migration explanation

## Final technical report

Create:

```text
docs/FINAL-REPORT.md
```

Include:

1. Summary of changes
2. Files added
3. Files changed
4. Files archived
5. Files removed
6. Migrations
7. Rollback
8. Environment variables
9. Local setup
10. Deployment
11. Extension setup
12. Demo instructions
13. Test results
14. Known limitations
15. Remaining risks
16. Deferred work
17. Suggested future Instagram plan without implementation

## Release verification

Run:

- Backend tests
- Frontend tests
- Extension syntax validation
- Lint
- Build
- Migration dry run where practical
- Manual smoke test

## Stop condition

Stop after producing the release report and updating `docs/PROGRESS.md`.
