/**
 * Phase 17 - Public aggregate observability.
 *
 * Unit coverage proves timeout/failure semantics without disrupting a real DB.
 * Integration coverage seeds non-claimable QA-only rows and checks aggregate
 * deltas from the public endpoint. No production project is permitted.
 */
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const {
    collectHealthSnapshot,
    PROCESSING_STUCK_MS,
    WORKER_STALE_MS,
    JOB_MAX_ATTEMPTS,
    MAX_ATTEMPTS_WINDOW_MS,
} = require('../server/lib/health.cjs');

const { SUPABASE_URL, SUPABASE_SERVICE_KEY, SUPABASE_ANON_KEY, API_URL = 'http://localhost:3001' } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !SUPABASE_ANON_KEY) {
    console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_KEY / SUPABASE_ANON_KEY.');
    process.exit(2);
}
if ((SUPABASE_URL || '').includes('hfpsdzfggugoerythnug')) {
    console.error('REFUSING: SUPABASE_URL points at the production project.');
    process.exit(3);
}

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
let passed = 0;
let failed = 0;
const assert = (name, condition) => {
    if (condition) {
        passed++;
        console.log(`  OK ${name}`);
    } else {
        failed++;
        console.log(`  FAIL ${name}`);
    }
};

const fixedNow = Date.parse('2026-09-02T12:00:00.000Z');
const healthyReader = (overrides = {}) => ({
    probe: async () => {},
    queueDepth: async () => 4,
    processingCount: async () => 2,
    processingOver10m: async () => 1,
    oldestProcessingClaimedAt: async () => new Date(fixedNow - 20 * 60 * 1000).toISOString(),
    onlineWorkers: async () => 2,
    staleWorkers: async () => 1,
    jobsAtMaxAttempts24h: async () => 3,
    retryableOverdue30m: async () => 1,
    recentRetries15m: async () => 2,
    ...overrides,
});

async function publicHealth() {
    const response = await fetch(`${API_URL}/api/health`, { headers: { Connection: 'close' } });
    return { status: response.status, body: await response.json().catch(() => null) };
}

// A real signed-in dashboard user, because bulk delete is only reachable behind
// dashboardAuth and its workspace scoping is the property under test.
async function makeDashboardUser(label) {
    const email = `phase17_${Date.now()}_${label}@example.com`;
    const password = `Passw0rd!${label}aA1`;
    const { data: created, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (error) throw new Error(`createUser ${label}: ${error.message}`);
    const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } });
    const { data: session, error: signInError } = await anon.auth.signInWithPassword({ email, password });
    if (signInError) throw new Error(`signIn ${label}: ${signInError.message}`);
    const token = session.session.access_token;
    const provision = await fetch(`${API_URL}/api/queue`, {
        headers: { Authorization: `Bearer ${token}`, Connection: 'close' },
    });
    if (!provision.ok) throw new Error(`workspace provision ${label}: HTTP ${provision.status}`);
    const { data: memberships } = await admin.from('workspace_members')
        .select('workspace_id').eq('user_id', created.user.id).limit(1);
    return { userId: created.user.id, token, workspaceId: memberships[0].workspace_id };
}

async function bulkDelete(user, ids) {
    const response = await fetch(`${API_URL}/api/tasks/bulk-delete`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${user.token}`,
            'x-workspace-id': user.workspaceId,
            'Content-Type': 'application/json',
            Connection: 'close',
        },
        body: JSON.stringify({ ids }),
    });
    return { status: response.status, body: await response.json().catch(() => null) };
}

async function seedDeletablePosts(workspaceId, marker, count) {
    const rows = Array.from({ length: count }, (_, i) => ({
        workspace_id: workspaceId,
        group_id: `${marker}_grp`,
        content: `${marker}_BULK_SECRET_${i}`,
        status: 'FAILED',
        app_source: marker,
        attempt_count: 1,
        max_attempts: JOB_MAX_ATTEMPTS,
    }));
    const { data, error } = await admin.from('posts').insert(rows).select('id');
    if (error) throw new Error(`bulk fixtures: ${error.message}`);
    return data.map(r => r.id);
}

function sensitiveKeyFound(value) {
    const forbidden = new Set([
        'content', 'post_text', 'group_name', 'group_id', 'facebook_id', 'facebook_user',
        'email', 'token', 'device_token', 'device_token_hash', 'worker_id', 'workspace_id',
        'workspace_secret', 'supabase_key', 'stack', 'stack_trace',
    ]);
    if (!value || typeof value !== 'object') return false;
    return Object.entries(value).some(([key, nested]) => forbidden.has(key) || sensitiveKeyFound(nested));
}

(async () => {
    console.log('Phase 17 observability readiness\n');

    console.log(' A. health-state semantics');
    const healthy = await collectHealthSnapshot(healthyReader(), {
        timeoutMs: 100,
        nowMs: fixedNow,
        app: { version: 'test', commit_sha: 'abc123' },
    });
    assert('healthy DB returns HTTP 200 semantics', healthy.httpStatus === 200 && healthy.body.status === 'healthy');
    assert('healthy response reports a real successful Supabase probe', healthy.body.supabase === true);
    assert('oldest PROCESSING age is calculated without exposing the row', healthy.body.oldest_processing_age_seconds === 1200);

    const unavailable = await collectHealthSnapshot(healthyReader({
        probe: async () => { const error = new Error('private database failure'); error.code = 'DB_DOWN'; throw error; },
    }), { timeoutMs: 100, nowMs: fixedNow });
    assert('unavailable DB returns HTTP 503 semantics', unavailable.httpStatus === 503 && unavailable.body.status === 'degraded');
    assert('unavailable DB is never reported as healthy Supabase', unavailable.body.supabase === false && unavailable.body.database.status === 'unavailable');
    assert('database error details are not exposed', !JSON.stringify(unavailable.body).includes('private database failure'));

    const timeoutStarted = Date.now();
    const timedOut = await collectHealthSnapshot(healthyReader({ probe: async () => new Promise(() => {}) }), {
        timeoutMs: 20,
        nowMs: fixedNow,
    });
    assert('database timeout returns degraded HTTP 503', timedOut.httpStatus === 503 && timedOut.body.reason === 'database_timeout');
    assert('timeout does not falsely claim Supabase connectivity', timedOut.body.supabase === false);
    assert('strict timeout returns promptly', Date.now() - timeoutStarted < 250);

    console.log('\n B. live aggregate signals');
    const baseline = await publicHealth();
    assert('live QA health endpoint is initially reachable', baseline.status === 200 && baseline.body?.status === 'healthy');

    const marker = `phase17_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const secretContent = `${marker}_SECRET_POST_TEXT`;
    const secretFacebookId = `${marker}_FACEBOOK_ID`;
    const secretWorkerName = `${marker}_SECRET_WORKER`;
    const { data: workspace, error: workspaceError } = await admin.from('workspaces')
        .insert({ name: marker, is_personal: false }).select('id').single();
    if (workspaceError) throw new Error(`workspace fixture: ${workspaceError.message}`);

    try {
        const oldProcessingAt = new Date(Date.now() - Math.max(PROCESSING_STUCK_MS + 5 * 60 * 1000, 15 * 60 * 1000)).toISOString();
        const freshProcessingAt = new Date(Date.now() - 60 * 1000).toISOString();
        const oldRetryAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();
        const futureSchedule = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
        const recentAttemptAt = new Date().toISOString();
        const recentEndedAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();
        const staleEndedAt = new Date(Date.now() - MAX_ATTEMPTS_WINDOW_MS - 24 * 60 * 60 * 1000).toISOString();

        const { error: postError } = await admin.from('posts').insert([
            {
                workspace_id: workspace.id, group_id: secretFacebookId, content: secretContent,
                status: 'PROCESSING', app_source: marker, scheduled_time: oldProcessingAt,
                claimed_at: oldProcessingAt, attempt_count: 1, max_attempts: JOB_MAX_ATTEMPTS,
            },
            {
                workspace_id: workspace.id, group_id: secretFacebookId, content: secretContent,
                status: 'PROCESSING', app_source: marker, scheduled_time: freshProcessingAt,
                claimed_at: freshProcessingAt, attempt_count: 1, max_attempts: JOB_MAX_ATTEMPTS,
            },
            {
                workspace_id: workspace.id, group_id: secretFacebookId, content: secretContent,
                status: 'PROCESSING', app_source: marker, scheduled_time: oldProcessingAt,
                claimed_at: null, created_at: oldProcessingAt,
                attempt_count: 1, max_attempts: JOB_MAX_ATTEMPTS,
            },
            {
                // Finalised inside the 24h window -> must be counted.
                workspace_id: workspace.id, group_id: secretFacebookId, content: secretContent,
                status: 'FAILED', app_source: marker, scheduled_time: oldRetryAt,
                attempt_count: JOB_MAX_ATTEMPTS, max_attempts: JOB_MAX_ATTEMPTS,
                ended_at: recentEndedAt,
            },
            {
                // Same shape but finalised two days ago. This is the historical
                // backlog case that made the all-time metric permanently non-zero.
                workspace_id: workspace.id, group_id: secretFacebookId, content: secretContent,
                status: 'FAILED', app_source: marker, scheduled_time: oldRetryAt,
                attempt_count: JOB_MAX_ATTEMPTS, max_attempts: JOB_MAX_ATTEMPTS,
                ended_at: staleEndedAt,
            },
            {
                workspace_id: workspace.id, group_id: secretFacebookId, content: secretContent,
                status: 'PENDING', app_source: marker, scheduled_time: futureSchedule,
                attempt_count: 1, max_attempts: JOB_MAX_ATTEMPTS, next_attempt_at: oldRetryAt,
            },
            {
                workspace_id: workspace.id, group_id: secretFacebookId, content: secretContent,
                status: 'FAILED', app_source: marker, scheduled_time: recentAttemptAt,
                attempt_count: 2, max_attempts: JOB_MAX_ATTEMPTS, last_attempt_at: recentAttemptAt,
            },
        ]);
        if (postError) throw new Error(`post fixtures: ${postError.message}`);

        const { error: workerError } = await admin.from('browser_workers').insert([
            {
                workspace_id: workspace.id, worker_name: secretWorkerName,
                device_token_hash: `${marker}_fresh_hash`, status: 'online', last_seen_at: freshProcessingAt,
            },
            {
                workspace_id: workspace.id, worker_name: secretWorkerName,
                device_token_hash: `${marker}_stale_hash`, status: 'online',
                last_seen_at: new Date(Date.now() - WORKER_STALE_MS - 5 * 60 * 1000).toISOString(),
            },
        ]);
        if (workerError) throw new Error(`worker fixtures: ${workerError.message}`);

        const observed = await publicHealth();
        assert('live health remains HTTP 200 with operational warnings', observed.status === 200 && observed.body?.status === 'healthy');
        assert('stuck PROCESSING jobs include legacy rows without claimed_at',
            observed.body.processing_over_10m >= baseline.body.processing_over_10m + 2);
        assert('PROCESSING count includes all test jobs', observed.body.processing_jobs >= baseline.body.processing_jobs + 3);
        assert('oldest PROCESSING age is at least 10 minutes', observed.body.oldest_processing_age_seconds >= 10 * 60);
        assert('stale worker is detected', observed.body.stale_workers >= baseline.body.stale_workers + 1);
        assert('normal worker is not marked stale', observed.body.online_workers >= baseline.body.online_workers + 1);
        assert('recently exhausted job is counted in the 24h window',
            observed.body.jobs_at_max_attempts_24h >= baseline.body.jobs_at_max_attempts_24h + 1);
        assert('historical backlog outside the 24h window is excluded',
            observed.body.jobs_at_max_attempts_24h === baseline.body.jobs_at_max_attempts_24h + 1);
        assert('unusually old retryable job is counted', observed.body.retryable_overdue_30m >= baseline.body.retryable_overdue_30m + 1);
        assert('recent retry signal is counted', observed.body.recent_retries_15m >= baseline.body.recent_retries_15m + 1);

        const serialized = JSON.stringify(observed.body);
        assert('public health response has no sensitive field names', !sensitiveKeyFound(observed.body));
        assert('public health response does not contain post or tenant fixture values',
            !serialized.includes(secretContent) &&
            !serialized.includes(secretFacebookId) &&
            !serialized.includes(secretWorkerName) &&
            !serialized.includes(workspace.id));
    } finally {
        await admin.from('posts').delete().eq('workspace_id', workspace.id);
        await admin.from('browser_workers').delete().eq('workspace_id', workspace.id);
        await admin.from('workspaces').delete().eq('id', workspace.id);
    }

    console.log('\n C. P1 security invariant');
    const serverSource = fs.readFileSync(path.join(__dirname, '../server/index.cjs'), 'utf8');
    assert('/api/logs remains behind dashboard workspace authorization',
        /app\.get\('\/api\/logs',\s*\.\.\.dashboardAuth/.test(serverSource));
    assert('bulk delete remains behind dashboard workspace authorization',
        /app\.post\('\/api\/tasks\/bulk-delete',\s*\.\.\.dashboardAuth/.test(serverSource));

    console.log('\n D. bulk delete safety');
    const bulkMarker = `bulk17_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const owner = await makeDashboardUser('owner');
    const outsider = await makeDashboardUser('outsider');
    try {
        const rejectedEmpty = await bulkDelete(owner, []);
        assert('empty id array is rejected', rejectedEmpty.status === 400);

        const notArray = await bulkDelete(owner, 'all');
        assert('malformed id payload is rejected', notArray.status === 400);

        // Seed one more than the cap so the refusal can be proven non-destructive.
        const overSized = await seedDeletablePosts(owner.workspaceId, `${bulkMarker}_over`, 101);
        const tooMany = await bulkDelete(owner, overSized);
        assert('batch above the cap is rejected', tooMany.status === 400);
        assert('rejection reports the cap without echoing the ids',
            tooMany.body?.max_batch === 100 &&
            tooMany.body?.received === 101 &&
            !JSON.stringify(tooMany.body).includes(String(overSized[0])));
        const { count: survivors } = await admin.from('posts')
            .select('id', { count: 'exact', head: true }).in('id', overSized);
        assert('over-sized batch deletes nothing (no silent truncation)', survivors === 101);
        await admin.from('posts').delete().in('id', overSized);

        const deletable = await seedDeletablePosts(owner.workspaceId, `${bulkMarker}_ok`, 5);
        const accepted = await bulkDelete(owner, deletable);
        assert('batch within the cap succeeds', accepted.status === 200 && accepted.body?.success === true);
        assert('response reports the real deleted count', accepted.body?.deleted_count === 5);
        const { count: remaining } = await admin.from('posts')
            .select('id', { count: 'exact', head: true }).in('id', deletable);
        assert('accepted batch actually removed the rows', remaining === 0);

        // Cross-tenant: ids that exist, but not in the caller's workspace.
        const foreign = await seedDeletablePosts(outsider.workspaceId, `${bulkMarker}_foreign`, 3);
        const crossTenant = await bulkDelete(owner, foreign);
        assert('cross-workspace ids are accepted but delete nothing',
            crossTenant.status === 200 && crossTenant.body?.deleted_count === 0);
        const { count: foreignSurvivors } = await admin.from('posts')
            .select('id', { count: 'exact', head: true }).in('id', foreign);
        assert('another workspace\'s rows are untouched', foreignSurvivors === 3);

        const { data: auditRows } = await admin.from('system_logs')
            .select('message, log_level, workspace_id')
            .eq('workspace_id', owner.workspaceId)
            .order('created_at', { ascending: false })
            .limit(20);
        const auditLines = (auditRows || []).filter(r => r.message.includes('operation=bulk_delete_posts'));
        const successAudit = auditLines.find(r => r.message.includes('deleted_count=5'));
        const rejectAudit = auditLines.find(r => r.message.includes('reason=batch_too_large'));
        assert('successful bulk delete writes an audit entry', Boolean(successAudit));
        assert('audit entry records the operation, count and actor',
            Boolean(successAudit) &&
            successAudit.message.includes('outcome=success') &&
            successAudit.message.includes(`actor=${owner.userId}`));
        assert('audit entry is attributed to the caller workspace',
            Boolean(successAudit) && successAudit.workspace_id === owner.workspaceId);
        assert('rejected over-sized attempt is also audited',
            Boolean(rejectAudit) && rejectAudit.message.includes('requested_count=101'));
        const auditText = auditLines.map(r => r.message).join(' | ');
        assert('audit entries never contain the id list or post content',
            !auditText.includes(String(deletable[0])) &&
            !auditText.includes(String(overSized[0])) &&
            !auditText.includes('BULK_SECRET') &&
            !auditText.includes(`${bulkMarker}_grp`));

        await admin.from('posts').delete().in('id', foreign);
    } finally {
        for (const u of [owner, outsider]) {
            await admin.from('system_logs').delete().eq('workspace_id', u.workspaceId);
            await admin.from('posts').delete().eq('workspace_id', u.workspaceId);
            await admin.from('workspace_members').delete().eq('workspace_id', u.workspaceId);
            await admin.from('workspaces').delete().eq('id', u.workspaceId);
            await admin.auth.admin.deleteUser(u.userId);
        }
    }

    console.log('\n E. monitoring guidance');
    const docsSource = fs.readFileSync(path.join(__dirname, '../docs/observability.md'), 'utf8');
    assert('docs make online_workers == 0 the primary worker alert',
        /Alert when `online_workers == 0` for two consecutive checks/.test(docsSource));
    assert('docs warn against alerting on stale_workers',
        /Do \*\*not\*\* use `stale_workers > 0` as the primary alert/.test(docsSource));
    assert('docs document the queue-depth drop signal',
        /Queue-depth drop signal/.test(docsSource) && /never wire it to an automatic corrective action/.test(docsSource));
    assert('docs explain the 24h max-attempts window',
        /jobs_at_max_attempts_24h/.test(docsSource) && /monotonic/.test(docsSource));

    console.log(`\n${passed} passed, ${failed} failed`);
    process.exitCode = failed ? 1 : 0;
})().catch(error => {
    console.error('Test run error:', error.message);
    process.exitCode = 2;
});
