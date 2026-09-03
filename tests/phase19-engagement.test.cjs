/**
 * Phase 19 — Engagement / Opportunities, backend + database (Phase 1A).
 *
 * Two real tenants, each with its own workspace, its own paired worker and its
 * own synced group. Everything a multi-tenant feature can get wrong is asserted
 * against live HTTP rather than reasoned about: flag gating, workspace scoping,
 * worker identity, batch caps, server-side truncation and dedup idempotency.
 *
 * The fleet kill switch is exercised against an in-process Express app mounting
 * the real router, because server/index.cjs hardcodes PORT 3001 and the flag is
 * read from the server process's own environment — which a test running in a
 * different process cannot change.
 */
const http = require('http');
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
// Called directly for the one rule HTTP cannot reach: a second worker inside the
// SAME workspace. Forging a device token for it would prove nothing extra.
const { reportScanStatus } = require('../server/lib/engagementQueue.cjs');

const { SUPABASE_URL, SUPABASE_SERVICE_KEY, SUPABASE_ANON_KEY, API_URL = 'http://localhost:3001' } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !SUPABASE_ANON_KEY) {
    console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_KEY / SUPABASE_ANON_KEY.');
    process.exit(2);
}
// Same guard every phase test carries: this suite creates and deletes users,
// workspaces and scans. It must never touch the production project.
if ((SUPABASE_URL || '').includes('hfpsdzfggugoerythnug')) {
    console.error('REFUSING: SUPABASE_URL points at the production project.');
    process.exit(3);
}

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });

let passed = 0;
let failed = 0;
const assert = (name, condition, detail = '') => {
    if (condition) { passed++; console.log(`  OK ${name}`); }
    else { failed++; console.log(`  FAIL ${name}${detail ? '  — ' + detail : ''}`); }
};

// Anything that would betray the database or another tenant if it reached a client.
const LEAK = /invalid input syntax|constraint|relation |column |PGRST|postgres|22P02|23505/i;
const leaks = body => LEAK.test(JSON.stringify(body || {}));

const tag = `p19_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
const LONG_TEXT = 'ל'.repeat(2600);   // deliberately non-ASCII: length is counted in characters

// --------------------------------------------------------------------------
// fixtures
// --------------------------------------------------------------------------
async function makeTenant(label) {
    const email = `${tag}_${label}@example.com`;
    const password = `Passw0rd!${label}aA1`;
    const { data: created, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (error) throw new Error(`createUser ${label}: ${error.message}`);

    const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } });
    const { data: session, error: signInError } = await anon.auth.signInWithPassword({ email, password });
    if (signInError) throw new Error(`signIn ${label}: ${signInError.message}`);
    const token = session.session.access_token;

    // First authenticated dashboard call provisions the workspace.
    const provision = await fetch(`${API_URL}/api/queue`, { headers: { Authorization: `Bearer ${token}`, Connection: 'close' } });
    if (!provision.ok) throw new Error(`provision ${label}: HTTP ${provision.status}`);
    const { data: members } = await admin.from('workspace_members').select('workspace_id').eq('user_id', created.user.id).limit(1);
    const workspaceId = members[0].workspace_id;

    // Pair a worker through the normal pairing flow.
    const codeRes = await fetch(`${API_URL}/api/workers/pairing-code`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'x-workspace-id': workspaceId, 'Content-Type': 'application/json', Connection: 'close' },
    });
    const { code } = await codeRes.json();
    const pairRes = await fetch(`${API_URL}/api/workers/pair`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Connection: 'close' },
        body: JSON.stringify({ code, worker_name: `${label} worker`, extension_version: '9.1' }),
    });
    const pair = await pairRes.json();

    // One synced group — Phase 1 only accepts groups already in the workspace.
    const groupId = `${tag}_${label}_group`;
    const { error: groupError } = await admin.from('groups').insert({
        id: groupId, name: `${label} test group`,
        url: `https://www.facebook.com/groups/${groupId}`,
        workspace_id: workspaceId, facebook_user: '',
    });
    if (groupError) throw new Error(`seed group ${label}: ${groupError.message}`);

    // Turn the per-workspace flag on. It defaults to false, which is the point.
    await admin.from('workspaces').update({ engagement_enabled: true }).eq('id', workspaceId);

    return {
        label, userId: created.user.id, token, workspaceId, groupId,
        workerId: pair.worker_id, deviceToken: pair.device_token,
    };
}

// dashboard request
const dash = async (t, method, path, body, base = API_URL) => {
    const res = await fetch(`${base}/api/engagement${path}`, {
        method,
        headers: {
            Authorization: `Bearer ${t.token}`, 'x-workspace-id': t.workspaceId,
            'Content-Type': 'application/json', Connection: 'close',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: await res.json().catch(() => null) };
};

// worker request — identity comes from the device token, never a header
const work = async (t, method, path, body, base = API_URL) => {
    const res = await fetch(`${base}/api/engagement${path}`, {
        method,
        headers: {
            'x-worker-id': t.workerId, 'x-device-token': t.deviceToken,
            'Content-Type': 'application/json', Connection: 'close',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: await res.json().catch(() => null) };
};

const newScan = (t, overrides = {}) => dash(t, 'POST', '/scans', {
    name: `${tag} scan`, group_ids: [t.groupId], max_groups: 1, max_posts_per_group: 5, ...overrides,
});

(async () => {
    console.log('Phase 19 engagement backend\n');

    const A = await makeTenant('a');
    const B = await makeTenant('b');
    let flagServer = null;

    try {
        // ------------------------------------------------------------------
        console.log(' A. fleet kill switch (ENGAGEMENT_ENABLED)');
        // The real router, mounted in-process, so this test controls the env the
        // flag is read from. Nothing is stubbed: the same middleware runs.
        const app = express();
        app.use(express.json());
        app.use('/api/engagement', require('../server/routes/engagement.cjs'));
        flagServer = http.createServer(app);
        await new Promise(resolve => flagServer.listen(0, '127.0.0.1', resolve));
        const flagBase = `http://127.0.0.1:${flagServer.address().port}`;

        const savedFlag = process.env.ENGAGEMENT_ENABLED;
        delete process.env.ENGAGEMENT_ENABLED;
        const offList = await dash(A, 'GET', '/scans', undefined, flagBase);
        const offClaim = await work(A, 'POST', '/scans/claim', {}, flagBase);
        assert('absent env flag hides the dashboard route (404)', offList.status === 404, `HTTP ${offList.status}`);
        assert('absent env flag stops the worker claiming (404)', offClaim.status === 404, `HTTP ${offClaim.status}`);
        assert('the 404 body reveals nothing about the feature',
            JSON.stringify(offList.body) === JSON.stringify({ error: 'Not found' }), JSON.stringify(offList.body));

        for (const bad of ['1', 'yes', 'TRUE ', 'on', '']) {
            process.env.ENGAGEMENT_ENABLED = bad;
            const r = await dash(A, 'GET', '/scans', undefined, flagBase);
            assert(`"${bad}" does not enable the feature`, r.status === 404, `HTTP ${r.status}`);
        }
        process.env.ENGAGEMENT_ENABLED = 'true';
        const onList = await dash(A, 'GET', '/scans', undefined, flagBase);
        assert('the literal "true" enables it', onList.status === 200, `HTTP ${onList.status}`);
        if (savedFlag === undefined) delete process.env.ENGAGEMENT_ENABLED; else process.env.ENGAGEMENT_ENABLED = savedFlag;

        // ------------------------------------------------------------------
        console.log('\n B. per-workspace flag');
        await admin.from('workspaces').update({ engagement_enabled: false }).eq('id', B.workspaceId);
        const bOff = await dash(B, 'GET', '/scans');
        const bOffClaim = await work(B, 'POST', '/scans/claim', {});
        assert('workspace flag off hides the dashboard route', bOff.status === 404, `HTTP ${bOff.status}`);
        assert('workspace flag off stops that workspace claiming', bOffClaim.status === 404, `HTTP ${bOffClaim.status}`);
        const aStillOn = await dash(A, 'GET', '/scans');
        assert('one workspace being off does not affect another', aStillOn.status === 200, `HTTP ${aStillOn.status}`);
        await admin.from('workspaces').update({ engagement_enabled: true }).eq('id', B.workspaceId);

        // ------------------------------------------------------------------
        console.log('\n C. scan creation and caps');
        const created = await newScan(A, { search_instructions: 'plumbers in Tel Aviv' });
        assert('a valid scan is created', created.status === 201 && created.body?.scan?.id, `HTTP ${created.status}`);
        const scanA = created.body.scan;
        assert('it starts QUEUED', scanA.status === 'QUEUED', scanA.status);
        assert('target_groups is resolved server-side from the group id',
            Array.isArray(scanA.target_groups) && scanA.target_groups[0]?.url?.includes(A.groupId),
            JSON.stringify(scanA.target_groups));
        assert('search_instructions is stored', scanA.search_instructions === 'plumbers in Tel Aviv');
        assert('counters start at zero', scanA.posts_discovered === 0 && scanA.groups_scanned === 0);

        const caps = await Promise.all([
            newScan(A, { max_groups: 6 }),
            newScan(A, { max_groups: 0 }),
            newScan(A, { max_posts_per_group: 26 }),
            newScan(A, { max_posts_per_group: 0 }),
            newScan(A, { max_groups: 1.5 }),
            newScan(A, { name: '' }),
            newScan(A, { name: 'x'.repeat(200) }),
            newScan(A, { group_ids: [] }),
            newScan(A, { group_ids: 'not-an-array' }),
        ]);
        assert('every out-of-range or malformed create is refused with 400',
            caps.every(r => r.status === 400), caps.map(r => r.status).join(','));
        assert('no create rejection leaks database detail', caps.every(r => !leaks(r.body)));

        const foreign = await newScan(A, { group_ids: [B.groupId] });
        assert('a group from another workspace cannot be scanned', foreign.status === 400, `HTTP ${foreign.status}`);
        assert('the rejection does not confirm the other group exists',
            !JSON.stringify(foreign.body).includes(B.groupId), JSON.stringify(foreign.body));
        const ghost = await newScan(A, { group_ids: ['no_such_group_at_all'] });
        assert('an unknown group id is refused', ghost.status === 400);

        const tooMany = await newScan(A, { group_ids: [A.groupId, `${A.groupId}_2`], max_groups: 1 });
        assert('more group ids than max_groups is refused', tooMany.status === 400, `HTTP ${tooMany.status}`);

        // ------------------------------------------------------------------
        console.log('\n D. read, list and cancel');
        const fetched = await dash(A, 'GET', `/scans/${scanA.id}`);
        assert('a scan can be fetched by id', fetched.status === 200 && fetched.body?.scan?.id === scanA.id);
        const listed = await dash(A, 'GET', '/scans');
        assert('the scan appears in the list', listed.body?.scans?.some(s => s.id === scanA.id));

        const cancellable = (await newScan(A)).body.scan;
        const cancelled = await dash(A, 'POST', `/scans/${cancellable.id}/cancel`);
        assert('a queued scan can be cancelled', cancelled.status === 200 && cancelled.body?.status === 'CANCELLED');
        const cancelAgain = await dash(A, 'POST', `/scans/${cancellable.id}/cancel`);
        assert('cancelling twice is a no-op, not an error',
            cancelAgain.status === 200 && cancelAgain.body?.already_final === true, `HTTP ${cancelAgain.status}`);

        // ------------------------------------------------------------------
        console.log('\n E. malformed identifiers');
        const badIds = ['not-a-uuid', '7', '1)or(', 'not.is.null', '*', '00000000-0000-0000-0000-00000000000'];
        for (const bad of badIds) {
            const e = encodeURIComponent(bad);
            const results = await Promise.all([
                dash(A, 'GET', `/scans/${e}`),
                dash(A, 'POST', `/scans/${e}/cancel`),
                work(A, 'POST', `/scans/${e}/posts`, { posts: [{ facebook_group_id: A.groupId }] }),
                work(A, 'POST', `/scans/${e}/status`, { status: 'COMPLETED' }),
                dash(A, 'GET', `/discovered?scan_task_id=${e}`),
            ]);
            assert(`"${bad}" is rejected with 400 everywhere`,
                results.every(r => r.status === 400), results.map(r => r.status).join(','));
            assert(`"${bad}" never leaks database detail`, results.every(r => !leaks(r.body)));
        }
        const wellFormedForeign = await dash(A, 'GET', '/scans/99999999-9999-4999-8999-999999999999');
        assert('a well-formed but unknown id is 404, not 400', wellFormedForeign.status === 404, `HTTP ${wellFormedForeign.status}`);

        // ------------------------------------------------------------------
        console.log('\n F. worker claim');
        const bClaimEmpty = await work(B, 'POST', '/scans/claim', {});
        assert("B's worker finds nothing while only A has a queued scan",
            bClaimEmpty.status === 200 && bClaimEmpty.body?.scan === null, JSON.stringify(bClaimEmpty.body));

        const claimed = await work(A, 'POST', '/scans/claim', {});
        assert("A's worker claims A's scan", claimed.status === 200 && claimed.body?.scan?.id === scanA.id);
        assert('the claim flips it to RUNNING', claimed.body?.scan?.status === 'RUNNING');
        assert('the claim records the worker and a lease',
            claimed.body?.scan?.worker_id === A.workerId && Boolean(claimed.body?.scan?.lock_expires_at));
        assert('the claim increments attempt_count', claimed.body?.scan?.attempt_count === 1);

        const reclaim = await work(A, 'POST', '/scans/claim', {});
        assert('a running scan is not handed out again',
            reclaim.body?.scan === null || reclaim.body?.scan?.id !== scanA.id, JSON.stringify(reclaim.body?.scan?.id));

        console.log('\n G. concurrent claims');
        const raceScan = (await newScan(A)).body.scan;
        const [r1, r2, r3] = await Promise.all([
            work(A, 'POST', '/scans/claim', {}),
            work(A, 'POST', '/scans/claim', {}),
            work(A, 'POST', '/scans/claim', {}),
        ]);
        const winners = [r1, r2, r3].filter(r => r.body?.scan?.id === raceScan.id);
        assert('three simultaneous claims hand the scan to exactly one worker',
            winners.length === 1, `${winners.length} winners`);
        await admin.from('engagement_scan_tasks').update({ status: 'CANCELLED' }).eq('id', raceScan.id);

        // ------------------------------------------------------------------
        console.log('\n H. post ingestion');
        const batch = [
            {
                facebook_group_id: A.groupId, facebook_group_name: 'A test group',
                facebook_post_url: 'https://www.facebook.com/groups/1/posts/1001?__cft__=noise&ref=x',
                author_name: 'Yossi Cohen', post_text: 'Looking for a plumber', posted_at: '2026-09-03T10:00:00Z',
            },
            {
                facebook_group_id: A.groupId, facebook_post_id: '1002',
                post_text: LONG_TEXT, author_name: 'Dana', posted_at_raw: 'לפני שעתיים',
            },
        ];
        const ingest = await work(A, 'POST', `/scans/${scanA.id}/posts`, { posts: batch });
        assert('a batch is accepted', ingest.status === 200, `HTTP ${ingest.status} ${JSON.stringify(ingest.body)}`);
        assert('both rows are stored', ingest.body?.stored === 2, JSON.stringify(ingest.body));

        const { data: stored } = await admin.from('engagement_discovered_posts')
            .select('*').eq('scan_task_id', scanA.id).order('facebook_post_id', { nullsFirst: true });
        const truncatedRow = stored.find(r => r.facebook_post_id === '1002');
        assert('over-long text is truncated by the SERVER to 2000 characters',
            truncatedRow.post_text.length === 2000, `${truncatedRow.post_text.length}`);
        assert('is_truncated is set by the server, not the client', truncatedRow.is_truncated === true);
        const urlRow = stored.find(r => r.facebook_post_id !== '1002');
        assert('short text is not flagged truncated', urlRow.is_truncated === false);
        assert('the dedup key uses the id found in the URL, tracking params stripped',
            urlRow.dedup_key === 'fb:1001', urlRow.dedup_key);
        assert('the dedup strategy is recorded for diagnostics',
            urlRow.raw_metadata?.dedup_strategy === 'facebook_post_id', JSON.stringify(urlRow.raw_metadata));
        assert('a relative timestamp is kept raw and posted_at stays null',
            truncatedRow.posted_at === null && truncatedRow.posted_at_raw === 'לפני שעתיים');

        const replay = await work(A, 'POST', `/scans/${scanA.id}/posts`, { posts: batch });
        assert('re-sending the same batch stores nothing new',
            replay.status === 200 && replay.body?.stored === 0 && replay.body?.duplicates === 2,
            JSON.stringify(replay.body));
        const { count: afterReplay } = await admin.from('engagement_discovered_posts')
            .select('id', { count: 'exact', head: true }).eq('scan_task_id', scanA.id);
        assert('the table still holds exactly two rows', afterReplay === 2, `${afterReplay}`);

        const dupInBatch = await work(A, 'POST', `/scans/${scanA.id}/posts`, {
            posts: [
                { facebook_group_id: A.groupId, facebook_post_id: '2001', post_text: 'x' },
                { facebook_group_id: A.groupId, facebook_post_id: '2001', post_text: 'x again' },
            ],
        });
        assert('duplicates inside one batch collapse instead of failing the batch',
            dupInBatch.status === 200 && dupInBatch.body?.stored === 1, JSON.stringify(dupInBatch.body));

        const overCap = await work(A, 'POST', `/scans/${scanA.id}/posts`, {
            posts: Array.from({ length: 51 }, (_, i) => ({ facebook_group_id: A.groupId, facebook_post_id: `c${i}`, post_text: 't' })),
        });
        assert('a batch over 50 is refused', overCap.status === 400 && overCap.body?.max_batch === 50, `HTTP ${overCap.status}`);
        const emptyBatch = await work(A, 'POST', `/scans/${scanA.id}/posts`, { posts: [] });
        assert('an empty batch is refused', emptyBatch.status === 400);

        // ------------------------------------------------------------------
        console.log('\n I. cross-tenant and worker isolation');
        const bIntoA = await work(B, 'POST', `/scans/${scanA.id}/posts`, {
            posts: [{ facebook_group_id: B.groupId, facebook_post_id: 'evil', post_text: 'injected' }],
        });
        assert("B's worker cannot ingest into A's scan", bIntoA.status === 404, `HTTP ${bIntoA.status}`);
        const bStatusA = await work(B, 'POST', `/scans/${scanA.id}/status`, { status: 'COMPLETED' });
        assert("B's worker cannot close A's scan", bStatusA.status === 404, `HTTP ${bStatusA.status}`);
        const bReadA = await dash(B, 'GET', `/scans/${scanA.id}`);
        assert("B's dashboard cannot read A's scan", bReadA.status === 404, `HTTP ${bReadA.status}`);
        const bCancelA = await dash(B, 'POST', `/scans/${scanA.id}/cancel`);
        assert("B's dashboard cannot cancel A's scan", bCancelA.status === 404, `HTTP ${bCancelA.status}`);
        const bList = await dash(B, 'GET', '/scans');
        assert("B's list contains none of A's scans",
            (bList.body?.scans || []).every(s => s.workspace_id === B.workspaceId));

        // A header claiming another workspace must not override the verified token.
        const spoofed = await fetch(`${API_URL}/api/engagement/scans`, {
            headers: {
                Authorization: `Bearer ${B.token}`, 'x-workspace-id': A.workspaceId,
                'Content-Type': 'application/json', Connection: 'close',
            },
        });
        const spoofBody = await spoofed.json().catch(() => null);
        assert('a spoofed x-workspace-id header cannot reach another tenant',
            spoofed.status === 403 || (spoofBody?.scans || []).every(s => s.workspace_id !== A.workspaceId),
            `HTTP ${spoofed.status}`);

        const bDiscovered = await dash(B, 'GET', '/discovered');
        assert("B sees none of A's discovered posts",
            (bDiscovered.body?.posts || []).every(p => p.workspace_id === B.workspaceId));
        assert("A's post text never appears in B's response",
            !JSON.stringify(bDiscovered.body).includes('Looking for a plumber'));

        // The same post discovered by both tenants must produce a row for each.
        const bScan = (await newScan(B)).body.scan;
        await work(B, 'POST', '/scans/claim', {});
        const shared = { facebook_group_id: B.groupId, facebook_post_id: '1002', post_text: 'same public post' };
        const bShared = await work(B, 'POST', `/scans/${bScan.id}/posts`, { posts: [shared] });
        assert('dedup is per workspace — the same post is stored for both tenants',
            bShared.status === 200 && bShared.body?.stored === 1, JSON.stringify(bShared.body));

        // ------------------------------------------------------------------
        console.log('\n J. status reporting');
        const done = await work(A, 'POST', `/scans/${scanA.id}/status`, { status: 'COMPLETED', groups_scanned: 1 });
        assert('a worker can complete its own scan', done.status === 200 && done.body?.status === 'COMPLETED');
        const { data: finished } = await admin.from('engagement_scan_tasks').select('*').eq('id', scanA.id).single();
        assert('completing clears the lock and the worker',
            finished.lock_expires_at === null && finished.worker_id === null);
        assert('completed_at is set', Boolean(finished.completed_at));
        assert('groups_scanned is recorded', finished.groups_scanned === 1);
        assert('posts_discovered reflects the rows actually stored', finished.posts_discovered === 3, `${finished.posts_discovered}`);

        const repeat = await work(A, 'POST', `/scans/${scanA.id}/status`, { status: 'FAILED', error_code: 'NETWORK_TIMEOUT' });
        assert('a duplicate terminal report cannot reopen a finished scan', repeat.status === 200);
        const { data: stillDone } = await admin.from('engagement_scan_tasks').select('status').eq('id', scanA.id).single();
        assert('the status stays COMPLETED', stillDone.status === 'COMPLETED', stillDone.status);

        const ingestAfterDone = await work(A, 'POST', `/scans/${scanA.id}/posts`, {
            posts: [{ facebook_group_id: A.groupId, facebook_post_id: 'late', post_text: 'too late' }],
        });
        assert('a finished scan stops accepting posts', ingestAfterDone.status === 409, `HTTP ${ingestAfterDone.status}`);

        // claimNextScan takes the OLDEST queued scan, so a bare create-then-claim
        // can hand back some earlier leftover instead. Clear the queue first and
        // assert the claim returned the scan under test, rather than assuming it.
        const claimFresh = async () => {
            await admin.from('engagement_scan_tasks')
                .update({ status: 'CANCELLED' })
                .eq('workspace_id', A.workspaceId).eq('status', 'QUEUED');
            const scan = (await newScan(A)).body.scan;
            const claim = await work(A, 'POST', '/scans/claim', {});
            if (claim.body?.scan?.id !== scan.id) {
                throw new Error(`claim returned ${claim.body?.scan?.id} but expected ${scan.id}`);
            }
            return scan;
        };

        const retryScan = await claimFresh();
        const retried = await work(A, 'POST', `/scans/${retryScan.id}/status`, { status: 'FAILED', error_code: 'PAGE_LOAD_TIMEOUT' });
        assert('a retryable failure returns the scan to the queue',
            retried.body?.status === 'QUEUED' && retried.body?.retried === true, JSON.stringify(retried.body));

        const blockScan = await claimFresh();
        const blocked = await work(A, 'POST', `/scans/${blockScan.id}/status`, { status: 'FAILED', error_code: 'CHECKPOINT_REQUIRED' });
        assert('a checkpoint is terminal and is never retried against Facebook',
            blocked.body?.status === 'FAILED' && blocked.body?.retried === false, JSON.stringify(blocked.body));

        const badStatus = await work(A, 'POST', `/scans/${blockScan.id}/status`, { status: 'BANANA' });
        assert('an unknown status value is refused', badStatus.status === 400, `HTTP ${badStatus.status}`);

        // A second worker in the SAME workspace must not close a scan another
        // worker holds. Workspace scoping cannot catch this — both share a
        // workspace — so the rule is asserted directly against the queue module.
        const heldScan = await claimFresh();
        const otherWorkerId = '33333333-3333-4333-8333-333333333333';
        const foreignWorkerReport = await reportScanStatus({
            scanId: heldScan.id, workspaceId: A.workspaceId, workerId: otherWorkerId, status: 'COMPLETED',
        });
        assert('another worker in the same workspace cannot close a held scan',
            foreignWorkerReport.ok === false && foreignWorkerReport.code === 404,
            JSON.stringify(foreignWorkerReport));
        const { data: stillRunning } = await admin.from('engagement_scan_tasks')
            .select('status').eq('id', heldScan.id).single();
        assert('the held scan is still RUNNING after the rejected report',
            stillRunning.status === 'RUNNING', stillRunning.status);
        // Close it properly so the FAILED/COMPLETED audit assertions below are
        // not affected by a scan left mid-flight.
        await work(A, 'POST', `/scans/${heldScan.id}/status`, { status: 'ABORTED', error_code: 'NO_POSTS_FOUND' });

        // ------------------------------------------------------------------
        console.log('\n K. audit trail');
        const { data: logs } = await admin.from('system_logs')
            .select('message, source').eq('workspace_id', A.workspaceId).eq('source', 'engagement');
        const messages = (logs || []).map(l => l.message).join(' | ');
        for (const event of ['ENGAGEMENT_SCAN_CREATED', 'ENGAGEMENT_SCAN_CLAIMED', 'ENGAGEMENT_SCAN_COMPLETED', 'ENGAGEMENT_SCAN_CANCELLED', 'ENGAGEMENT_SCAN_FAILED']) {
            assert(`${event} is audited`, messages.includes(event));
        }
        assert('discovered post text is NOT written into system_logs',
            !messages.includes('Looking for a plumber') && !messages.includes('ל'.repeat(50)));
        assert('author names are NOT written into system_logs', !messages.includes('Yossi Cohen'));

        console.log('\n L. publishing queue untouched');
        const { count: postsForA } = await admin.from('posts')
            .select('id', { count: 'exact', head: true }).eq('workspace_id', A.workspaceId);
        assert('no rows were created in the publishing table', postsForA === 0, `${postsForA}`);
    } finally {
        if (flagServer) await new Promise(resolve => flagServer.close(resolve));
        for (const t of [A, B]) {
            await admin.from('engagement_discovered_posts').delete().eq('workspace_id', t.workspaceId);
            await admin.from('engagement_scan_tasks').delete().eq('workspace_id', t.workspaceId);
            await admin.from('system_logs').delete().eq('workspace_id', t.workspaceId);
            await admin.from('posts').delete().eq('workspace_id', t.workspaceId);
            await admin.from('groups').delete().eq('workspace_id', t.workspaceId);
            await admin.from('browser_workers').delete().eq('workspace_id', t.workspaceId);
            await admin.from('pairing_codes').delete().eq('workspace_id', t.workspaceId);
            await admin.from('workspace_members').delete().eq('workspace_id', t.workspaceId);
            await admin.from('workspaces').delete().eq('id', t.workspaceId);
            await admin.auth.admin.deleteUser(t.userId);
        }
        console.log('\n  fixtures cleaned');
    }

    console.log(`\n${passed} passed, ${failed} failed`);
    process.exitCode = failed ? 1 : 0;
})().catch(error => {
    console.error('Test run error:', error.message);
    process.exitCode = 2;
});
