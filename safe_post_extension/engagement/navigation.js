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

    // Membership evidence.
    //
    // Live QA #2 established that a group's presence in a workspace says nothing
    // about which Facebook account it belongs to: 172 of 175 synced groups were
    // owned by a different identity than the one logged in. So a legacy group may
    // only be bound to the current account when the page itself proves the account
    // is a member of THAT group.
    //
    // The discriminator was read off real pages, not guessed. A "Joined" state
    // control is present only for members; a "Join group" call to action is
    // present only for non-members. The post composer is NOT a discriminator —
    // public groups render it for non-members too.
    const JOINED_LABELS = ['הצטרפת', 'joined'];
    const JOIN_CTA_LABELS = [
        'הצטרף לקבוצה',
        'הצטרפי לקבוצה',
        'join group',
    ];

    const AFFORDANCE_SELECTOR = '[role="button"], [role="link"], button, a';
    // Measured against the live page: the membership control's smallest ancestor
    // that also contains the group's <h1> is 7 levels up. 12 leaves room for a
    // layout change without letting the walk escape the header.
    const MAX_HEADER_ANCESTORS = 12;

    function affordanceLabel(element) {
        const label = element?.getAttribute?.('aria-label');
        const text = label || element?.textContent || '';
        return String(text).replace(/\s+/g, ' ').trim().toLowerCase();
    }

    function groupIdFromHref(href) {
        const match = String(href || '').match(/\/groups\/([^/?#]+)/);
        if (!match) return null;
        let id;
        try { id = decodeURIComponent(match[1]); } catch { id = match[1]; }
        return ['joins', 'feed', 'discover', 'create'].includes(id.toLowerCase()) ? null : id;
    }

    // 'joined' | 'join' | null — 'joined' wins, so a header showing both cannot
    // be read as a non-member page.
    function membershipControlKind(region) {
        if (!region || typeof region.querySelectorAll !== 'function') return null;
        const joined = new Set(JOINED_LABELS.map(label => label.toLowerCase()));
        const join = new Set(JOIN_CTA_LABELS.map(label => label.toLowerCase()));
        let sawJoin = false;
        for (const element of region.querySelectorAll(AFFORDANCE_SELECTOR)) {
            const label = affordanceLabel(element);
            if (joined.has(label)) return 'joined';
            if (join.has(label)) sawJoin = true;
        }
        return sawJoin ? 'join' : null;
    }

    // The group header: the smallest ancestor of the group's own <h1> that also
    // carries a membership control. Scoping to it — rather than to all of
    // [role="main"] — keeps a recommendation card's "Joined" out of reach.
    function findGroupHeaderRegion(root) {
        if (!root || typeof root.querySelector !== 'function') return null;
        const heading = root.querySelector('h1');
        if (!heading) return null;
        let node = heading;
        for (let depth = 0; depth < MAX_HEADER_ANCESTORS && node.parentElement; depth++) {
            node = node.parentElement;
            // Once the candidate would swallow the feed we are looking at the
            // page, not the header. Overshooting is not evidence.
            if (node.querySelector('[role="feed"]')) return null;
            if (membershipControlKind(node)) return node;
        }
        return null;
    }

    function foreignGroupLinkCount(region, groupId) {
        const ids = new Set();
        for (const anchor of region.querySelectorAll('a[href]')) {
            const id = groupIdFromHref(anchor.getAttribute('href'));
            if (id) ids.add(id);
        }
        if (groupId) return [...ids].filter(id => id !== String(groupId)).length;
        // Without a group id to compare against, more than one distinct group in
        // the header is itself the ambiguity we are guarding against.
        return ids.size > 1 ? ids.size : 0;
    }

    // member: true  -> positive evidence this account belongs to this group
    // member: false -> positive evidence it does not
    // member: null  -> no evidence either way; the caller must NOT bind
    function evaluateGroupMembership(root, options = {}) {
        const groupId = options.groupId == null ? null : String(options.groupId).trim();
        const region = findGroupHeaderRegion(root);
        if (!region) {
            return { member: null, strategy: 'none', signal: 'no_group_header_region' };
        }
        // A header that also advertises other groups is not a header we can
        // trust: a recommendation card's "Joined" would be indistinguishable
        // from this group's own state. Block rather than guess.
        if (foreignGroupLinkCount(region, groupId) > 0) {
            return { member: null, strategy: 'none', signal: 'header_contains_other_groups' };
        }
        const kind = membershipControlKind(region);
        if (kind === 'joined') {
            return { member: true, strategy: 'group_header_joined_control', signal: 'joined_affordance' };
        }
        if (kind === 'join') {
            return { member: false, strategy: 'group_header_join_call_to_action', signal: 'join_affordance' };
        }
        return { member: null, strategy: 'none', signal: 'no_membership_affordance' };
    }

    const api = Object.freeze({
        CONTROLLED_MAX_GROUPS,
        CONTROLLED_MAX_POSTS,
        JOINED_LABELS,
        JOIN_CTA_LABELS,
        normalizeGroupUrl,
        validateEngagementScan,
        classifyGroupPage,
        findGroupHeaderRegion,
        membershipControlKind,
        evaluateGroupMembership,
    });
    global.SafePostEngagementNavigation = api;
    try { if (typeof module !== 'undefined' && module.exports) module.exports = api; } catch {}
})(typeof globalThis !== 'undefined' ? globalThis : this);
