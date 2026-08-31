/**
 * Phase 11 - Worker status callback regression test.
 *
 * WHY THIS EXISTS
 * ---------------
 * The extension CLAIMED jobs through the hardened queue
 * (POST /api/workers/:workerId/jobs/claim) but REPORTED them through the legacy
 * PATCH /api/tasks/:id/status, which only writes `status`. So a finished job kept
 * its lock and worker (ended_at null, lock_expires_at set, worker_id set,
 * browser_workers.current_job_id stuck on the completed job), external_post_url was
 * never stored, and — the serious part — reportJobStatus()'s error classification
 * never ran, so Phase 6's retry/backoff/NEEDS_USER_ACTION logic was dead for every
 * real extension failure. Observed live on job 2415 (2026-08-31).
 *
 * Phase 6 covers the same logic by calling queue.cjs directly, which is exactly why
 * it stayed green while the real path was broken. This file therefore drives the
 * actual HTTP route the extension uses, with real device-token auth.
 *
 * Env: SUPABASE_URL, SUPABASE_SERVICE_KEY, API_URL. Requires the backend running.
 */
const { createClient } = require('@supabase/supabase-js');
const { generateDeviceToken, hashToken } = require('../server/middleware/worker.cjs');

const { SUPABASE_URL, SUPABASE_SERVICE_KEY, API_URL = 'http://localhost:3001' } = process.env;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_KEY.');
    process.exit(2);
}
if ((SUPABASE_URL || '').includes('namyhsldzufeoycleqxf')) {
    console.error('REFUSING: SUPABASE_URL points at the PRODUCTION project.');
    process.exit(3);
}

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });

let passed = 0, failed = 0;
const assert = (name, cond) => { cond ? (passed++, console.log(`  OK ${name}`)) : (failed++, console.log(`  FAIL ${name}`)); };
const past = (ms = 60000) => new Date(Date.now() - ms).toISOString();

const getJob = async id => (await admin.from('posts').select('*').eq('id', id).single()).data;
const getWorker = async id => (await admin.from('browser_workers').select('*').eq('id', id).single()).data;

async function seedJob(wsId, groupId, fields = {}) {
    const { data, error } = await admin.from('posts').insert({
        content: 'phase11 job', app_source: 'backup', workspace_id: wsId, group_id: groupId,
        status: 'SENT', scheduled_time: past(), ...fields,
    }).select('id').single();
    if (error) throw new Error('seedJob: ' + error.message);
    return data.id;
}

function workerHeaders(w) {
    return { 'x-worker-id': w.id, 'x-device-token': w.token, 'Content-Type': 'application/json', Connection: 'close' };
}

async function claim(w) {
    const res = await fetch(`${API_URL}/api/workers/${w.id}/jobs/claim`, { method: 'POST', headers: workerHeaders(w) });
    const body = await res.json().catch(() => null);
    return { status: res.status, job: body && body.job };
}

async function report(w, jobId, payload, headersOverride) {
    const res = await fetch(`${API_URL}/api/workers/${w.id}/jobs/${jobId}/status`, {
        method: 'POST',
        headers: headersOverride || workerHeaders(w),
        body: JSON.stringify(payload),
    });
    return { status: res.status, body: await res.json().catch(() => null) };
}

async function makeWorker(wsId, name) {
    const token = generateDeviceToken();
    const { data, error } = await admin.from('browser_workers').insert({
        workspace_id: wsId, worker_name: name, device_token_hash: hashToken(token), status: 'online',
    }).select('id').single();
    if (error) throw new Error('makeWorker: ' + error.message);
    return { id: data.id, token };
}

(async () => {
    console.log('Phase 11 worker status callback (HTTP route)\n');

    const { data: wsA } = await admin.from('workspaces').insert({ name: 'Phase11 WS A', is_personal: false }).select('id').single();
    const { data: wsB } = await admin.from('workspaces').insert({ name: 'Phase11 WS B', is_personal: false }).select('id').single();
    const groupId = `phase11-grp-${Date.now()}`;
    await admin.from('groups').insert({
        id: groupId, name: 'Phase11 Group', url: 'https://facebook.com/groups/phase11',
        workspace_id: wsA.id, facebook_user: '',
    });
    const workerA = await makeWorker(wsA.id, 'phase11-a');
    const workerB = await makeWorker(wsB.id, 'phase11-b');

    // ---------- 1. SUCCESS: full cleanup through the hardened route ----------
    const j1 = await seedJob(wsA.id, groupId);
    const c1 = await claim(workerA);
    assert('worker claims the job over HTTP', c1.job && String(c1.job.id) === String(j1));
    assert('claim marks the worker busy on that job', String((await getWorker(workerA.id)).current_job_id) === String(j1));

    const permalink = 'https://www.facebook.com/groups/phase11/permalink/12345/';
    const r1 = await report(workerA, j1, { status: 'SUCCESS', proof_url: permalink });
    assert('SUCCESS report accepted', r1.status === 200);

    const j1row = await getJob(j1);
    assert('status becomes SUCCESS', j1row.status === 'SUCCESS');
    assert('ended_at is set', !!j1row.ended_at);
    assert('lock_expires_at is cleared', j1row.lock_expires_at === null);
    assert('worker_id is released', j1row.worker_id === null);
    assert('external_post_url stores the permalink', j1row.external_post_url === permalink);
    assert('proof_url stores the evidence url', j1row.proof_url === permalink);

    const wA1 = await getWorker(workerA.id);
    assert('browser_workers.current_job_id is cleared', wA1.current_job_id === null);
    assert('worker returns to online', wA1.status === 'online');

    const reclaim = await claim(workerA);
    assert('completed job cannot be reclaimed', !reclaim.job || String(reclaim.job.id) !== String(j1));

    // ---------- 2. SUCCESS with only the group-url fallback ----------
    // findPostPermalink() returns the GROUP url when it cannot find the post, and
    // that must not masquerade as a permalink in external_post_url.
    const j2 = await seedJob(wsA.id, groupId);
    await claim(workerA);
    const groupUrl = 'https://www.facebook.com/groups/phase11/';
    await report(workerA, j2, { status: 'SUCCESS', proof_url: groupUrl });
    const j2row = await getJob(j2);
    assert('fallback group url is NOT stored as external_post_url', j2row.external_post_url === null);
    assert('fallback group url is kept in proof_url', j2row.proof_url === groupUrl);
    assert('fallback success still completes the job', j2row.status === 'SUCCESS' && !!j2row.ended_at);

    // ---------- 3. Retryable failure → requeued with backoff ----------
    const j3 = await seedJob(wsA.id, groupId);
    await claim(workerA);
    const r3 = await report(workerA, j3, { status: 'FAILED', error_code: 'NETWORK_TIMEOUT', failure_reason: 'timeout' });
    const j3row = await getJob(j3);
    assert('retryable failure is requeued (SENT)', r3.body && r3.body.requeued === true && j3row.status === 'SENT');
    assert('retry sets a future next_attempt_at', new Date(j3row.next_attempt_at).getTime() > Date.now());
    assert('retry clears the lock and worker', j3row.lock_expires_at === null && j3row.worker_id === null);
    assert('retry releases the worker record', (await getWorker(workerA.id)).current_job_id === null);

    // ---------- 4. Non-retryable → NEEDS_USER_ACTION ----------
    const j4 = await seedJob(wsA.id, groupId);
    await claim(workerA);
    const r4 = await report(workerA, j4, { status: 'FAILED', error_code: 'FACEBOOK_LOGGED_OUT' });
    const j4row = await getJob(j4);
    assert('user-action error is terminal NEEDS_USER_ACTION', r4.body && r4.body.final === 'NEEDS_USER_ACTION' && j4row.status === 'NEEDS_USER_ACTION');
    assert('NEEDS_USER_ACTION clears lock and worker', j4row.lock_expires_at === null && j4row.worker_id === null);

    // ---------- 5. Max attempts reached → terminal FAILED ----------
    const j5 = await seedJob(wsA.id, groupId, { attempt_count: 3, max_attempts: 3 });
    await claim(workerA);
    const r5 = await report(workerA, j5, { status: 'FAILED', error_code: 'NETWORK_TIMEOUT' });
    const j5row = await getJob(j5);
    assert('retryable past max_attempts fails terminally', r5.body && r5.body.final === 'FAILED' && j5row.status === 'FAILED');

    // ---------- 6. Auth must not be weakened ----------
    const j6 = await seedJob(wsA.id, groupId);
    await claim(workerA);
    const noAuth = await report(workerA, j6, { status: 'SUCCESS' }, { 'Content-Type': 'application/json', Connection: 'close' });
    assert('status route rejects unauthenticated calls (401)', noAuth.status === 401);
    const badToken = await report(workerA, j6, { status: 'SUCCESS' },
        { 'x-worker-id': workerA.id, 'x-device-token': 'not-the-token', 'Content-Type': 'application/json', Connection: 'close' });
    assert('status route rejects a wrong device token (401)', badToken.status === 401);
    assert('rejected reports leave the job untouched', (await getJob(j6)).status === 'PROCESSING');

    // ---------- 7. Cross-workspace report is refused ----------
    const cross = await report(workerB, j6, { status: 'SUCCESS' });
    assert('worker cannot report a job from another workspace', cross.status === 403);
    assert('cross-workspace attempt leaves the job untouched', (await getJob(j6)).status === 'PROCESSING');

    // ---------- 8. Pending moderator approval is NOT success ----------
    // Live finding (job 2435, 2026-08-31): a post accepted straight into a group's
    // approval queue was recorded as SUCCESS, because the composer dialog closes
    // identically in both cases. The extension now reports CANCELLED with the
    // 'ממתין לאישור מנהל' marker that requires_moderation, the analytics
    // moderationRate and the 48h resume sweep all already key off.
    const MOD_REASON = 'ממתין לאישור מנהל – הפוסט נשלח וממתין לאישור';
    const j7 = await seedJob(wsA.id, groupId);
    await claim(workerA);
    const r7 = await report(workerA, j7, { status: 'CANCELLED', failure_reason: MOD_REASON });
    const j7row = await getJob(j7);
    assert('moderation report is accepted', r7.status === 200);
    assert('moderation state is NOT SUCCESS', j7row.status !== 'SUCCESS');
    assert('moderation state is CANCELLED', j7row.status === 'CANCELLED');
    assert('moderation keeps the marker requires_moderation keys off', (j7row.failure_reason || '').includes('ממתין לאישור מנהל'));
    assert('moderation does NOT requeue', j7row.status !== 'SENT' && j7row.next_attempt_at === null);
    assert('moderation sets ended_at (the 48h resume sweep needs it)', !!j7row.ended_at);
    assert('moderation clears the lock', j7row.lock_expires_at === null);
    assert('moderation releases worker_id', j7row.worker_id === null);
    assert('moderation records no external_post_url', j7row.external_post_url === null);
    assert('moderation releases the worker record', (await getWorker(workerA.id)).current_job_id === null);
    assert('moderation returns the worker to online', (await getWorker(workerA.id)).status === 'online');

    // G: a moderation-CANCELLED job must not come back as an ordinary due job.
    await admin.from('posts').update({ scheduled_time: past() }).eq('id', j7);
    const modReclaim = await claim(workerA);
    assert('moderation job cannot be reclaimed as a due job', !modReclaim.job || String(modReclaim.job.id) !== String(j7));

    // ---------- 9. Unverifiable outcome is terminal, never retried ----------
    // The composer closed but neither a published post nor a pending banner could
    // be found. Retrying could publish the same content twice, so this is terminal.
    const j8 = await seedJob(wsA.id, groupId);
    await claim(workerA);
    const r8 = await report(workerA, j8, {
        status: 'FAILED', error_code: 'PUBLISH_UNVERIFIED', failure_reason: 'unverified',
    });
    const j8row = await getJob(j8);
    assert('unverified outcome is NOT SUCCESS', j8row.status !== 'SUCCESS');
    assert('unverified outcome is terminal NEEDS_USER_ACTION', r8.body && r8.body.final === 'NEEDS_USER_ACTION' && j8row.status === 'NEEDS_USER_ACTION');
    assert('unverified outcome is NOT requeued', j8row.status !== 'SENT');
    assert('unverified outcome keeps its error code', j8row.error_code === 'PUBLISH_UNVERIFIED');
    assert('unverified outcome clears lock and worker', j8row.lock_expires_at === null && j8row.worker_id === null);

    await admin.from('posts').update({ scheduled_time: past() }).eq('id', j8);
    const unvReclaim = await claim(workerA);
    assert('unverified job cannot be reclaimed', !unvReclaim.job || String(unvReclaim.job.id) !== String(j8));

    // Cleanup.
    await admin.from('posts').delete().in('workspace_id', [wsA.id, wsB.id]);
    await admin.from('groups').delete().eq('workspace_id', wsA.id);
    await admin.from('browser_workers').delete().in('workspace_id', [wsA.id, wsB.id]);
    await admin.from('workspaces').delete().in('id', [wsA.id, wsB.id]);

    console.log(`\n${passed} passed, ${failed} failed`);
    process.exitCode = failed ? 1 : 0;
})().catch(err => {
    console.error('Test run error:', err.message);
    process.exitCode = 2;
});
