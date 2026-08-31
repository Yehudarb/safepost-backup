/**
 * Phase 8 - Scheduling isolation regression test.
 *
 * Verifies that POST /api/posts calculates the next slot only from the
 * caller's workspace queue, never from another workspace's queued posts.
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

let passed = 0, failed = 0;
const assert = (name, cond) => { cond ? (passed++, console.log(`  OK ${name}`)) : (failed++, console.log(`  FAIL ${name}`)); };

async function api(path, { token, workspaceId, method = 'GET', body } = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (workspaceId) headers['x-workspace-id'] = workspaceId;
    const res = await fetch(`${API_URL}/api${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
    let json = null;
    try { json = await res.json(); } catch {}
    return { status: res.status, json };
}

async function makeUser(tag) {
    const email = `phase8_${tag}_${Math.random().toString(36).slice(2, 8)}@example.com`;
    const password = `Passw0rd!${tag}`;
    const { error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (error) throw new Error(`createUser ${tag}: ${error.message}`);

    const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } });
    const { data, error: signInErr } = await anon.auth.signInWithPassword({ email, password });
    if (signInErr) throw new Error(`signIn ${tag}: ${signInErr.message}`);

    await fetch(`${API_URL}/api/queue`, { headers: { Authorization: `Bearer ${data.session.access_token}` } }).catch(() => {});
    const { data: mem } = await admin.from('workspace_members').select('workspace_id').eq('user_id', data.user.id).limit(1);
    return { token: data.session.access_token, userId: data.user.id, workspaceId: mem?.[0]?.workspace_id };
}

(async () => {
    console.log('Phase 8 scheduling isolation\n');

    const A = await makeUser('a');
    const B = await makeUser('b');

    const aFuture = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const bGroupId = `phase8-group-${Math.random().toString(36).slice(2, 8)}`;

    await admin.from('groups').insert([
        { id: `phase8-a-${Math.random().toString(36).slice(2, 8)}`, name: 'A Group', url: 'https://example.com/a', workspace_id: A.workspaceId, facebook_user: '' },
        { id: bGroupId, name: 'B Group', url: 'https://example.com/b', workspace_id: B.workspaceId, facebook_user: '' },
    ]);
    await admin.from('posts').insert({
        content: 'A future queue anchor',
        status: 'PENDING',
        app_source: 'backup',
        workspace_id: A.workspaceId,
        scheduled_time: aFuture,
    });

    const uniqueContent = `phase8-content-${Math.random().toString(36).slice(2, 8)}`;
    const created = await api('/posts', {
        token: B.token,
        workspaceId: B.workspaceId,
        method: 'POST',
        body: { group_ids: [bGroupId], content: uniqueContent },
    });
    assert('B can create a scheduled post', created.status === 200 && created.json?.success === true);

    const { data: bPost, error: bPostErr } = await admin
        .from('posts')
        .select('id, scheduled_time, workspace_id, content')
        .eq('workspace_id', B.workspaceId)
        .eq('content', uniqueContent)
        .order('id', { ascending: false })
        .limit(1)
        .maybeSingle();
    if (bPostErr) throw new Error(`lookup B post: ${bPostErr.message}`);

    const bScheduledAt = new Date(bPost.scheduled_time).getTime();
    const now = Date.now();
    const tenMinutes = 10 * 60 * 1000;

    assert('scheduled post stays inside workspace B', bPost.workspace_id === B.workspaceId);
    assert('workspace A future queue does not shift workspace B schedule', bScheduledAt < now + tenMinutes);

    await admin.from('posts').delete().in('workspace_id', [A.workspaceId, B.workspaceId]);
    await admin.from('groups').delete().in('workspace_id', [A.workspaceId, B.workspaceId]);
    await admin.auth.admin.deleteUser(A.userId).catch(() => {});
    await admin.auth.admin.deleteUser(B.userId).catch(() => {});

    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed ? 1 : 0);
})().catch(err => {
    console.error('Test run error:', err.message);
    process.exit(2);
});
