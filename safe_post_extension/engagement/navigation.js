(function initSafePostEngagementNavigation(global) {
    'use strict';

    const CONTROLLED_MAX_GROUPS = 1;
    const CONTROLLED_MAX_POSTS = 10;
    const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

    function normalizeGroupUrl(value) {
        if (typeof value !== 'string' || !value.trim()) return null;
        try {
            const parsed = new URL(value.trim());
            if (parsed.protocol !== 'https:') return null;
            if (!['facebook.com', 'www.facebook.com'].includes(parsed.hostname.toLowerCase())) return null;
            const match = parsed.pathname.match(/^\/groups\/([^/?#]+)\/?$/i);
            if (!match || !match[1] || match[1].toLowerCase() === 'joins') return null;
            return `https://www.facebook.com/groups/${encodeURIComponent(decodeURIComponent(match[1]))}/`;
        } catch {
            return null;
        }
    }

    function validateEngagementScan(scan) {
        if (!scan || !UUID_PATTERN.test(String(scan.id || ''))) {
            return { ok: false, errorCode: 'INVALID_SCAN_TASK', reason: 'invalid-scan-id' };
        }
        if (!Array.isArray(scan.target_groups) || scan.target_groups.length !== CONTROLLED_MAX_GROUPS) {
            return { ok: false, errorCode: 'INVALID_SCAN_TASK', reason: 'controlled-limit-requires-one-group' };
        }

        const source = scan.target_groups[0];
        const id = typeof source?.id === 'string' || typeof source?.id === 'number'
            ? String(source.id).trim()
            : '';
        const url = normalizeGroupUrl(source?.url);
        if (!id || !url) {
            return { ok: false, errorCode: 'INVALID_SCAN_TASK', reason: 'invalid-resolved-group' };
        }

        const requestedLimit = Number(scan.max_posts_per_group);
        const limit = Number.isInteger(requestedLimit) && requestedLimit > 0
            ? Math.min(requestedLimit, CONTROLLED_MAX_POSTS)
            : CONTROLLED_MAX_POSTS;
        const facebookUserId = /^\d{3,30}$/.test(String(scan.facebook_user_id || '').trim())
            ? String(scan.facebook_user_id).trim()
            : null;
        return {
            ok: true,
            scanId: String(scan.id),
            group: {
                id,
                name: typeof source.name === 'string' && source.name.trim() ? source.name.trim() : null,
                url,
            },
            limit,
            facebookUserId,
            facebookUser: typeof scan.facebook_user === 'string' && scan.facebook_user.trim()
                ? scan.facebook_user.trim()
                : null,
        };
    }

    function classifyGroupPage({ expectedUrl, currentUrl, facebookState, bodyText = '' }) {
        if (facebookState && facebookState.ok === false) return facebookState;
        const normalizedExpected = normalizeGroupUrl(expectedUrl);
        const normalizedCurrent = normalizeGroupUrl(currentUrl);
        if (!normalizedExpected || !normalizedCurrent || normalizedExpected !== normalizedCurrent) {
            return { ok: false, errorCode: 'GROUP_NOT_FOUND', detail: { signal: 'unexpected-group-url' } };
        }

        const text = String(bodyText || '').replace(/\s+/g, ' ').trim().toLowerCase();
        const includesAny = phrases => phrases.some(phrase => text.includes(phrase));
        if (includesAny([
            'this content isn\'t available', 'this page isn\'t available',
            'content not found', '\u05d4\u05ea\u05d5\u05db\u05df \u05d4\u05d6\u05d4 \u05d0\u05d9\u05e0\u05d5 \u05d6\u05de\u05d9\u05df',
        ])) return { ok: false, errorCode: 'GROUP_NOT_FOUND', detail: { signal: 'not-found-text' } };
        if (includesAny([
            'you must join this group', 'join group to see', 'you can\'t view this group',
            'you do not have access', '\u05e2\u05dc\u05d9\u05da \u05dc\u05d4\u05e6\u05d8\u05e8\u05e3 \u05dc\u05e7\u05d1\u05d5\u05e6\u05d4',
        ])) return { ok: false, errorCode: 'NO_GROUP_ACCESS', detail: { signal: 'access-text' } };
        if (includesAny([
            'your account is restricted', 'account restricted', 'temporarily blocked',
            '\u05d4\u05d7\u05e9\u05d1\u05d5\u05df \u05e9\u05dc\u05da \u05de\u05d5\u05d2\u05d1\u05dc',
        ])) return { ok: false, errorCode: 'ACCOUNT_RESTRICTED', detail: { signal: 'restriction-text' } };
        return { ok: true };
    }

    const api = Object.freeze({
        CONTROLLED_MAX_GROUPS,
        CONTROLLED_MAX_POSTS,
        normalizeGroupUrl,
        validateEngagementScan,
        classifyGroupPage,
    });
    global.SafePostEngagementNavigation = api;
    try { if (typeof module !== 'undefined' && module.exports) module.exports = api; } catch {}
})(typeof globalThis !== 'undefined' ? globalThis : this);
