/**
 * Phase 3 — Authentication & workspace isolation tests.
 *
 * Runs against the DEV Supabase project + a locally running backend with
 * AUTH_ENFORCED=true. Creates two independent users, gives each some data,
 * and asserts strict isolation.
 *
 * Prerequisites:
 *   1. Migrations 0001..0004 applied to the dev project.
 *   2. Backend running with the dev SUPABASE_URL/SERVICE_KEY and AUTH_ENFORCED=true.
 *   3. Env for this script:
 *        SUPABASE_URL           dev project url
 *        SUPABASE_SERVICE_KEY   dev service role key (to create users)
 *        SUPABASE_ANON_KEY      dev anon key (to sign in)
 *        API_URL                backend base, e.g. http://localhost:3001
 *
 * Run:  node tests/phase3-isolation.test.cjs
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
// SAFETY: these tests create/delete users + data — never against production.
if ((SUPABASE_URL || '').includes('namyhsldzufeoycleqxf')) {
    console.error('❌ REFUSING: SUPABASE_URL points at the PRODUCTION project. Use the dev project.');
    process.exit(3);
}

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });

let passed = 0, failed = 0;
function assert(name, cond) {
    if (cond) { passed++; console.log(`  ✅ ${name}`); }
    else { failed++; console.log(`  ❌ ${name}`); }
}

async function api(path, { token, workspaceId, method = 'GET', body } = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    if (workspaceId) headers['x-workspace-id'] = workspaceId;
    const res = await fetch(`${API_URL}/api${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
    let json = null; try { json = await res.json(); } catch { /* noop */ }
    return { status: res.status, json };
}

async function makeUser(tag) {
    const email = `phase3_${tag}_${Math.random().toString(36).slice(2, 8)}@example.com`;
    const password = 'Passw0rd!' + tag;
    const { error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (error) throw new Error(`createUser ${tag}: ${error.message}`);
    const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } });
    const { data, error: signInErr } = await anon.auth.signInWithPassword({ email, password });
    if (signInErr) throw new Error(`signIn ${tag}: ${signInErr.message}`);
    // Warm-up call: triggers backend workspace provisioning on first access.
    await fetch(`${API_URL}/api/queue`, { headers: { 'Authorization': `Bearer ${data.session.access_token}` } }).catch(() => {});
    const { data: mem } = await admin.from('workspace_members').select('workspace_id').eq('user_id', data.user.id).limit(1);
    return { email, token: data.session.access_token, userId: data.user.id, workspaceId: mem?.[0]?.workspace_id };
}

(async () => {
    console.log('Phase 3 isolation tests\n');

    // --- unauthorized access ---
    console.log('Unauthorized access:');
    assert('GET /queue without token → 401', (await api('/queue')).status === 401);
    assert('GET /groups without token → 401', (await api('/groups')).status === 401);

    // --- users + private workspaces ---
    console.log('\nProvisioning:');
    const A = await makeUser('a');
    const B = await makeUser('b');
    assert('User A got a personal workspace', !!A.workspaceId);
    assert('User B got a personal workspace', !!B.workspaceId);
    assert('A and B have different workspaces', A.workspaceId !== B.workspaceId);

    // --- login works (token accepted) ---
    console.log('\nAuthenticated access:');
    assert('A can list own queue → 200', (await api('/queue', { token: A.token, workspaceId: A.workspaceId })).status === 200);

    // --- A creates a template; B must not see it ---
    console.log('\nIsolation:');
    const created = await api('/templates', { token: A.token, workspaceId: A.workspaceId, method: 'POST', body: { name: 'A-secret', content: 'hello' } });
    assert('A can create a template', created.status === 200 && created.json?.success);

    const aList = await api('/templates', { token: A.token, workspaceId: A.workspaceId });
    assert('A sees own template', (aList.json?.templates || []).some(t => t.name === 'A-secret'));

    const bList = await api('/templates', { token: B.token, workspaceId: B.workspaceId });
    assert('B cannot see A template', !(bList.json?.templates || []).some(t => t.name === 'A-secret'));

    // --- B cannot act in A's workspace (membership check) ---
    const bIntoA = await api('/templates', { token: B.token, workspaceId: A.workspaceId });
    assert('B using A workspace id → 403', bIntoA.status === 403);

    // --- B cannot delete A's template ---
    const aTemplateId = (aList.json?.templates || []).find(t => t.name === 'A-secret')?.id;
    if (aTemplateId) {
        const del = await api(`/templates/${aTemplateId}`, { token: B.token, workspaceId: B.workspaceId, method: 'DELETE' });
        const aStillThere = await api('/templates', { token: A.token, workspaceId: A.workspaceId });
        assert('B delete of A template does not remove it', (aStillThere.json?.templates || []).some(t => t.id === aTemplateId));
        // cleanup
        await api(`/templates/${aTemplateId}`, { token: A.token, workspaceId: A.workspaceId, method: 'DELETE' });
    }

    // --- cleanup users ---
    await admin.auth.admin.deleteUser(A.userId).catch(() => {});
    await admin.auth.admin.deleteUser(B.userId).catch(() => {});

    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed ? 1 : 0);
})().catch(err => { console.error('Test run error:', err.message); process.exit(2); });
