/**
 * Phase 32 - Engagement deployment hardening.
 *
 * Requires the secure development backend and the QA Supabase project. The
 * suite refuses the known production project and deletes every fixture it
 * creates.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { createClient } = require('@supabase/supabase-js');
const {
    MINIMUM_ENGAGEMENT_EXTENSION_VERSION,
    compareNumericVersions,
    isVersionAtLeast,
} = require('../server/lib/extensionVersion.cjs');
const { logEngagementSweepResult } = require('../server/lib/engagementObservability.cjs');

const root = path.resolve(__dirname, '..');
const { SUPABASE_URL, SUPABASE_SERVICE_KEY, SUPABASE_ANON_KEY, API_URL = 'http://localhost:3001' } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !SUPABASE_ANON_KEY) {
    console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_KEY / SUPABASE_ANON_KEY.');
    process.exit(2);
}
if (SUPABASE_URL.includes('hfpsdzfggugoerythnug')) {
    console.error('REFUSING: SUPABASE_URL points at the production project.');
    process.exit(3);
}

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const tag = `p32_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
let passed = 0;
let failed = 0;

function assert(name, condition, detail = '') {
    if (condition) {
        passed++;
        console.log(`  OK ${name}`);
    } else {
        failed++;
        console.log(`  FAIL ${name}${detail ? ` - ${detail}` : ''}`);
    }
}

async function request(pathname, { method = 'GET', token, workspaceId, worker, body } = {}) {
    const headers = { 'Content-Type': 'application/json', Connection: 'close' };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (workspaceId) headers['x-workspace-id'] = workspaceId;
    if (worker) {
        headers['x-worker-id'] = worker.workerId;
        headers['x-device-token'] = worker.deviceToken;
    }
    const response = await fetch(`${API_URL}${pathname}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, body: await response.json().catch(() => null) };
}

async function makeTenant(label, extensionVersion = '9.1') {
    const email = `${tag}_${label}@example.com`;
    const password = `P32-safe-${label}-A1!`;
    const { data: created, error: createError } = await admin.auth.admin.createUser({
        email, password, email_confirm: true,
    });
    if (createError) throw new Error(`create user ${label}: ${createError.message}`);

    const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } });
    const { data: session, error: signInError } = await anon.auth.signInWithPassword({ email, password });
    if (signInError) throw new Error(`sign in ${label}: ${signInError.message}`);
    const token = session.session.access_token;

    const provision = await request('/api/queue', { token });
    if (provision.status !== 200) throw new Error(`provision ${label}: HTTP ${provision.status}`);
    const { data: memberships } = await admin.from('workspace_members')
        .select('workspace_id').eq('user_id', created.user.id).limit(1);
    const workspaceId = memberships?.[0]?.workspace_id;
    if (!workspaceId) throw new Error(`workspace missing for ${label}`);
    await admin.from('workspaces').update({ engagement_enabled: true }).eq('id', workspaceId);

    const pairing = await request('/api/workers/pairing-code', {
        method: 'POST', token, workspaceId, body: {},
    });
    const paired = await request('/api/workers/pair', {
        method: 'POST',
        body: {
            code: pairing.body?.code,
            worker_name: `${tag}-${label}`,
            ...(extensionVersion === undefined ? {} : { extension_version: extensionVersion }),
        },
    });
    if (paired.status !== 200) throw new Error(`pair ${label}: HTTP ${paired.status}`);

    return {
        userId: created.user.id,
        token,
        workspaceId,
        workerId: paired.body.worker_id,
        deviceToken: paired.body.device_token,
    };
}

async function seedScan(tenant, suffix) {
    const { data, error } = await admin.from('engagement_scan_tasks').insert({
        workspace_id: tenant.workspaceId,
        created_by: tenant.userId,
        name: `${tag}-${suffix}`,
        status: 'QUEUED',
        target_groups: [{ id: `${tag}-group`, name: 'Phase 32 group', url: 'https://www.facebook.com/groups/phase32' }],
        max_groups: 1,
        max_posts_per_group: 1,
    }).select('*').single();
    if (error) throw new Error(`seed scan ${suffix}: ${error.message}`);
    return data;
}

async function readScan(id) {
    const { data, error } = await admin.from('engagement_scan_tasks').select('*').eq('id', id).single();
    if (error) throw new Error(`read scan: ${error.message}`);
    return data;
}

async function setWorkerVersion(worker, version) {
    const { error } = await admin.from('browser_workers')
        .update({ extension_version: version }).eq('id', worker.workerId);
    if (error) throw new Error(`set worker version: ${error.message}`);
}

async function removeScan(id) {
    await admin.from('engagement_scan_tasks').delete().eq('id', id);
}

function runExtensionBuild() {
    const result = spawnSync(process.execPath, ['scripts/build-extension.cjs'], {
        cwd: root,
        encoding: 'utf8',
    });
    if (result.status !== 0) throw new Error(result.stderr || result.stdout || 'extension build failed');
    const hash = result.stdout.match(/sha256=([a-f0-9]{64})/i)?.[1];
    return { hash, output: result.stdout };
}

(async () => {
    console.log('Phase 32 deployment hardening\n');
    const tenants = [];

    try {
        console.log(' A. semantic extension versions');
        assert('minimum Engagement extension version is 9.2', MINIMUM_ENGAGEMENT_EXTENSION_VERSION === '9.2');
        assert('9.2 is allowed', isVersionAtLeast('9.2', '9.2'));
        assert('9.3 is allowed', isVersionAtLeast('9.3', '9.2'));
        assert('10.0 is allowed numerically', isVersionAtLeast('10.0', '9.2'));
        assert('9.1 is rejected', !isVersionAtLeast('9.1', '9.2'));
        assert('8.x is rejected', !isVersionAtLeast('8.99', '9.2'));
        assert('missing version is rejected', !isVersionAtLeast(null, '9.2'));
        assert('malformed version is rejected', !isVersionAtLeast('9.2-beta', '9.2'));
        assert('comparison is not lexicographic', compareNumericVersions('10.0', '9.2') > 0);

        // Chrome accepts one to four dot-separated integers, so a future
        // single-component manifest such as "10" is valid and must not lock the
        // fleet out of Engagement.
        assert('single-component "10" is accepted', isVersionAtLeast('10', '9.2'));
        assert('"10" and "10.0" compare equal', compareNumericVersions('10', '10.0') === 0);
        assert('single-component "9" is still below the floor', !isVersionAtLeast('9', '9.2'));
        assert('four components are accepted', isVersionAtLeast('9.2.0.1', '9.2'));
        assert('five components are rejected', !isVersionAtLeast('9.2.3.4.5', '9.2'));
        assert('a bare separator is rejected', !isVersionAtLeast('9.', '9.2'));
        assert('a leading separator is rejected', !isVersionAtLeast('.2', '9.2'));
        assert('a v-prefix is rejected', !isVersionAtLeast('v9.2', '9.2'));
        assert('an out-of-range component is rejected', !isVersionAtLeast('9999999999', '9.2'));

        // The server rejects an old build with 426; the extension must treat that
        // as a standing condition rather than polling every minute in silence.
        const backgroundSource = fs.readFileSync(
            path.join(__dirname, '../safe_post_extension/background.js'), 'utf8');
        assert('the extension backs off on 426 exactly as it does on 404',
            /response\.status === 426/.test(backgroundSource) &&
            /if \(response\.status === 426\)[\s\S]{0,400}engagementUnavailableUntil = Date\.now\(\) \+ ENGAGEMENT_UNAVAILABLE_BACKOFF_MS/
                .test(backgroundSource));
        assert('the 426 warning is emitted once, not once per poll',
            /engagementUpgradeWarned/.test(backgroundSource) &&
            /if \(!engagementUpgradeWarned\)/.test(backgroundSource));
        assert('the 426 warning states publishing is unaffected',
            /Publishing is unaffected/.test(backgroundSource));

        console.log('\n B. authenticated claim gate and tenant isolation');
        const A = await makeTenant('a', '9.1');
        const B = await makeTenant('b', '10.0');
        tenants.push(A, B);

        for (const version of ['9.1', '8.75', null, 'not-a-version']) {
            await setWorkerVersion(A, version);
            const scan = await seedScan(A, `reject-${version || 'missing'}`);
            const claim = await request('/api/engagement/scans/claim', { method: 'POST', worker: A, body: {} });
            const after = await readScan(scan.id);
            assert(`${version || 'missing'} receives stable upgrade error`,
                claim.status === 426 && claim.body?.code === 'EXTENSION_UPGRADE_REQUIRED' &&
                claim.body?.minimum_version === '9.2', `HTTP ${claim.status}`);
            assert(`${version || 'missing'} does not increment attempt_count`, after.attempt_count === 0);
            assert(`${version || 'missing'} does not create a lease`,
                after.claimed_at === null && after.lock_expires_at === null && after.worker_id === null);
            assert(`${version || 'missing'} leaves status QUEUED`, after.status === 'QUEUED');
            await removeScan(scan.id);
        }

        for (const version of ['9.2', '9.3', '10.0']) {
            await setWorkerVersion(A, version);
            const scan = await seedScan(A, `allow-${version}`);
            const claim = await request('/api/engagement/scans/claim', { method: 'POST', worker: A, body: {} });
            assert(`${version} can claim`, claim.status === 200 && claim.body?.scan?.id === scan.id, `HTTP ${claim.status}`);
            await removeScan(scan.id);
        }

        await setWorkerVersion(A, '9.2');
        const isolated = await seedScan(A, 'cross-workspace');
        const foreignClaim = await request('/api/engagement/scans/claim', { method: 'POST', worker: B, body: {} });
        const isolatedAfter = await readScan(isolated.id);
        assert('valid worker in another workspace cannot claim the scan',
            foreignClaim.status === 200 && foreignClaim.body?.scan === null);
        assert('cross-workspace claim leaves the scan untouched',
            isolatedAfter.status === 'QUEUED' && isolatedAfter.attempt_count === 0 && isolatedAfter.worker_id === null);
        await removeScan(isolated.id);

        await setWorkerVersion(A, '9.1');
        const heartbeatScan = await seedScan(A, 'heartbeat-upgrade');
        const beforeHeartbeat = await request('/api/engagement/scans/claim', { method: 'POST', worker: A, body: {} });
        assert('9.1 is blocked before heartbeat upgrade', beforeHeartbeat.status === 426);
        const heartbeat = await request(`/api/workers/${A.workerId}/heartbeat`, {
            method: 'POST', worker: A, body: { extension_version: '9.2', status: 'online' },
        });
        const afterHeartbeat = await request('/api/engagement/scans/claim', { method: 'POST', worker: A, body: {} });
        assert('authenticated heartbeat stores the upgrade', heartbeat.status === 200);
        assert('heartbeat upgrade to 9.2 allows the next claim',
            afterHeartbeat.status === 200 && afterHeartbeat.body?.scan?.id === heartbeatScan.id);
        await removeScan(heartbeatScan.id);

        console.log('\n C. dashboard Facebook identity privacy');
        const internalSync = await request('/api/profile/sync', {
            method: 'POST', worker: A,
            body: { facebook_user: 'Phase 32 account', facebook_user_id: '100000000000032' },
        });
        const dashboardProfile = await request('/api/profile/current', {
            token: A.token, workspaceId: A.workspaceId,
        });
        assert('worker identity sync remains available internally', internalSync.status === 200);
        assert('dashboard profile response omits current_user_id',
            dashboardProfile.status === 200 && !Object.prototype.hasOwnProperty.call(dashboardProfile.body || {}, 'current_user_id'));
        assert('dashboard profile response does not contain the numeric Facebook id',
            !JSON.stringify(dashboardProfile.body).includes('100000000000032'));
        const appSource = fs.readFileSync(path.join(root, 'src/App.jsx'), 'utf8');
        assert('dashboard never stores the legacy Facebook id',
            !/localStorage\.setItem\(['"]safepost_currentUserId/.test(appSource));
        assert('dashboard removes an existing legacy Facebook id',
            /localStorage\.removeItem\(['"]safepost_currentUserId/.test(appSource));
        assert('dashboard does not render currentUserId', !/\bcurrentUserId\b/.test(appSource));

        console.log('\n D. deterministic extension artifact');
        const manifest = JSON.parse(fs.readFileSync(path.join(root, 'safe_post_extension/manifest.json'), 'utf8'));
        assert('authoritative manifest is 9.2', manifest.version === '9.2');
        const firstBuild = runExtensionBuild();
        const secondBuild = runExtensionBuild();
        assert('extension archive hash is byte-for-byte deterministic',
            firstBuild.hash && firstBuild.hash === secondBuild.hash, `${firstBuild.hash} / ${secondBuild.hash}`);
        const artifact = path.join(root, `dist/safepost-extension-${manifest.version}.zip`);
        assert('versioned extension archive exists', fs.existsSync(artifact));
        assert('reported SHA-256 matches the archive',
            crypto.createHash('sha256').update(fs.readFileSync(artifact)).digest('hex') === secondBuild.hash);
        const required = [
            'manifest.json', 'background.js', 'content.js', 'fbUtils.js',
            'engagement/identity.js', 'engagement/navigation.js',
            'engagement/postParser.js', 'engagement/scanner.js',
        ];
        assert('artifact staging contains every required runtime file',
            required.every(file => fs.existsSync(path.join(root, 'dist/extension', ...file.split('/')))));
        assert('artifact content script is the reviewed source',
            fs.readFileSync(path.join(root, 'dist/extension/content.js')).equals(
                fs.readFileSync(path.join(root, 'safe_post_extension/content.js'))));
        assert('no stale public manifest or content script remains',
            !fs.existsSync(path.join(root, 'public/manifest.json')) &&
            !fs.existsSync(path.join(root, 'public/scripts/content.js')) &&
            !fs.existsSync(path.join(root, 'public/assets/content.js')));

        console.log('\n E. deployment defaults and sweep visibility');
        const envExample = fs.readFileSync(path.join(root, '.env.example'), 'utf8');
        const renderConfig = fs.readFileSync(path.join(root, 'render.yaml'), 'utf8');
        assert('.env.example keeps Engagement disabled', /^ENGAGEMENT_ENABLED=false$/m.test(envExample));
        assert('Render blueprint keeps Engagement disabled',
            /key:\s*ENGAGEMENT_ENABLED[\s\S]{0,80}value:\s*["']?false/.test(renderConfig));
        const messages = [];
        assert('zero sweep is silent', !logEngagementSweepResult({ swept: 0 }, { warn: message => messages.push(message) }));
        assert('recovered sweep emits one aggregate log',
            logEngagementSweepResult({ swept: 3, requeued: 2, failed: 1 }, { warn: message => messages.push(message) }) &&
            messages.length === 1 && /swept=3 requeued=2 failed=1/.test(messages[0]));
        assert('sweep log contains aggregate counts only', !/facebook|account|group|post_text/i.test(messages[0]));
    } finally {
        for (const tenant of tenants) {
            await admin.auth.admin.deleteUser(tenant.userId).catch(() => {});
        }
    }

    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed ? 1 : 0);
})().catch(error => {
    console.error(`Phase 32 error: ${error.message}`);
    process.exit(2);
});
