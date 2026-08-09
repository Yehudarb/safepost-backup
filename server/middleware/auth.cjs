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

// Ensure a user has a personal workspace, creating one on first access.
// Backend-side provisioning (uses the service key) so we don't depend on a DB
// trigger on auth.users, which newer Supabase projects don't permit.
async function provisionUserWorkspace(user) {
    try {
        await supabase.from('profiles').upsert(
            { id: user.id, email: user.email, full_name: (user.user_metadata && user.user_metadata.full_name) || user.email },
            { onConflict: 'id' }
        );
        const wsName = ((user.email || 'my').split('@')[0]) + "'s workspace";
        const { data: ws, error } = await supabase
            .from('workspaces')
            .insert({ name: wsName, is_personal: true, created_by: user.id })
            .select('id')
            .single();
        if (error || !ws) { console.error('[provision] workspace insert failed:', error && error.message); return null; }
        await supabase.from('workspace_members').insert({ workspace_id: ws.id, user_id: user.id, role: 'owner' });
        return ws;
    } catch (e) {
        console.error('[provision] failed:', e.message);
        return null;
    }
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
        .select('workspace_id, role, workspaces(is_demo)')
        .eq('user_id', req.user.id);
    if (requested) query = query.eq('workspace_id', requested);

    const { data, error } = await query.limit(1);

    if (error) {
        if (AUTH_ENFORCED) return res.status(500).json({ error: 'Failed to resolve workspace access.' });
        req.workspaceId = null;
        return next();
    }
    if (!data || data.length === 0) {
        // Asked for a specific workspace they don't belong to → deny.
        if (requested) {
            if (AUTH_ENFORCED) return res.status(403).json({ error: 'No access to the requested workspace.' });
            req.workspaceId = null;
            return next();
        }
        // First-time user with no workspace → provision a personal one.
        const ws = await provisionUserWorkspace(req.user);
        if (!ws) {
            if (AUTH_ENFORCED) return res.status(500).json({ error: 'Failed to provision workspace.' });
            req.workspaceId = null;
            return next();
        }
        req.workspaceId = ws.id;
        req.membershipRole = 'owner';
        req.isDemo = false;
        return next();
    }

    req.workspaceId = data[0].workspace_id;
    req.membershipRole = data[0].role;
    req.isDemo = data[0].workspaces?.is_demo === true;
    next();
}

// Block real-effect actions in a demo workspace with a clear message.
// Must run after requireWorkspaceAccess.
function denyDemo(req, res, next) {
    if (req.isDemo) {
        return res.status(403).json({ error: 'Demo mode — this action is disabled. No real posts are published.', demo: true });
    }
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
    provisionUserWorkspace,
    denyDemo,
    getBearerToken,
    resolveUser,
    scopeToWorkspace,
    workspaceFields,
};
