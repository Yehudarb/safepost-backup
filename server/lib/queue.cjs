// Phase 6 — Queue hardening: persistent locking, retries, idempotency, sweeps.
//
// Built on the `posts` job table. All times UTC. The claim uses a conditional
// UPDATE (status flips SENT→PROCESSING atomically) so two workers can never
// execute the same job. Idempotency + retry state live in the DB, not memory.

const { supabase } = require('../supabaseClient.cjs');

const LOCK_LEASE_MS = 2 * 60 * 1000;   // a claimed job is locked for 2 minutes
const BACKOFF_BASE_MS = 30 * 1000;      // 30s, doubling per attempt
const BACKOFF_CAP_MS = 30 * 60 * 1000;  // capped at 30 minutes

const RETRYABLE = new Set([
    'NETWORK_TIMEOUT', 'PAGE_LOAD_TIMEOUT', 'COMPOSER_NOT_READY',
    'MEDIA_UPLOAD_TIMEOUT', 'TEMPORARY_SERVER_ERROR', 'WORKER_DISCONNECTED',
]);
const NEEDS_USER_ACTION = new Set([
    'FACEBOOK_LOGGED_OUT', 'GROUP_NOT_FOUND', 'NO_GROUP_ACCESS', 'POSTING_NOT_ALLOWED',
    'ACCOUNT_RESTRICTED', 'CHECKPOINT_REQUIRED', 'CAPTCHA_REQUIRED', 'INVALID_MEDIA',
]);

// Unknown codes are treated as retryable (likely transient), bounded by max_attempts.
function classifyError(code) {
    if (NEEDS_USER_ACTION.has(code)) return 'needs_user_action';
    if (RETRYABLE.has(code)) return 'retryable';
    return 'retryable';
}

function backoffMs(attempt) {
    return Math.min(BACKOFF_BASE_MS * Math.pow(2, Math.max(0, attempt)), BACKOFF_CAP_MS);
}

// Atomically claim the next due job for a workspace. Returns the locked job or null.
async function claimNextJob({ workspaceId, workerId }) {
    const now = new Date().toISOString();
    const leaseUntil = new Date(Date.now() + LOCK_LEASE_MS).toISOString();

    let q = supabase.from('posts').select('*')
        .eq('app_source', 'backup')
        .eq('status', 'SENT')
        .lte('scheduled_time', now)
        .or(`lock_expires_at.is.null,lock_expires_at.lt.${now}`)
        .order('scheduled_time', { ascending: true })
        .limit(1);
    if (workspaceId) q = q.eq('workspace_id', workspaceId);

    const { data: cands } = await q;
    const job = cands && cands[0];
    if (!job) return null;

    // Conditional lock: only succeeds if still SENT + lock free (atomic row update).
    const { data: locked } = await supabase.from('posts')
        .update({
            status: 'PROCESSING',
            worker_id: workerId || null,
            claimed_at: now,
            lock_expires_at: leaseUntil,
            attempt_count: (job.attempt_count || 0) + 1,
            last_attempt_at: now,
        })
        .eq('id', job.id)
        .eq('status', 'SENT')
        .or(`lock_expires_at.is.null,lock_expires_at.lt.${now}`)
        .select('*, groups(name, url)');

    if (!locked || locked.length === 0) return null; // lost the race — caller may retry
    return locked[0];
}

// Extend the lock for a worker's in-flight job (called on heartbeat).
async function extendLock(workerId) {
    if (!workerId) return;
    const leaseUntil = new Date(Date.now() + LOCK_LEASE_MS).toISOString();
    await supabase.from('posts').update({ lock_expires_at: leaseUntil })
        .eq('worker_id', workerId).eq('status', 'PROCESSING');
}

// Report a job result with persistent idempotency + retry/backoff.
async function reportJobStatus({ jobId, workspaceId, status, errorCode, failureReason, externalUrl }) {
    const { data: job } = await supabase.from('posts').select('*').eq('id', jobId).maybeSingle();
    if (!job) return { ok: false, code: 404 };
    if (workspaceId && job.workspace_id !== workspaceId) return { ok: false, code: 403 };

    // Idempotency: never re-process an already-successful job.
    if (job.status === 'SUCCESS' || job.external_post_url) return { ok: true, idempotent: true };

    const now = new Date().toISOString();

    if (status === 'SUCCESS') {
        const { error } = await supabase.from('posts').update({
            status: 'SUCCESS', external_post_url: externalUrl || null,
            ended_at: now, lock_expires_at: null, worker_id: null, error_code: null,
        }).eq('id', jobId);
        if (error) { console.error('[queue] success update failed:', error.message); return { ok: false, code: 500 }; }
        return { ok: true, final: 'SUCCESS' };
    }

    const category = classifyError(errorCode);
    const attempts = job.attempt_count || 0;
    const maxAtt = job.max_attempts || 3;

    if (category === 'retryable' && attempts < maxAtt) {
        const next = new Date(Date.now() + backoffMs(attempts)).toISOString();
        await supabase.from('posts').update({
            status: 'SENT', error_code: errorCode || null, failure_reason: failureReason || null,
            next_attempt_at: next, scheduled_time: next, lock_expires_at: null, worker_id: null,
        }).eq('id', jobId);
        return { ok: true, requeued: true, next_attempt_at: next };
    }

    const finalStatus = category === 'needs_user_action' ? 'NEEDS_USER_ACTION' : 'FAILED';
    await supabase.from('posts').update({
        status: finalStatus, error_code: errorCode || null, failure_reason: failureReason || null,
        ended_at: now, lock_expires_at: null, worker_id: null,
    }).eq('id', jobId);
    return { ok: true, final: finalStatus };
}

// Return jobs whose lock expired (worker died) to the queue, or fail if exhausted.
async function sweepExpiredLocks() {
    const now = new Date().toISOString();
    const { data: stuck } = await supabase.from('posts')
        .select('id, attempt_count, max_attempts')
        .eq('status', 'PROCESSING').lt('lock_expires_at', now).limit(100);
    let requeued = 0, failed = 0;
    for (const j of stuck || []) {
        const attempts = j.attempt_count || 0, maxAtt = j.max_attempts || 3;
        if (attempts < maxAtt) {
            const next = new Date(Date.now() + backoffMs(attempts)).toISOString();
            const { data } = await supabase.from('posts').update({
                status: 'SENT', error_code: 'WORKER_DISCONNECTED', next_attempt_at: next,
                scheduled_time: next, lock_expires_at: null, worker_id: null,
            }).eq('id', j.id).eq('status', 'PROCESSING').select('id');
            if (data && data.length) requeued++;
        } else {
            const { data } = await supabase.from('posts').update({
                status: 'FAILED', error_code: 'WORKER_DISCONNECTED',
                failure_reason: 'Worker disconnected; max attempts reached',
                ended_at: now, lock_expires_at: null, worker_id: null,
            }).eq('id', j.id).eq('status', 'PROCESSING').select('id');
            if (data && data.length) failed++;
        }
    }
    return { requeued, failed };
}

// Handle schedules missed while the server/worker was down, per workspace policy.
async function sweepMissedSchedules({ graceMs = 15 * 60 * 1000 } = {}) {
    const cutoff = new Date(Date.now() - graceMs).toISOString();
    const now = new Date().toISOString();
    const { data: overdue } = await supabase.from('posts')
        .select('id, workspace_id, workspaces(missed_schedule_policy)')
        .in('status', ['PENDING', 'SCHEDULED'])
        .lt('scheduled_time', cutoff).limit(200);

    let handled = 0;
    for (const j of overdue || []) {
        const policy = j.workspaces?.missed_schedule_policy || 'publish_immediately';
        let update = null;
        if (policy === 'publish_immediately') update = { status: 'SENT', scheduled_time: now };
        else if (policy === 'reschedule') update = { scheduled_time: new Date(Date.now() + 5 * 60 * 1000).toISOString() };
        else if (policy === 'cancel') update = { status: 'CANCELLED', failure_reason: 'Missed schedule (policy: cancel)' };
        else if (policy === 'ask_user') update = { status: 'NEEDS_USER_ACTION', failure_reason: 'Missed schedule — needs your decision' };
        if (update) {
            const { data } = await supabase.from('posts').update(update).eq('id', j.id).in('status', ['PENDING', 'SCHEDULED']).select('id');
            if (data && data.length) handled++;
        }
    }
    return { handled };
}

module.exports = {
    LOCK_LEASE_MS, RETRYABLE, NEEDS_USER_ACTION,
    classifyError, backoffMs, claimNextJob, extendLock,
    reportJobStatus, sweepExpiredLocks, sweepMissedSchedules,
};
