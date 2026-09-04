/**
 * Phase 28 - Engagement late-flush lease race regression.
 *
 * Uses the QA database directly so status transitions and late requests can be
 * ordered deterministically without Facebook or a separately running backend.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');
const {
    claimNextScan,
    recordDiscoveredPosts,
    reportScanStatus,
} = require('../server/lib/engagementQueue.cjs');

const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_KEY.');
    process.exit(2);
}
if (!SUPABASE_URL.includes('tesagheacuzkhecaihte') || SUPABASE_URL.includes('hfpsdzfggugoerythnug')) {
    console.error('REFUSING: Phase 28 must run only against the SafePost QA project.');
    process.exit(3);
}

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
});
const tag = `p28_lease_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
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
    const worker = await insert('browser_workers', {
        workspace_id: workspace.id,
        worker_name: `${tag} ${label} worker`,
        device_token_hash: crypto.createHash('sha256').update(`${tag}-${label}`).digest('hex'),
        extension_version: '9.1',
    }, 'id');
    return { workspaceId: workspace.id, workerId: worker.id };
}

async function makeWorker(workspaceId, label) {
    return insert('browser_workers', {
        workspace_id: workspaceId,
        worker_name: `${tag} ${label}`,
        device_token_hash: crypto.createHash('sha256').update(`${tag}-${label}`).digest('hex'),
        extension_version: '9.1',
    }, 'id');
}

async function makeScan(owner, overrides = {}) {
    const claimedAt = overrides.claimed_at || new Date(Date.now() - 60_000).toISOString();
    return insert('engagement_scan_tasks', {
        workspace_id: owner.workspaceId,
        name: `${tag} scan`,
        status: 'RUNNING',
        target_groups: [],
        worker_id: owner.workerId,
        claimed_at: claimedAt,
        lock_expires_at: new Date(Date.now() + 60_000).toISOString(),
        attempt_count: 1,
        max_attempts: 2,
        ...overrides,
    });
}

const discovered = (suffix, group = 'group-a') => ({
    facebook_group_id: group,
    facebook_post_id: `${tag}-${suffix}`,
    post_text: `Phase 28 ${suffix}`,
});

async function readScan(scanId) {
    const { data, error } = await admin.from('engagement_scan_tasks')
        .select('*').eq('id', scanId).single();
    if (error) throw new Error(`read scan: ${error.message}`);
    return data;
}

async function countPosts(scanId, workspaceId) {
    const { count, error } = await admin.from('engagement_discovered_posts')
        .select('id', { count: 'exact', head: true })
        .eq('workspace_id', workspaceId)
        .eq('scan_task_id', scanId);
    if (error) throw new Error(`count posts: ${error.message}`);
    return count;
}

async function upload(owner, scan, claimStartedAt, suffix, workspaceId = owner.workspaceId) {
    return recordDiscoveredPosts({
        scanId: scan.id,
        workspaceId,
        workerId: owner.workerId,
        claimStartedAt,
        posts: [discovered(suffix)],
    });
}

(async () => {
    console.log('Phase 28 Engagement late-flush lease race\n');
    const A = await makeWorkspace('a');
    const B = await makeWorkspace('b');
    const secondWorker = await makeWorker(A.workspaceId, 'second-worker');

    try {
        console.log(' A. active claim lease invariant');
        const active = await makeScan(A);
        const oldLease = active.lock_expires_at;
        const activeResult = await upload(A, active, active.claimed_at, 'active');
        const activeAfter = await readScan(active.id);
        assert('1. RUNNING current claim refreshes its lease',
            activeResult.ok && activeResult.lease_refreshed === true &&
            Date.parse(activeAfter.lock_expires_at) > Date.parse(oldLease));

        console.log('\n B. late batches never restore a lease');
        const lateScans = new Map();
        for (const status of ['QUEUED', 'COMPLETED', 'FAILED', 'ABORTED', 'CANCELLED']) {
            const claim = new Date(Date.now() - 120_000 - lateScans.size * 1000).toISOString();
            const scan = await makeScan(A, {
                name: `${tag} ${status}`,
                status,
                worker_id: null,
                claimed_at: claim,
                lock_expires_at: null,
                completed_at: status === 'QUEUED' ? null : new Date().toISOString(),
                attempt_count: 1,
            });
            const result = await upload(A, scan, claim, status.toLowerCase());
            const after = await readScan(scan.id);
            lateScans.set(status, { scan, claim, result, after });
            assert(`${lateScans.size + 1}. ${status} late batch does not refresh lease`,
                result.ok && result.lease_refreshed === false && after.lock_expires_at === null &&
                after.status === status);
        }

        console.log('\n C. reproduced preemption sequence');
        const preempted = await makeScan(A, { name: `${tag} preempted`, attempt_count: 1 });
        const first = await upload(A, preempted, preempted.claimed_at, 'preempt-first');
        const preempt = await reportScanStatus({
            scanId: preempted.id,
            workspaceId: A.workspaceId,
            workerId: A.workerId,
            status: 'FAILED',
            errorCode: 'SCAN_PREEMPTED_BY_PUBLISH',
            failureReason: 'Phase 28 deterministic preemption',
        });
        const late = await upload(A, preempted, preempted.claimed_at, 'preempt-late');
        const afterLate = await readScan(preempted.id);
        assert('7. preempt then late batch stays QUEUED, neutral and unlocked',
            first.ok && preempt.ok && late.ok && late.lease_refreshed === false &&
            afterLate.status === 'QUEUED' && afterLate.attempt_count === 0 &&
            afterLate.lock_expires_at === null);

        // Keep this scan as the only queued candidate so claimability is exact.
        await admin.from('engagement_scan_tasks')
            .update({ status: 'CANCELLED', completed_at: new Date().toISOString() })
            .eq('workspace_id', A.workspaceId)
            .eq('status', 'QUEUED')
            .neq('id', preempted.id);
        await new Promise(resolve => setTimeout(resolve, 5));
        const claimB = await claimNextScan({ workspaceId: A.workspaceId, workerId: secondWorker.id });
        assert('8. preempted scan is immediately claimable after the late batch',
            claimB?.id === preempted.id && claimB.status === 'RUNNING');

        const claimBLease = claimB.lock_expires_at;
        const oldClaimLate = await upload(A, preempted, preempted.claimed_at, 'old-claim-after-b');
        const afterOldClaim = await readScan(preempted.id);
        assert('9. old claim cannot refresh or overwrite the new claim',
            oldClaimLate.code === 404 &&
            afterOldClaim.status === 'RUNNING' && afterOldClaim.worker_id === secondWorker.id &&
            afterOldClaim.claimed_at === claimB.claimed_at &&
            afterOldClaim.lock_expires_at === claimBLease && afterOldClaim.attempt_count === 1);

        const staleGeneration = await recordDiscoveredPosts({
            scanId: preempted.id,
            workspaceId: A.workspaceId,
            workerId: secondWorker.id,
            claimStartedAt: preempted.claimed_at,
            posts: [discovered('stale-generation')],
        });
        const afterStaleGeneration = await readScan(preempted.id);
        assert('a stale generation cannot refresh the current worker lease',
            staleGeneration.ok && staleGeneration.lease_refreshed === false &&
            afterStaleGeneration.worker_id === secondWorker.id &&
            afterStaleGeneration.claimed_at === claimB.claimed_at &&
            afterStaleGeneration.lock_expires_at === claimBLease);

        console.log('\n D. dedup, counters and immutable queue state');
        const completed = lateScans.get('COMPLETED');
        const duplicateOne = await upload(A, completed.scan, completed.claim, 'completed');
        const duplicateTwo = await upload(A, completed.scan, completed.claim, 'completed');
        const completedCount = await countPosts(completed.scan.id, A.workspaceId);
        assert('10. duplicate late batch is idempotent',
            duplicateOne.stored === 0 && duplicateTwo.stored === 0);
        assert('11. a valid late row exists only once', completedCount === 1, `${completedCount}`);

        const preemptCount = await countPosts(preempted.id, A.workspaceId);
        const counted = await readScan(preempted.id);
        assert('12. posts_discovered equals authoritative deduplicated rows',
            counted.posts_discovered === preemptCount, `${counted.posts_discovered}/${preemptCount}`);

        const queued = lateScans.get('QUEUED');
        assert('13. /posts never moves QUEUED to RUNNING', queued.after.status === 'QUEUED');
        assert('14. late /posts does not change attempt_count',
            lateScans.get('FAILED').after.attempt_count === 1 && afterLate.attempt_count === 0);

        const beforeIsolation = await countPosts(preempted.id, A.workspaceId);
        const crossWorkspace = await upload(B, preempted, preempted.claimed_at,
            'cross-workspace', B.workspaceId);
        const afterIsolation = await countPosts(preempted.id, A.workspaceId);
        assert('15. workspace isolation is preserved',
            crossWorkspace.code === 404 && beforeIsolation === afterIsolation);

        console.log('\n E. protocol wiring');
        const routeSource = fs.readFileSync(path.join(__dirname, '../server/routes/engagement.cjs'), 'utf8');
        const backgroundSource = fs.readFileSync(path.join(__dirname, '../safe_post_extension/background.js'), 'utf8');
        assert('worker route forwards claim_started_at to the queue',
            /claimStartedAt:\s*typeof req\.body\?\.claim_started_at/.test(routeSource));
        assert('extension sends the claimed_at generation with each batch',
            /claim_started_at:\s*activity\.claimStartedAt/.test(backgroundSource));
    } finally {
        await admin.from('workspaces').delete().in('id', [A.workspaceId, B.workspaceId]);
        console.log('\n  fixtures cleaned');
    }

    console.log(`\n${passed} passed, ${failed} failed`);
    process.exitCode = failed ? 1 : 0;
})().catch(error => {
    console.error('Test run error:', error);
    process.exitCode = 2;
});
