/**
 * Strips credentials out of anything on its way to a log.
 *
 * Why this exists: EventSource cannot send headers, so the extension appends its
 * device token to the SSE URL (`/api/stream/jobs?worker_id=…&device_token=…`),
 * and the request logger printed `req.url` verbatim. Every SSE connection
 * therefore wrote a live 64-hex bearer credential into the platform log stream,
 * where the audience is far wider than the set of credential holders. A device
 * token authenticates `requireWorker`: whoever holds one can claim jobs and post
 * to that workspace's Facebook groups.
 *
 * Two independent rules, because either alone has a gap:
 *
 *   1. Name-based — a known-sensitive parameter or field name is always redacted,
 *      even when its value is short or oddly shaped.
 *   2. Shape-based — a long high-entropy-looking value is redacted whatever it is
 *      called, so a parameter added later is covered without editing this file.
 *
 * `worker_id` is deliberately NOT redacted. It is an identifier, not a secret:
 * `requireWorker` verifies the token against a stored hash, so the id alone
 * authenticates nothing, and keeping it is what makes a log line useful for
 * telling one worker's traffic from another's.
 *
 * `facebook_user_id` IS redacted. It is not a credential but it is a real
 * person's Facebook account identifier, and it does not belong in a log line any
 * more than it belongs in a bug report.
 */
'use strict';

const REDACTED = '[redacted]';

// Matched case-insensitively against query parameter and object key names.
const SENSITIVE_NAMES = new Set([
    'device_token', 'devicetoken',
    'token', 'access_token', 'accesstoken', 'refresh_token', 'refreshtoken',
    'id_token', 'idtoken', 'bearer',
    'authorization', 'auth',
    'api_key', 'apikey', 'x-api-key',
    'extension_key', 'extensionkey', 'x-extension-key',
    'secret', 'client_secret', 'clientsecret',
    'password', 'passwd', 'pwd',
    'session', 'session_id', 'sessionid', 'cookie',
    'service_key', 'servicekey', 'anon_key', 'anonkey',
    // Pairing codes are single-use but are a credential until redeemed.
    'code', 'pairing_code', 'pairingcode',
    // Personal identifier rather than a credential - see the header note.
    'facebook_user_id', 'facebookuserid', 'c_user',
]);

/**
 * True for values shaped like a secret: long hex, base64url, or a JWT. Chosen to
 * catch a 64-char device token and a Supabase JWT without eating ordinary ids -
 * a UUID is 36 chars with dashes and is left alone, because UUIDs identify rows
 * all over this system and redacting them would blind the logs.
 */
function looksLikeSecret(value) {
    if (typeof value !== 'string') return false;
    const trimmed = value.trim();
    if (trimmed.length < 32) return false;
    if (/^[0-9a-f]{32,}$/i.test(trimmed)) return true;                       // hex token
    if (/^[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+$/.test(trimmed)) return true; // JWT
    if (/^[A-Za-z0-9+/_-]{40,}={0,2}$/.test(trimmed)) return true;           // base64/base64url
    return false;
}

function isSensitiveName(name) {
    return typeof name === 'string' && SENSITIVE_NAMES.has(name.toLowerCase());
}

/**
 * Rewrites a request URL so the path and harmless parameters survive but no
 * credential does. Relative URLs are the normal input (`req.url`), so a base is
 * supplied and then discarded.
 */
function redactUrl(url) {
    if (typeof url !== 'string' || !url) return url;
    const questionMark = url.indexOf('?');
    if (questionMark === -1) return url;

    const path = url.slice(0, questionMark);
    const rawQuery = url.slice(questionMark + 1);

    let params;
    try {
        params = new URLSearchParams(rawQuery);
    } catch {
        // Unparseable query: drop it entirely rather than risk printing a secret.
        return `${path}?${REDACTED}`;
    }

    const parts = [];
    for (const [name, value] of params) {
        const unsafe = isSensitiveName(name) || looksLikeSecret(value);
        parts.push(`${name}=${unsafe ? REDACTED : value}`);
    }
    return parts.length ? `${path}?${parts.join('&')}` : path;
}

/**
 * Deep-copies a value with sensitive fields replaced. Used before logging a
 * request body. Depth-limited so a cyclic or pathological object cannot hang the
 * logger - a log line is never worth stalling a request for.
 */
function redactValue(value, depth = 0) {
    if (depth > 6) return '[truncated]';
    if (value === null || value === undefined) return value;
    if (typeof value === 'string') return looksLikeSecret(value) ? REDACTED : value;
    if (typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map(entry => redactValue(entry, depth + 1));

    const output = {};
    for (const [key, entry] of Object.entries(value)) {
        output[key] = isSensitiveName(key) ? REDACTED : redactValue(entry, depth + 1);
    }
    return output;
}

/** Convenience for log call sites that want a string. */
function redactJson(value) {
    try {
        return JSON.stringify(redactValue(value));
    } catch {
        return '[unserializable]';
    }
}

/**
 * Scrubs free text before logging it. Error messages and stack traces can carry
 * a full request URL, so the same rules are applied to any embedded query
 * parameter and to any bare token-shaped run of characters.
 */
function redactText(text) {
    if (typeof text !== 'string' || !text) return text;
    let output = text;
    for (const name of SENSITIVE_NAMES) {
        // name=value up to the next separator
        output = output.replace(
            new RegExp(`(${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*[=:]\\s*)([^\\s&,;"')\\]}]+)`, 'gi'),
            `$1${REDACTED}`,
        );
    }
    // Bare token-shaped runs that survived the name pass.
    output = output.replace(/\b[0-9a-f]{32,}\b/gi, REDACTED);
    output = output.replace(/\b[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\b/g, REDACTED);
    return output;
}

module.exports = {
    REDACTED,
    SENSITIVE_NAMES,
    looksLikeSecret,
    isSensitiveName,
    redactUrl,
    redactValue,
    redactJson,
    redactText,
};
