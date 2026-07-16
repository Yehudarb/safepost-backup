// Phase 3 — Authentication & workspace-access middleware.
//
// The dashboard sends the Supabase access token as `Authorization: Bearer <jwt>`
// and the active workspace as `x-workspace-id`. We NEVER trust a user_id or
// workspace ownership claimed by the client — both are validated here against
// Supabase (token) and workspace_members (membership).
//
// TRANSITION SAFETY: enforcement is gated by AUTH_ENFORCED. When it is not
// 'true' (production today), these behave as pass-throughs that merely attach
// req.user/req.workspaceId when a valid token happens to be present — so the
// app keeps working openly and unscoped, exactly as before. Set
// AUTH_ENFORCED=true (dev, then the reviewed cutover) to require auth and
// scope every query.

const { supabase } = require('../supabaseClient.cjs');

const AUTH_ENFORCED = process.env.AUTH_ENFORCED === 'true';

function getBearerToken(req) {
    const header = req.headers['authorization'] || '';
    const [scheme, token] = header.split(' ');
    if (scheme === 'Bearer' && token) return token.trim();
    return null;
}

// Validate the JWT with Supabase and return the user (or null).
async function resolveUser(token) {
    if (!token) return null;
    try {
        const { data, error } = await supabase.auth.getUser(token);
        if (error || !data || !data.user) return null;
        return data.user;
    } catch {
        return null;
    }
}

// Attach req.user from the token if present. Blocks anonymous access only when
// AUTH_ENFORCED is on.
async function requireAuth(req, res, next) {
    req.user = await resolveUser(getBearerToken(req));
    if (AUTH_ENFORCED && !req.user) {
        return res.status(401).json({ error: 'Authentication required.' });
    }
    next();
}

// Attach req.user if a valid token is present, but never block.
async function optionalAuth(req, res, next) {
    req.user = await resolveUser(getBearerToken(req));
    next();
}

// Resolve and authorize the active workspace. Workspace id comes from
// `x-workspace-id` (or ?workspace_id); if absent we fall back to the user's
// first membership. Sets req.workspaceId + req.membershipRole. When
// AUTH_ENFORCED is off and there is no authenticated user, leaves
// req.workspaceId null (queries stay global/unscoped — legacy behavior).
async function requireWorkspaceAccess(req, res, next) {
    if (!req.user) {
        if (AUTH_ENFORCED) return res.status(401).json({ error: 'Authentication required.' });
        req.workspaceId = null;
        return next();
    }

    const requested = req.headers['x-workspace-id'] || req.query.workspace_id || null;

    let query = supabase
        .from('workspace_members')
        .select('workspace_id, role')
        .eq('user_id', req.user.id);
    if (requested) query = query.eq('workspace_id', requested);

    const { data, error } = await query.limit(1);

    if (error) {
        if (AUTH_ENFORCED) return res.status(500).json({ error: 'Failed to resolve workspace access.' });
        req.workspaceId = null;
        return next();
    }
    if (!data || data.length === 0) {
        if (AUTH_ENFORCED) return res.status(403).json({ error: 'No access to the requested workspace.' });
        req.workspaceId = null;
        return next();
    }

    req.workspaceId = data[0].workspace_id;
    req.membershipRole = data[0].role;
    next();
}

// Add a workspace filter to a Supabase query builder, but only when a workspace
// is resolved (so legacy/open mode stays global).
function scopeToWorkspace(query, req) {
    if (req && req.workspaceId) return query.eq('workspace_id', req.workspaceId);
    return query;
}

// Ownership columns to attach to INSERTs, only when a workspace is resolved.
// Omitting them in legacy mode keeps inserts valid on the pre-migration schema.
function workspaceFields(req) {
    if (req && req.workspaceId) {
        return { workspace_id: req.workspaceId, created_by: req.user ? req.user.id : null };
    }
    return {};
}

module.exports = {
    AUTH_ENFORCED,
    requireAuth,
    optionalAuth,
    requireWorkspaceAccess,
    getBearerToken,
    resolveUser,
    scopeToWorkspace,
    workspaceFields,
};
