/**
 * Retention sweep for the Engagement candidate buffer.
 *
 * The buffer holds every item a scan saw — matched or not — so that Preview and
 * re-match work against real data without another Facebook visit. It is the only
 * place unmatched third-party content lives, and it must not become permanent
 * storage.
 *
 * The whole match-then-store privacy argument depends on this actually running.
 * A 48-hour TTL that nothing enforces is a comment, not a control, so the sweep
 * is wired into the existing periodic tick and its result is logged as counts.
 *
 * Opportunities are untouched. A promoted match has its own lifecycle and does
 * not expire with the buffer it came from.
 */
'use strict';

const { supabase } = require('../supabaseClient.cjs');

// Bounded so one sweep cannot lock a large table or blow the statement timeout;
// the tick repeats, so a backlog drains over successive runs rather than in one.
const SWEEP_BATCH = 500;

/**
 * Deletes candidates whose expiry has passed, across all workspaces.
 *
 * Deliberately NOT workspace-scoped: this is an infrastructure sweep keyed on
 * expires_at, which is per-row. Adding a workspace filter would mean either
 * iterating tenants or leaving rows behind for workspaces nobody touched — the
 * exact way retention jobs silently stop covering part of the data.
 *
 * @returns {Promise<{ deleted: number, error: (Error|null) }>}
 */
async function sweepExpiredCandidates(nowIso = new Date().toISOString()) {
    const { data, error } = await supabase
        .from('engagement_scan_candidates')
        .delete()
        .lt('expires_at', nowIso)
        .select('id')
        .limit(SWEEP_BATCH);

    if (error) return { deleted: 0, error };
    return { deleted: Array.isArray(data) ? data.length : 0, error: null };
}

/**
 * Removes the buffer for one finished scan.
 *
 * Called after ingest has matched and promoted. Keeping the buffer for the full
 * 48 hours is only useful while the user might still re-tune the watch, so this
 * is offered as an explicit control rather than run automatically — the caller
 * decides whether the tuning window matters for that scan.
 */
async function purgeScanCandidates(workspaceId, scanTaskId) {
    if (!workspaceId || !scanTaskId) return { deleted: 0, error: null };
    const { data, error } = await supabase
        .from('engagement_scan_candidates')
        .delete()
        .eq('workspace_id', workspaceId)
        .eq('scan_task_id', scanTaskId)
        .select('id');

    if (error) return { deleted: 0, error };
    return { deleted: Array.isArray(data) ? data.length : 0, error: null };
}

/**
 * Counts what is currently buffered for a workspace. Used by the dashboard to
 * say how long Preview will keep working, so the tuning window is visible
 * rather than a surprise when it lapses.
 */
async function bufferedCandidateCount(workspaceId) {
    const { count, error } = await supabase
        .from('engagement_scan_candidates')
        .select('id', { count: 'exact', head: true })
        .eq('workspace_id', workspaceId);
    return { count: count || 0, error: error || null };
}

module.exports = {
    SWEEP_BATCH,
    sweepExpiredCandidates,
    purgeScanCandidates,
    bufferedCandidateCount,
};
