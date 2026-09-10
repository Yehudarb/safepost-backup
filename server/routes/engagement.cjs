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
const { requireEngagementExtensionVersion } = require('../lib/extensionVersion.cjs');
const {
    claimNextScan,
    reportScanStatus,
    cancelScan,
    recordDiscoveredPosts,
} = require('../lib/engagementQueue.cjs');
const watchService = require('../services/engagementWatch.service.cjs');
const { matchText } = require('../lib/engagementMatcher.cjs');
const { bufferedCandidateCount } = require('../services/engagementRetention.service.cjs');
const { ingestCandidates, updateScanCoverage } = require('../services/engagementIngest.service.cjs');

const router = express.Router();
const dashboardAuth = [requireAuth, requireWorkspaceAccess];

// Hard backend cap on one ingest call, independent of the per-scan limits. Even
// if a future scan config allows more posts, a single HTTP body stays bounded.
const MAX_POSTS_PER_BATCH = 50;

// Phase 1 product/safety caps. The database retains a broader legacy ceiling,
// while this controlled API matches the scanner and dashboard limit.
const MAX_GROUPS_LIMIT = 5;
const MAX_POSTS_PER_GROUP_LIMIT = 10;

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

// Explicit column list for DASHBOARD responses.
//
// facebook_user_id is deliberately absent. It is a real Facebook account
// identifier used for internal consistency checks; the dashboard has no need
// for it, and select('*') was returning it on every scan listing and detail
// fetch. Worker routes still receive it, because the extension must compare it.
const DASHBOARD_SCAN_FIELDS = [
    'id', 'workspace_id', 'created_by', 'name', 'status',
    'target_groups', 'search_instructions', 'max_groups', 'max_posts_per_group',
    'facebook_user', 'worker_id', 'claimed_at', 'lock_expires_at',
    'attempt_count', 'max_attempts', 'error_code', 'failure_reason',
    'groups_scanned', 'posts_discovered', 'created_at', 'started_at', 'completed_at',
].join(', ');

const DASHBOARD_DISCOVERED_FIELDS = [
    'id', 'scan_task_id', 'facebook_group_id', 'facebook_group_name',
    'facebook_post_id', 'facebook_post_url', 'author_name', 'author_profile_url',
    'post_text', 'is_truncated', 'posted_at', 'posted_at_raw', 'discovered_at',
].join(', ');

// What the user is told about a terminal scan.
//
// The stored failure_reason names internal strategies and signals
// ("strategy=legacy_identity_bind;signal=not_a_member"). That is the right
// thing to keep for debugging and the wrong thing to render, so the dashboard
// is given this mapping instead and never the raw string.
const SCAN_REASON_SUMMARY = {
    FACEBOOK_IDENTITY_UNVERIFIED:
        'Could not confirm that this Facebook account belongs to the selected group. The scan stopped before reading anything.',
    FACEBOOK_IDENTITY_MISMATCH:
        'The Facebook account signed in right now is not the account this group belongs to.',
    CAPTCHA_REQUIRED:
        'Facebook asked for a security check. Complete it in the browser, then run the scan again.',
    CHECKPOINT_REQUIRED:
        'Facebook needs something confirmed on the account before automation can continue.',
    FACEBOOK_LOGGED_OUT: 'The browser is signed out of Facebook.',
    ACCOUNT_RESTRICTED: 'Facebook has restricted this account.',
    GROUP_NOT_FOUND: 'That group could not be opened.',
    NO_GROUP_ACCESS: 'This account cannot view that group.',
    PAGE_LOAD_TIMEOUT: 'The group page did not finish loading.',
    NETWORK_TIMEOUT: 'The connection to Facebook timed out.',
    TEMPORARY_SERVER_ERROR: 'A temporary server error interrupted the scan. Try again later.',
    WORKER_DISCONNECTED: 'The paired browser extension went offline before the scan finished.',
    NO_POSTS_FOUND: 'The scan completed, but no top-level posts were found.',
    SCAN_PREEMPTED_BY_PUBLISH:
        'Paused so a scheduled post could publish. The scan returns to the queue on its own.',
    PARSER_NO_STRATEGY_MATCHED:
        'Facebook changed the page layout and the scanner could not read it.',
    INVALID_SCAN_TASK: 'This scan request was not valid.',
    SCAN_LOCK_EXPIRED: 'The browser extension stopped responding while the scan was running.',
};

// The five states the dashboard distinguishes.
function scanUiState(scan) {
    if (!scan) return 'NONE';
    if (scan.status === 'QUEUED') return 'QUEUED';
    if (scan.status === 'RUNNING') return 'RUNNING';
    if (scan.status === 'COMPLETED' ||
        (scan.status === 'FAILED' && scan.error_code === 'NO_POSTS_FOUND')) return 'COMPLETED';
    if (scan.status === 'ABORTED') {
        return scan.error_code === 'FACEBOOK_IDENTITY_UNVERIFIED' ||
            scan.error_code === 'FACEBOOK_IDENTITY_MISMATCH'
            ? 'BLOCKED'
            : 'ABORTED';
    }
    if (scan.status === 'CANCELLED') return 'CANCELLED';
    return 'FAILED';
}

function scanSummary(scan) {
    if (!scan) return null;
    const group = Array.isArray(scan.target_groups) ? scan.target_groups[0] : null;
    return {
        id: scan.id,
        name: scan.name,
        status: scan.status,
        ui_state: scanUiState(scan),
        error_code: scan.error_code || null,
        // Mapped text only. failure_reason is deliberately not forwarded.
        reason_summary: scan.error_code
            ? (SCAN_REASON_SUMMARY[scan.error_code] || 'The scan stopped before finishing.')
            : null,
        target_groups: Array.isArray(scan.target_groups)
            ? scan.target_groups.map(item => ({
                id: item?.id ?? null,
                name: typeof item?.name === 'string' ? item.name : null,
                url: typeof item?.url === 'string' ? item.url : null,
            }))
            : [],
        group_name: group && typeof group.name === 'string' ? group.name : null,
        search_instructions: typeof scan.search_instructions === 'string' ? scan.search_instructions : null,
        max_groups: scan.max_groups,
        max_posts_per_group: scan.max_posts_per_group,
        groups_scanned: scan.groups_scanned ?? 0,
        posts_discovered: scan.posts_discovered ?? 0,
        created_at: scan.created_at,
        started_at: scan.started_at || null,
        completed_at: scan.completed_at || null,
    };
}

const invalidId = (res) => res.status(400).json({ error: 'Invalid id' });

function isMissingFacebookIdentityColumn(error) {
    const detail = `${error?.code || ''} ${error?.message || ''}`;
    return /facebook_user_id/i.test(detail) && /column|schema cache|PGRST/i.test(detail);
}

// ---------------------------------------------------------------------------
// Dashboard routes
// ---------------------------------------------------------------------------

// Dashboard summary. This is the ONE engagement route that answers while the
// workspace flag is off, because the dashboard has to be able to render
// "Engagement is off for this workspace". The fleet kill switch still hides the
// feature completely: with it off this 404s like everything else.
router.get('/status', ...dashboardAuth, async (req, res) => {
    if (!isFleetEnabled()) return res.status(404).json({ error: 'Not found' });
    if (!req.workspaceId) return res.status(404).json({ error: 'Not found' });

    const { data: workspace, error: flagError } = await supabase
        .from('workspaces')
        .select('engagement_enabled')
        .eq('id', req.workspaceId)
        .maybeSingle();
    if (flagError) return dbFailure(res, 'engagement status flag', flagError);

    const enabled = Boolean(workspace && workspace.engagement_enabled === true);
    if (!enabled) {
        return res.json({ enabled: false, latest_scan: null, discovered_count: 0, active_scan: false });
    }

    const { data: scans, error: scanError } = await scopeToWorkspace(
        supabase.from('engagement_scan_tasks')
            .select(DASHBOARD_SCAN_FIELDS)
            .order('created_at', { ascending: false })
            .limit(1),
        req,
    );
    if (scanError) return dbFailure(res, 'engagement status scan', scanError);

    const { count, error: countError } = await scopeToWorkspace(
        supabase.from('engagement_discovered_posts').select('id', { count: 'exact', head: true }),
        req,
    );
    if (countError) return dbFailure(res, 'engagement status count', countError);

    const { count: activeCount, error: activeError } = await scopeToWorkspace(
        supabase.from('engagement_scan_tasks')
            .select('id', { count: 'exact', head: true })
            .in('status', ['QUEUED', 'RUNNING']),
        req,
    );
    if (activeError) return dbFailure(res, 'engagement status active', activeError);

    res.json({
        enabled: true,
        latest_scan: scanSummary((scans || [])[0]),
        discovered_count: count || 0,
        active_scan: (activeCount || 0) > 0,
    });
});

router.get('/scans', ...dashboardAuth, requireEngagementEnabled, async (req, res) => {
    const { data, error } = await scopeToWorkspace(
        supabase.from('engagement_scan_tasks')
            .select(DASHBOARD_SCAN_FIELDS)
            .order('created_at', { ascending: false })
            .limit(MAX_PAGE_SIZE),
        req,
    );
    if (error) return dbFailure(res, 'list engagement scans', error);
    // `summaries` is what the dashboard renders: same rows, mapped to UI states
    // and user-facing text, with no internal reason strings.
    const summaries = (data || []).map(scanSummary);
    res.json({ scans: summaries, summaries });
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

    let groupQuery = supabase.from('groups').select('id, name, url, facebook_user_id').in('id', groupIds);
    groupQuery = scopeToWorkspace(groupQuery, req);
    if (facebookUser) groupQuery = groupQuery.eq('facebook_user', facebookUser);
    let { data: groups, error: groupError } = await groupQuery;

    // Keep the API deployable before migration 0013 reaches a database. The
    // resulting task deliberately has no stable identity and the extension's
    // fail-closed guard will abort it before opening Facebook.
    let identityColumnAvailable = true;
    if (isMissingFacebookIdentityColumn(groupError)) {
        identityColumnAvailable = false;
        groupQuery = supabase.from('groups').select('id, name, url').in('id', groupIds);
        groupQuery = scopeToWorkspace(groupQuery, req);
        if (facebookUser) groupQuery = groupQuery.eq('facebook_user', facebookUser);
        ({ data: groups, error: groupError } = await groupQuery);
    }

    if (groupError) return dbFailure(res, 'resolve engagement groups', groupError);

    // Resolve BY GROUP ID rather than by row count. Migration 0014 makes a
    // second row per (workspace_id, id) impossible, but counting rows was the
    // wrong test even so: if duplicates ever exist, `resolved.length !==
    // groupIds.length` reports "not found" for groups that were found twice,
    // which is both misleading and unfixable by the user.
    const byGroupId = new Map();
    for (const group of groups || []) {
        const existing = byGroupId.get(group.id);
        // Deterministic collapse: a row carrying a verified account id wins, so
        // the choice does not depend on row order.
        if (!existing || (!existing.facebook_user_id && group.facebook_user_id)) {
            byGroupId.set(group.id, group);
        }
    }

    const missing = groupIds.filter(id => !byGroupId.has(id));
    if (missing.length) {
        // Deliberately does not name which ids were missing: that would let a
        // caller probe which group ids exist in other workspaces.
        return res.status(400).json({
            error: 'One or more groups were not found in this workspace.',
            requested: groupIds.length,
            resolved: byGroupId.size,
        });
    }
    const resolved = groupIds.map(id => byGroupId.get(id));

    const stableIds = [...new Set(resolved
        .map(group => typeof group.facebook_user_id === 'string' ? group.facebook_user_id.trim() : '')
        .filter(id => /^\d{3,30}$/.test(id)))];
    if (stableIds.length > 1) {
        // Two verified accounts in one selection is a real conflict, not
        // something to resolve silently.
        return res.status(409).json({
            error: 'Selected groups do not share one verified Facebook account. Sync the groups again before scanning.',
        });
    }
    // A selection mixing one verified id with not-yet-bound groups keeps that id:
    // the scan must match it, and the unbound rows are upgraded to it afterwards.
    const facebookUserId = stableIds[0] || null;

    const insert = {
        ...workspaceFields(req),
        name,
        status: 'QUEUED',
        target_groups: resolved.map(g => ({ id: g.id, name: g.name, url: g.url })),
        search_instructions: instructions || null,
        max_groups: maxGroups,
        max_posts_per_group: maxPosts,
        facebook_user: facebookUser,
        ...(identityColumnAvailable ? { facebook_user_id: facebookUserId } : {}),
    };

    const { data: created, error: insertError } = await supabase
        .from('engagement_scan_tasks')
        .insert(insert)
        .select(DASHBOARD_SCAN_FIELDS)
        .single();

    if (insertError) return dbFailure(res, 'create engagement scan', insertError);

    await audit(req.workspaceId, 'ENGAGEMENT_SCAN_CREATED',
        `scan=${created.id} groups=${resolved.length} max_posts=${maxPosts}`);

    res.status(201).json({ scan: scanSummary(created) });
});

// Fetch one scan.
router.get('/scans/:id', ...dashboardAuth, requireEngagementEnabled, async (req, res) => {
    const id = normalizeUuid(req.params.id);
    if (!id) return invalidId(res);

    const { data, error } = await scopeToWorkspace(
        supabase.from('engagement_scan_tasks').select(DASHBOARD_SCAN_FIELDS).eq('id', id), req,
    ).maybeSingle();

    if (error) return dbFailure(res, 'fetch engagement scan', error);
    if (!data) return res.status(404).json({ error: 'Scan not found.' });
    res.json({ scan: scanSummary(data) });
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
        .select(DASHBOARD_DISCOVERED_FIELDS)
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
router.post('/scans/claim', requireWorker, requireEngagementEnabled, requireEngagementExtensionVersion, async (req, res) => {
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
        claimStartedAt: typeof req.body?.claim_started_at === 'string'
            ? req.body.claim_started_at
            : null,
        posts,
    });

    if (!result.ok) {
        if (result.code === 404) return res.status(404).json({ error: 'Scan not found.' });
        if (result.code === 409) return res.status(409).json({ error: 'Scan is not running.' });
        return res.status(result.code || 400).json({ error: 'Ingest rejected.' });
    }

    // ---- Phase 2A pipeline, deliberately after Phase 1 has already succeeded.
    //
    // Buffer the batch, match it against this workspace's enabled watches, and
    // promote only the matches. Wrapped so that a Phase 2A fault degrades to
    // "no opportunities produced" and can never turn a successful Phase 1 ingest
    // into an error the worker would see as a failed upload.
    let discovery = null;
    try {
        const ingest = await ingestCandidates({
            scanId: id,
            workspaceId: req.workspaceId,
            posts,
        });
        if (ingest.counters) {
            await updateScanCoverage({
                scanId: id,
                workspaceId: req.workspaceId,
                counters: ingest.counters,
            });
        }
        if (ingest.error) {
            // Counts and a message only; no post or comment text is ever logged.
            console.warn('[engagement] candidate pipeline degraded:', ingest.error);
        }
        discovery = {
            candidates: ingest.candidates,
            opportunities: ingest.opportunities,
            partial_comment_coverage: true,
        };
    } catch (error) {
        console.warn('[engagement] candidate pipeline failed:', error?.message || 'unknown');
    }

    // Phase 1's four fields are unchanged in name, type and meaning. `discovery`
    // is additive, so an older worker that ignores it behaves exactly as before.
    res.json({
        success: true,
        received: result.received,
        stored: result.stored,
        duplicates: result.duplicates,
        total_for_scan: result.total_for_scan,
        ...(discovery ? { discovery } : {}),
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
        claimStartedAt: typeof req.body?.claim_started_at === 'string'
            ? req.body.claim_started_at
            : null,
        status,
        errorCode: typeof error_code === 'string' ? error_code : null,
        failureReason: typeof failure_reason === 'string' ? failure_reason.slice(0, 500) : null,
        groupsScanned,
    });

    if (!result.ok) {
        if (result.code === 404) return res.status(404).json({ error: 'Scan not found.' });
        if (result.reason === 'STALE_SCAN_CLAIM') {
            await audit(req.workspaceId, 'STALE_SCAN_CLAIM',
                `scan=${id} worker=${req.worker.id} status=${status || 'unknown'}`);
            return res.status(409).json({ error: 'Stale scan claim.', code: 'STALE_SCAN_CLAIM' });
        }
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

// Bind the verified Facebook account id to a scan and to the groups it targets.
//
// This is the one-time upgrade path for datasets synced before migration 0013,
// which have no stored account id. The extension reads the live c_user from the
// group page it already opened and reports it here.
//
// The BACKEND stays authoritative. The extension supplies an observation, not a
// decision: the workspace comes from the verified device token, the scan must
// belong to it, only the groups that scan targets are touched, and an existing
// verified id is never overwritten — a different one is a conflict, because two
// accounts claiming the same group means something is wrong that a write would
// hide rather than fix.
router.post('/scans/:id/bind-identity', requireWorker, requireEngagementEnabled, async (req, res) => {
    const id = normalizeUuid(req.params.id);
    if (!id) return invalidId(res);

    const raw = req.body?.facebook_user_id;
    const facebookUserId = typeof raw === 'string' || typeof raw === 'number' ? String(raw).trim() : '';
    if (!/^\d{3,30}$/.test(facebookUserId)) {
        return res.status(400).json({ error: 'Invalid facebook_user_id' });
    }

    // Owning the workspace is not evidence of owning the group. The caller must
    // assert that the Facebook page itself proved this account is a member of the
    // targeted group, and name the strategy that proved it, so an unevidenced
    // bind is refused here as well as in the extension.
    if (req.body?.membership_verified !== true) {
        return res.status(400).json({ error: 'Group membership was not verified for this account.' });
    }
    const evidenceStrategy = typeof req.body?.evidence_strategy === 'string'
        ? req.body.evidence_strategy.trim().slice(0, 64)
        : '';
    if (!/^[a-z0-9_]{3,64}$/i.test(evidenceStrategy)) {
        return res.status(400).json({ error: 'Invalid evidence_strategy' });
    }

    const { data: scan, error: scanError } = await supabase
        .from('engagement_scan_tasks')
        .select('id, status, worker_id, facebook_user_id, target_groups')
        .eq('id', id)
        .eq('workspace_id', req.workspaceId)
        .maybeSingle();

    if (scanError) return dbFailure(res, 'bind engagement identity', scanError);
    if (!scan) return res.status(404).json({ error: 'Scan not found.' });
    // Only the worker holding the lease may bind, and only while it is running.
    if (scan.worker_id && scan.worker_id !== req.worker.id) {
        return res.status(404).json({ error: 'Scan not found.' });
    }
    if (scan.status !== 'RUNNING') {
        return res.status(409).json({ error: 'Scan is not running.' });
    }

    if (scan.facebook_user_id && scan.facebook_user_id !== facebookUserId) {
        return res.status(409).json({
            error: 'Scan is already bound to a different Facebook account.',
        });
    }

    const targetGroupIds = Array.isArray(scan.target_groups)
        ? scan.target_groups
            .map(group => (typeof group?.id === 'string' || typeof group?.id === 'number' ? String(group.id).trim() : ''))
            .filter(Boolean)
        : [];
    if (!targetGroupIds.length) {
        return res.status(409).json({ error: 'Scan has no resolvable target groups.' });
    }

    // Refuse if any targeted group already carries a DIFFERENT verified account.
    const { data: groups, error: groupError } = await supabase
        .from('groups')
        .select('id, facebook_user_id')
        .eq('workspace_id', req.workspaceId)
        .in('id', targetGroupIds);
    if (groupError) return dbFailure(res, 'bind engagement identity groups', groupError);

    const conflicting = (groups || []).filter(group =>
        group.facebook_user_id && group.facebook_user_id !== facebookUserId);
    if (conflicting.length) {
        return res.status(409).json({
            error: 'One or more groups are already bound to a different Facebook account.',
        });
    }

    // Fill only the empty ones. `.is('facebook_user_id', null)` keeps this from
    // ever rewriting a verified value, even under a concurrent bind.
    const { data: boundGroups, error: bindGroupsError } = await supabase
        .from('groups')
        .update({ facebook_user_id: facebookUserId })
        .eq('workspace_id', req.workspaceId)
        .in('id', targetGroupIds)
        .is('facebook_user_id', null)
        .select('id');
    if (bindGroupsError) return dbFailure(res, 'bind engagement identity groups write', bindGroupsError);

    const { error: bindScanError } = await supabase
        .from('engagement_scan_tasks')
        .update({ facebook_user_id: facebookUserId })
        .eq('id', id)
        .eq('workspace_id', req.workspaceId)
        .is('facebook_user_id', null);
    if (bindScanError) return dbFailure(res, 'bind engagement identity scan write', bindScanError);

    // The account id itself is never logged — only how many rows were upgraded
    // and which page evidence authorised the bind.
    await audit(req.workspaceId, 'ENGAGEMENT_IDENTITY_BOUND',
        `scan=${id} groups=${Array.isArray(boundGroups) ? boundGroups.length : 0} evidence=${evidenceStrategy}`);

    res.json({ success: true, bound_groups: Array.isArray(boundGroups) ? boundGroups.length : 0 });
});


// ---------------------------------------------------------------------------
// Phase 2A — Watches, Preview and Opportunities.
//
// Additive: every Phase 1 route above keeps its path, method and response
// shape. These sit behind the same two feature flags and the same dashboard
// auth stack, so nothing here can be reached with either gate off.
// ---------------------------------------------------------------------------

const OPPORTUNITY_FIELDS = [
    'id', 'workspace_id', 'watch_id', 'scan_task_id', 'source_type',
    'facebook_group_id', 'source_id', 'parent_source_id', 'parent_dedup_key', 'source_url',
    'excerpt', 'parent_excerpt', 'author_name',
    'matched_terms', 'matched_phrase', 'match_mode', 'match_reason',
    'relevance', 'review_state', 'dedup_key', 'discovered_at',
].join(', ');

// A watch id that does not resolve inside this workspace answers 404, never 403.
// A 403 would confirm the id exists somewhere, which is a cross-tenant hint.
function watchNotFound(res) {
    return res.status(404).json({ error: 'Not found' });
}

function validationFailed(res, error) {
    if (error && error.name === 'ValidationError') {
        return res.status(400).json({ error: error.message });
    }
    return null;
}

router.get('/watches', ...dashboardAuth, requireEngagementEnabled, async (req, res) => {
    const { data, error } = await watchService.listWatches(req.workspaceId);
    if (error) return dbFailure(res, 'list engagement watches', error);
    res.json({ watches: data || [] });
});

router.post('/watches', ...dashboardAuth, denyDemo, requireEngagementEnabled, async (req, res) => {
    let result;
    try {
        result = await watchService.createWatch(req.workspaceId, req.user?.id, req.body || {});
    } catch (error) {
        const handled = validationFailed(res, error);
        if (handled) return handled;
        throw error;
    }
    if (result.error) return dbFailure(res, 'create engagement watch', result.error);
    // Counts only. The query text is a workspace's commercial intent and never
    // reaches a log line.
    await audit(req.workspaceId, 'ENGAGEMENT_WATCH_CREATED',
        `watch=${result.data.id} mode=${result.data.match_mode} groups=${(result.data.selected_group_ids || []).length}`);
    res.status(201).json({ watch: result.data });
});

router.patch('/watches/:id', ...dashboardAuth, denyDemo, requireEngagementEnabled, async (req, res) => {
    const id = normalizeUuid(req.params.id);
    if (!id) return invalidId(res);
    let result;
    try {
        result = await watchService.updateWatch(req.workspaceId, id, req.body || {});
    } catch (error) {
        const handled = validationFailed(res, error);
        if (handled) return handled;
        throw error;
    }
    if (result.error) return dbFailure(res, 'update engagement watch', result.error);
    if (!result.data) return watchNotFound(res);
    res.json({ watch: result.data });
});

router.delete('/watches/:id', ...dashboardAuth, denyDemo, requireEngagementEnabled, async (req, res) => {
    const id = normalizeUuid(req.params.id);
    if (!id) return invalidId(res);
    const { data, error } = await watchService.deleteWatch(req.workspaceId, id);
    if (error) return dbFailure(res, 'delete engagement watch', error);
    if (!data) return watchNotFound(res);
    res.json({ success: true });
});

// Preview: run the matcher over what this workspace already has buffered.
//
// This route performs NO Facebook contact of any kind. It exists so a user can
// tune a query against real scanned data with instant feedback and without
// asking the extension to visit a group again. It persists nothing.
router.post('/watches/:id/preview', ...dashboardAuth, requireEngagementEnabled, async (req, res) => {
    const id = normalizeUuid(req.params.id);
    if (!id) return invalidId(res);

    const { data: watch, error: watchError } = await watchService.getWatch(req.workspaceId, id);
    if (watchError) return dbFailure(res, 'load engagement watch', watchError);
    if (!watch) return watchNotFound(res);

    const rawLimit = Number(req.query.limit);
    const limit = Number.isInteger(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, MAX_PAGE_SIZE) : DEFAULT_PAGE_SIZE;

    let query = supabase.from('engagement_scan_candidates')
        .select('id, source_type, dedup_key, parent_dedup_key, facebook_group_id, source_id, source_url, author_name, content, discovered_at')
        .order('discovered_at', { ascending: false })
        .limit(limit);
    if (!watch.include_posts) query = query.neq('source_type', 'post');
    if (!watch.include_comments) query = query.neq('source_type', 'comment');

    const { data: candidates, error } = await scopeToWorkspace(query, req);
    if (error) return dbFailure(res, 'preview engagement watch', error);

    const matcherWatch = watchService.toMatcherWatch(watch);
    const matches = [];
    for (const candidate of candidates || []) {
        const verdict = matchText(candidate.content, matcherWatch, { sourceType: candidate.source_type });
        if (!verdict.matched) continue;
        matches.push({
            source_type: candidate.source_type,
            facebook_group_id: candidate.facebook_group_id,
            source_url: candidate.source_url,
            author_name: candidate.author_name,
            excerpt: verdict.excerpt,
            matched_terms: verdict.matchedTerms,
            matched_phrase: verdict.matchedPhrase,
            match_reason: verdict.matchReason,
            relevance: verdict.relevance,
        });
    }

    const { count: buffered } = await bufferedCandidateCount(req.workspaceId);
    res.json({
        examined: (candidates || []).length,
        matched: matches.length,
        buffered_total: buffered,
        // Comment coverage is always partial: SafePost reads only what Facebook
        // had already rendered and never expands a thread.
        partial_comment_coverage: true,
        matches,
    });
});

router.get('/opportunities', ...dashboardAuth, requireEngagementEnabled, async (req, res) => {
    const rawLimit = Number(req.query.limit);
    const limit = Number.isInteger(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, MAX_PAGE_SIZE) : DEFAULT_PAGE_SIZE;
    const rawOffset = Number(req.query.offset);
    const offset = Number.isInteger(rawOffset) && rawOffset > 0 ? rawOffset : 0;

    let query = supabase.from('engagement_opportunities')
        .select(OPPORTUNITY_FIELDS)
        .order('discovered_at', { ascending: false })
        .range(offset, offset + limit - 1);

    if (req.query.watch_id !== undefined) {
        const watchId = normalizeUuid(req.query.watch_id);
        if (!watchId) return invalidId(res);
        query = query.eq('watch_id', watchId);
    }
    if (req.query.source_type === 'post' || req.query.source_type === 'comment') {
        query = query.eq('source_type', req.query.source_type);
    }
    if (['exact', 'strong', 'possible'].includes(req.query.relevance)) {
        query = query.eq('relevance', req.query.relevance);
    }
    if (['new', 'saved', 'dismissed'].includes(req.query.review_state)) {
        query = query.eq('review_state', req.query.review_state);
    }
    if (typeof req.query.group_id === 'string' && req.query.group_id.trim()) {
        query = query.eq('facebook_group_id', req.query.group_id.trim());
    }

    const { data, error } = await scopeToWorkspace(query, req);
    if (error) return dbFailure(res, 'list engagement opportunities', error);
    res.json({ opportunities: data || [], limit, offset, partial_comment_coverage: true });
});

router.get('/opportunities/:id', ...dashboardAuth, requireEngagementEnabled, async (req, res) => {
    const id = normalizeUuid(req.params.id);
    if (!id) return invalidId(res);
    const { data, error } = await scopeToWorkspace(
        supabase.from('engagement_opportunities').select(OPPORTUNITY_FIELDS).eq('id', id).maybeSingle(), req);
    if (error) return dbFailure(res, 'load engagement opportunity', error);
    if (!data) return watchNotFound(res);
    res.json({ opportunity: data });
});

router.patch('/opportunities/:id', ...dashboardAuth, denyDemo, requireEngagementEnabled, async (req, res) => {
    const id = normalizeUuid(req.params.id);
    if (!id) return invalidId(res);
    const state = req.body?.review_state;
    if (!['new', 'saved', 'dismissed'].includes(state)) {
        return res.status(400).json({ error: 'review_state must be new, saved or dismissed.' });
    }
    const { data, error } = await supabase.from('engagement_opportunities')
        .update({ review_state: state })
        .eq('workspace_id', req.workspaceId).eq('id', id)
        .select(OPPORTUNITY_FIELDS).maybeSingle();
    if (error) return dbFailure(res, 'update engagement opportunity', error);
    if (!data) return watchNotFound(res);
    res.json({ opportunity: data });
});

// Deleting an opportunity removes the stored third-party excerpt as well as the
// match — it is the manual erasure path, not an archive flag.
router.delete('/opportunities/:id', ...dashboardAuth, denyDemo, requireEngagementEnabled, async (req, res) => {
    const id = normalizeUuid(req.params.id);
    if (!id) return invalidId(res);
    const { data, error } = await supabase.from('engagement_opportunities')
        .delete().eq('workspace_id', req.workspaceId).eq('id', id)
        .select('id').maybeSingle();
    if (error) return dbFailure(res, 'delete engagement opportunity', error);
    if (!data) return watchNotFound(res);
    res.json({ success: true });
});

module.exports = router;
module.exports.MAX_POSTS_PER_BATCH = MAX_POSTS_PER_BATCH;
module.exports.MAX_GROUPS_LIMIT = MAX_GROUPS_LIMIT;
module.exports.MAX_POSTS_PER_GROUP_LIMIT = MAX_POSTS_PER_GROUP_LIMIT;
