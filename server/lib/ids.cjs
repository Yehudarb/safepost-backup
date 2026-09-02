'use strict';

// Validation for identifiers that end up inside PostgREST filters.
//
// PostgREST parses filter values against the column type, so a malformed value
// on a bigint column raises `invalid input syntax for type bigint: "..."`. Routes
// that forwarded the driver error to the caller turned a client mistake into a
// 500 carrying database internals. Rejecting the value before the query keeps the
// error where it belongs — a 400 the caller can act on — and stops malformed
// input reaching the database at all.
//
// Types are not interchangeable: `posts.id` and `post_templates.id` are bigint,
// `browser_workers.id` and `workspaces.id` are uuid, and `groups.id` is text.
// (`group_sets.id` differs by environment — see normalizeDbIdOrUuid.) Applying
// the wrong check is its own bug: the delete routes for templates and group sets
// previously guarded a bigint column with a uuid-shaped regexp, which rejected
// every real id.

// Digits only, no sign, no decimal point, no leading zero, and at least one
// digit. Kept as a string so ids beyond Number.MAX_SAFE_INTEGER survive intact:
// bigint reaches 2^63 and JSON numbers silently lose precision past 2^53.
const DB_ID_RE = /^[1-9][0-9]*$/;
// Digit-shaped is not the same as storable. A value above bigint's range parses
// as an id but overflows the column, and PostgREST answers 22003 — another 5xx
// for what is a client mistake. Bound it here so it never reaches the database.
const BIGINT_MAX = 9223372036854775807n;
const BIGINT_MAX_DIGITS = 19;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Returns the canonical string form of a positive integer id, or null.
// Rejects: empty, null/undefined, negatives, zero, decimals, exponent notation,
// whitespace padding, arrays/objects, and any PostgREST filter syntax such as
// `1,2`, `not.is.null`, `*` or `1)or(`.
function normalizeDbId(value) {
    if (typeof value === 'number') {
        // A number that already lost precision cannot be trusted to address a
        // row, so require the string form for anything that large.
        if (!Number.isSafeInteger(value) || value <= 0) return null;
        return String(value);
    }
    if (typeof value !== 'string') return null;
    if (!DB_ID_RE.test(value)) return null;
    // Length is checked first so an absurdly long digit string is rejected
    // without building a BigInt for it.
    if (value.length > BIGINT_MAX_DIGITS) return null;
    if (value.length === BIGINT_MAX_DIGITS && BigInt(value) > BIGINT_MAX) return null;
    return value;
}

function isValidDbId(value) {
    return normalizeDbId(value) !== null;
}

// Validates a whole list. Returns { ok: false, reason } on the first problem so
// the caller can answer 400 without partially applying anything — a batch that
// contains one bad id is a bad batch, not a batch to be silently trimmed.
function normalizeDbIdList(value, { max = null } = {}) {
    if (!Array.isArray(value) || value.length === 0) return { ok: false, reason: 'empty' };
    if (max !== null && value.length > max) return { ok: false, reason: 'too_many', count: value.length };
    const ids = [];
    for (const entry of value) {
        const id = normalizeDbId(entry);
        if (id === null) return { ok: false, reason: 'malformed' };
        ids.push(id);
    }
    return { ok: true, ids };
}

function normalizeUuid(value) {
    if (typeof value !== 'string') return null;
    return UUID_RE.test(value) ? value : null;
}

function isValidUuid(value) {
    return normalizeUuid(value) !== null;
}

// `group_sets.id` is bigint in production but uuid in the QA project — the two
// schemas have drifted. Committing to either check alone would reject every real
// id in the other environment, so this route accepts both legitimate shapes.
// That still keeps malformed values and filter syntax out of PostgREST, which is
// the point; it is not a licence to use this where the column type is known.
function normalizeDbIdOrUuid(value) {
    return normalizeDbId(value) || normalizeUuid(value);
}

module.exports = {
    DB_ID_RE,
    UUID_RE,
    normalizeDbId,
    isValidDbId,
    normalizeDbIdList,
    normalizeUuid,
    isValidUuid,
    normalizeDbIdOrUuid,
};
