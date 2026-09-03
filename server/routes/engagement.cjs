'use strict';

// Engagement / Opportunities — Phase 1A routes.
//
// Mounted at /api/engagement from server/index.cjs with a single app.use() line.
// It is a self-contained Router: it requires its own dependencies rather than
// receiving them, so mounting it cannot perturb anything already in index.cjs.
//
// PHASE 1A SCOPE: create/list/cancel scans, let a paired worker claim one,
// ingest the posts it found, and report the outcome. There is no extension
// scanner, no DOM parsing, no dashboard UI and no AI in this slice.
//
// Every route is behind two independent feature flags (see isEngagementEnabled).
// With either off, the whole surface answers 404 — an unreleased feature should
// not advertise its own existence.

const express = require('express');
const { supabase } = require('../supabaseClient.cjs');
const {
    requireAuth,
    requireWorkspaceAccess,
    denyDemo,
    scopeToWorkspace,
    workspaceFields,
} = require('../middleware/auth.cjs');
const { requireWorker } = require('../middleware/worker.cjs');
const { normalizeUuid } = require('../lib/ids.cjs');
const { dbFailure } = require('../lib/httpErrors.cjs');
const { persistTenantSystemLog } = require('../lib/logIsolation.cjs');
const {
    claimNextScan,
    reportScanStatus,
    cancelScan,
    recordDiscoveredPosts,
} = require('../lib/engagementQueue.cjs');

const router = express.Router();
const dashboardAuth = [requireAuth, requireWorkspaceAccess];

// Hard backend cap on one ingest call, independent of the per-scan limits. Even
// if a future scan config allows more posts, a single HTTP body stays bounded.
const MAX_POSTS_PER_BATCH = 50;

// Phase 1 product/safety caps. Mirrored by CHECK constraints in migration 0012,
// so a direct database write cannot exceed them either.
const MAX_GROUPS_LIMIT = 5;
const MAX_POSTS_PER_GROUP_LIMIT = 25;

const MAX_NAME_LENGTH = 120;
const MAX_INSTRUCTIONS_LENGTH = 1000;
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

// Fleet-wide kill switch. Absent means OFF — the comparison is against the
// literal 'true', so any other value (including '1' or 'yes') leaves it off.
// A feature this new should fail closed on a typo in an env var.
function isFleetEnabled() {
    return String(process.env.ENGAGEMENT_ENABLED || '').toLowerCase() === 'true';
}

// Both flags must be on. Runs after the auth stack, so req.workspaceId is
// already resolved and verified.
//
// The 404 body is identical whichever flag is off, and identical to a genuinely
// unknown route, so it never reveals that the feature exists but is disabled for
// this particular workspace.
async function requireEngagementEnabled(req, res, next) {
    if (!isFleetEnabled()) return res.status(404).json({ error: 'Not found' });
    if (!req.workspaceId) return res.status(404).json({ error: 'Not found' });

    const { data, error } = await supabase
        .from('workspaces')
        .select('engagement_enabled')
        .eq('id', req.workspaceId)
        .maybeSingle();

    if (error) return dbFailure(res, 'engagement flag lookup', error);
    if (!data || data.engagement_enabled !== true) {
        return res.status(404).json({ error: 'Not found' });
    }
    return next();
}

// Audit helper. Records the event and its identifiers only — never post bodies,
// author names or group content. A scan can discover hundreds of other people's
// posts; those belong in engagement_discovered_posts, not in system_logs, which
// is surfaced in the dashboard log viewer.
async function audit(workspaceId, event, detail = '') {
    try {
        await persistTenantSystemLog(supabase, workspaceId, {
            log_level: 'info',
            source: 'engagement',
            message: detail ? `${event} ${detail}` : event,
        });
    } catch (error) {
        // An audit failure must never turn a successful operation into a failed
        // one, or the caller would retry something that already happened.
        console.error('[engagement] audit write failed:', error?.message || error);
    }
}

const invalidId = (res) => res.status(400).json({ error: 'Invalid id' });

// ---------------------------------------------------------------------------
// Dashboard routes
// ---------------------------------------------------------------------------

// List this workspace's scans, newest first.
router.get('/scans', ...dashboardAuth, requireEngagementEnabled, async (req, res) => {
    const { data, error } = await scopeToWorkspace(
        supabase.from('engagement_scan_tasks')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(MAX_PAGE_SIZE),
        req,
    );
    if (error) return dbFailure(res, 'list engagement scans', error);
    res.json({ scans: data || [] });
});

// Create a scan.
//
// The client sends group IDS ONLY. The server resolves them against this
// workspace's own synced `groups` rows and builds target_groups itself, so a
// caller cannot smuggle in another workspace's group — or an arbitrary Facebook
// URL, which Phase 1 deliberately does not support.
router.post('/scans', ...dashboardAuth, denyDemo, requireEngagementEnabled, async (req, res) => {
    const body = req.body || {};

    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name || name.length > MAX_NAME_LENGTH) {
        return res.status(400).json({ error: `Name is required and must be at most ${MAX_NAME_LENGTH} characters.` });
    }

    const instructions = typeof body.search_instructions === 'string' ? body.search_instructions.trim() : '';
    if (instructions.length > MAX_INSTRUCTIONS_LENGTH) {
        return res.status(400).json({ error: `Search instructions must be at most ${MAX_INSTRUCTIONS_LENGTH} characters.` });
    }

    const maxGroups = body.max_groups === undefined ? 3 : Number(body.max_groups);
    if (!Number.isInteger(maxGroups) || maxGroups < 1 || maxGroups > MAX_GROUPS_LIMIT) {
        return res.status(400).json({ error: `max_groups must be an integer between 1 and ${MAX_GROUPS_LIMIT}.` });
    }

    const maxPosts = body.max_posts_per_group === undefined ? 10 : Number(body.max_posts_per_group);
    if (!Number.isInteger(maxPosts) || maxPosts < 1 || maxPosts > MAX_POSTS_PER_GROUP_LIMIT) {
        return res.status(400).json({ error: `max_posts_per_group must be an integer between 1 and ${MAX_POSTS_PER_GROUP_LIMIT}.` });
    }

    const rawIds = Array.isArray(body.group_ids) ? body.group_ids : null;
    if (!rawIds || rawIds.length === 0) {
        return res.status(400).json({ error: 'group_ids must be a non-empty array.' });
    }
    if (rawIds.length > maxGroups) {
        return res.status(400).json({ error: `Too many groups: ${rawIds.length} supplied but max_groups is ${maxGroups}.` });
    }

    // groups.id is a text column, so there is no numeric/uuid validator to apply;
    // the protection here is that the ids are looked up inside this workspace and
    // anything that does not resolve is rejected.
    const groupIds = [];
    for (const value of rawIds) {
        const id = typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
        if (!id) return res.status(400).json({ error: 'group_ids contains an invalid entry.' });
        if (!groupIds.includes(id)) groupIds.push(id);
    }

    const facebookUser = typeof body.facebook_user === 'string' && body.facebook_user.trim()
        ? body.facebook_user.trim()
        : null;

    let groupQuery = supabase.from('groups').select('id, name, url').in('id', groupIds);
    groupQuery = scopeToWorkspace(groupQuery, req);
    if (facebookUser) groupQuery = groupQuery.eq('facebook_user', facebookUser);
    const { data: groups, error: groupError } = await groupQuery;

    if (groupError) return dbFailure(res, 'resolve engagement groups', groupError);

    const resolved = groups || [];
    if (resolved.length !== groupIds.length) {
        // Deliberately does not name which ids were missing: that would let a
        // caller probe which group ids exist in other workspaces.
        return res.status(400).json({
            error: 'One or more groups were not found in this workspace.',
            requested: groupIds.length,
            resolved: resolved.length,
        });
    }

    const insert = {
        ...workspaceFields(req),
        name,
        status: 'QUEUED',
        target_groups: resolved.map(g => ({ id: g.id, name: g.name, url: g.url })),
        search_instructions: instructions || null,
        max_groups: maxGroups,
        max_posts_per_group: maxPosts,
        facebook_user: facebookUser,
    };

    const { data: created, error: insertError } = await supabase
        .from('engagement_scan_tasks')
        .insert(insert)
        .select('*')
        .single();

    if (insertError) return dbFailure(res, 'create engagement scan', insertError);

    await audit(req.workspaceId, 'ENGAGEMENT_SCAN_CREATED',
        `scan=${created.id} groups=${resolved.length} max_posts=${maxPosts}`);

    res.status(201).json({ scan: created });
});

// Fetch one scan.
router.get('/scans/:id', ...dashboardAuth, requireEngagementEnabled, async (req, res) => {
    const id = normalizeUuid(req.params.id);
    if (!id) return invalidId(res);

    const { data, error } = await scopeToWorkspace(
        supabase.from('engagement_scan_tasks').select('*').eq('id', id), req,
    ).maybeSingle();

    if (error) return dbFailure(res, 'fetch engagement scan', error);
    if (!data) return res.status(404).json({ error: 'Scan not found.' });
    res.json({ scan: data });
});

// Cancel a scan that has not finished.
router.post('/scans/:id/cancel', ...dashboardAuth, denyDemo, requireEngagementEnabled, async (req, res) => {
    const id = normalizeUuid(req.params.id);
    if (!id) return invalidId(res);

    const result = await cancelScan({ scanId: id, workspaceId: req.workspaceId });
    if (!result.ok) {
        if (result.code === 404) return res.status(404).json({ error: 'Scan not found.' });
        return res.status(result.code || 400).json({ error: 'Cancel rejected.' });
    }

    if (!result.alreadyFinal) {
        await audit(req.workspaceId, 'ENGAGEMENT_SCAN_CANCELLED', `scan=${id}`);
    }
    res.json({ success: true, status: result.status, already_final: Boolean(result.alreadyFinal) });
});

// List discovered posts for this workspace, newest first.
router.get('/discovered', ...dashboardAuth, requireEngagementEnabled, async (req, res) => {
    const rawLimit = Number(req.query.limit);
    const limit = Number.isInteger(rawLimit) && rawLimit > 0
        ? Math.min(rawLimit, MAX_PAGE_SIZE)
        : DEFAULT_PAGE_SIZE;
    const rawOffset = Number(req.query.offset);
    const offset = Number.isInteger(rawOffset) && rawOffset > 0 ? rawOffset : 0;

    let query = supabase.from('engagement_discovered_posts')
        .select('*')
        .order('discovered_at', { ascending: false })
        .range(offset, offset + limit - 1);

    // Optional filter by scan. Validated before it can reach PostgREST, so a
    // malformed value is a 400 here rather than a driver error downstream.
    if (req.query.scan_task_id !== undefined) {
        const scanId = normalizeUuid(req.query.scan_task_id);
        if (!scanId) return invalidId(res);
        query = query.eq('scan_task_id', scanId);
    }
    if (typeof req.query.group_id === 'string' && req.query.group_id.trim()) {
        query = query.eq('facebook_group_id', req.query.group_id.trim());
    }

    const { data, error } = await scopeToWorkspace(query, req);
    if (error) return dbFailure(res, 'list discovered posts', error);
    res.json({ posts: data || [], limit, offset });
});

// ---------------------------------------------------------------------------
// Worker routes
//
// req.workspaceId is set by requireWorker from the VERIFIED device token. The
// x-workspace-id header is never consulted on these routes.
// ---------------------------------------------------------------------------

// Claim the next queued scan in this worker's own workspace.
router.post('/scans/claim', requireWorker, requireEngagementEnabled, async (req, res) => {
    const scan = await claimNextScan({ workspaceId: req.workspaceId, workerId: req.worker.id });
    if (!scan) return res.json({ scan: null });

    await audit(req.workspaceId, 'ENGAGEMENT_SCAN_CLAIMED', `scan=${scan.id} worker=${req.worker.id}`);
    res.json({ scan });
});

// Ingest a batch of discovered posts.
//
// post_text truncation and the dedup key are computed server-side in
// recordDiscoveredPosts(); nothing the worker sends for those is trusted.
router.post('/scans/:id/posts', requireWorker, requireEngagementEnabled, async (req, res) => {
    const id = normalizeUuid(req.params.id);
    if (!id) return invalidId(res);

    const posts = Array.isArray(req.body?.posts) ? req.body.posts : null;
    if (!posts || posts.length === 0) {
        return res.status(400).json({ error: 'posts must be a non-empty array.' });
    }
    if (posts.length > MAX_POSTS_PER_BATCH) {
        // Only the count is echoed; the submitted content is never reflected back.
        return res.status(400).json({
            error: `Too many posts. Send at most ${MAX_POSTS_PER_BATCH} per request.`,
            max_batch: MAX_POSTS_PER_BATCH,
            received: posts.length,
        });
    }

    const result = await recordDiscoveredPosts({
        scanId: id,
        workspaceId: req.workspaceId,
        workerId: req.worker.id,
        posts,
    });

    if (!result.ok) {
        if (result.code === 404) return res.status(404).json({ error: 'Scan not found.' });
        if (result.code === 409) return res.status(409).json({ error: 'Scan is not running.' });
        return res.status(result.code || 400).json({ error: 'Ingest rejected.' });
    }

    res.json({
        success: true,
        received: result.received,
        stored: result.stored,
        duplicates: result.duplicates,
        total_for_scan: result.total_for_scan,
    });
});

// Terminal report for a scan.
router.post('/scans/:id/status', requireWorker, requireEngagementEnabled, async (req, res) => {
    const id = normalizeUuid(req.params.id);
    if (!id) return invalidId(res);

    const { status, error_code, failure_reason, groups_scanned } = req.body || {};
    const groupsScanned = Number.isInteger(Number(groups_scanned)) && Number(groups_scanned) >= 0
        ? Number(groups_scanned)
        : null;

    const result = await reportScanStatus({
        scanId: id,
        workspaceId: req.workspaceId,
        workerId: req.worker.id,
        status,
        errorCode: typeof error_code === 'string' ? error_code : null,
        failureReason: typeof failure_reason === 'string' ? failure_reason.slice(0, 500) : null,
        groupsScanned,
    });

    if (!result.ok) {
        if (result.code === 404) return res.status(404).json({ error: 'Scan not found.' });
        return res.status(result.code || 400).json({ error: 'Status update rejected.' });
    }

    if (!result.duplicate) {
        const event = result.status === 'COMPLETED' ? 'ENGAGEMENT_SCAN_COMPLETED'
            : result.status === 'QUEUED' ? 'ENGAGEMENT_SCAN_RETRY_QUEUED'
                : 'ENGAGEMENT_SCAN_FAILED';
        await audit(req.workspaceId, event,
            `scan=${id} status=${result.status}${error_code ? ` code=${error_code}` : ''}`);
    }

    res.json({ success: true, status: result.status, retried: Boolean(result.retried) });
});

module.exports = router;
module.exports.MAX_POSTS_PER_BATCH = MAX_POSTS_PER_BATCH;
module.exports.MAX_GROUPS_LIMIT = MAX_GROUPS_LIMIT;
module.exports.MAX_POSTS_PER_GROUP_LIMIT = MAX_POSTS_PER_GROUP_LIMIT;
