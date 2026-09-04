/**
 * Phase 30 - stale Engagement /status claim-generation regression.
 */
const fs = require('fs');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const { pathToFileURL } = require('url');
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const {
    claimNextScan,
    reportScanStatus,
} = require('../server/lib/engagementQueue.cjs');

const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_KEY.');
    process.exit(2);
}
if (!SUPABASE_URL.includes('tesagheacuzkhecaihte') || SUPABASE_URL.includes('hfpsdzfggugoerythnug')) {
    console.error('REFUSING: Phase 30 must run only against the SafePost QA project.');
    process.exit(3);
}

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
});
const tag = `p30_status_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
let passed = 0;
let failed = 0;

function assert(name, condition, detail = '') {
    if (condition) {
        passed++;
        console.log(`  OK ${name}`);
    } else {
        failed++;
        console.log(`  FAIL ${name}${detail ? ` - ${detail}` : ''}`);
    }
}

async function insert(table, values, fields = '*') {
    const { data, error } = await admin.from(table).insert(values).select(fields).single();
    if (error) throw new Error(`${table} fixture: ${error.message}`);
    return data;
}

async function makeWorkspace(label) {
    const workspace = await insert('workspaces', {
        name: `${tag} ${label}`,
        is_personal: false,
        engagement_enabled: true,
    }, 'id');
    const deviceToken = `${tag}-${label}-device-token`;
    const worker = await insert('browser_workers', {
        workspace_id: workspace.id,
        worker_name: `${tag} ${label} worker`,
        device_token_hash: crypto.createHash('sha256').update(deviceToken).digest('hex'),
        extension_version: '9.1',
    }, 'id');
    return { workspaceId: workspace.id, workerId: worker.id, deviceToken };
}

async function makeWorker(workspaceId, label) {
    const deviceToken = `${tag}-${label}-device-token`;
    const worker = await insert('browser_workers', {
        workspace_id: workspaceId,
        worker_name: `${tag} ${label}`,
        device_token_hash: crypto.createHash('sha256').update(deviceToken).digest('hex'),
        extension_version: '9.1',
    }, 'id');
    return { workerId: worker.id, deviceToken };
}

async function makeScan(owner, overrides = {}) {
    return insert('engagement_scan_tasks', {
        workspace_id: owner.workspaceId,
        name: `${tag} scan`,
        status: 'RUNNING',
        target_groups: [],
        worker_id: owner.workerId,
        claimed_at: new Date(Date.now() - 60_000).toISOString(),
        lock_expires_at: new Date(Date.now() + 60_000).toISOString(),
        attempt_count: 1,
        max_attempts: 2,
        ...overrides,
    });
}

async function readScan(scanId) {
    const { data, error } = await admin.from('engagement_scan_tasks')
        .select('*').eq('id', scanId).single();
    if (error) throw new Error(`read scan: ${error.message}`);
    return data;
}

function lifecycleSnapshot(scan) {
    return JSON.stringify({
        status: scan.status,
        worker_id: scan.worker_id,
        claimed_at: scan.claimed_at,
        lock_expires_at: scan.lock_expires_at,
        attempt_count: scan.attempt_count,
        completed_at: scan.completed_at,
        error_code: scan.error_code,
    });
}

function status(owner, scan, body = {}) {
    return reportScanStatus({
        scanId: scan.id,
        workspaceId: owner.workspaceId,
        workerId: owner.workerId,
        claimStartedAt: body.claimStartedAt,
        status: body.status,
        errorCode: body.errorCode || null,
        failureReason: body.failureReason || null,
        groupsScanned: body.groupsScanned ?? null,
    });
}

function memoryStorage() {
    let lock = null;
    return {
        async readFacebookActivityLock() { return lock && JSON.parse(JSON.stringify(lock)); },
        async writeFacebookActivityLock(value) { lock = JSON.parse(JSON.stringify(value)); },
        async clearFacebookActivityLock() { lock = null; },
        async readFacebookActivityPreemption() { return null; },
        async writeFacebookActivityPreemption() {},
        async clearFacebookActivityPreemption() {},
    };
}

(async () => {
    console.log('Phase 30 Engagement status generation race\n');
    const savedFlag = process.env.ENGAGEMENT_ENABLED;
    process.env.ENGAGEMENT_ENABLED = 'true';
    const A = await makeWorkspace('a');
    const B = await makeWorkspace('b');
    const otherAWorker = await makeWorker(A.workspaceId, 'a-other');
    let server = null;

    try {
        console.log(' A. exact generation and released-row behavior');
        const matching = await makeScan(A, { name: `${tag} matching` });
        const matchingResult = await status(A, matching, {
            claimStartedAt: matching.claimed_at,
            status: 'FAILED',
            errorCode: 'PAGE_LOAD_TIMEOUT',
        });
        const matchingAfter = await readScan(matching.id);
        assert('1. matching claim generation applies the status transition',
            matchingResult.ok && matchingAfter.status === 'QUEUED');

        const releasedBefore = lifecycleSnapshot(matchingAfter);
        const releasedStale = await status(A, matching, {
            claimStartedAt: matching.claimed_at,
            status: 'COMPLETED',
        });
        const releasedAfter = await readScan(matching.id);
        assert('8. released worker_id=null scan rejects a different stale status without mutation',
            releasedStale.code === 409 && releasedStale.reason === 'STALE_SCAN_CLAIM' &&
            lifecycleSnapshot(releasedAfter) === releasedBefore);

        const missing = await makeScan(A, { name: `${tag} missing generation` });
        const missingBefore = lifecycleSnapshot(missing);
        const missingResult = await status(A, missing, { status: 'COMPLETED' });
        assert('9. missing claim_started_at fails safely',
            missingResult.code === 409 && lifecycleSnapshot(await readScan(missing.id)) === missingBefore);

        const completed = await status(A, missing, {
            claimStartedAt: missing.claimed_at,
            status: 'COMPLETED',
            groupsScanned: 1,
        });
        assert('10. correct claim_started_at completes normally',
            completed.ok && (await readScan(missing.id)).status === 'COMPLETED');

        const duplicate = await status(A, missing, {
            claimStartedAt: missing.claimed_at,
            status: 'COMPLETED',
            groupsScanned: 1,
        });
        assert('20. exact duplicate status is an idempotent success',
            duplicate.ok && duplicate.duplicate === true && duplicate.status === 'COMPLETED');

        console.log('\n B. same-worker claim A versus claim B');
        await admin.from('engagement_scan_tasks')
            .update({ status: 'CANCELLED', completed_at: new Date().toISOString() })
            .eq('workspace_id', A.workspaceId)
            .eq('status', 'QUEUED');
        const claimA = await makeScan(A, { name: `${tag} claim race`, attempt_count: 1 });
        const validPreempt = await status(A, claimA, {
            claimStartedAt: claimA.claimed_at,
            status: 'FAILED',
            errorCode: 'SCAN_PREEMPTED_BY_PUBLISH',
        });
        const afterPreempt = await readScan(claimA.id);
        assert('11. correct preemption is attempt-neutral, queued and unlocked',
            validPreempt.ok && afterPreempt.status === 'QUEUED' &&
            afterPreempt.attempt_count === 0 && afterPreempt.worker_id === null &&
            afterPreempt.lock_expires_at === null);

        await new Promise(resolve => setTimeout(resolve, 5));
        const claimB = await claimNextScan({ workspaceId: A.workspaceId, workerId: A.workerId });
        if (claimB?.id !== claimA.id) throw new Error(`claim B selected ${claimB?.id || 'nothing'}`);
        const claimBSnapshot = lifecycleSnapshot(claimB);

        const staleCases = [
            ['2. stale COMPLETED from claim A leaves claim B RUNNING', 'COMPLETED', null],
            ['3. stale FAILED from claim A leaves claim B RUNNING', 'FAILED', 'PAGE_LOAD_TIMEOUT'],
            ['4. stale preemption from claim A cannot requeue claim B', 'FAILED', 'SCAN_PREEMPTED_BY_PUBLISH'],
            ['5. stale WORKER_DISCONNECTED from claim A cannot requeue claim B', 'FAILED', 'WORKER_DISCONNECTED'],
            ['6. stale security ABORTED from claim A cannot abort claim B', 'ABORTED', 'FACEBOOK_IDENTITY_MISMATCH'],
        ];
        for (const [name, attemptedStatus, errorCode] of staleCases) {
            const result = await status(A, claimA, {
                claimStartedAt: claimA.claimed_at,
                status: attemptedStatus,
                errorCode,
            });
            assert(name, result.code === 409 && result.reason === 'STALE_SCAN_CLAIM' &&
                lifecycleSnapshot(await readScan(claimA.id)) === claimBSnapshot);
        }

        const wrongGeneration = await status(A, claimB, {
            claimStartedAt: new Date(Date.parse(claimB.claimed_at) - 1).toISOString(),
            status: 'FAILED',
            errorCode: 'NETWORK_TIMEOUT',
        });
        const afterWrongGeneration = await readScan(claimB.id);
        assert('12. wrong generation leaves attempt_count unchanged',
            wrongGeneration.code === 409 && afterWrongGeneration.attempt_count === claimB.attempt_count);
        assert('13. wrong generation leaves lease unchanged',
            afterWrongGeneration.lock_expires_at === claimB.lock_expires_at);
        assert('14. wrong generation leaves worker ownership unchanged',
            afterWrongGeneration.worker_id === claimB.worker_id);
        assert('15. wrong generation leaves status unchanged', afterWrongGeneration.status === 'RUNNING');

        console.log('\n C. worker and workspace isolation');
        const foreignWorker = await reportScanStatus({
            scanId: claimB.id,
            workspaceId: A.workspaceId,
            workerId: otherAWorker.workerId,
            claimStartedAt: claimB.claimed_at,
            status: 'COMPLETED',
        });
        assert('7. a different worker cannot report the active claim', foreignWorker.code === 404);

        const crossWorkspace = await reportScanStatus({
            scanId: claimB.id,
            workspaceId: B.workspaceId,
            workerId: B.workerId,
            claimStartedAt: claimB.claimed_at,
            status: 'COMPLETED',
        });
        assert('19. workspace isolation is preserved',
            crossWorkspace.code === 404 && lifecycleSnapshot(await readScan(claimB.id)) === claimBSnapshot);

        console.log('\n D. persisted MV3 generation');
        const storage = memoryStorage();
        global.ExtStorage = storage;
        await import(`${pathToFileURL(path.join(__dirname, '../safe_post_extension/facebookActivityLock.js')).href}?phase30`);
        const lock = global.SafePostFacebookActivityLock;
        const owner = global.SafePostFacebookActivityLockFactory.FACEBOOK_ACTIVITY_OWNERS.ENGAGEMENT;
        await lock.acquireFacebookActivityLock(owner, 'engagement:phase30');
        const attached = await lock.attachFacebookActivityScan(
            owner, 'engagement:phase30', claimA.id, claimA.claimed_at);
        const persisted = await lock.getFacebookActivityLock();
        assert('16. persisted MV3 activity stores the exact claim generation',
            attached && persisted.claimStartedAt === new Date(claimA.claimed_at).toISOString());

        const backgroundSource = fs.readFileSync(
            path.join(__dirname, '../safe_post_extension/background.js'), 'utf8');
        assert('17. orphan reconciliation sends the persisted generation',
            /finishPersistedEngagementActivity[\s\S]*?claim_started_at:\s*lock\.claimStartedAt/.test(backgroundSource));

        const orphanResult = await status(A, claimA, {
            claimStartedAt: persisted.claimStartedAt,
            status: 'FAILED',
            errorCode: 'WORKER_DISCONNECTED',
        });
        assert('18. orphan recovery from claim A cannot mutate claim B',
            orphanResult.code === 409 && lifecycleSnapshot(await readScan(claimB.id)) === claimBSnapshot);

        const validClaimB = await status(A, claimB, {
            claimStartedAt: claimB.claimed_at,
            status: 'COMPLETED',
            groupsScanned: 1,
        });
        assert('the valid claim B status still succeeds after stale reports',
            validClaimB.ok && (await readScan(claimB.id)).status === 'COMPLETED');

        console.log('\n E. HTTP contract and observability');
        const app = express();
        app.use(express.json());
        app.use('/api/engagement', require('../server/routes/engagement.cjs'));
        server = http.createServer(app);
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        const routeScan = await makeScan(A, { name: `${tag} route` });
        const endpoint = `http://127.0.0.1:${server.address().port}/api/engagement/scans/${routeScan.id}/status`;
        const headers = {
            'x-worker-id': A.workerId,
            'x-device-token': A.deviceToken,
            'Content-Type': 'application/json',
        };
        const staleResponse = await fetch(endpoint, {
            method: 'POST', headers, body: JSON.stringify({ status: 'COMPLETED' }),
        });
        const staleBody = await staleResponse.json();
        assert('HTTP status route returns the stable stale-claim contract',
            staleResponse.status === 409 && staleBody.code === 'STALE_SCAN_CLAIM');
        const { data: logs } = await admin.from('system_logs')
            .select('message').eq('workspace_id', A.workspaceId).eq('source', 'engagement');
        assert('stale status rejection is safely observable',
            (logs || []).some(item => item.message.includes('STALE_SCAN_CLAIM') &&
                !item.message.includes(A.deviceToken)));
    } finally {
        if (server) await new Promise(resolve => server.close(resolve));
        await admin.from('workspaces').delete().in('id', [A.workspaceId, B.workspaceId]);
        if (savedFlag === undefined) delete process.env.ENGAGEMENT_ENABLED;
        else process.env.ENGAGEMENT_ENABLED = savedFlag;
        console.log('\n  fixtures cleaned');
    }

    console.log(`\n${passed} passed, ${failed} failed`);
    process.exitCode = failed ? 1 : 0;
})().catch(error => {
    console.error('Test run error:', error);
    process.exitCode = 2;
});
