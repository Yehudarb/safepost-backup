# Final Acceptance Checklist

Claude must verify every item and provide evidence.

## Backup

- [ ] Original code is recoverable.
- [ ] Backup branch exists.
- [ ] Backup tag exists.
- [ ] Timestamped snapshot exists.
- [ ] `safepost-backup` remains preserved.
- [ ] `docs/RESTORE.md` is complete.

## Repository

- [ ] One primary repository is documented.
- [ ] One active extension implementation exists.
- [ ] Duplicate extension code is archived only.
- [ ] Hardcoded production URLs are removed.
- [ ] `.env.example` is complete.
- [ ] Real credentials are not committed.

## Authentication and isolation

- [ ] User can register.
- [ ] User can log in.
- [ ] User can log out.
- [ ] Password reset works.
- [ ] New user receives a private workspace.
- [ ] Existing data belongs only to the original owner workspace.
- [ ] User A cannot read User B data.
- [ ] User A cannot modify User B data.
- [ ] Realtime events are isolated.

## Demo and external users

- [ ] Demo contains synthetic data only.
- [ ] Demo banner is visible.
- [ ] Demo cannot publish.
- [ ] Demo cannot pair a real extension.
- [ ] External user starts with an empty private workspace.
- [ ] Owner Facebook data is not exposed.

## Extension

- [ ] Each extension belongs to one workspace.
- [ ] Pairing code expires.
- [ ] Pairing code is single-use.
- [ ] Device token is revocable.
- [ ] Revoked workers are rejected.
- [ ] Worker receives only workspace jobs.
- [ ] Version is consistent.
- [ ] Service-worker restart recovery works.
- [ ] Facebook password is never stored.
- [ ] Facebook cookies are never stored.

## Queue

- [ ] Queue survives backend restart.
- [ ] Locking prevents simultaneous duplicate execution.
- [ ] Idempotency is persistent.
- [ ] Retryable and non-retryable errors are separated.
- [ ] Missed schedules are handled.
- [ ] Cancellation works.
- [ ] Worker disconnect recovery works.

## Facebook publishing

- [ ] Text posting works.
- [ ] Supported image posting works.
- [ ] Login state is detected.
- [ ] Captcha/checkpoint is detected.
- [ ] Group-access failure is detected.
- [ ] Publish success is verified.
- [ ] Uncertain success is not marked successful.
- [ ] Post URL is stored when available.
- [ ] Diagnostics are visible.

## Code quality

- [ ] Backend is modular.
- [ ] Frontend is modular.
- [ ] Route validation exists.
- [ ] Central error handling exists.
- [ ] Duplicate active code is removed.
- [ ] Existing approved functionality remains available.

## Tests and documentation

- [ ] Authentication tests pass.
- [ ] Isolation tests pass.
- [ ] Pairing tests pass.
- [ ] Queue tests pass.
- [ ] Demo restriction tests pass.
- [ ] Frontend tests pass.
- [ ] Build passes.
- [ ] README is updated.
- [ ] Architecture documentation exists.
- [ ] Deployment documentation exists.
- [ ] Extension instructions exist.
- [ ] Final report exists.

## Deferred scope confirmation

- [ ] Instagram was not implemented.
- [ ] TikTok was not implemented.
- [ ] Billing was not implemented.
- [ ] Broad Supabase security cleanup was not performed.
- [ ] Git history secret removal was not performed.
- [ ] Production key rotation was not performed.
- [ ] Future platform-ready fields remain in the architecture.
