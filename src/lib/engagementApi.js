// Engagement dashboard client.
//
// Deliberately separate from the publishing `API` class in App.jsx: the
// publishing client surface is proven and should not grow methods for an
// unreleased feature. Every call here is workspace-scoped by the same auth
// headers the rest of the dashboard uses — the server derives the workspace
// from the verified session, never from anything this file sends.
import { getAuthHeaders } from '@/lib/session';
import { API_BASE } from '@/lib/apiConfig';

const ENGAGEMENT_BASE = `${API_BASE}/engagement`;

// The five states the UI distinguishes, plus NONE for "no scan yet".
export const SCAN_UI_STATES = Object.freeze({
    NONE: 'NONE',
    QUEUED: 'QUEUED',
    RUNNING: 'RUNNING',
    COMPLETED: 'COMPLETED',
    BLOCKED: 'BLOCKED',
    ABORTED: 'ABORTED',
    CANCELLED: 'CANCELLED',
    FAILED: 'FAILED',
});

export class EngagementUnavailableError extends Error {
    constructor() {
        super('Engagement is not available.');
        this.name = 'EngagementUnavailableError';
        this.unavailable = true;
    }
}

export class EngagementRequestError extends Error {
    constructor(status = 0) {
        const message = status === 0
            ? 'Could not reach SafePost. Check your connection and try again.'
            : status === 401 || status === 403
                ? 'Your SafePost session is no longer authorized. Sign in again and retry.'
                : status === 409
                    ? 'Another scan is already active. Refresh and try again.'
                    : 'SafePost could not complete this request. Try again.';
        super(message);
        this.name = 'EngagementRequestError';
        this.status = status;
    }
}

async function request(path, options = {}) {
    let res;
    try {
        const headers = { 'Content-Type': 'application/json', ...(await getAuthHeaders()), ...options.headers };
        res = await fetch(`${ENGAGEMENT_BASE}${path}`, { ...options, headers });
    } catch {
        throw new EngagementRequestError();
    }
    if (res.status === 404) {
        // The feature answers 404 rather than 403 when it is switched off, so a
        // 404 here means "not available", not "something broke".
        throw new EngagementUnavailableError();
    }
    if (!res.ok) {
        throw new EngagementRequestError(res.status);
    }
    try {
        return await res.json();
    } catch {
        throw new EngagementRequestError(res.status);
    }
}

export const EngagementAPI = {
    /** Works whether or not the workspace flag is on; throws only if the feature is off fleet-wide. */
    getStatus() {
        return request('/status');
    },
    listScans() {
        return request('/scans');
    },
    listDiscovered({ limit = 50, offset = 0, scanId = null, groupId = null } = {}) {
        const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
        if (scanId) params.set('scan_task_id', scanId);
        if (groupId) params.set('group_id', groupId);
        return request(`/discovered?${params.toString()}`);
    },
    /** Manual scan of exactly one group. Phase 1 scans one group at a time. */
    startScan({ name, groupId, maxPosts = 10, searchInstructions = '' }) {
        return request('/scans', {
            method: 'POST',
            body: JSON.stringify({
                name,
                group_ids: [groupId],
                max_groups: 1,
                max_posts_per_group: maxPosts,
                search_instructions: searchInstructions,
            }),
        });
    },
    cancelScan(id) {
        return request(`/scans/${encodeURIComponent(id)}/cancel`, { method: 'POST' });
    },

    // ---- Phase 2A: watches and opportunities -------------------------------
    //
    // These reuse request() above, so auth headers, the workspace header, the
    // 404-means-unavailable rule and error normalisation are shared rather than
    // reimplemented. Nothing here sends workspace_id: the server derives it from
    // the verified session, and a client-supplied value would be ignored anyway.

    listWatches() {
        return request('/watches');
    },

    /**
     * Phase 2A is posts-only. include_posts/include_comments are set here rather
     * than surfaced as form fields, so no caller can accidentally enable the
     * dormant comment path from the dashboard.
     */
    createWatch({ name, queryText, keywords = [], exactPhrases = [], excludeTerms = [], groupIds = [], matchMode = 'flexible', enabled = true }) {
        return request('/watches', {
            method: 'POST',
            body: JSON.stringify({
                name,
                query_text: queryText,
                match_mode: matchMode,
                keywords,
                exact_phrases: exactPhrases,
                exclude_terms: excludeTerms,
                selected_group_ids: groupIds,
                include_posts: true,
                include_comments: false,
                enabled,
            }),
        });
    },

    updateWatch(id, patch = {}) {
        const body = {};
        if (patch.name !== undefined) body.name = patch.name;
        if (patch.queryText !== undefined) body.query_text = patch.queryText;
        if (patch.matchMode !== undefined) body.match_mode = patch.matchMode;
        if (patch.keywords !== undefined) body.keywords = patch.keywords;
        if (patch.exactPhrases !== undefined) body.exact_phrases = patch.exactPhrases;
        if (patch.excludeTerms !== undefined) body.exclude_terms = patch.excludeTerms;
        if (patch.groupIds !== undefined) body.selected_group_ids = patch.groupIds;
        if (patch.enabled !== undefined) body.enabled = patch.enabled;
        // Never patched away from posts-only, even by a caller that tried.
        body.include_posts = true;
        body.include_comments = false;
        return request(`/watches/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) });
    },

    deleteWatch(id) {
        return request(`/watches/${encodeURIComponent(id)}`, { method: 'DELETE' });
    },

    /**
     * Matches a saved watch against the recent candidate buffer.
     *
     * The backend requires a saved watch id — it loads the watch by id and
     * workspace — so there is no unsaved-payload preview. The UI therefore
     * offers "Save & preview" for a new watch, which is one click and says what
     * it does, rather than silently creating a draft the user did not ask for.
     *
     * No Facebook contact: this reads only what SafePost already buffered.
     */
    previewWatch(id, { limit = 25 } = {}) {
        const params = new URLSearchParams({ limit: String(limit) });
        return request(`/watches/${encodeURIComponent(id)}/preview?${params.toString()}`, { method: 'POST' });
    },

    listOpportunities({ limit = 50, offset = 0, watchId = null, relevance = null, groupId = null, reviewState = null } = {}) {
        const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
        if (watchId) params.set('watch_id', watchId);
        if (relevance) params.set('relevance', relevance);
        if (groupId) params.set('group_id', groupId);
        if (reviewState) params.set('review_state', reviewState);
        // source_type is deliberately never sent. Phase 2A is posts-only and the
        // UI has no comment filter; leaving it unset returns what exists.
        return request(`/opportunities?${params.toString()}`);
    },
};

export default EngagementAPI;
