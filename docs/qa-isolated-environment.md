# SafePost isolated QA environment

## Decision

Keep `release/engagement-phase2a-clean` immutable. Deploy QA from a dedicated
`qa/engagement-phase2a` branch cut from the verified RC commit. That branch may
contain only the environment abstraction, generated CSP, isolation checks, and
their tests/docs. It must contain no QA secret and no fixed QA endpoint in
shared application logic.

The QA projects are separate Render and Vercel projects. They use their own
environment variables and the Supabase project whose ref is
`tesagheacuzkhecaihte`. Startup/build checks fail closed if a QA configuration
contains the production Supabase ref or production application hosts.

Do not configure either service until the final Render and Vercel hostnames are
known. Do not assume that a requested project name guarantees its hostname.

## Render dashboard: `safepost-qa`

Create a new Web Service from the same repository. Select the dedicated QA
configuration branch (not the immutable RC branch), Node runtime, build command
`npm ci`, start command `node server/index.cjs`, health check `/api/health`, and
disable automatic deploys for the initial pilot.

`render.qa.yaml` records those non-secret settings and marks every secret or
not-yet-assigned origin `sync: false`; do not apply the Blueprint until all such
values are safely available.

Non-secret environment variables:

| Name | Value |
|---|---|
| `NODE_ENV` | `production` |
| `SAFEPOST_ENV` | `qa` |
| `SAFEPOST_EXPECTED_SUPABASE_REF` | `tesagheacuzkhecaihte` |
| `SUPABASE_URL` | `https://tesagheacuzkhecaihte.supabase.co` |
| `AUTH_ENFORCED` | `true` |
| `WORKER_AUTH_ENFORCED` | `true` |
| `ENGAGEMENT_ENABLED` | `true` |
| `ALLOWED_DASHBOARD_ORIGINS` | exact assigned QA Vercel origin |
| `QA_DASHBOARD_ORIGIN` | same exact assigned QA Vercel origin |

Secret environment variables (obtain only from the QA Supabase project):

| Name | Purpose |
|---|---|
| `SUPABASE_SERVICE_KEY` | backend database access; never expose to Vercel |
| `SUPABASE_ANON_KEY` | QA project identity/parity check |

Optional variables are required only when the corresponding feature is used:
`ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, and a workspace-bound extension API key.
Do not copy these from production by default. Pair a QA worker through the QA
dashboard instead of copying a production extension credential.

The server's database operations require the URL and service key. The anon key
is additionally required by this QA deployment contract so all three requested
Supabase values are explicitly sourced from the QA project.

## Vercel dashboard: `safepost-qa`

Create a separate project from the same repository. Select the dedicated QA
configuration branch as its production branch. Framework preset is Other; the
repository's `vercel.json` runs `npm run build:vercel` and publishes
`.vercel/output`. Disable automatic deployments for the initial pilot.

Non-secret variables (Production scope for this QA project only):

| Name | Value |
|---|---|
| `SAFEPOST_ENV` | `qa` |
| `SAFEPOST_EXPECTED_SUPABASE_REF` | `tesagheacuzkhecaihte` |
| `VITE_API_URL` | exact assigned QA Render HTTPS origin |
| `VITE_SUPABASE_URL` | `https://tesagheacuzkhecaihte.supabase.co` |
| `VITE_PUBLIC_APP_ORIGIN` | exact assigned QA Vercel HTTPS origin |

Public client credential:

| Name | Value source |
|---|---|
| `VITE_SUPABASE_ANON_KEY` | QA Supabase publishable/anon key only |

The generated CSP permits only self, the configured QA Render HTTPS/WSS
origins, and the configured QA Supabase origin for network connections. It is
generated during each build, so neither QA nor production endpoints live in a
shared static `vercel.json`.

## Mandatory pre-deploy assertions

Run `npm run build:vercel` with the QA variables, then
`npm run test:qa-isolation`. Deployment is blocked unless:

- API origin differs from `https://safepost-backup.onrender.com`.
- Supabase hostname is exactly `tesagheacuzkhecaihte.supabase.co`.
- built output contains neither production Supabase ref nor production app hosts.
- generated CSP contains the exact assigned QA HTTPS and WSS backend origins.
- backend startup accepts only QA Supabase and all three security gates are on.
- dashboard CORS and Socket.IO CORS accept the exact QA Vercel origin only.

After deployment, inspect the response CSP, call `/api/health`, and use browser
DevTools Network while completing the QA procedure. Any request to a production
SafePost or production Supabase hostname is an immediate stop.

## One bounded end-to-end validation

1. Open only the QA dashboard and confirm its hostname and QA worker identity.
2. Create a posts-only Watch named `חשמלאי ירושלים`, query `מחפש חשמלאי`, mode
   Flexible Hebrew.
3. Select one group synced into the QA workspace and save.
4. Clear DevTools Network, run one bounded scan, then use Preview.
5. Verify the match reason, relevance, Opportunities entry, and Open on Facebook.
6. Verify comments control is absent.
7. Switch workspace and verify Watch/Opportunity state resets to that workspace.
8. Run Preview again and prove it makes zero Facebook requests in Network logs.
9. Export evidence and stop. Any production hostname, auth checkpoint, or
   ambiguous worker state is a stop condition; do not retry automatically.

## Read-only production RLS inspection before migration 0015

Run the following in the production Supabase SQL editor only when separately
authorized. It changes nothing:

```sql
select current_database(), current_user, now();

select n.nspname as schema_name,
       c.relname as table_name,
       c.relrowsecurity as rls_enabled,
       c.relforcerowsecurity as rls_forced
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind = 'r'
  and c.relname in (
    'posts','groups','post_templates','group_sets','system_logs',
    'profiles','workspaces','workspace_members','pairing_codes',
    'browser_workers','app_config','engagement_scan_tasks',
    'engagement_discovered_posts','engagement_watches',
    'engagement_scan_candidates','engagement_opportunities'
  )
order by c.relname;

select schemaname, tablename, policyname, permissive, roles, cmd,
       qual, with_check
from pg_policies
where schemaname = 'public'
  and tablename in (
    'posts','groups','post_templates','group_sets','system_logs',
    'profiles','workspaces','workspace_members','pairing_codes',
    'browser_workers','app_config','engagement_scan_tasks',
    'engagement_discovered_posts','engagement_watches',
    'engagement_scan_candidates','engagement_opportunities'
  )
order by tablename, policyname;

select p.oid::regprocedure as function_signature,
       pg_get_functiondef(p.oid) as function_definition
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'is_workspace_member';

select table_name, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and grantee in ('anon','authenticated','service_role')
  and table_name like 'engagement_%'
order by table_name, grantee, privilege_type;
```

Classify production as **member-policy** only when the engagement tables have
permissive `p_*_member` policies whose `qual` and `with_check` call
`public.is_workspace_member(workspace_id)`. Classify it as
**service-role-only drift** when RLS is enabled but those tables have no member
policy (and backend service-role access is the intended path). Any `USING
(true)`, anon-wide policy, disabled RLS, unexpected role, or mixed state is
neither classification and blocks migration 0015 pending review.
