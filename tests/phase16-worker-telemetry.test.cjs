/**
 * Phase 16 - Dashboard worker telemetry.
 *
 * A PAIRED extension heartbeats to /api/workers/:id/heartbeat, which writes to the
 * browser_workers table. The legacy /api/worker/heartbeat instead fills an
 * in-memory per-tenant state, and /api/system/status — which feeds the dashboard's
 * worker/integrity badge — read ONLY that memory. So a paired, perfectly healthy
 * worker showed as OFFLINE with version UNKNOWN indefinitely while the database
 * said online/9.0. (Observed live: browser_workers fresh with extension_version 9.0,
 * popup showing 9.0, dashboard showing a stale heartbeat and vUNKNOWN.)
 *
 * /api/system/status now takes whichever source checked in more recently.
 *
 * Env: SUPABASE_URL, SUPABASE_SERVICE_KEY, SUPABASE_ANON_KEY, API_URL.
 */
const { createClient } = require('@supabase/supabase-js');
const { generateDeviceToken, hashToken } = require('../server/middleware/worker.cjs');

const { SUPABASE_URL, SUPABASE_SERVICE_KEY, SUPABASE_ANON_KEY, API_URL = 'http://localhost:3001' } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !SUPABASE_ANON_KEY) {
    console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_KEY / SUPABASE_ANON_KEY.');
    process.exit(2);
}
if ((SUPABASE_URL || '').includes('hfpsdzfggugoerythnug')) {
    console.error('REFUSING: SUPABASE_URL points at the PRODUCTION project.');
    process.exit(3);
}

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });

let passed = 0, failed = 0;
const assert = (name, cond) => { cond ? (passed++, console.log(`  OK ${name}`)) : (failed++, console.log(`  FAIL ${name}`)); };

async function makeUser(tag) {
    const email = `phase16_${tag}_${Math.random().toString(36).slice(2, 8)}@example.com`;
    const password = `Passw0rd!${tag}`;
    const { error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (error) throw new Error('createUser: ' + error.message);
    const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } });
    const { data, error: sErr } = await anon.auth.signInWithPassword({ email, password });
    if (sErr) throw new Error('signIn: ' + sErr.message);
    await fetch(`${API_URL}/api/queue`, { headers: { Authorization: `Bearer ${data.session.access_token}` } }).catch(() => {});
    const { data: mem } = await admin.from('workspace_members').select('workspace_id').eq('user_id', data.user.id).limit(1);
    return { token: data.session.access_token, userId: data.user.id, workspaceId: mem?.[0]?.workspace_id };
}

const status = async token => {
    const r = await fetch(`${API_URL}/api/system/status`, {
        headers: { Authorization: `Bearer ${token}`, Connection: 'close' },
    });
    return { httpStatus: r.status, body: await r.json().catch(() => null) };
};

(async () => {
    console.log('Phase 16 dashboard worker telemetry\n');

    const user = await makeUser('a');
    const token = generateDeviceToken();

    // A paired worker that checked in seconds ago — the live QA situation.
    const { data: worker, error } = await admin.from('browser_workers').insert({
        workspace_id: user.workspaceId, worker_name: 'phase16', device_token_hash: hashToken(token),
        status: 'online', last_seen_at: new Date().toISOString(),
        extension_version: '9.0', browser_version: 'Chrome/140',
    }).select('id').single();
    if (error) throw new Error('worker insert: ' + error.message);

    const fresh = await status(user.token);
    assert('system status reachable', fresh.httpStatus === 200);
    assert('paired worker reports ACTIVE (was OFFLINE)', fresh.body.worker_status === 'ACTIVE');
    assert('extension version is the real one, not UNKNOWN', fresh.body.worker_version === '9.0');
    assert('last_worker_checkin is populated from the DB heartbeat', !!fresh.body.last_worker_checkin);
    assert('checkin age is fresh (< 90s)',
        (Date.now() - new Date(fresh.body.last_worker_checkin).getTime()) / 1000 < 90);

    // The WorkersPanel list has always been DB-backed; guard it against regressing
    // to the same in-memory source.
    const listRes = await fetch(`${API_URL}/api/workers`, {
        headers: { Authorization: `Bearer ${user.token}`, Connection: 'close' },
    });
    const list = (await listRes.json().catch(() => ({}))).workers || [];
    const mine = list.find(w => w.id === worker.id);
    assert('workers list shows the worker', !!mine);
    assert('workers list carries the extension version', mine && mine.extension_version === '9.0');
    assert('workers list carries last_seen_at', mine && !!mine.last_seen_at);

    // Stale heartbeat must still read as OFFLINE — the fix must not pin it ACTIVE.
    await admin.from('browser_workers')
        .update({ last_seen_at: new Date(Date.now() - 5 * 60 * 1000).toISOString() })
        .eq('id', worker.id);
    const stale = await status(user.token);
    assert('a stale heartbeat still reports OFFLINE', stale.body.worker_status === 'OFFLINE');
    assert('stale state still reports the known version', stale.body.worker_version === '9.0');
    assert('stale checkin timestamp reflects the old heartbeat',
        (Date.now() - new Date(stale.body.last_worker_checkin).getTime()) / 1000 > 120);

    // A workspace with no worker at all must not invent one.
    const other = await makeUser('b');
    const empty = await status(other.token);
    assert('workspace with no worker reports OFFLINE', empty.body.worker_status === 'OFFLINE');
    assert('workspace with no worker reports no checkin', empty.body.last_worker_checkin === null);

    // Cleanup.
    await admin.from('browser_workers').delete().eq('id', worker.id);
    await admin.auth.admin.deleteUser(user.userId).catch(() => {});
    await admin.auth.admin.deleteUser(other.userId).catch(() => {});

    console.log(`\n${passed} passed, ${failed} failed`);
    process.exitCode = failed ? 1 : 0;
})().catch(err => {
    console.error('Test run error:', err.message);
    process.exitCode = 2;
});
