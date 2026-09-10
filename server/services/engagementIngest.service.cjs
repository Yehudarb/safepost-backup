/**
 * Phase 2A ingest: candidate buffer → matcher → durable opportunity.
 *
 * Runs AFTER recordDiscoveredPosts() has succeeded, never inside it. Phase 1's
 * ingest is deployed and its contract is fixed, so this bolts on beside it: a
 * fault anywhere in this file degrades Phase 2A to "no opportunities produced"
 * and leaves Phase 1 scanning exactly as it was. The caller is expected to treat
 * every failure here as non-fatal.
 *
 * MATCH-THEN-STORE. Everything a scan saw lands in engagement_scan_candidates
 * with a 48-hour expiry so Preview and re-matching work without another Facebook
 * visit. Only items that match a watch are promoted to engagement_opportunities.
 * Unmatched third-party content is never durable — it expires and is swept.
 *
 * No network, no AI, no external provider. The matcher is a pure function.
 */
'use strict';

const { supabase } = require('../supabaseClient.cjs');
const { buildDedupKey, truncatePostText } = require('../lib/engagementDedup.cjs');
const {
    buildCommentDedupKey,
    truncateCommentText,
} = require('../lib/engagementCommentDedup.cjs');
const { matchText } = require('../lib/engagementMatcher.cjs');
const { toMatcherWatch } = require('./engagementWatch.service.cjs');

// The scan-wide ceiling. Per-post capping already happens in the extension
// (5 visible comments); this is the independent backend bound, so a modified or
// replayed client cannot push more comment rows into a single scan than the
// product decided to hold.
const MAX_COMMENT_CANDIDATES_PER_SCAN = 250;

// Parent context stored on a comment opportunity: enough for a human to see what
// was being replied to, not the whole parent post.
const PARENT_EXCERPT_LIMIT = 300;

function cleanString(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function excerpt(value, limit) {
    const text = typeof value === 'string' ? value.trim() : '';
    return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

/**
 * Flattens an upload batch into candidate rows.
 *
 * Comments arrive nested under their post so the parent relationship is
 * structural and never re-derived here — guessing a parent from a URL is how a
 * comment ends up attributed to the wrong thread.
 *
 * @returns {{ rows: object[], counters: object }}
 */
function buildCandidateRows({ workspaceId, scanId, posts, commentBudget, collectComments = true }) {
    const rows = [];
    const seen = new Set();
    const counters = {
        posts_seen: 0,
        visible_comments_seen: 0,
        comments_with_stable_id: 0,
        replies_skipped: 0,
        comments_dropped_over_ceiling: 0,
        // Comments the extension observed that no enabled watch asked for. Counted
        // so coverage stays honest, never persisted.
        comments_skipped_no_watch: 0,
    };
    let commentsTaken = 0;

    for (const post of Array.isArray(posts) ? posts : []) {
        const groupId = cleanString(post?.facebook_group_id);
        if (!groupId) continue; // unattributable, exactly as Phase 1 treats it
        counters.posts_seen += 1;

        const { text: postText } = truncatePostText(post?.post_text);
        const postedAt = post?.posted_at ? new Date(post.posted_at) : null;
        const validPostedAt = postedAt && !Number.isNaN(postedAt.getTime()) ? postedAt.toISOString() : null;

        // Same key as Phase 1 produces, so a candidate and its discovered_post
        // row describe the same item and comments can reference it as a parent.
        const { key: postKey } = buildDedupKey({
            workspaceId,
            facebookPostId: post?.facebook_post_id,
            facebookPostUrl: post?.facebook_post_url,
            facebookGroupId: groupId,
            authorName: post?.author_name,
            postText,
            postedAt: validPostedAt,
        });

        if (!seen.has(postKey)) {
            seen.add(postKey);
            rows.push({
                workspace_id: workspaceId,
                scan_task_id: scanId,
                source_type: 'post',
                dedup_key: postKey,
                parent_dedup_key: null,
                facebook_group_id: groupId,
                source_id: cleanString(post?.facebook_post_id),
                source_url: cleanString(post?.facebook_post_url),
                author_name: cleanString(post?.author_name),
                content: postText || '',
            });
        }

        // Replies the extension saw and deliberately did not read. A coverage
        // signal, not an error.
        const skipped = Number(post?.replies_skipped);
        if (Number.isInteger(skipped) && skipped > 0) counters.replies_skipped += skipped;

        for (const comment of Array.isArray(post?.comments) ? post.comments : []) {
            counters.visible_comments_seen += 1;

            // Phase 2A ships posts-only: a real-Facebook measurement found a median
            // of zero visible comments per post, so no watch enables them. When no
            // enabled watch wants comments there is nothing to match them against,
            // and the candidate buffer is the ONLY place a comment would live —
            // unlike posts, which Phase 1 already retains durably in
            // engagement_discovered_posts. Buffering them anyway would hold other
            // people's words for 48 hours for no product purpose. Counted, dropped
            // here, never written.
            if (!collectComments) {
                counters.comments_skipped_no_watch += 1;
                continue;
            }

            // The ceiling stops collection; it never fails the request. Exceeding
            // it is a bounded-coverage outcome, not an error to retry.
            if (commentsTaken >= commentBudget) {
                counters.comments_dropped_over_ceiling += 1;
                continue;
            }

            const commentText = truncateCommentText(comment?.comment_text ?? comment?.commentText);
            const commentId = cleanString(comment?.comment_id ?? comment?.commentId);
            const commentUrl = cleanString(comment?.comment_url ?? comment?.commentUrl);
            const authorName = cleanString(comment?.author_name ?? comment?.authorName);
            if (!commentText && !authorName) continue;

            const { key: commentKey } = buildCommentDedupKey({
                workspaceId,
                commentId,
                commentUrl,
                parentDedupKey: postKey,
                authorName,
                commentText,
            });
            if (seen.has(commentKey)) continue;
            seen.add(commentKey);

            if (commentId) counters.comments_with_stable_id += 1;
            commentsTaken += 1;

            rows.push({
                workspace_id: workspaceId,
                scan_task_id: scanId,
                source_type: 'comment',
                dedup_key: commentKey,
                parent_dedup_key: postKey,
                facebook_group_id: groupId,
                source_id: commentId,
                source_url: commentUrl || cleanString(post?.facebook_post_url),
                author_name: authorName,
                content: commentText || '',
                // Carried in memory only, for building the opportunity's parent
                // context. Not a column on the buffer.
                __parentExcerpt: excerpt(postText, PARENT_EXCERPT_LIMIT),
                __parentSourceId: cleanString(post?.facebook_post_id),
            });
        }
    }

    counters.comments_taken = commentsTaken;
    return { rows, counters };
}

/** A watch applies to a candidate when type and group both allow it. */
function watchApplies(watch, candidate) {
    if (!watch?.enabled) return false;
    if (candidate.source_type === 'post' && !watch.include_posts) return false;
    if (candidate.source_type === 'comment' && !watch.include_comments) return false;
    const groups = Array.isArray(watch.selected_group_ids) ? watch.selected_group_ids : [];
    // An empty group list means "every group this scan visits", which is how a
    // watch created before any group was chosen still produces results.
    if (groups.length && !groups.map(String).includes(String(candidate.facebook_group_id))) return false;
    return true;
}

/**
 * The Phase 2A pipeline for one upload batch.
 *
 * Never throws: every failure is reported in the returned object so the caller
 * can log counts and still answer the Phase 1 contract.
 */
async function ingestCandidates({ scanId, workspaceId, posts }) {
    const empty = {
        ok: false, candidates: 0, matched: 0, opportunities: 0,
        counters: null, error: null,
    };
    if (!workspaceId || !scanId) return { ...empty, error: 'missing scope' };

    // ---- intent, BEFORE construction ----
    //
    // Watches are read first so the workspace's stated intent decides what is
    // built at all, rather than being consulted after the rows already exist.
    // This is the whole point of the ordering: a comment nobody asked for should
    // never reach persistent storage, not be written and then found unwanted.
    //
    // Scoped to this workspace, so one tenant enabling comments can never cause
    // another tenant's comments to be retained.
    const { data: watches, error: watchError } = await supabase
        .from('engagement_watches')
        .select('id, workspace_id, match_mode, query_text, keywords, exact_phrases, exclude_terms, selected_group_ids, include_posts, include_comments, enabled')
        .eq('workspace_id', workspaceId)
        .eq('enabled', true);
    if (watchError) return { ...empty, error: watchError.message };

    const enabled = Array.isArray(watches) ? watches : [];
    const wantsComments = enabled.some(w => w.include_comments === true);

    // Comments are gated; posts are not. The asymmetry is deliberate and rests on
    // where each one already lives:
    //
    //   Posts    — Phase 1 has ALREADY written every scanned post durably to
    //              engagement_discovered_posts, with no TTL. Buffering them adds
    //              no exposure that does not already exist, and it is what makes
    //              "scan, then write a watch, then Preview against real data"
    //              work without going back to Facebook.
    //   Comments — the buffer is their ONLY home. Nothing else stores them, so
    //              buffering with no watch to match against is pure retention
    //              of other people's words for no purpose.
    //
    // If a future watch sets include_comments = true, wantsComments flips on the
    // next ingest and buffering resumes with no code change.
    const { count: existingComments, error: countError } = await supabase
        .from('engagement_scan_candidates')
        .select('id', { count: 'exact', head: true })
        .eq('workspace_id', workspaceId)
        .eq('scan_task_id', scanId)
        .eq('source_type', 'comment');
    if (countError) return { ...empty, error: countError.message };

    const commentBudget = Math.max(0, MAX_COMMENT_CANDIDATES_PER_SCAN - (existingComments || 0));
    const { rows, counters } = buildCandidateRows({
        workspaceId, scanId, posts, commentBudget, collectComments: wantsComments,
    });
    counters.wants_comments = wantsComments;
    if (!rows.length) return { ...empty, ok: true, counters };

    // Strip the in-memory-only fields before the row reaches PostgREST.
    const persistable = rows.map(({ __parentExcerpt, __parentSourceId, ...row }) => row);

    // ignoreDuplicates keeps a replayed batch idempotent: an existing candidate
    // keeps its original discovered_at and expiry rather than being extended.
    const { error: writeError } = await supabase
        .from('engagement_scan_candidates')
        .upsert(persistable, { onConflict: 'scan_task_id,dedup_key', ignoreDuplicates: true });
    if (writeError) return { ...empty, error: writeError.message, counters };

    // ---- match ----
    if (!enabled.length) return { ...empty, ok: true, candidates: rows.length, counters };

    const opportunities = [];
    let commentsMatched = 0;
    const promoted = new Set();

    for (const candidate of rows) {
        for (const watch of enabled) {
            if (!watchApplies(watch, candidate)) continue;
            const verdict = matchText(candidate.content, toMatcherWatch(watch), {
                sourceType: candidate.source_type,
            });
            if (!verdict.matched) continue;

            // One opportunity per (watch, item) — the unique index enforces it in
            // the database; this guard keeps a single batch from carrying the
            // same conflict target twice, which would fail the whole upsert.
            const pairKey = `${watch.id}::${candidate.dedup_key}`;
            if (promoted.has(pairKey)) continue;
            promoted.add(pairKey);

            if (candidate.source_type === 'comment') commentsMatched += 1;

            opportunities.push({
                workspace_id: workspaceId,
                watch_id: watch.id,
                scan_task_id: scanId,
                source_type: candidate.source_type,
                facebook_group_id: candidate.facebook_group_id,
                source_id: candidate.source_id,
                parent_source_id: candidate.__parentSourceId || null,
                parent_dedup_key: candidate.parent_dedup_key,
                source_url: candidate.source_url,
                excerpt: verdict.excerpt,
                parent_excerpt: candidate.__parentExcerpt || null,
                author_name: candidate.author_name,
                matched_terms: verdict.matchedTerms,
                matched_phrase: verdict.matchedPhrase,
                match_mode: verdict.matchMode,
                match_reason: verdict.matchReason,
                relevance: verdict.relevance,
                dedup_key: candidate.dedup_key,
            });
        }
    }

    let stored = 0;
    if (opportunities.length) {
        const { data: inserted, error: promoteError } = await supabase
            .from('engagement_opportunities')
            .upsert(opportunities, { onConflict: 'watch_id,dedup_key', ignoreDuplicates: true })
            .select('id');
        if (promoteError) {
            return { ...empty, ok: true, candidates: rows.length, error: promoteError.message, counters };
        }
        stored = Array.isArray(inserted) ? inserted.length : 0;
    }

    return {
        ok: true,
        candidates: rows.length,
        matched: opportunities.length,
        opportunities: stored,
        counters: { ...counters, comments_matched: commentsMatched },
        error: null,
    };
}

/**
 * Adds this batch's coverage counters to the scan row.
 *
 * Counts only — never comment text, never an author name. partial_comment_coverage
 * is set true and never cleared: SafePost reads only what was already on screen
 * and cannot observe what it did not see.
 */
async function updateScanCoverage({ scanId, workspaceId, counters }) {
    if (!scanId || !workspaceId || !counters) return { ok: false };

    const { data: current, error: readError } = await supabase
        .from('engagement_scan_tasks')
        .select('posts_seen, visible_comments_seen, comments_matched, comments_with_stable_id, replies_skipped')
        .eq('workspace_id', workspaceId)
        .eq('id', scanId)
        .maybeSingle();
    if (readError || !current) return { ok: false };

    const add = (base, delta) => (Number(base) || 0) + (Number(delta) || 0);
    const { error: writeError } = await supabase
        .from('engagement_scan_tasks')
        .update({
            posts_seen: add(current.posts_seen, counters.posts_seen),
            visible_comments_seen: add(current.visible_comments_seen, counters.visible_comments_seen),
            comments_matched: add(current.comments_matched, counters.comments_matched),
            comments_with_stable_id: add(current.comments_with_stable_id, counters.comments_with_stable_id),
            replies_skipped: add(current.replies_skipped, counters.replies_skipped),
            partial_comment_coverage: true,
        })
        .eq('workspace_id', workspaceId)
        .eq('id', scanId);

    return { ok: !writeError };
}

module.exports = {
    MAX_COMMENT_CANDIDATES_PER_SCAN,
    PARENT_EXCERPT_LIMIT,
    buildCandidateRows,
    watchApplies,
    ingestCandidates,
    updateScanCoverage,
};
