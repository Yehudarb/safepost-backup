# Phase 4 — Demo and External Users

## Goal

Allow an external user to experience SafePost without seeing the owner's Facebook data or triggering real publishing.

## Experience A — Demo mode

Create a demo account or isolated demo workspace using synthetic data only.

Include:

- Fictional Facebook groups
- Sample scheduled posts
- Sample history
- Sample templates
- Sample analytics
- Simulated worker state
- Simulated success and failure logs

Do not include:

- Real Facebook group URLs
- Owner account details
- Real worker IDs
- Real private posts
- Real media
- Real owner records

Display a visible banner:

```text
Demo Mode — no real posts will be published
```

## Demo restrictions

The demo user must not:

- Pair a real extension
- Claim a real job
- Publish to Facebook
- Modify production owner data
- Upload media into a real owner workspace
- Access private API routes outside demo scope

Real operations must be:

- Disabled
- Simulated
- Or replaced by a clear demo message

Provide a safe demo-data reset mechanism.

## Experience B — Independent external user

A real external user must be able to:

1. Register.
2. Receive a private workspace.
3. Add their own Facebook groups.
4. Install their own extension.
5. Pair it with their account.
6. Create and schedule their own posts.
7. View only their own workers, jobs, logs, and analytics.

The system must never:

- Copy the owner's Facebook session
- Share the owner's extension
- Store Facebook passwords
- Transfer cookies
- Reuse another user's logged-in browser state

## UI requirements

Add:

- Demo entry option
- Registration link
- Login link
- Demo banner
- Clear distinction between demo and real mode
- Disabled real publishing controls in demo mode

## Tests

Test:

- Demo sees synthetic data only.
- Demo cannot trigger real publishing.
- Demo cannot access owner data.
- External user begins with an empty private workspace.
- External user cannot see demo administrative records.
- Demo reset works safely.

## Verification

- Demo mode is safe and clearly labeled.
- External registration works.
- Owner data remains isolated.
- `docs/PROGRESS.md` is updated.

## Stop condition

Stop after demo and external-user support.
