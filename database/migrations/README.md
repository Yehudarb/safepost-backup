# Database migrations (Phase 3)

Versioned, reversible SQL migrations for authentication + workspace isolation.
Run in order against the **dev/staging** Supabase project first.

## Order

| # | File | Purpose |
|---|------|---------|
| 1 | `0001_auth_and_workspaces.sql` | profiles, workspaces, workspace_members, role enum, new-user trigger |
| 2 | `0002_add_workspace_scoping.sql` | add nullable `workspace_id`/`created_by` to business tables |
| 3 | `0003_backfill_owner.sql` | assign existing rows to the Original Owner workspace (**edit owner email first**) |
| 4 | `0004_rls_and_constraints.sql` | RLS isolation policies + `NOT NULL` on `workspace_id` |

Each has a matching `NNNN_down.sql` to revert (newest first).

## How to run

**Supabase SQL editor** (simplest): paste each file's contents in order and run.

**Or via psql / Supabase CLI:**
```bash
psql "$DATABASE_URL" -f 0001_auth_and_workspaces.sql
psql "$DATABASE_URL" -f 0002_add_workspace_scoping.sql
# 1) register the original-owner account in the app (or Supabase dashboard)
# 2) edit v_owner_email in 0003, then:
psql "$DATABASE_URL" -f 0003_backfill_owner.sql
psql "$DATABASE_URL" -f 0004_rls_and_constraints.sql
```

## Notes

- **0003 requires the owner account to exist first** (needs an `auth.users` row).
- The backend uses the `service_role` key and bypasses RLS; RLS is defense-in-depth.
  Primary isolation is enforced in the backend by scoping every query to the
  authenticated user's workspace.
- Do **not** run these against production until validated on dev and the cutover
  is approved.
