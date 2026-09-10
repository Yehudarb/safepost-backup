/**
 * Engagement Watches — saved definitions of what a workspace is looking for.
 *
 * Validation lives here rather than in the route so the same rules apply to a
 * create, a patch and a preview. Every query is workspace-scoped by the caller's
 * verified workspace; a watch id alone is never enough to reach a row.
 *
 * Phase 2A holds only keyword and phrase matching. `match_mode` therefore
 * accepts 'exact' and 'flexible' and nothing else — 'semantic' is not a value
 * the database or this service will take, because the capability does not exist
 * and a row must not be able to claim behaviour the matcher cannot deliver.
 */
'use strict';

const { supabase } = require('../supabaseClient.cjs');
const { MATCH_MODES } = require('../lib/engagementMatcher.cjs');

const MAX_NAME = 120;
const MAX_QUERY = 500;
const MAX_TERMS = 40;
const MAX_TERM_LENGTH = 120;
const MAX_GROUPS = 5;

const SELECT_FIELDS = [
    'id', 'workspace_id', 'name', 'query_text', 'match_mode',
    'keywords', 'exact_phrases', 'exclude_terms', 'selected_group_ids',
    'include_posts', 'include_comments', 'enabled', 'created_at', 'updated_at',
].join(', ');

class ValidationError extends Error {
    constructor(message) {
        super(message);
        this.name = 'ValidationError';
        this.status = 400;
    }
}

function cleanString(value, { field, min = 1, max }) {
    if (typeof value !== 'string') throw new ValidationError(`${field} must be a string.`);
    const trimmed = value.trim();
    if (trimmed.length < min) throw new ValidationError(`${field} is required.`);
    if (trimmed.length > max) throw new ValidationError(`${field} must be at most ${max} characters.`);
    return trimmed;
}

/** Normalises a term list: trims, drops blanks, de-duplicates, bounds size. */
function cleanTermList(value, field) {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value)) throw new ValidationError(`${field} must be an array.`);
    const seen = new Set();
    for (const entry of value) {
        if (typeof entry !== 'string') throw new ValidationError(`${field} must contain only strings.`);
        const trimmed = entry.trim();
        if (!trimmed) continue;
        if (trimmed.length > MAX_TERM_LENGTH) {
            throw new ValidationError(`${field} entries must be at most ${MAX_TERM_LENGTH} characters.`);
        }
        seen.add(trimmed);
    }
    if (seen.size > MAX_TERMS) throw new ValidationError(`${field} may contain at most ${MAX_TERMS} entries.`);
    return [...seen];
}

function cleanGroupIds(value) {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value)) throw new ValidationError('selected_group_ids must be an array.');
    const ids = [];
    for (const entry of value) {
        const id = typeof entry === 'string' || typeof entry === 'number' ? String(entry).trim() : '';
        if (!id) continue;
        if (!ids.includes(id)) ids.push(id);
    }
    // The scan caps are the product's safety story; a watch must not be able to
    // encode a target set larger than a scan is allowed to visit.
    if (ids.length > MAX_GROUPS) throw new ValidationError(`selected_group_ids may contain at most ${MAX_GROUPS} groups.`);
    return ids;
}

function cleanBoolean(value, fallback) {
    if (value === undefined || value === null) return fallback;
    if (typeof value !== 'boolean') throw new ValidationError('Expected a boolean value.');
    return value;
}

/** Builds the row for a create. Throws ValidationError on bad input. */
function buildCreatePayload(body = {}) {
    const matchMode = body.match_mode === undefined ? 'flexible' : body.match_mode;
    if (!MATCH_MODES.includes(matchMode)) {
        throw new ValidationError(`match_mode must be one of: ${MATCH_MODES.join(', ')}.`);
    }

    const includePosts = cleanBoolean(body.include_posts, true);
    const includeComments = cleanBoolean(body.include_comments, false);
    if (!includePosts && !includeComments) {
        throw new ValidationError('A watch must include posts, comments, or both.');
    }

    return {
        name: cleanString(body.name, { field: 'name', max: MAX_NAME }),
        query_text: cleanString(body.query_text, { field: 'query_text', min: 2, max: MAX_QUERY }),
        match_mode: matchMode,
        keywords: cleanTermList(body.keywords, 'keywords'),
        exact_phrases: cleanTermList(body.exact_phrases, 'exact_phrases'),
        exclude_terms: cleanTermList(body.exclude_terms, 'exclude_terms'),
        selected_group_ids: cleanGroupIds(body.selected_group_ids),
        include_posts: includePosts,
        include_comments: includeComments,
        enabled: cleanBoolean(body.enabled, true),
    };
}

/** Only the fields actually present are validated and returned. */
function buildUpdatePayload(body = {}) {
    const payload = {};
    if (body.name !== undefined) payload.name = cleanString(body.name, { field: 'name', max: MAX_NAME });
    if (body.query_text !== undefined) {
        payload.query_text = cleanString(body.query_text, { field: 'query_text', min: 2, max: MAX_QUERY });
    }
    if (body.match_mode !== undefined) {
        if (!MATCH_MODES.includes(body.match_mode)) {
            throw new ValidationError(`match_mode must be one of: ${MATCH_MODES.join(', ')}.`);
        }
        payload.match_mode = body.match_mode;
    }
    if (body.keywords !== undefined) payload.keywords = cleanTermList(body.keywords, 'keywords');
    if (body.exact_phrases !== undefined) payload.exact_phrases = cleanTermList(body.exact_phrases, 'exact_phrases');
    if (body.exclude_terms !== undefined) payload.exclude_terms = cleanTermList(body.exclude_terms, 'exclude_terms');
    if (body.selected_group_ids !== undefined) payload.selected_group_ids = cleanGroupIds(body.selected_group_ids);
    if (body.include_posts !== undefined) payload.include_posts = cleanBoolean(body.include_posts, true);
    if (body.include_comments !== undefined) payload.include_comments = cleanBoolean(body.include_comments, false);
    if (body.enabled !== undefined) payload.enabled = cleanBoolean(body.enabled, true);

    if (!Object.keys(payload).length) throw new ValidationError('No supported fields were supplied.');

    const nextPosts = payload.include_posts;
    const nextComments = payload.include_comments;
    if (nextPosts === false && nextComments === false) {
        throw new ValidationError('A watch must include posts, comments, or both.');
    }

    payload.updated_at = new Date().toISOString();
    return payload;
}

/** Shapes a database row into the matcher's expected watch object. */
function toMatcherWatch(row) {
    return {
        matchMode: row.match_mode,
        queryText: row.query_text,
        keywords: Array.isArray(row.keywords) ? row.keywords : [],
        exactPhrases: Array.isArray(row.exact_phrases) ? row.exact_phrases : [],
        excludeTerms: Array.isArray(row.exclude_terms) ? row.exclude_terms : [],
    };
}

async function listWatches(workspaceId) {
    return supabase
        .from('engagement_watches')
        .select(SELECT_FIELDS)
        .eq('workspace_id', workspaceId)
        .order('created_at', { ascending: false });
}

/**
 * Fetches one watch, scoped to the workspace.
 *
 * The scoping is in the query rather than checked afterwards on purpose: a
 * missing row and a row belonging to another tenant are indistinguishable to the
 * caller, so a probe cannot confirm that an id exists elsewhere.
 */
async function getWatch(workspaceId, watchId) {
    return supabase
        .from('engagement_watches')
        .select(SELECT_FIELDS)
        .eq('workspace_id', workspaceId)
        .eq('id', watchId)
        .maybeSingle();
}

async function createWatch(workspaceId, createdBy, body) {
    const payload = buildCreatePayload(body);
    return supabase
        .from('engagement_watches')
        .insert({ ...payload, workspace_id: workspaceId, created_by: createdBy || null })
        .select(SELECT_FIELDS)
        .single();
}

async function updateWatch(workspaceId, watchId, body) {
    const payload = buildUpdatePayload(body);
    return supabase
        .from('engagement_watches')
        .update(payload)
        .eq('workspace_id', workspaceId)
        .eq('id', watchId)
        .select(SELECT_FIELDS)
        .maybeSingle();
}

async function deleteWatch(workspaceId, watchId) {
    return supabase
        .from('engagement_watches')
        .delete()
        .eq('workspace_id', workspaceId)
        .eq('id', watchId)
        .select('id')
        .maybeSingle();
}

module.exports = {
    ValidationError,
    MAX_NAME,
    MAX_QUERY,
    MAX_TERMS,
    MAX_GROUPS,
    SELECT_FIELDS,
    buildCreatePayload,
    buildUpdatePayload,
    toMatcherWatch,
    listWatches,
    getWatch,
    createWatch,
    updateWatch,
    deleteWatch,
};
