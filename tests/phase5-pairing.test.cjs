/**
 * Phase 5 — Extension pairing / worker isolation tests.
 *
 * Prereqs: migrations 0000-0002,0005,0006 applied to dev; backend running with
 * AUTH_ENFORCED=true; demo account seeded (scripts/setup-demo.cjs).
 * Env: SUPABASE_URL, SUPABASE_SERVICE_KEY, SUPABASE_ANON_KEY,
 *      DEMO_EMAIL, DEMO_PASSWORD, API_URL.
 *
 * Run: node tests/phase5-pairing.test.cjs
 */
const { createClient } = require('@supabase/supabase-js');

const {
    SUPABASE_URL, SUPABASE_SERVICE_KEY, SUPABASE_ANON_KEY,
    DEMO_EMAIL, DEMO_PASSWORD, API_URL = 'http://localhost:3001',
} = process.env;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !SUPABASE_ANON_KEY) {
    console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_KEY / SUPABASE_ANON_KEY.');
    process.exit(2);
}
if ((SUPABASE_URL || '').includes('namyhsldzufeoycleqxf')) {
    console.error('❌ REFUSING: SUPABASE_URL points at the PRODUCTION project.');
    process.exit(3);
}

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
let passed = 0, failed = 0;
const assert = (n, c) => { c ? (passed++, console.log(`  ✅ ${n}`)) : (failed++, console.log(`  ❌ ${n}`)); };

async function api(path, { token, workspaceId, workerId, deviceToken, method = 'POST', body } = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    if (workspaceId) headers['x-workspace-id'] = workspaceId;
    if (workerId) headers['x-worker-id'] = workerId;
    if (deviceToken) headers['x-device-token'] = deviceToken;
    const res = await fetch(`${API_URL}/api${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
    let json = null; try { json = await res.json(); } catch {}
    return { status: res.status, json };
}

async function makeUser(tag) {
    const email = `phase5_${tag}_${Math.random().toString(36).slice(2, 8)}@example.com`;
    const password = 'Passw0rd!' + tag;
    const { error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (error) throw new Error(`createUser ${tag}: ${error.message}`);
    const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } });
    const { data, error: sErr } = await anon.auth.signInWithPassword({ email, password });
    if (sErr) throw new Error(`signIn ${tag}: ${sErr.message}`);
    const token = data.session.access_token;
    await fetch(`${API_URL}/api/queue`, { headers: { 'Authorization': `Bearer ${token}` } }).catch(() => {});
    const { data: mem } = await admin.from('workspace_members').select('workspace_id').eq('user_id', data.user.id).limit(1);
    return { email, token, userId: data.user.id, workspaceId: mem?.[0]?.workspace_id };
}

(async () => {
    console.log('Phase 5 pairing tests\n');

    const A = await makeUser('a');
    const B = await makeUser('b');

    // Demo cannot pair.
    const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } });
    const { data: demo } = await anon.auth.signInWithPassword({ email: DEMO_EMAIL, password: DEMO_PASSWORD });
    const demoMem = await admin.from('workspace_members').select('workspace_id').eq('user_id', demo.user.id).limit(1);
    const demoCode = await api('/workers/pairing-code', { token: demo.session.access_token, workspaceId: demoMem.data?.[0]?.workspace_id });
    assert('demo user cannot generate a pairing code (403)', demoCode.status === 403);

    // A generates a pairing code and pairs a worker.
    const codeRes = await api('/workers/pairing-code', { token: A.token, workspaceId: A.workspaceId });
    assert('A generates a pairing code', codeRes.status === 200 && !!codeRes.json?.code);
    const code = codeRes.json.code;

    const pair = await api('/workers/pair', { body: { code, worker_name: 'A Office PC', extension_version: '7.3' } });
    assert('pair exchanges code for a device token', pair.status === 200 && !!pair.json?.device_token && !!pair.json?.worker_id);
    const A_worker = pair.json.worker_id, A_token = pair.json.device_token;

    // Single-use.
    const reuse = await api('/workers/pair', { body: { code } });
    assert('pairing code is single-use (409 on reuse)', reuse.status === 409);

    // Expiration.
    const c2 = await api('/workers/pairing-code', { token: A.token, workspaceId: A.workspaceId });
    await admin.from('pairing_codes').update({ expires_at: new Date(Date.now() - 1000).toISOString() }).eq('code', c2.json.code);
    const expired = await api('/workers/pair', { body: { code: c2.json.code } });
    assert('expired pairing code rejected (410)', expired.status === 410);

    // Worker heartbeat with a valid token.
    const hb = await api(`/workers/${A_worker}/heartbeat`, { workerId: A_worker, deviceToken: A_token, body: { status: 'online' } });
    assert('worker heartbeat accepted with valid token', hb.status === 200);

    // Invalid token rejected.
    const badTok = await api(`/workers/${A_worker}/heartbeat`, { workerId: A_worker, deviceToken: 'deadbeef', body: {} });
    assert('worker heartbeat rejected with wrong token (401)', badTok.status === 401);

    // B pairs their own worker.
    const bCode = await api('/workers/pairing-code', { token: B.token, workspaceId: B.workspaceId });
    const bPair = await api('/workers/pair', { body: { code: bCode.json.code, worker_name: 'B Laptop' } });
    const B_worker = bPair.json.worker_id, B_token = bPair.json.device_token;

    // A cannot revoke B's worker.
    const crossRevoke = await api(`/workers/${B_worker}/revoke`, { token: A.token, workspaceId: A.workspaceId });
    assert('A cannot revoke B worker (403)', crossRevoke.status === 403);

    // Job isolation: seed a SENT job in each workspace, worker claims only its own.
    await admin.from('posts').insert([
        { content: 'A-job', status: 'SENT', app_source: 'backup', workspace_id: A.workspaceId, scheduled_time: new Date(Date.now() - 60000).toISOString() },
        { content: 'B-job', status: 'SENT', app_source: 'backup', workspace_id: B.workspaceId, scheduled_time: new Date(Date.now() - 60000).toISOString() },
    ]);
    const aClaim = await api(`/workers/${A_worker}/jobs/claim`, { workerId: A_worker, deviceToken: A_token });
    assert('A worker claims a job from its own workspace', aClaim.status === 200 && aClaim.json?.job?.content === 'A-job');
    assert('claimed job belongs to A workspace', aClaim.json?.job?.workspace_id === A.workspaceId);
    const bClaim = await api(`/workers/${B_worker}/jobs/claim`, { workerId: B_worker, deviceToken: B_token });
    assert('B worker claims only its own job', bClaim.status === 200 && bClaim.json?.job?.content === 'B-job');

    // Revoked token rejected.
    const revoke = await api(`/workers/${A_worker}/revoke`, { token: A.token, workspaceId: A.workspaceId });
    assert('A revokes its own worker', revoke.status === 200);
    const afterRevoke = await api(`/workers/${A_worker}/heartbeat`, { workerId: A_worker, deviceToken: A_token, body: {} });
    assert('revoked worker token rejected (403)', afterRevoke.status === 403);

    // Cleanup.
    await admin.from('posts').delete().in('workspace_id', [A.workspaceId, B.workspaceId]);
    await admin.from('browser_workers').delete().in('workspace_id', [A.workspaceId, B.workspaceId]);
    await admin.auth.admin.deleteUser(A.userId).catch(() => {});
    await admin.auth.admin.deleteUser(B.userId).catch(() => {});

    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed ? 1 : 0);
})().catch(e => { console.error('Test run error:', e.message); process.exit(2); });
