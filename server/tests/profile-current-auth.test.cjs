/**
 * Regression test for /api/profile/current dashboard auth behavior.
 *
 * Env:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_KEY
 *   SUPABASE_ANON_KEY
 *   API_URL
 */
const { createClient } = require('@supabase/supabase-js');

const {
    SUPABASE_URL,
    SUPABASE_SERVICE_KEY,
    SUPABASE_ANON_KEY,
    API_URL = 'http://localhost:3001',
} = process.env;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !SUPABASE_ANON_KEY) {
    console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_KEY / SUPABASE_ANON_KEY.');
    process.exit(2);
}
if ((SUPABASE_URL || '').includes('namyhsldzufeoycleqxf')) {
    console.error('REFUSING: SUPABASE_URL points at the production project.');
    process.exit(3);
}

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });

let passed = 0;
let failed = 0;
function assert(name, cond) {
    if (cond) { passed++; console.log(`  OK ${name}`); }
    else { failed++; console.log(`  FAIL ${name}`); }
}

async function api(path, { token, workspaceId, method = 'GET', body, workerId, deviceToken } = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (workspaceId) headers['x-workspace-id'] = workspaceId;
    if (workerId) headers['x-worker-id'] = workerId;
    if (deviceToken) headers['x-device-token'] = deviceToken;
    const res = await fetch(`${API_URL}/api${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
    let json = null;
    try { json = await res.json(); } catch {}
    return { status: res.status, json };
}

async function makeUser(tag) {
    const email = `profile_auth_${tag}_${Math.random().toString(36).slice(2, 8)}@example.com`;
    const password = `Passw0rd!${tag}`;
    const { error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (error) throw new Error(`createUser ${tag}: ${error.message}`);

    const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } });
    const { data, error: signInErr } = await anon.auth.signInWithPassword({ email, password });
    if (signInErr) throw new Error(`signIn ${tag}: ${signInErr.message}`);

    await fetch(`${API_URL}/api/queue`, { headers: { Authorization: `Bearer ${data.session.access_token}` } }).catch(() => {});
    const { data: mem } = await admin
        .from('workspace_members')
        .select('workspace_id')
        .eq('user_id', data.user.id)
        .limit(1);
    return { userId: data.user.id, token: data.session.access_token, workspaceId: mem?.[0]?.workspace_id };
}

(async () => {
    console.log('Profile current auth regression\n');

    const A = await makeUser('a');
    const B = await makeUser('b');

    const ownProfile = await api('/profile/current', { token: A.token, workspaceId: A.workspaceId });
    assert('authenticated dashboard user can access /profile/current', ownProfile.status === 200 && ownProfile.json && 'current_user' in ownProfile.json);

    const anonProfile = await api('/profile/current');
    assert('unauthenticated /profile/current is rejected', anonProfile.status === 401);

    const crossWorkspace = await api('/profile/current', { token: A.token, workspaceId: B.workspaceId });
    assert('dashboard user cannot access another workspace profile', crossWorkspace.status === 403);

    const workerRouteAnon = await api('/jobs/next');
    assert('worker route still rejects anonymous requests', workerRouteAnon.status === 401);

    const workerRouteBadCreds = await api('/workers/not-a-uuid/jobs/claim', { method: 'POST', workerId: 'not-a-uuid', deviceToken: 'bad-token' });
    assert('worker route still rejects malformed worker credentials', workerRouteBadCreds.status === 401);

    await admin.auth.admin.deleteUser(A.userId).catch(() => {});
    await admin.auth.admin.deleteUser(B.userId).catch(() => {});

    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed ? 1 : 0);
})().catch((err) => {
    console.error('Test run error:', err.message);
    process.exit(2);
});
