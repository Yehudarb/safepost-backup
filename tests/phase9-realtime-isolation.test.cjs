/**
 * Phase 9 - Realtime isolation regression test.
 *
 * Verifies that a workspace-scoped Socket.IO event is delivered only to the
 * matching workspace room and not to another authenticated workspace.
 *
 * Env:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_KEY
 *   SUPABASE_ANON_KEY
 *   API_URL
 */
const { createClient } = require('@supabase/supabase-js');
const { io } = require('socket.io-client');

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
const socketBaseUrl = API_URL.replace(/\/api\/?$/, '');

let passed = 0, failed = 0;
const assert = (name, cond) => { cond ? (passed++, console.log(`  OK ${name}`)) : (failed++, console.log(`  FAIL ${name}`)); };
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function api(path, { token, workspaceId, method = 'POST', body } = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (workspaceId) headers['x-workspace-id'] = workspaceId;
    const res = await fetch(`${API_URL}/api${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
    let json = null;
    try { json = await res.json(); } catch {}
    return { status: res.status, json };
}

async function makeUser(tag) {
    const email = `phase9_${tag}_${Math.random().toString(36).slice(2, 8)}@example.com`;
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

// Pair a browser worker to this user's workspace (the SSE stream authenticates
// with a device token, not the dashboard JWT).
async function pairWorker(user, name) {
    const code = await api('/workers/pairing-code', { token: user.token, workspaceId: user.workspaceId });
    if (code.status !== 200) throw new Error(`pairing-code ${name}: HTTP ${code.status}`);
    const paired = await api('/workers/pair', { body: { code: code.json.code, worker_name: name } });
    if (paired.status !== 200) throw new Error(`pair ${name}: HTTP ${paired.status}`);
    return { workerId: paired.json.worker_id, deviceToken: paired.json.device_token };
}

// Open an SSE stream as a paired worker and collect the events it receives.
function openSse({ workerId, deviceToken }) {
    const controller = new AbortController();
    const events = [];
    const ready = fetch(`${API_URL}/api/stream/jobs`, {
        headers: { 'x-worker-id': workerId, 'x-device-token': deviceToken },
        signal: controller.signal,
    }).then((res) => {
        if (!res.ok) throw new Error(`SSE connect failed: HTTP ${res.status}`);
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        (async () => {
            try {
                for (;;) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    buffer += decoder.decode(value, { stream: true });
                    let split;
                    while ((split = buffer.indexOf('\n\n')) !== -1) {
                        const frame = buffer.slice(0, split);
                        buffer = buffer.slice(split + 2);
                        const line = frame.split('\n').find(l => l.startsWith('data: '));
                        if (!line) continue;
                        try { events.push(JSON.parse(line.slice(6))); } catch { /* ping/comment */ }
                    }
                }
            } catch { /* stream aborted on close */ }
        })();
    });
    return { events, ready, close: () => controller.abort() };
}

function connectClient({ token, workspaceId }) {
    return new Promise((resolve, reject) => {
        const socket = io(socketBaseUrl, {
            transports: ['websocket'],
            forceNew: true,
            auth: { token, workspaceId },
        });

        const onError = (err) => {
            socket.close();
            reject(new Error(err?.message || 'socket connect failed'));
        };

        socket.once('connect_error', onError);
        socket.once('connect', () => {
            socket.off('connect_error', onError);
            resolve(socket);
        });
    });
}

(async () => {
    console.log('Phase 9 realtime isolation\n');

    const A = await makeUser('a');
    const B = await makeUser('b');

    const socketA = await connectClient(A);
    const socketB = await connectClient(B);

    let aEvents = 0;
    let bEvents = 0;
    socketA.on('worker_stop_signal', () => { aEvents++; });
    socketB.on('worker_stop_signal', () => { bEvents++; });

    // The same /worker/stop trigger also fans out over SSE (broadcastSSE), which
    // is the transport the Chrome extension actually listens on — cover both.
    const workerA = await pairWorker(A, 'phase9-worker-a');
    const workerB = await pairWorker(B, 'phase9-worker-b');
    const sseA = openSse(workerA);
    const sseB = openSse(workerB);
    await sseA.ready;
    await sseB.ready;
    await sleep(400);

    const stop = await api('/worker/stop', {
        token: A.token,
        workspaceId: A.workspaceId,
        method: 'POST',
    });
    assert('workspace A can trigger a workspace-scoped event', stop.status === 200 && stop.json?.success === true);

    await sleep(1200);

    assert('workspace A receives its own realtime event', aEvents === 1);
    assert('workspace B does not receive workspace A realtime event', bEvents === 0);

    const aStop = sseA.events.filter(e => e.type === 'stop_worker').length;
    const bStop = sseB.events.filter(e => e.type === 'stop_worker').length;
    assert('workspace A SSE stream receives its own event', aStop === 1);
    assert('workspace B SSE stream does not receive workspace A event', bStop === 0);

    sseA.close();
    sseB.close();
    await admin.from('browser_workers').delete().in('id', [workerA.workerId, workerB.workerId]);
    socketA.close();
    socketB.close();
    await admin.auth.admin.deleteUser(A.userId).catch(() => {});
    await admin.auth.admin.deleteUser(B.userId).catch(() => {});

    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed ? 1 : 0);
})().catch(err => {
    console.error('Test run error:', err.message);
    process.exit(2);
});
