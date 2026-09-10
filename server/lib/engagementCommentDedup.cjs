/**
 * Dedup keys for discovered comments.
 *
 * Kept beside engagementDedup.cjs rather than inside it: the post ladder is
 * deployed, tested and unchanged by Phase 2A, and comments need a different
 * fallback for a reason that matters.
 *
 * Priority, first match wins:
 *   1. fbc:<comment id>  — strongest, from comment_id / reply_comment_id
 *   2. curl:<canonical>  — post permalink plus comment_id, tracking stripped
 *   3. chash:<sha256>    — fallback over parent + author + text
 *
 * WHY THE FALLBACK DIFFERS FROM POSTS
 *
 * A post's hash keys on a few hundred characters and is unlikely to collide.
 * Comments are short and formulaic — "גם אני מחפש" will be typed verbatim by
 * many different people in many different groups. Hashing comment text the way
 * posts are hashed would merge those strangers into a single row, and every
 * merged row is a lead that silently disappears.
 *
 * So the fallback ALWAYS includes the parent post key and the author. Two people
 * writing the same words under the same post stay two rows; the same person
 * writing the same words twice collapses to one, which is the correct trade.
 * A visible duplicate is an annoyance. A merged stranger is a lost customer and
 * nobody ever finds out.
 */
'use strict';

const crypto = require('crypto');
const { normalizeText, normalizeAuthor } = require('./engagementDedup.cjs');

// Comments are short; 200 characters is almost always the whole thing.
const HASH_TEXT_CHARS = 200;
const MAX_COMMENT_TEXT = 600;

/**
 * Pulls a comment id out of a Facebook permalink.
 * Handles ?comment_id=… and the reply form &reply_comment_id=…, preferring the
 * reply id when both are present because that identifies the deeper node.
 */
function extractCommentId(url) {
    if (typeof url !== 'string' || !url) return null;
    const reply = url.match(/[?&]reply_comment_id=(\d{5,})/);
    if (reply) return reply[1];
    const direct = url.match(/[?&]comment_id=(\d{5,})/);
    if (direct) return direct[1];
    return null;
}

/**
 * Canonical comment permalink: https host, path, and only the comment
 * parameters. Every tracking parameter Facebook appends per render is dropped,
 * otherwise the same comment produces a new key on every scan.
 */
function canonicalizeCommentUrl(rawUrl) {
    if (typeof rawUrl !== 'string' || !rawUrl.trim()) return null;
    let parsed;
    try {
        parsed = new URL(rawUrl.trim(), 'https://www.facebook.com');
    } catch {
        return null;
    }
    if (!/facebook\.com$/i.test(parsed.hostname.replace(/^www\./i, ''))) return null;

    const commentId = extractCommentId(rawUrl);
    if (!commentId) return null;

    const path = parsed.pathname.replace(/\/+$/, '');
    return `https://www.facebook.com${path}?comment_id=${commentId}`;
}

function truncateCommentText(value) {
    if (typeof value !== 'string') return '';
    const trimmed = value.trim();
    return trimmed.length > MAX_COMMENT_TEXT ? trimmed.slice(0, MAX_COMMENT_TEXT) : trimmed;
}

/**
 * @param {object} input
 * @param {string} input.workspaceId
 * @param {string} [input.commentId]        Stable Facebook comment id, when derivable.
 * @param {string} [input.commentUrl]       Comment permalink, when derivable.
 * @param {string} input.parentDedupKey     REQUIRED for the fallback — the parent post's key.
 * @param {string} [input.authorName]
 * @param {string} [input.commentText]
 */
function buildCommentDedupKey({
    workspaceId,
    commentId,
    commentUrl,
    parentDedupKey,
    authorName,
    commentText,
} = {}) {
    const explicitId = typeof commentId === 'string' && commentId.trim() ? commentId.trim() : null;
    const derivedId = explicitId || extractCommentId(commentUrl);
    if (derivedId) return { key: `fbc:${derivedId}`, strategy: 'facebook_comment_id' };

    const canonical = canonicalizeCommentUrl(commentUrl);
    if (canonical) return { key: `curl:${canonical}`, strategy: 'canonical_comment_url' };

    // NUL separator so field boundaries cannot be forged by concatenation.
    // parentDedupKey and author are load-bearing here — see the header note.
    const material = [
        workspaceId || '',
        parentDedupKey || '',
        normalizeAuthor(authorName),
        normalizeText(commentText).slice(0, HASH_TEXT_CHARS),
    ].join('\u0000');

    const digest = crypto.createHash('sha256').update(material, 'utf8').digest('hex');
    return { key: `chash:${digest}`, strategy: 'comment_content_hash' };
}

module.exports = {
    HASH_TEXT_CHARS,
    MAX_COMMENT_TEXT,
    extractCommentId,
    canonicalizeCommentUrl,
    truncateCommentText,
    buildCommentDedupKey,
};
