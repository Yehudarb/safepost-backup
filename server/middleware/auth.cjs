// Phase 3 — Authentication & workspace-access middleware.
//
// The dashboard sends the Supabase access token as `Authorization: Bearer <jwt>`
// and the active workspace as `x-workspace-id`. We NEVER trust a user_id or
// workspace ownership claimed by the client — both are validated here against
// Supabase (token) and workspace_members (membership).

const { supabase } = require('../supabaseClient.cjs');

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

// Require a valid authenticated user. Sets req.user.
async function requireAuth(req, res, next) {
    const user = await resolveUser(getBearerToken(req));
    if (!user) {
        return res.status(401).json({ error: 'Authentication required.' });
    }
    req.user = user;
    next();
}

// Attach req.user if a valid token is present, but don't block anonymous access.
async function optionalAuth(req, res, next) {
    req.user = await resolveUser(getBearerToken(req));
    next();
}

// Resolve and authorize the active workspace for the authenticated user.
// Workspace id comes from `x-workspace-id` (or ?workspace_id); if absent we fall
// back to the user's first membership. Verifies membership before proceeding.
// Sets req.workspaceId and req.membershipRole. Must run after requireAuth.
async function requireWorkspaceAccess(req, res, next) {
    if (!req.user) {
        return res.status(401).json({ error: 'Authentication required.' });
    }

    const requested = req.headers['x-workspace-id'] || req.query.workspace_id || null;

    let query = supabase
        .from('workspace_members')
        .select('workspace_id, role')
        .eq('user_id', req.user.id);

    if (requested) query = query.eq('workspace_id', requested);

    const { data, error } = await query.limit(1);

    if (error) {
        return res.status(500).json({ error: 'Failed to resolve workspace access.' });
    }
    if (!data || data.length === 0) {
        // Either not a member of the requested workspace, or no workspace at all.
        return res.status(403).json({ error: 'No access to the requested workspace.' });
    }

    req.workspaceId = data[0].workspace_id;
    req.membershipRole = data[0].role;
    next();
}

module.exports = { requireAuth, optionalAuth, requireWorkspaceAccess, getBearerToken, resolveUser };
