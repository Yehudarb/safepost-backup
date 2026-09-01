(function initExternalMessageTrust(global) {
    'use strict';

    // The beta extension has no legitimate web-page or extension caller. Keep
    // this list empty in the production manifest/source; a development build
    // may pass its own exact-origin list to validateExternalSender in tests or
    // tooling without widening the shipped extension.
    const TRUSTED_EXTERNAL_ORIGINS = Object.freeze([]);

    function normalizeOrigin(value) {
        if (typeof value !== 'string' || !value.trim()) return null;
        try {
            const url = new URL(value);
            if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
            return url.origin;
        } catch {
            return null;
        }
    }

    function validateExternalSender(sender, trustedOrigins = TRUSTED_EXTERNAL_ORIGINS) {
        if (!sender || typeof sender !== 'object' || Array.isArray(sender)) {
            return { ok: false, reason: 'MALFORMED_SENDER' };
        }

        const origin = normalizeOrigin(sender.origin);
        const urlOrigin = normalizeOrigin(sender.url);
        if (!origin || !urlOrigin) return { ok: false, reason: 'MISSING_ORIGIN' };
        if (origin !== urlOrigin) return { ok: false, reason: 'ORIGIN_URL_MISMATCH' };

        const exactOrigins = new Set(
            Array.isArray(trustedOrigins)
                ? trustedOrigins.map(normalizeOrigin).filter(Boolean)
                : []
        );
        if (!exactOrigins.has(origin)) return { ok: false, reason: 'UNTRUSTED_ORIGIN' };

        return { ok: true, origin };
    }

    const api = { TRUSTED_EXTERNAL_ORIGINS, normalizeOrigin, validateExternalSender };
    global.SafePostExternalTrust = api;
    try { if (typeof module !== 'undefined' && module.exports) module.exports = api; } catch (_) { /* browser */ }
})(typeof globalThis !== 'undefined' ? globalThis : this);
