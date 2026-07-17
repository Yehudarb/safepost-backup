/**
 * Phase 4 — Demo mode tests.
 *
 * Prerequisites:
 *   1. Migrations 0001..0005 applied to the dev project.
 *   2. `node scripts/setup-demo.cjs` has created + seeded the demo workspace.
 *   3. Backend running with AUTH_ENFORCED=true against the dev DB.
 *   4. Env: SUPABASE_URL, SUPABASE_ANON_KEY, DEMO_EMAIL, DEMO_PASSWORD, API_URL.
 *
 * Run:  node tests/phase4-demo.test.cjs
 */
const { createClient } = require('@supabase/supabase-js');

const {
    SUPABASE_URL, SUPABASE_ANON_KEY,
    DEMO_EMAIL, DEMO_PASSWORD,
    API_URL = 'http://localhost:3001',
} = process.env;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !DEMO_EMAIL || !DEMO_PASSWORD) {
    console.error('Missing SUPABASE_URL / SUPABASE_ANON_KEY / DEMO_EMAIL / DEMO_PASSWORD.');
    process.exit(2);
}
// SAFETY: never run demo tests against the production project.
if ((SUPABASE_URL || '').includes('namyhsldzufeoycleqxf')) {
    console.error('❌ REFUSING: SUPABASE_URL points at the PRODUCTION project. Use the dev project.');
    process.exit(3);
}

let passed = 0, failed = 0;
const assert = (n, c) => { c ? (passed++, console.log(`  ✅ ${n}`)) : (failed++, console.log(`  ❌ ${n}`)); };

(async () => {
    const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } });
    const { data, error } = await anon.auth.signInWithPassword({ email: DEMO_EMAIL, password: DEMO_PASSWORD });
    if (error) { console.error('Demo sign-in failed:', error.message); process.exit(2); }

    const token = data.session.access_token;
    const { data: mem } = await createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } })
        .from('workspace_members').select('workspace_id, workspaces(is_demo)').eq('user_id', data.user.id).limit(1);
    const wsId = mem?.[0]?.workspace_id;

    const api = async (path, { method = 'GET' } = {}) => {
        const res = await fetch(`${API_URL}/api${path}`, {
            method, headers: { 'Authorization': `Bearer ${token}`, 'x-workspace-id': wsId, 'Content-Type': 'application/json' },
        });
        let json = null; try { json = await res.json(); } catch {}
        return { status: res.status, json };
    };

    console.log('Phase 4 demo tests\n');
    assert('demo workspace flagged is_demo', mem?.[0]?.workspaces?.is_demo === true);

    const queue = await api('/queue');
    assert('demo sees seeded synthetic queue', queue.status === 200 && Array.isArray(queue.json?.queue) && queue.json.queue.length > 0);

    const groups = await api('/groups');
    assert('demo groups are synthetic (example.com only)', (groups.json?.groups || []).every(g => !g.url || g.url.includes('example.com')));

    const upload = await api('/upload', { method: 'POST' });
    assert('demo cannot upload (403 demo)', upload.status === 403 && upload.json?.demo === true);

    const stop = await api('/worker/stop', { method: 'POST' });
    assert('demo cannot control worker (403 demo)', stop.status === 403 && stop.json?.demo === true);

    const reset = await api('/demo/reset', { method: 'POST' });
    assert('demo reset works', reset.status === 200 && reset.json?.success);

    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed ? 1 : 0);
})().catch(err => { console.error('Test run error:', err.message); process.exit(2); });
