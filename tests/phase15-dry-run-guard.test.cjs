/**
 * Phase 15 - Dry-run hard guard.
 *
 * INCIDENT (P0): during a dry run the extension continued past "publish button
 * detected" and clicked it. A real Facebook post was created that no operator
 * asked for. There was no in-extension barrier at all — dry-run was only ever a
 * convention about when the operator or the agent would intervene.
 *
 * The guard now lives inside the extension. This file proves three things:
 *
 *   A. the decision function is correct in every branch, including fail-safe;
 *   B. no code path in content.js can reach a Facebook submission without
 *      passing that decision (a SOURCE INVARIANT — it is what catches a future
 *      change that adds a new publish path);
 *   C. a blocked dry run terminates the job safely on the backend, over the
 *      real HTTP worker route.
 *
 * Env: SUPABASE_URL, SUPABASE_SERVICE_KEY, API_URL. Requires the backend running.
 */
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const { generateDeviceToken, hashToken } = require('../server/middleware/worker.cjs');

require('../safe_post_extension/fbUtils.js');
const fb = globalThis.SafePostFB;

const { SUPABASE_URL, SUPABASE_SERVICE_KEY, API_URL = 'http://localhost:3001' } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_KEY.');
    process.exit(2);
}
if ((SUPABASE_URL || '').includes('hfpsdzfggugoerythnug')) {
    console.error('REFUSING: SUPABASE_URL points at the PRODUCTION project.');
    process.exit(3);
}

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });

let passed = 0, failed = 0;
const assert = (name, cond) => { cond ? (passed++, console.log(`  OK ${name}`)) : (failed++, console.log(`  FAIL ${name}`)); };
const past = (ms = 60000) => new Date(Date.now() - ms).toISOString();
const getJob = async id => (await admin.from('posts').select('*').eq('id', id).single()).data;
const getWorker = async id => (await admin.from('browser_workers').select('*').eq('id', id).single()).data;

const CONTENT_JS = fs.readFileSync(path.join(__dirname, '../safe_post_extension/content.js'), 'utf8');

(async () => {
    console.log('Phase 15 dry-run hard guard\n');

    // ---------- A. decision function ----------
    console.log(' A. dry-run decision');
    assert('explicit true blocks', fb.resolveDryRun({ dryRunMode: true, apiUrl: 'https://safepost-backup.onrender.com' }) === true);
    assert('explicit false allows (production keeps working)', fb.resolveDryRun({ dryRunMode: false, apiUrl: 'http://localhost:3001' }) === false);
    assert('unset + local backend defaults to BLOCKED (QA/dev)', fb.resolveDryRun({ apiUrl: 'http://localhost:3001' }) === true);
    assert('unset + 127.0.0.1 defaults to BLOCKED', fb.resolveDryRun({ apiUrl: 'http://127.0.0.1:3001' }) === true);
    assert('unset + remote backend allows (production default unchanged)', fb.resolveDryRun({ apiUrl: 'https://safepost-backup.onrender.com' }) === false);
    assert('unset apiUrl uses the production default => allows', fb.resolveDryRun({}) === false);
    assert('unreadable settings fail SAFE (blocked)', fb.resolveDryRun(null) === true && fb.resolveDryRun(undefined) === true);
    assert('non-boolean dryRunMode does not enable publishing by accident',
        fb.resolveDryRun({ dryRunMode: 'false', apiUrl: 'http://localhost:3001' }) === true);
    assert('sentinel is a distinct non-boolean value', fb.DRY_RUN_BLOCKED === 'DRY_RUN_BLOCKED');

    // ---------- B. source invariants ----------
    console.log('\n B. no unguarded submission path in content.js');
    assert('a dry-run check helper exists', /async function isDryRunEnabled\s*\(/.test(CONTENT_JS));
    assert('helper fails safe on error (returns true in catch)',
        /catch[\s\S]{0,220}?return true;[\s\S]{0,40}?\}\s*\n\s*\/\/ --- Human-Like Click/.test(CONTENT_JS)
        || /dry-run setting unreadable[\s\S]{0,120}?return true;/.test(CONTENT_JS));

    const clickPostBody = CONTENT_JS.slice(CONTENT_JS.indexOf('async function clickPostButton'));
    assert('clickPostButton guards before searching for a button',
        /async function clickPostButton[\s\S]{0,600}?await isDryRunEnabled\(\)[\s\S]{0,300}?return DRY_RUN_BLOCKED;/.test(clickPostBody));

    const humanBody = CONTENT_JS.slice(CONTENT_JS.indexOf('async function humanClick'), CONTENT_JS.indexOf('async function clickPostButton'));
    assert('humanClick itself refuses in dry run', /await isDryRunEnabled\(\)/.test(humanBody));
    assert('humanClick returns false when blocked, true when it clicked',
        /return false;/.test(humanBody) && /return true;/.test(humanBody));
    assert('humanClick guard sits BEFORE any event dispatch',
        humanBody.indexOf('isDryRunEnabled') < humanBody.indexOf('dispatchEvent'));

    // Every humanClick call site must consume the return value.
    const callSites = [...CONTENT_JS.matchAll(/^.*await humanClick\(.*$/gm)].map(m => m[0]);
    assert('humanClick is called at least twice (both publish strategies)', callSites.length >= 2);
    assert('every humanClick call site captures its result',
        callSites.every(l => /=\s*await humanClick\(/.test(l)));
    assert('every publish strategy converts a blocked click into the sentinel',
        (CONTENT_JS.match(/dispatched \? true : DRY_RUN_BLOCKED/g) || []).length >= 2);

    // The sentinel is a truthy string: it must be handled before `if (clicked)`.
    const sentinelIdx = CONTENT_JS.indexOf("clicked === DRY_RUN_BLOCKED");
    const truthyIdx = CONTENT_JS.indexOf('if (clicked) {');
    assert('sentinel is handled before the truthy `if (clicked)` branch',
        sentinelIdx > 0 && truthyIdx > 0 && sentinelIdx < truthyIdx);

    // No submission mechanism may exist outside the guarded helper.
    assert('no Enter-key or form submission path exists',
        !/key:\s*'Enter'|keyCode:\s*13|\.submit\(\)|requestSubmit\(/.test(CONTENT_JS));
    const ALLOWED_CLICKS = ['trigger.click()', 'mediaTrigger.click()', 'el.click()', 'b.click()'];
    const clicks = [...CONTENT_JS.matchAll(/^[^\n]*\.click\(\)[^\n]*$/gm)]
        .map(m => m[0].trim())
        .filter(l => !l.startsWith('//'))
        .filter(l => !ALLOWED_CLICKS.some(a => l.includes(a)));
    assert('no .click() outside the guarded helper / composer / media controls',
        clicks.length === 0 || console.log('     unexpected:', clicks));

    // ---------- C. backend terminal state ----------
    console.log('\n C. backend result for a blocked dry run');
    const { data: ws } = await admin.from('workspaces').insert({ name: 'Phase15 WS', is_personal: false }).select('id').single();
    const groupId = `phase15-grp-${Date.now()}`;
    await admin.from('groups').insert({
        id: groupId, name: 'Phase15 Group', url: 'https://facebook.com/groups/phase15',
        workspace_id: ws.id, facebook_user: '',
    });
    const token = generateDeviceToken();
    const { data: worker } = await admin.from('browser_workers').insert({
        workspace_id: ws.id, worker_name: 'phase15', device_token_hash: hashToken(token), status: 'online',
    }).select('id').single();
    const headers = { 'x-worker-id': worker.id, 'x-device-token': token, 'Content-Type': 'application/json', Connection: 'close' };

    const { data: job } = await admin.from('posts').insert({
        content: 'phase15 dry run job', app_source: 'backup', workspace_id: ws.id, group_id: groupId,
        status: 'SENT', scheduled_time: past(),
    }).select('id').single();

    await fetch(`${API_URL}/api/workers/${worker.id}/jobs/claim`, { method: 'POST', headers });
    const res = await fetch(`${API_URL}/api/workers/${worker.id}/jobs/${job.id}/status`, {
        method: 'POST', headers,
        body: JSON.stringify({
            status: 'CANCELLED', error_code: 'DRY_RUN_BLOCKED',
            failure_reason: 'DRY RUN — blocked in the extension',
        }),
    });
    const body = await res.json().catch(() => null);
    const row = await getJob(job.id);

    assert('dry-run report accepted', res.status === 200);
    assert('dry run is NEVER reported as SUCCESS', row.status !== 'SUCCESS');
    assert('dry run terminates the job as CANCELLED', row.status === 'CANCELLED' && body.final === 'CANCELLED');
    assert('dry run keeps its DRY_RUN_BLOCKED code', row.error_code === 'DRY_RUN_BLOCKED');
    assert('dry run sets ended_at', !!row.ended_at);
    assert('dry run clears the lock', row.lock_expires_at === null);
    assert('dry run releases worker_id', row.worker_id === null);
    assert('dry run records no external_post_url', row.external_post_url === null);
    assert('dry run does not requeue', row.next_attempt_at === null && row.status !== 'SENT');

    const w = await getWorker(worker.id);
    assert('worker current_job_id cleared', w.current_job_id === null);
    assert('worker returned online', w.status === 'online');

    await admin.from('posts').update({ scheduled_time: past() }).eq('id', job.id);
    const reclaim = await fetch(`${API_URL}/api/workers/${worker.id}/jobs/claim`, { method: 'POST', headers });
    const reclaimed = (await reclaim.json().catch(() => null) || {}).job;
    assert('dry-run job cannot be reclaimed', !reclaimed || String(reclaimed.id) !== String(job.id));

    // The moderation resume sweep must never pick this up either.
    assert('dry-run job is excluded from the moderation resume sweep',
        row.error_code !== 'MODERATION_BLOCKED_NOT_SENT' &&
        !String(row.failure_reason || '').includes('ממתין לאישור מנהל'));

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
