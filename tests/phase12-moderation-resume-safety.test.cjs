/**
 * Phase 12 - Moderation resume safety.
 *
 * WHY THIS EXISTS
 * ---------------
 * The 48h moderation resume sweep (server/index.cjs, heartbeat tick) was written
 * when the ONLY way a post reached moderation-CANCELLED was the content script's
 * PRE-FLIGHT check — and there nothing had been submitted, so re-queueing was
 * harmless. content.js now also reports CANCELLED with the same
 * 'ממתין לאישור מנהל' marker for a post that WAS submitted and is waiting in the
 * group's approval queue. Resuming that one republishes content a moderator may
 * already have approved: a duplicate Facebook post.
 *
 * The sweep now resumes only what is provably un-submitted
 * (error_code = MODERATION_BLOCKED_NOT_SENT). Everything else — including legacy
 * rows with no code — stays CANCELLED for a human.
 *
 * This test drives the REAL sweep: it seeds rows and waits for the backend's
 * 60s heartbeat tick rather than calling anything directly.
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
const sleep = ms => new Promise(r => setTimeout(r, ms));

const MOD_REASON = 'ממתין לאישור מנהל – בדיקת phase12';
const THREE_DAYS_AGO = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
const getJob = async id => (await admin.from('posts').select('*').eq('id', id).single()).data;

async function seedModerationJob(wsId, groupId, { errorCode, attempts = 0 }) {
    const { data, error } = await admin.from('posts').insert({
        content: 'phase12 moderation job', app_source: 'backup', workspace_id: wsId, group_id: groupId,
        status: 'CANCELLED', scheduled_time: THREE_DAYS_AGO, ended_at: THREE_DAYS_AGO,
        failure_reason: MOD_REASON, error_code: errorCode, attempt_count: attempts,
    }).select('id').single();
    if (error) throw new Error('seedModerationJob: ' + error.message);
    return data.id;
}

(async () => {
    console.log('Phase 12 moderation resume safety\n');

    const { data: ws } = await admin.from('workspaces').insert({ name: 'Phase12 WS', is_personal: false }).select('id').single();
    const groupId = `phase12-grp-${Date.now()}`;
    await admin.from('groups').insert({
        id: groupId, name: 'Phase12 Group', url: 'https://facebook.com/groups/phase12',
        workspace_id: ws.id, facebook_user: '',
    });

    // A: never submitted → the one case that is safe to resume.
    const jNotSent = await seedModerationJob(ws.id, groupId, { errorCode: 'MODERATION_BLOCKED_NOT_SENT' });
    // B: submitted and awaiting a moderator → resuming would duplicate the post.
    const jSubmitted = await seedModerationJob(ws.id, groupId, { errorCode: 'MODERATION_PENDING_SUBMITTED' });
    // C: legacy row with no marker → unknown, must default to safe.
    const jLegacy = await seedModerationJob(ws.id, groupId, { errorCode: null });
    // D: safe to resume in principle, but already at the attempt cap.
    const jCapped = await seedModerationJob(ws.id, groupId, { errorCode: 'MODERATION_BLOCKED_NOT_SENT', attempts: 2 });

    console.log('  waiting for the backend heartbeat sweep (runs every 60s)...');
    let resumed = false;
    for (let i = 0; i < 20; i++) {
        await sleep(5000);
        if ((await getJob(jNotSent)).status !== 'CANCELLED') { resumed = true; break; }
    }

    const a = await getJob(jNotSent);
    const b = await getJob(jSubmitted);
    const c = await getJob(jLegacy);
    const d = await getJob(jCapped);

    // 1. The provably-unsent job still resumes — the safe half of the feature lives.
    assert('un-submitted moderation job is resumed by the sweep', resumed && a.status !== 'CANCELLED');
    assert('resumed job is queued again (PENDING or already dispatched to SENT)', ['PENDING', 'SENT', 'PROCESSING'].includes(a.status));
    assert('resumed job increments attempt_count', (a.attempt_count || 0) === 1);
    assert('resumed job clears the moderation marker', a.error_code === null && a.failure_reason === null);

    // 2. THE POINT OF THIS FILE: a submitted-and-pending post is never republished.
    assert('SUBMITTED-and-pending job is NOT resumed', b.status === 'CANCELLED');
    assert('SUBMITTED-and-pending job keeps its marker', b.error_code === 'MODERATION_PENDING_SUBMITTED');
    assert('SUBMITTED-and-pending job attempt_count untouched', (b.attempt_count || 0) === 0);

    // 3. Unknown provenance defaults to safe rather than to a guess.
    assert('legacy unmarked moderation job is NOT resumed', c.status === 'CANCELLED');
    assert('legacy unmarked job attempt_count untouched', (c.attempt_count || 0) === 0);

    // 4. The existing attempt cap still holds.
    assert('capped job is NOT resumed', d.status === 'CANCELLED' && (d.attempt_count || 0) === 2);

    // 5. No sweep run may duplicate a row.
    const { data: all } = await admin.from('posts').select('id').eq('workspace_id', ws.id);
    assert('sweep created no duplicate jobs', (all || []).length === 4);

    // 6. Genuine technical failures must still retry — over the real HTTP route,
    //    so this cannot pass while the extension's actual path is broken.
    const token = generateDeviceToken();
    const { data: worker } = await admin.from('browser_workers').insert({
        workspace_id: ws.id, worker_name: 'phase12', device_token_hash: hashToken(token), status: 'online',
    }).select('id').single();
    const headers = { 'x-worker-id': worker.id, 'x-device-token': token, 'Content-Type': 'application/json', Connection: 'close' };

    const { data: tech } = await admin.from('posts').insert({
        content: 'phase12 technical failure', app_source: 'backup', workspace_id: ws.id, group_id: groupId,
        status: 'SENT', scheduled_time: new Date(Date.now() - 60000).toISOString(),
    }).select('id').single();
    await fetch(`${API_URL}/api/workers/${worker.id}/jobs/claim`, { method: 'POST', headers });
    const res = await fetch(`${API_URL}/api/workers/${worker.id}/jobs/${tech.id}/status`, {
        method: 'POST', headers,
        body: JSON.stringify({ status: 'FAILED', error_code: 'NETWORK_TIMEOUT', failure_reason: 'timeout' }),
    });
    const techBody = await res.json().catch(() => null);
    const techRow = await getJob(tech.id);
    assert('normal technical failure still retries (requeued)', techBody && techBody.requeued === true && techRow.status === 'SENT');
    assert('technical retry still clears lock and worker', techRow.lock_expires_at === null && techRow.worker_id === null);
    assert('technical retry releases the worker record',
        ((await admin.from('browser_workers').select('current_job_id').eq('id', worker.id).single()).data || {}).current_job_id === null);

    // Cleanup.
    await admin.from('posts').delete().eq('workspace_id', ws.id);
    await admin.from('groups').delete().eq('workspace_id', ws.id);
    await admin.from('browser_workers').delete().eq('workspace_id', ws.id);
    await admin.from('workspaces').delete().eq('id', ws.id);

    console.log(`\n${passed} passed, ${failed} failed`);
    process.exitCode = failed ? 1 : 0;
})().catch(err => {
    console.error('Test run error:', err.message);
    process.exitCode = 2;
});
