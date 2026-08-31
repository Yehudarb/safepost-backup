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
    // The composer closed but neither a published post nor a pending-approval
    // banner could be found, so we do not know whether Facebook accepted it.
    // Deliberately terminal rather than retryable: a retry of a submission that
    // DID go through posts the same content to the group twice. A human decides.
    'PUBLISH_UNVERIFIED',
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
    //
    // NOTE: this used to `.select('*, groups(name, url)')`. That PostgREST embed
    // needs a foreign key between posts and groups — exactly the FK migration
    // 0008 deliberately drops, because a group id is no longer globally unique.
    // After 0008 every claim failed with PGRST200 ("Could not find a relationship
    // between 'posts' and 'groups'"), the error was swallowed by destructuring
    // only `data`, and claimNextJob silently returned null — i.e. NO job could
    // ever be claimed. The group is now resolved separately, scoped the same way
    // dispatchTask() does it.
    const { data: locked, error: lockError } = await supabase.from('posts')
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
        .select('*');

    if (lockError) { console.error('[queue] claim lock failed:', lockError.message); return null; }
    if (!locked || locked.length === 0) return null; // lost the race — caller may retry

    const claimed = locked[0];

    // Resolve the target group for this workspace + facebook_user (composite key
    // since 0008). The worker needs `group_url` — background.js opens the tab with
    // it — so attach it here rather than leaving the caller to guess.
    let groupQuery = supabase.from('groups').select('name, url').eq('id', claimed.group_id);
    if (claimed.workspace_id) groupQuery = groupQuery.eq('workspace_id', claimed.workspace_id);
    if (claimed.facebook_user) groupQuery = groupQuery.eq('facebook_user', claimed.facebook_user);
    const { data: group } = await groupQuery.limit(1).maybeSingle();

    return { ...claimed, group_name: group?.name || null, group_url: group?.url || null };
}

// Extend the lock for a worker's in-flight job (called on heartbeat).
async function extendLock(workerId) {
    if (!workerId) return;
    const leaseUntil = new Date(Date.now() + LOCK_LEASE_MS).toISOString();
    await supabase.from('posts').update({ lock_expires_at: leaseUntil })
        .eq('worker_id', workerId).eq('status', 'PROCESSING');
}

// Report a job result with persistent idempotency + retry/backoff.
// `externalUrl` is the post's real permalink and lands in external_post_url — it
// doubles as the idempotency signal below, so only a genuinely identified post URL
// belongs there. `proofUrl` is whatever the worker could show as evidence (which
// may only be the group URL when the permalink could not be found); it is kept in
// the separate proof_url column, matching what the legacy PATCH route has always
// stored, so switching the extension to this route loses nothing.
async function reportJobStatus({ jobId, workspaceId, status, errorCode, failureReason, externalUrl, proofUrl }) {
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
            ...(proofUrl ? { proof_url: proofUrl } : {}),
        }).eq('id', jobId);
        if (error) { console.error('[queue] success update failed:', error.message); return { ok: false, code: 500 }; }
        return { ok: true, final: 'SUCCESS' };
    }

    // CANCELLED is a decision, not an error: the worker deliberately stopped
    // (today: the group holds posts for admin approval, reported as CANCELLED with
    // 'ממתין לאישור מנהל' — the convention GET /api/groups' requires_moderation,
    // the analytics moderationRate and the 48h resume sweep all key off). It must
    // never fall through to the retry classifier below: an unknown/absent error
    // code classifies as retryable, which would requeue the job and could publish
    // the same post to Facebook a second time. The resume sweep needs ended_at set,
    // so it is stamped here.
    if (status === 'CANCELLED') {
        const { error } = await supabase.from('posts').update({
            status: 'CANCELLED', failure_reason: failureReason || null,
            error_code: errorCode || null, ended_at: now,
            lock_expires_at: null, worker_id: null,
            ...(proofUrl ? { proof_url: proofUrl } : {}),
        }).eq('id', jobId);
        if (error) { console.error('[queue] cancel update failed:', error.message); return { ok: false, code: 500 }; }
        return { ok: true, final: 'CANCELLED' };
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
        ...(proofUrl ? { proof_url: proofUrl } : {}),
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
