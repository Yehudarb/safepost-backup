(function initSafePostEngagementIdentity(global) {
    'use strict';

    const IDENTITY_MISMATCH = 'FACEBOOK_IDENTITY_MISMATCH';
    const IDENTITY_UNVERIFIED = 'FACEBOOK_IDENTITY_UNVERIFIED';

    function normalizeFacebookUserId(value) {
        const normalized = value == null ? '' : String(value).trim();
        return /^\d{3,30}$/.test(normalized) ? normalized : null;
    }

    function normalizeDisplayName(value) {
        return typeof value === 'string' && value.trim()
            ? value.replace(/\s+/g, ' ').trim()
            : null;
    }

    function diagnostic(errorCode, strategy, matchedSignal, message, names = {}) {
        return {
            ok: false,
            errorCode,
            state: 'facebook_identity',
            strategy,
            matchedSignal,
            message,
            expectedName: normalizeDisplayName(names.expectedName),
            currentName: normalizeDisplayName(names.currentName),
        };
    }

    function evaluateFacebookIdentity({
        expectedId,
        expectedName,
        currentId,
        currentName,
        currentStrategy = 'unknown',
    } = {}) {
        const expected = normalizeFacebookUserId(expectedId);
        const current = normalizeFacebookUserId(currentId);
        const names = { expectedName, currentName };

        if (!expected) {
            return diagnostic(
                IDENTITY_UNVERIFIED,
                'missing_dataset_facebook_user_id',
                'dataset_identity_missing',
                'The synced group dataset has no reliable Facebook account identifier. Sync the groups again before scanning.',
                names
            );
        }
        if (!current) {
            return diagnostic(
                IDENTITY_UNVERIFIED,
                'missing_current_facebook_user_id',
                'current_identity_missing',
                'The currently logged-in Facebook account could not be verified. Open Facebook and try again.',
                names
            );
        }
        if (expected !== current) {
            return diagnostic(
                IDENTITY_MISMATCH,
                'stable_facebook_user_id_mismatch',
                'expected_id_differs_from_current_id',
                'The currently logged-in Facebook account does not match the account used to sync these groups.',
                names
            );
        }
        return {
            ok: true,
            state: 'facebook_identity',
            strategy: currentStrategy === 'active_facebook_tab_c_user'
                ? 'active_facebook_tab_id_match'
                : 'persisted_facebook_user_id_match',
            matchedSignal: 'stable_facebook_user_id',
            expectedName: normalizeDisplayName(expectedName),
            currentName: normalizeDisplayName(currentName),
        };
    }

    function safeIdentityFailureReason(result) {
        if (!result || result.ok !== false) return null;
        return `strategy=${result.strategy || 'unknown'};signal=${result.matchedSignal || 'unknown'}`;
    }

    const api = Object.freeze({
        IDENTITY_MISMATCH,
        IDENTITY_UNVERIFIED,
        normalizeFacebookUserId,
        evaluateFacebookIdentity,
        safeIdentityFailureReason,
    });
    global.SafePostEngagementIdentity = api;
    try { if (typeof module !== 'undefined' && module.exports) module.exports = api; } catch {}
})(typeof globalThis !== 'undefined' ? globalThis : this);
