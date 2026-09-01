/**
 * Focused regression coverage for the three P1 beta security findings:
 * external extension messaging, /api/logs tenant isolation, and system_logs
 * workspace attribution.
 */
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const { generateDeviceToken, hashToken } = require('../server/middleware/worker.cjs');
const logIsolation = require('../server/lib/logIsolation.cjs');

require('../safe_post_extension/externalMessageTrust.js');
const externalTrust = globalThis.SafePostExternalTrust;

const { SUPABASE_URL, SUPABASE_SERVICE_KEY, SUPABASE_ANON_KEY, API_URL = 'http://localhost:3001' } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !SUPABASE_ANON_KEY) {
    console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_KEY / SUPABASE_ANON_KEY.');
    process.exit(2);
}
if ((SUPABASE_URL || '').includes('hfpsdzfggugoerythnug')) {
    console.error('REFUSING: SUPABASE_URL points at the production project.');
    process.exit(3);
}

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '../safe_post_extension/manifest.json'), 'utf8'));
const background = fs.readFileSync(path.join(__dirname, '../safe_post_extension/background.js'), 'utf8');

let passed = 0;
let failed = 0;
const assert = (name, condition) => {
    if (condition) {
        passed++;
        console.log(`  OK ${name}`);
    } else {
        failed++;
        console.log(`  FAIL ${name}`);
    }
};

const unique = `p1_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const createdUsers = [];
const createdWorkspaces = [];

async function makeUser(label) {
    const email = `${unique}_${label}@example.com`;
    const password = `Passw0rd!${label}`;
    const { data: created, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (error) throw new Error(`createUser ${label}: ${error.message}`);
    createdUsers.push(created.user.id);

    const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } });
    const { data, error: signInError } = await anon.auth.signInWithPassword({ email, password });
    if (signInError) throw new Error(`signIn ${label}: ${signInError.message}`);

    const provision = await fetch(`${API_URL}/api/queue`, {
        headers: { Authorization: `Bearer ${data.session.access_token}`, Connection: 'close' },
    });
    if (!provision.ok) throw new Error(`workspace provision ${label}: HTTP ${provision.status}`);

    const { data: memberships, error: membershipError } = await admin
        .from('workspace_members').select('workspace_id').eq('user_id', created.user.id).limit(1);
    if (membershipError || !memberships?.[0]) throw new Error(`workspace lookup ${label} failed`);
    const workspaceId = memberships[0].workspace_id;
    createdWorkspaces.push(workspaceId);
    return { userId: created.user.id, token: data.session.access_token, workspaceId };
}

function dashboardHeaders(user, workspaceId = user.workspaceId) {
    return {
        Authorization: `Bearer ${user.token}`,
        'x-workspace-id': workspaceId,
        'Content-Type': 'application/json',
        Connection: 'close',
    };
}

async function createPendingTask(workspaceId, label) {
    const groupId = `${unique}_${label}_group`;
    const { error: groupError } = await admin.from('groups').insert({
        id: groupId,
        name: `P1 ${label}`,
        url: `https://www.facebook.com/groups/${unique}_${label}`,
        workspace_id: workspaceId,
        facebook_user: '',
    });
    if (groupError) throw new Error(`group ${label}: ${groupError.message}`);

    const { data: task, error: taskError } = await admin.from('posts').insert({
        workspace_id: workspaceId,
        group_id: groupId,
        content: `${unique} ${label}`,
        status: 'PENDING',
        app_source: 'backup',
        scheduled_time: new Date(Date.now() + 3600000).toISOString(),
    }).select('id').single();
    if (taskError) throw new Error(`task ${label}: ${taskError.message}`);
    return task.id;
}

async function cleanup() {
    for (const workspaceId of createdWorkspaces) {
        await admin.from('posts').delete().eq('workspace_id', workspaceId);
        await admin.from('groups').delete().eq('workspace_id', workspaceId);
        await admin.from('browser_workers').delete().eq('workspace_id', workspaceId);
        await admin.from('system_logs').delete().eq('workspace_id', workspaceId);
    }
    for (const userId of createdUsers) {
        await admin.auth.admin.deleteUser(userId).catch(() => {});
    }
}

(async () => {
    console.log('P1 beta security hardening\n');

    console.log(' A. extension external-message trust');
    assert('beta manifest exposes no externally_connectable origins', !manifest.externally_connectable);
    assert('untrusted localhost origin is rejected',
        externalTrust.validateExternalSender({ origin: 'http://localhost:5173', url: 'http://localhost:5173/app' }).ok === false);
    assert('random web origin is rejected',
        externalTrust.validateExternalSender({ origin: 'https://evil.example', url: 'https://evil.example/x' }).ok === false);
    assert('missing sender origin is rejected',
        externalTrust.validateExternalSender({ url: 'https://dashboard.example/app' }).ok === false);
    assert('malformed sender is rejected', externalTrust.validateExternalSender('not-an-object').ok === false);
    assert('origin and sender URL must match',
        externalTrust.validateExternalSender({ origin: 'https://a.example', url: 'https://b.example/app' }, ['https://a.example']).ok === false);
    assert('an exact explicit development allowlist can validate its own origin',
        externalTrust.validateExternalSender(
            { origin: 'https://dashboard.example', url: 'https://dashboard.example/app' },
            ['https://dashboard.example']
        ).ok === true);
    const externalListener = background.slice(background.indexOf('chrome.runtime.onMessageExternal.addListener'));
    assert('external listener validates sender before inspecting an action',
        externalListener.indexOf('validateExternalSender(sender)') >= 0 &&
        !externalListener.includes('request.action'));
    assert('START_AUTOMATION has no active extension handler', !background.includes('START_AUTOMATION'));
    assert('external listener cannot trigger tabs, publish, or group sync',
        !externalListener.includes('chrome.tabs') && !externalListener.includes('scanAndSyncGroups'));

    console.log('\n B. in-memory API log isolation helpers');
    const eventA = logIsolation.createTenantEventLog({ workspaceId: 'workspace-a', taskId: 1, type: 'FAILED', message: 'A' });
    const eventB = logIsolation.createTenantEventLog({ workspaceId: 'workspace-b', taskId: 2, type: 'FAILED', message: 'B' });
    const globalEvent = logIsolation.createGlobalEventLog({ type: 'SYSTEM', message: 'global' });
    const malformedTenant = { scope: 'tenant', workspace_id: null, taskId: 3, type: 'FAILED', message: 'missing tenant' };
    const selectedA = logIsolation.selectWorkspaceEventLogs([eventA, eventB, globalEvent, malformedTenant], 'workspace-a');
    assert('workspace A helper sees only workspace A', selectedA.total === 1 && selectedA.logs[0].message === 'A');
    assert('mixed global events are not exposed to tenant callers', !selectedA.logs.some(log => log.scope === 'global'));
    assert('tenant event without workspace_id is not exposed', !selectedA.logs.some(log => log.message === 'missing tenant'));
    let missingEventRejected = false;
    try { logIsolation.createTenantEventLog({ taskId: 4, type: 'FAILED', message: 'missing' }); } catch { missingEventRejected = true; }
    assert('tenant event write fails closed without workspace_id', missingEventRejected);

    console.log('\n C. live /api/logs and system_logs isolation');
    const userA = await makeUser('a');
    const userB = await makeUser('b');
    const taskA = await createPendingTask(userA.workspaceId, 'a');
    const taskB = await createPendingTask(userB.workspaceId, 'b');

    const unauthenticated = await fetch(`${API_URL}/api/logs?workspace_id=${userA.workspaceId}`, { headers: { Connection: 'close' } });
    assert('unauthenticated /api/logs request is 401', unauthenticated.status === 401);

    const forbidden = await fetch(`${API_URL}/api/logs`, { headers: dashboardHeaders(userB, userA.workspaceId) });
    assert('authenticated user without requested workspace access is 403', forbidden.status === 403);

    const cancelA = await fetch(`${API_URL}/api/tasks/${taskA}/cancel`, { method: 'POST', headers: dashboardHeaders(userA), body: '{}' });
    const cancelB = await fetch(`${API_URL}/api/tasks/${taskB}/cancel`, { method: 'POST', headers: dashboardHeaders(userB), body: '{}' });
    assert('dashboard events created in both workspaces', cancelA.status === 200 && cancelB.status === 200);

    const logsAResponse = await fetch(`${API_URL}/api/logs`, { headers: dashboardHeaders(userA) });
    const logsBResponse = await fetch(`${API_URL}/api/logs`, { headers: dashboardHeaders(userB) });
    const logsA = await logsAResponse.json();
    const logsB = await logsBResponse.json();
    assert('authorized workspace A logs request is 200', logsAResponse.status === 200);
    assert('authorized workspace B logs request is 200', logsBResponse.status === 200);
    assert('workspace A sees only its own event', logsA.logs.length === 1 && String(logsA.logs[0].taskId) === String(taskA));
    assert('workspace B sees only its own event', logsB.logs.length === 1 && String(logsB.logs[0].taskId) === String(taskB));
    assert('workspace A cannot see workspace B event', !logsA.logs.some(log => String(log.taskId) === String(taskB)));
    assert('workspace B cannot see workspace A event', !logsB.logs.some(log => String(log.taskId) === String(taskA)));

    const token = generateDeviceToken();
    const { data: worker, error: workerError } = await admin.from('browser_workers').insert({
        workspace_id: userA.workspaceId,
        worker_name: `${unique}_worker`,
        device_token_hash: hashToken(token),
        status: 'online',
    }).select('id').single();
    if (workerError) throw new Error(`worker: ${workerError.message}`);
    const workerHeaders = {
        'x-worker-id': worker.id,
        'x-device-token': token,
        'Content-Type': 'application/json',
        Connection: 'close',
    };

    const workerMessage = `${unique} worker log`;
    const workerLog = await fetch(`${API_URL}/api/workers/${worker.id}/logs`, {
        method: 'POST', headers: workerHeaders,
        body: JSON.stringify({ level: 'info', message: workerMessage, workspace_id: userB.workspaceId }),
    });
    assert('worker log endpoint accepts paired worker', workerLog.status === 200);

    const taskLogMessage = `${unique} task log`;
    const taskLog = await fetch(`${API_URL}/api/tasks/update-status`, {
        method: 'POST', headers: workerHeaders,
        body: JSON.stringify({
            taskId: taskA, status: 'LOG', failure_reason: taskLogMessage,
            workspace_id: userB.workspaceId,
        }),
    });
    assert('job-related worker log is accepted for own task', taskLog.status === 200);

    const crossTaskLog = await fetch(`${API_URL}/api/tasks/update-status`, {
        method: 'POST', headers: workerHeaders,
        body: JSON.stringify({ taskId: taskB, status: 'LOG', failure_reason: `${unique} cross workspace` }),
    });
    assert('worker cannot write a log for another workspace job', crossTaskLog.status === 404);

    const { data: persistedLogs, error: persistedError } = await admin.from('system_logs')
        .select('source, message, workspace_id')
        .in('message', [workerMessage, `Task #${taskA}: ${taskLogMessage}`, `Task #${taskA} manually cancelled`]);
    if (persistedError) throw new Error(`system log query: ${persistedError.message}`);
    const workerRow = persistedLogs.find(row => row.message === workerMessage);
    const jobRow = persistedLogs.find(row => row.message === `Task #${taskA}: ${taskLogMessage}`);
    const dashboardRow = persistedLogs.find(row => row.message === `Task #${taskA} manually cancelled`);
    assert('worker log receives worker workspace_id', workerRow?.workspace_id === userA.workspaceId);
    assert('job log receives stored job workspace_id', jobRow?.workspace_id === userA.workspaceId);
    assert('dashboard tenant log receives authenticated workspace_id', dashboardRow?.workspace_id === userA.workspaceId);
    assert('forged client workspace_id cannot redirect logs',
        persistedLogs.every(row => row.workspace_id === userA.workspaceId));
    assert('no new tenant-scoped log is persisted with workspace_id NULL',
        persistedLogs.length === 3 && persistedLogs.every(row => row.workspace_id));

    console.log('\n D. explicit global system-log classification');
    const inserted = [];
    const fakeDatabase = { from: () => ({ insert: async rows => (inserted.push(...rows), { error: null }) }) };
    const quietLogger = { error: () => {} };
    const refused = await logIsolation.persistTenantSystemLog(fakeDatabase, null, { message: 'tenant without workspace' }, quietLogger);
    const global = await logIsolation.persistGlobalSystemLog(fakeDatabase, { source: 'server_scheduler', message: 'global scheduler fault' }, quietLogger);
    assert('unresolved tenant system log is skipped', refused.ok === false && inserted.length === 1);
    assert('global log remains possible only through explicit global helper',
        global.ok === true && inserted[0].workspace_id === null && inserted[0].source === 'server_scheduler');

    await cleanup();
    console.log(`\n${passed} passed, ${failed} failed`);
    process.exitCode = failed ? 1 : 0;
})().catch(async error => {
    console.error('Test run error:', error.message);
    await cleanup().catch(() => {});
    process.exitCode = 2;
});
