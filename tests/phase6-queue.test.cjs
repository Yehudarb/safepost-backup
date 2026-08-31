/**
 * Phase 6 — Queue hardening tests (locking, retry, idempotency, sweeps).
 *
 * Exercises server/lib/queue.cjs directly against the DEV database.
 * Prereqs: migrations 0000-0002,0005,0006,0007 applied to dev.
 * Env: SUPABASE_URL, SUPABASE_SERVICE_KEY (dev).
 *
 * Run: node tests/phase6-queue.test.cjs
 */
const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_KEY.');
    process.exit(2);
}
if ((SUPABASE_URL || '').includes('namyhsldzufeoycleqxf')) {
    console.error('❌ REFUSING: SUPABASE_URL points at the PRODUCTION project.');
    process.exit(3);
}

const { createClient } = require('@supabase/supabase-js');
const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const q = require('../server/lib/queue.cjs');

let passed = 0, failed = 0;
const assert = (n, c) => { c ? (passed++, console.log(`  ✅ ${n}`)) : (failed++, console.log(`  ❌ ${n}`)); };
const past = (ms = 60000) => new Date(Date.now() - ms).toISOString();

async function seedJob(wsId, fields = {}) {
    const { data, error } = await admin.from('posts').insert({
        content: 'q-test', app_source: 'backup', workspace_id: wsId,
        status: 'SENT', scheduled_time: past(), ...fields,
    }).select('id').single();
    if (error) throw new Error('seedJob: ' + error.message);
    return data.id;
}
const getJob = async (id) => (await admin.from('posts').select('*').eq('id', id).single()).data;

(async () => {
    console.log('Phase 6 queue tests\n');

    // Setup workspace + worker.
    const { data: ws } = await admin.from('workspaces').insert({ name: 'Phase6 WS', is_personal: false }).select('id').single();
    const wsId = ws.id;
    const { data: worker } = await admin.from('browser_workers').insert({ workspace_id: wsId, worker_name: 'w1', device_token_hash: 'x' }).select('id').single();
    const { data: worker2 } = await admin.from('browser_workers').insert({ workspace_id: wsId, worker_name: 'w2', device_token_hash: 'y' }).select('id').single();

    // 1. Locking — two workers cannot both claim the same job.
    const j1 = await seedJob(wsId);
    const c1 = await q.claimNextJob({ workspaceId: wsId, workerId: worker.id });
    const c2 = await q.claimNextJob({ workspaceId: wsId, workerId: worker2.id });
    assert('first claim returns the job', c1 && String(c1.id) === String(j1));
    assert('second concurrent claim is blocked (lock held)', c2 === null);
    assert('claimed job is PROCESSING with attempt_count=1', (await getJob(j1)).status === 'PROCESSING' && (await getJob(j1)).attempt_count === 1);

    // 2. Success + idempotency.
    const s1 = await q.reportJobStatus({ jobId: j1, workspaceId: wsId, status: 'SUCCESS', externalUrl: 'https://example.com/p/1' });
    assert('success recorded', s1.final === 'SUCCESS' && (await getJob(j1)).status === 'SUCCESS');
    const s2 = await q.reportJobStatus({ jobId: j1, workspaceId: wsId, status: 'SUCCESS', externalUrl: 'https://example.com/p/1' });
    assert('re-reporting success is idempotent (no double-processing)', s2.idempotent === true);

    // 3. Retryable failure → requeued with backoff.
    const j2 = await seedJob(wsId);
    await q.claimNextJob({ workspaceId: wsId, workerId: worker.id });
    const r = await q.reportJobStatus({ jobId: j2, workspaceId: wsId, status: 'FAILED', errorCode: 'NETWORK_TIMEOUT' });
    const j2row = await getJob(j2);
    assert('retryable failure is requeued (status SENT)', r.requeued === true && j2row.status === 'SENT');
    assert('requeue sets a future next_attempt_at (backoff)', new Date(j2row.next_attempt_at).getTime() > Date.now());

    // 4. Non-retryable failure → NEEDS_USER_ACTION.
    const j3 = await seedJob(wsId);
    await q.claimNextJob({ workspaceId: wsId, workerId: worker.id });
    const nr = await q.reportJobStatus({ jobId: j3, workspaceId: wsId, status: 'FAILED', errorCode: 'FACEBOOK_LOGGED_OUT' });
    assert('user-action failure is not retried', nr.final === 'NEEDS_USER_ACTION' && (await getJob(j3)).status === 'NEEDS_USER_ACTION');

    // 5. Lock-expiry sweep — worker disconnected mid-job → returned to queue.
    const j4 = await seedJob(wsId, { status: 'PROCESSING', lock_expires_at: past(), attempt_count: 0, worker_id: worker.id });
    const swept = await q.sweepExpiredLocks();
    assert('expired lock returns job to the queue', swept.requeued >= 1 && (await getJob(j4)).status === 'SENT');

    // 6. Missed schedule (policy publish_immediately) → made ready.
    const j5 = await seedJob(wsId, { status: 'PENDING', scheduled_time: past(60 * 60 * 1000) });
    const missed = await q.sweepMissedSchedules({ graceMs: 15 * 60 * 1000 });
    assert('missed schedule handled per policy', missed.handled >= 1 && (await getJob(j5)).status === 'SENT');

    // 7. REGRESSION (2026-08-31): claimNextJob used a PostgREST embed
    //    (`groups(name, url)`) that needs a posts→groups FK — the very FK
    //    migration 0008 drops. Every claim failed with PGRST200 and returned
    //    null, so nothing could ever be published. The worker also needs
    //    group_url: background.js opens the Facebook tab with it.
    const gid = `qa-regression-${Date.now()}`;
    await admin.from('groups').insert({
        id: gid, name: 'QA Regression Group', url: 'https://facebook.com/groups/qa-regression',
        workspace_id: wsId, facebook_user: '',
    });
    const j6 = await seedJob(wsId, { group_id: gid, facebook_user: '' });
    const c6 = await q.claimNextJob({ workspaceId: wsId, workerId: worker.id });
    assert('claim succeeds for a job with a group (no FK embed)', c6 && String(c6.id) === String(j6));
    assert('claimed job carries group_url for the worker', c6 && c6.group_url === 'https://facebook.com/groups/qa-regression');

    // Cleanup.
    await admin.from('groups').delete().eq('workspace_id', wsId);
    await admin.from('posts').delete().eq('workspace_id', wsId);
    await admin.from('browser_workers').delete().eq('workspace_id', wsId);
    await admin.from('workspaces').delete().eq('id', wsId);

    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed ? 1 : 0);
})().catch(e => { console.error('Test run error:', e.message); process.exit(2); });
