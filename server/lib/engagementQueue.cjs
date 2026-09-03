'use strict';

// Engagement scan queue — Phase 1A.
//
// A SECOND, fully independent queue. It reads and writes only
// `engagement_scan_tasks` and `engagement_discovered_posts`, and never touches
// `posts`. server/lib/queue.cjs is not imported, not extended and not modified:
// its extendLock() updates every PROCESSING row for a worker and its sweeps
// assume publish semantics, so any shared state between the two queues would let
// a scan corrupt a publish job's lock.
//
// The claim uses the same conditional-UPDATE technique as the publish queue
// (QUEUED -> RUNNING in one atomic row update), so two workers can never run the
// same scan.

const { supabase } = require('../supabaseClient.cjs');
const { buildDedupKey, truncatePostText } = require('./engagementDedup.cjs');

// A scan covers several groups with scrolling between them, so it is a much
// longer unit of work than a single publish. The publish queue leases for 2
// minutes; 15 gives a real scan room to finish without a sweep stealing it.
const SCAN_LOCK_LEASE_MS = 15 * 60 * 1000;

const TERMINAL_STATUSES = new Set(['COMPLETED', 'FAILED', 'ABORTED', 'CANCELLED']);

// Conditions worth another attempt: the environment failed, not the account.
const RETRYABLE_ERRORS = new Set([
    'PAGE_LOAD_TIMEOUT', 'NETWORK_TIMEOUT', 'TEMPORARY_SERVER_ERROR',
    'WORKER_DISCONNECTED',
    // Phase 1B: the scanner yields the Facebook tab to a publish job. Not a
    // failure at all — the scan simply has not run yet.
    'SCAN_PREEMPTED_BY_PUBLISH',
]);

// Conditions a retry cannot fix, and where retrying makes things worse: hammering
// Facebook while it is already showing a checkpoint is exactly how an account
// gets restricted further. These are terminal and surfaced to the user.
const NEEDS_USER_ACTION_ERRORS = new Set([
    'FACEBOOK_LOGGED_OUT', 'CAPTCHA_REQUIRED', 'CHECKPOINT_REQUIRED',
    'ACCOUNT_RESTRICTED', 'GROUP_NOT_FOUND', 'NO_GROUP_ACCESS',
    'PARSER_NO_STRATEGY_MATCHED',
]);

function classifyScanError(code) {
    if (NEEDS_USER_ACTION_ERRORS.has(code)) return 'needs_user_action';
    if (RETRYABLE_ERRORS.has(code)) return 'retryable';
    // Unknown codes are treated as needing a human. A scan is not time-critical,
    // and silently retrying something we do not understand against Facebook is
    // the riskier default.
    return 'needs_user_action';
}

// Atomically claim the next queued scan for a workspace. Returns the locked row
// or null. Callers must have already verified both feature flags — the queue
// deliberately does not read them, so flag policy lives in exactly one place
// (the route) rather than being duplicated and drifting.
async function claimNextScan({ workspaceId, workerId }) {
    if (!workspaceId) return null;
    const now = new Date().toISOString();
    const leaseUntil = new Date(Date.now() + SCAN_LOCK_LEASE_MS).toISOString();

    const { data: candidates, error: findError } = await supabase
        .from('engagement_scan_tasks')
        .select('*')
        .eq('workspace_id', workspaceId)
        .eq('status', 'QUEUED')
        .or(`lock_expires_at.is.null,lock_expires_at.lt.${now}`)
        .order('created_at', { ascending: true })
        .limit(1);

    if (findError) {
        console.error('[engagement] claim lookup failed:', findError.message);
        return null;
    }
    const candidate = candidates && candidates[0];
    if (!candidate) return null;

    // Conditional lock. Re-asserting status='QUEUED' and the free-lock predicate
    // inside the UPDATE is what makes this atomic: if another worker claimed it
    // between the SELECT and here, zero rows match and we return null.
    const { data: locked, error: lockError } = await supabase
        .from('engagement_scan_tasks')
        .update({
            status: 'RUNNING',
            worker_id: workerId || null,
            claimed_at: now,
            started_at: candidate.started_at || now,
            lock_expires_at: leaseUntil,
            attempt_count: (candidate.attempt_count || 0) + 1,
        })
        .eq('id', candidate.id)
        .eq('workspace_id', workspaceId)
        .eq('status', 'QUEUED')
        .or(`lock_expires_at.is.null,lock_expires_at.lt.${now}`)
        .select('*');

    if (lockError) {
        console.error('[engagement] claim lock failed:', lockError.message);
        return null;
    }
    if (!locked || locked.length === 0) return null; // lost the race
    return locked[0];
}

// Ownership check for a worker acting on a scan.
//
// Tenant isolation comes from workspace_id, which the caller took from a
// VERIFIED device token — that alone stops another tenant touching this row.
// The worker check is a narrower rule on top: while a scan is RUNNING, only the
// worker holding the lease may act on it.
//
// It deliberately does NOT filter on worker_id in the query. A finished scan has
// its worker_id cleared, so filtering would make every post-completion lookup
// miss and answer 404 — turning an idempotent duplicate report into an error and
// hiding the real reason a late ingest was refused.
function workerMayAct(scan, workerId) {
    if (!scan.worker_id) return true;          // lease released or never claimed
    if (!workerId) return true;                // caller is not acting as a worker
    return scan.worker_id === workerId;
}

// Record a terminal (or retry) outcome for a scan.
async function reportScanStatus({
    scanId, workspaceId, workerId,
    status, errorCode = null, failureReason = null,
    groupsScanned = null, postsDiscovered = null,
}) {
    if (!scanId || !workspaceId) return { ok: false, code: 400 };
    if (!TERMINAL_STATUSES.has(status)) return { ok: false, code: 400 };

    const { data: scan, error: readError } = await supabase
        .from('engagement_scan_tasks')
        .select('*')
        .eq('id', scanId)
        .eq('workspace_id', workspaceId)
        .maybeSingle();

    if (readError) {
        console.error('[engagement] status read failed:', readError.message);
        return { ok: false, code: 500 };
    }
    if (!scan) return { ok: false, code: 404 };
    // 404 rather than 403: another worker's scan should look absent, not forbidden.
    if (!workerMayAct(scan, workerId)) return { ok: false, code: 404 };

    // Idempotent: a duplicate terminal report (a retried HTTP call, say) must not
    // reopen or re-close a finished scan.
    if (TERMINAL_STATUSES.has(scan.status)) {
        return { ok: true, duplicate: true, status: scan.status };
    }

    const now = new Date().toISOString();
    const patch = {
        error_code: errorCode,
        failure_reason: failureReason,
        lock_expires_at: null,
        worker_id: null,
    };
    if (groupsScanned !== null) patch.groups_scanned = groupsScanned;
    if (postsDiscovered !== null) patch.posts_discovered = postsDiscovered;

    const attempts = scan.attempt_count || 0;
    const maxAttempts = scan.max_attempts || 2;
    const shouldRetry = status === 'FAILED'
        && classifyScanError(errorCode) === 'retryable'
        && attempts < maxAttempts;

    if (shouldRetry) {
        // Back to the pool. claimed_at is cleared so the next claim looks fresh.
        patch.status = 'QUEUED';
        patch.claimed_at = null;
    } else {
        patch.status = status;
        patch.completed_at = now;
    }

    const { error: writeError } = await supabase
        .from('engagement_scan_tasks')
        .update(patch)
        .eq('id', scanId)
        .eq('workspace_id', workspaceId);

    if (writeError) {
        console.error('[engagement] status write failed:', writeError.message);
        return { ok: false, code: 500 };
    }
    return { ok: true, status: patch.status, retried: Boolean(shouldRetry) };
}

// User-initiated cancel from the dashboard. Only a scan that has not reached a
// terminal state can be cancelled; cancelling a finished scan is a no-op rather
// than an error, so a double-click does not produce a spurious failure.
async function cancelScan({ scanId, workspaceId }) {
    if (!scanId || !workspaceId) return { ok: false, code: 400 };

    const { data: scan, error: readError } = await supabase
        .from('engagement_scan_tasks')
        .select('id, status')
        .eq('id', scanId)
        .eq('workspace_id', workspaceId)
        .maybeSingle();

    if (readError) {
        console.error('[engagement] cancel read failed:', readError.message);
        return { ok: false, code: 500 };
    }
    if (!scan) return { ok: false, code: 404 };
    if (TERMINAL_STATUSES.has(scan.status)) {
        return { ok: true, alreadyFinal: true, status: scan.status };
    }

    const { error: writeError } = await supabase
        .from('engagement_scan_tasks')
        .update({
            status: 'CANCELLED',
            completed_at: new Date().toISOString(),
            lock_expires_at: null,
            worker_id: null,
        })
        .eq('id', scanId)
        .eq('workspace_id', workspaceId)
        .in('status', ['QUEUED', 'RUNNING']);

    if (writeError) {
        console.error('[engagement] cancel write failed:', writeError.message);
        return { ok: false, code: 500 };
    }
    return { ok: true, status: 'CANCELLED' };
}

// Store a batch of discovered posts.
//
// Every derived field is computed here, server-side: the dedup key, the text
// truncation and the is_truncated flag. Nothing the extension sends is trusted
// for those — a client that computed its own key could collide with an existing
// row or evade the unique index entirely.
async function recordDiscoveredPosts({ scanId, workspaceId, workerId, posts }) {
    if (!workspaceId) return { ok: false, code: 400 };
    if (!Array.isArray(posts) || posts.length === 0) return { ok: false, code: 400 };

    // The scan must exist, belong to this workspace, be held by this worker and
    // still be running. A cancelled or completed scan must not keep ingesting.
    //
    // Read scoped by workspace only, then check ownership and status separately,
    // so a late batch against a finished scan gets an accurate 409 instead of a
    // 404 that would send the worker looking for a scan that plainly exists.
    const { data: scan, error: readError } = await supabase
        .from('engagement_scan_tasks')
        .select('id, status, worker_id, posts_discovered, groups_scanned')
        .eq('id', scanId)
        .eq('workspace_id', workspaceId)
        .maybeSingle();

    if (readError) {
        console.error('[engagement] ingest read failed:', readError.message);
        return { ok: false, code: 500 };
    }
    if (!scan) return { ok: false, code: 404 };
    if (!workerMayAct(scan, workerId)) return { ok: false, code: 404 };
    if (scan.status !== 'RUNNING') return { ok: false, code: 409, reason: 'scan_not_running' };

    const rows = [];
    const seen = new Set();
    for (const post of posts) {
        const groupId = typeof post?.facebook_group_id === 'string' ? post.facebook_group_id.trim() : '';
        if (!groupId) continue; // a post with no group is not attributable; drop it

        const { text, truncated } = truncatePostText(post?.post_text);
        const postedAt = post?.posted_at ? new Date(post.posted_at) : null;
        const validPostedAt = postedAt && !Number.isNaN(postedAt.getTime()) ? postedAt.toISOString() : null;

        const { key, strategy } = buildDedupKey({
            workspaceId,
            facebookPostId: post?.facebook_post_id,
            facebookPostUrl: post?.facebook_post_url,
            facebookGroupId: groupId,
            authorName: post?.author_name,
            postText: text,
            postedAt: validPostedAt,
        });

        // Collapse duplicates inside this one batch before they reach Postgres.
        // upsert() rejects a payload containing the same conflict target twice
        // ("cannot affect row a second time"), which would fail the whole batch.
        if (seen.has(key)) continue;
        seen.add(key);

        rows.push({
            workspace_id: workspaceId,
            scan_task_id: scanId,
            facebook_group_id: groupId,
            facebook_group_name: typeof post?.facebook_group_name === 'string' ? post.facebook_group_name.trim() : null,
            facebook_post_id: typeof post?.facebook_post_id === 'string' ? post.facebook_post_id.trim() : null,
            facebook_post_url: typeof post?.facebook_post_url === 'string' ? post.facebook_post_url.trim() : null,
            author_name: typeof post?.author_name === 'string' ? post.author_name.trim() : null,
            author_profile_url: typeof post?.author_profile_url === 'string' ? post.author_profile_url.trim() : null,
            post_text: text,
            is_truncated: truncated,
            posted_at: validPostedAt,
            posted_at_raw: typeof post?.posted_at_raw === 'string' ? post.posted_at_raw.trim() : null,
            dedup_key: key,
            raw_metadata: {
                dedup_strategy: strategy,
                ...(post?.raw_metadata && typeof post.raw_metadata === 'object' && !Array.isArray(post.raw_metadata)
                    ? post.raw_metadata
                    : {}),
            },
        });
    }

    if (rows.length === 0) return { ok: true, received: posts.length, stored: 0, duplicates: 0 };

    // ignoreDuplicates keeps a re-scan idempotent: rows already present are left
    // untouched rather than overwritten, so the original discovered_at survives.
    const { data: inserted, error: writeError } = await supabase
        .from('engagement_discovered_posts')
        .upsert(rows, { onConflict: 'workspace_id,dedup_key', ignoreDuplicates: true })
        .select('id');

    if (writeError) {
        console.error('[engagement] ingest write failed:', writeError.message);
        return { ok: false, code: 500 };
    }

    const stored = Array.isArray(inserted) ? inserted.length : 0;

    // Counter is recomputed from the table rather than incremented, so a retried
    // batch cannot inflate it.
    const { count } = await supabase
        .from('engagement_discovered_posts')
        .select('id', { count: 'exact', head: true })
        .eq('workspace_id', workspaceId)
        .eq('scan_task_id', scanId);

    await supabase.from('engagement_scan_tasks')
        .update({
            posts_discovered: count || 0,
            // Extend the lease: the worker is demonstrably alive and working.
            lock_expires_at: new Date(Date.now() + SCAN_LOCK_LEASE_MS).toISOString(),
        })
        .eq('id', scanId)
        .eq('workspace_id', workspaceId);

    return {
        ok: true,
        received: posts.length,
        stored,
        duplicates: rows.length - stored,
        total_for_scan: count || 0,
    };
}

// Return scans whose lease expired without a terminal report — a browser that
// was closed mid-scan, say. Operates only on engagement rows; the publish
// sweeper in queue.cjs is untouched and unaware of this.
async function sweepExpiredScanLocks() {
    const now = new Date().toISOString();
    const { data, error } = await supabase
        .from('engagement_scan_tasks')
        .update({ status: 'QUEUED', worker_id: null, claimed_at: null, lock_expires_at: null })
        .eq('status', 'RUNNING')
        .lt('lock_expires_at', now)
        .select('id');
    if (error) {
        console.error('[engagement] sweep failed:', error.message);
        return { swept: 0 };
    }
    return { swept: Array.isArray(data) ? data.length : 0 };
}

module.exports = {
    SCAN_LOCK_LEASE_MS,
    TERMINAL_STATUSES,
    RETRYABLE_ERRORS,
    NEEDS_USER_ACTION_ERRORS,
    classifyScanError,
    claimNextScan,
    reportScanStatus,
    cancelScan,
    recordDiscoveredPosts,
    sweepExpiredScanLocks,
};
