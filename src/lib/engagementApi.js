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
};

export default EngagementAPI;
