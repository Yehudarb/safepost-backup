/**
 * Phase 27 — Phase 1C.3 hardening.
 *
 * Three defects are pinned here:
 *
 *  1. The 1C.2 detector only read text inside dialogs, alerts and headings, so a
 *     Facebook security screen rendered in a plain div read as OK. For the
 *     publish path that meant COMPOSER_NOT_READY — a RETRYABLE code — and
 *     therefore retrying against a security screen.
 *  2. `groups` conflicted on (workspace_id, facebook_user, id). Because
 *     facebook_user is only a display label, a re-sync under a different label
 *     inserted the same group twice, and scan creation then answered
 *     400 "not found" for a group that was found twice.
 *  3. facebook_user_id was returned to the dashboard by select('*').
 *
 * The detector needs BOTH directions: visible security text must block, and the
 * same words inside a post, a comment, a script or a hidden node must not.
 */
const path = require('path');
const { pathToFileURL } = require('url');
const { JSDOM } = require('jsdom');
const { createClient } = require('@supabase/supabase-js');

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

let passed = 0;
let failed = 0;
const assert = (name, condition, detail = '') => {
    if (condition) { passed++; console.log(`  OK ${name}`); }
    else { failed++; console.log(`  FAIL ${name}${detail ? '  — ' + detail : ''}`); }
};

const tag = `p27_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
const FB_ID_A = '100000000000001';
const FB_ID_B = '100000000000002';

const page = (body, url = 'https://www.facebook.com/groups/group-a/') =>
    new JSDOM(`<body><div role="main"><div role="feed">
        <div role="article"><div dir="auto">An ordinary group post</div></div>
    </div></div>${body}</body>`, { url }).window.document;

async function makeTenant(label) {
    const email = `${tag}_${label}@example.com`;
    const password = `Passw0rd!${label}aA1`;
    const { data: created, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (error) throw new Error(`createUser ${label}: ${error.message}`);
    const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } });
    const { data: session } = await anon.auth.signInWithPassword({ email, password });
    const token = session.session.access_token;
    await fetch(`${API_URL}/api/queue`, { headers: { Authorization: `Bearer ${token}`, Connection: 'close' } });
    const { data: members } = await admin.from('workspace_members').select('workspace_id').eq('user_id', created.user.id).limit(1);
    const workspaceId = members[0].workspace_id;

    const codeRes = await fetch(`${API_URL}/api/workers/pairing-code`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'x-workspace-id': workspaceId, 'Content-Type': 'application/json', Connection: 'close' },
    });
    const { code } = await codeRes.json();
    const pairRes = await fetch(`${API_URL}/api/workers/pair`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Connection: 'close' },
        body: JSON.stringify({ code, worker_name: `${label} worker`, extension_version: '9.2' }),
    });
    const pair = await pairRes.json();
    await admin.from('workspaces').update({ engagement_enabled: true }).eq('id', workspaceId);
    return { label, userId: created.user.id, token, workspaceId, workerId: pair.worker_id, deviceToken: pair.device_token };
}

const dash = async (t, method, p, body) => {
    const res = await fetch(`${API_URL}/api/engagement${p}`, {
        method,
        headers: {
            Authorization: `Bearer ${t.token}`, 'x-workspace-id': t.workspaceId,
            'Content-Type': 'application/json', Connection: 'close',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: await res.json().catch(() => null) };
};

const work = async (t, method, p, body) => {
    const res = await fetch(`${API_URL}/api/engagement${p}`, {
        method,
        headers: {
            'x-worker-id': t.workerId, 'x-device-token': t.deviceToken,
            'Content-Type': 'application/json', Connection: 'close',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: await res.json().catch(() => null) };
};

const seedGroup = (workspaceId, id, label, fbId = null) => admin.from('groups').insert({
    id, name: `${id} name`, url: `https://www.facebook.com/groups/${id}`,
    workspace_id: workspaceId, facebook_user: label, facebook_user_id: fbId,
});

(async () => {
    await import(`${pathToFileURL(path.join(__dirname, '../safe_post_extension/fbUtils.js')).href}?phase27`);
    const FB = global.SafePostFB;

    console.log('Phase 27 identity and security hardening\n');

    console.log(' A. visible security text blocks, wherever it is rendered');
    {
        const blocking = [
            ['plain visible div: Security check', '<div>Security check</div>', 'CAPTCHA_REQUIRED'],
            ['plain visible div: Confirm your identity', '<div>Confirm your identity</div>', 'CHECKPOINT_REQUIRED'],
            ['plain visible div: Verify your identity', '<div>Verify your identity</div>', 'CHECKPOINT_REQUIRED'],
            ['nested visible div', '<div><div><div>We need to confirm it\'s you</div></div></div>', 'CHECKPOINT_REQUIRED'],
            ['visible span', '<span>Confirm your identity</span>', 'CHECKPOINT_REQUIRED'],
            ['Hebrew plain div: אשר את זהותך', '<div>אשר את זהותך</div>', 'CHECKPOINT_REQUIRED'],
            ['Hebrew plain div: אמת את זהותך', '<div>אמת את זהותך</div>', 'CHECKPOINT_REQUIRED'],
            ['Hebrew plain div: נדרש אימות', '<div>נדרש אימות</div>', 'CHECKPOINT_REQUIRED'],
            ['checkpoint label in a plain div', '<div>Security checkpoint</div>', 'CHECKPOINT_REQUIRED'],
            ['restriction notice in a plain div', '<div>Your account is restricted from posting</div>', 'ACCOUNT_RESTRICTED'],
            ['visible captcha iframe', '<iframe src="https://www.google.com/recaptcha/api2/anchor"></iframe>', 'CAPTCHA_REQUIRED'],
        ];
        for (const [name, html, expected] of blocking) {
            const state = FB.detectFacebookState(page(html));
            assert(name, state.ok === false && state.errorCode === expected,
                `ok=${state.ok} code=${state.errorCode} strategy=${state.strategy}`);
        }
        const url = FB.detectFacebookState(page('', 'https://www.facebook.com/checkpoint/1/'));
        assert('checkpoint URL still blocks', url.ok === false && url.errorCode === 'CHECKPOINT_REQUIRED');
    }

    console.log('\n B. the same words in ordinary content must NOT block');
    {
        const allowed = [
            ['hidden challenge text', '<div style="display:none">Confirm your identity</div>'],
            ['aria-hidden challenge text', '<div aria-hidden="true">Security check</div>'],
            ['post content mentioning captcha',
                '<div role="feed"><div role="article"><div dir="auto">the site kept showing me a captcha</div></div></div>'],
            ['post content mentioning a security check',
                '<div role="feed"><div role="article"><div dir="auto">I had to do a Security check to log in</div></div></div>'],
            ['comment mentioning confirm your identity',
                '<div role="feed"><div role="article"><div role="article"><div dir="auto">they asked me to confirm your identity lol</div></div></div></div>'],
            ['Hebrew comment mentioning בדיקת אבטחה',
                '<div role="feed"><div role="article"><div role="article"><div dir="auto">ביקשו ממני בדיקת אבטחה</div></div></div></div>'],
            ['script text', '<script>var challenge="Confirm your identity";</script>'],
            ['style text', '<style>.captcha{display:none}/* security check */</style>'],
            ['a help link about security checks', '<a href="/help">Learn about security checks</a>'],
            ['composer placeholder', '<div role="textbox" aria-label="Write something">Security check</div>'],
        ];
        for (const [name, html] of allowed) {
            const state = FB.detectFacebookState(page(html));
            assert(name, state.ok === true,
                `code=${state.errorCode} strategy=${state.strategy} signal=${state.matchedSignal}`);
        }
    }

    console.log('\n C. publishing regression: a security page is never "just a missing composer"');
    {
        const doc = page('<div>We need to confirm it\'s you</div>');
        const state = FB.detectFacebookState(doc);
        const composer = FB.findPostComposer(doc);
        assert('the page is classified as a security state',
            state.ok === false && state.errorCode === 'CHECKPOINT_REQUIRED', state.errorCode);
        assert('so publishing stops terminally instead of retrying as COMPOSER_NOT_READY',
            state.ok === false && composer.found === false);
    }

    const A = await makeTenant('a');
    const B = await makeTenant('b');
    try {
        console.log('\n D. one Facebook group is one row per workspace');
        {
            const gid = `${tag}_dup`;
            await seedGroup(A.workspaceId, gid, 'Smart Choice gadgets', null);
            // A later sync reporting a different display label must UPDATE, not insert.
            const { error } = await admin.from('groups').upsert({
                id: gid, name: 'Renamed', url: `https://www.facebook.com/groups/${gid}`,
                workspace_id: A.workspaceId, facebook_user: 'Yehuda Arbely', facebook_user_id: FB_ID_A,
            }, { onConflict: 'workspace_id,id' });
            assert('a re-sync under a different label does not error', !error, error?.message);
            const { data: rows } = await admin.from('groups')
                .select('id, name, facebook_user, facebook_user_id')
                .eq('workspace_id', A.workspaceId).eq('id', gid);
            assert('exactly one logical group row survives', rows.length === 1, `${rows.length} rows`);
            assert('its metadata was updated in place',
                rows[0].name === 'Renamed' && rows[0].facebook_user === 'Yehuda Arbely' &&
                rows[0].facebook_user_id === FB_ID_A, JSON.stringify(rows[0]));

            const created = await dash(A, 'POST', '/scans', {
                name: `${tag} dedup`, group_ids: [gid], max_groups: 1, max_posts_per_group: 5,
            });
            assert('scan creation resolves that group deterministically',
                created.status === 201, `HTTP ${created.status} ${JSON.stringify(created.body)}`);
            await admin.from('engagement_scan_tasks').delete().eq('workspace_id', A.workspaceId);
        }

        console.log('\n E. selected-group identity rules');
        {
            const known = `${tag}_known`;
            const unbound = `${tag}_unbound`;
            const other = `${tag}_other`;
            await seedGroup(A.workspaceId, known, '', FB_ID_A);
            await seedGroup(A.workspaceId, unbound, '', null);
            await seedGroup(A.workspaceId, other, '', FB_ID_B);

            const mixed = await dash(A, 'POST', '/scans', {
                name: `${tag} mixed`, group_ids: [known, unbound], max_groups: 2, max_posts_per_group: 5,
            });
            assert('one known id plus an unbound group is accepted, carrying the known id',
                mixed.status === 201, `HTTP ${mixed.status} ${JSON.stringify(mixed.body)}`);

            const conflicting = await dash(A, 'POST', '/scans', {
                name: `${tag} conflict`, group_ids: [known, other], max_groups: 2, max_posts_per_group: 5,
            });
            assert('two different verified accounts in one selection is refused',
                conflicting.status === 409, `HTTP ${conflicting.status}`);
            await admin.from('engagement_scan_tasks').delete().eq('workspace_id', A.workspaceId);
        }

        console.log('\n F. dashboard responses do not expose the Facebook account id');
        {
            const gid = `${tag}_priv`;
            await seedGroup(A.workspaceId, gid, '', FB_ID_A);
            const created = await dash(A, 'POST', '/scans', {
                name: `${tag} privacy`, group_ids: [gid], max_groups: 1, max_posts_per_group: 5,
            });
            assert('scan creation succeeds', created.status === 201, `HTTP ${created.status}`);
            assert('the create response omits facebook_user_id',
                !('facebook_user_id' in (created.body?.scan || {})), JSON.stringify(Object.keys(created.body?.scan || {})));
            assert('the create response body never contains the raw id',
                !JSON.stringify(created.body).includes(FB_ID_A));

            const list = await dash(A, 'GET', '/scans');
            assert('the scan list omits facebook_user_id',
                (list.body?.scans || []).every(s => !('facebook_user_id' in s)));
            assert('the scan list never contains the raw id', !JSON.stringify(list.body).includes(FB_ID_A));

            const detail = await dash(A, 'GET', `/scans/${created.body.scan.id}`);
            assert('the scan detail omits facebook_user_id',
                !('facebook_user_id' in (detail.body?.scan || {})));
            assert('the scan detail never contains the raw id', !JSON.stringify(detail.body).includes(FB_ID_A));
            assert('the dashboard still receives the fields it needs',
                detail.body?.scan?.status && detail.body?.scan?.name && Array.isArray(detail.body?.scan?.target_groups));
        }

        console.log('\n G. identity bind is backend-authoritative');
        {
            const gid = `${tag}_bind`;
            await seedGroup(A.workspaceId, gid, '', null);
            const created = await dash(A, 'POST', '/scans', {
                name: `${tag} bind`, group_ids: [gid], max_groups: 1, max_posts_per_group: 5,
            });
            const scanId = created.body.scan.id;

            const notRunning = await work(A, 'POST', `/scans/${scanId}/bind-identity`, { facebook_user_id: FB_ID_A, membership_verified: true, evidence_strategy: 'group_header_joined_control' });
            assert('a queued scan cannot be bound', notRunning.status === 409, `HTTP ${notRunning.status}`);

            // claimNextScan returns the OLDEST queued scan, so earlier sections'
            // leftovers would be claimed instead of this one. Clear them, then
            // assert the claim actually handed back the scan under test.
            await admin.from('engagement_scan_tasks').delete()
                .eq('workspace_id', A.workspaceId).neq('id', scanId);
            const claimed = await work(A, 'POST', '/scans/claim', {});
            assert('the scan under test is the one claimed',
                claimed.body?.scan?.id === scanId, `claimed ${claimed.body?.scan?.id}`);
            for (const bad of ['abc', '', '12', null, '1'.repeat(31), '10;drop', 1.5]) {
                const r = await work(A, 'POST', `/scans/${scanId}/bind-identity`, { facebook_user_id: bad, membership_verified: true, evidence_strategy: 'group_header_joined_control' });
                if (r.status !== 400) { assert(`malformed id ${JSON.stringify(bad)} refused`, false, `HTTP ${r.status}`); }
            }
            assert('every malformed facebook_user_id is refused', true);

            const bad = await work(A, 'POST', '/scans/not-a-uuid/bind-identity', { facebook_user_id: FB_ID_A, membership_verified: true, evidence_strategy: 'group_header_joined_control' });
            assert('a malformed scan id is refused', bad.status === 400 && bad.body?.error === 'Invalid id');

            const cross = await work(B, 'POST', `/scans/${scanId}/bind-identity`, { facebook_user_id: FB_ID_B, membership_verified: true, evidence_strategy: 'group_header_joined_control' });
            assert("another workspace's worker cannot bind this scan", cross.status === 404, `HTTP ${cross.status}`);
            const { data: untouched } = await admin.from('groups')
                .select('facebook_user_id').eq('workspace_id', A.workspaceId).eq('id', gid).single();
            assert('the cross-tenant attempt changed nothing', untouched.facebook_user_id === null);

            const ok = await work(A, 'POST', `/scans/${scanId}/bind-identity`, { facebook_user_id: FB_ID_A, membership_verified: true, evidence_strategy: 'group_header_joined_control' });
            assert('the owning worker binds successfully',
                ok.status === 200 && ok.body?.bound_groups === 1, JSON.stringify(ok.body));
            const { data: bound } = await admin.from('groups')
                .select('facebook_user_id').eq('workspace_id', A.workspaceId).eq('id', gid).single();
            assert('the group now carries the verified id', bound.facebook_user_id === FB_ID_A);

            const overwrite = await work(A, 'POST', `/scans/${scanId}/bind-identity`, { facebook_user_id: FB_ID_B, membership_verified: true, evidence_strategy: 'group_header_joined_control' });
            assert('a different id cannot overwrite an existing verified one',
                overwrite.status === 409, `HTTP ${overwrite.status}`);
            const { data: still } = await admin.from('groups')
                .select('facebook_user_id').eq('workspace_id', A.workspaceId).eq('id', gid).single();
            assert('the original verified id survives the attempt', still.facebook_user_id === FB_ID_A);

            const repeat = await work(A, 'POST', `/scans/${scanId}/bind-identity`, { facebook_user_id: FB_ID_A, membership_verified: true, evidence_strategy: 'group_header_joined_control' });
            assert('re-binding the same id is idempotent', repeat.status === 200, `HTTP ${repeat.status}`);

            const { data: logs } = await admin.from('system_logs')
                .select('message').eq('workspace_id', A.workspaceId).eq('source', 'engagement');
            const messages = (logs || []).map(l => l.message).join(' | ');
            assert('the bind is audited', messages.includes('ENGAGEMENT_IDENTITY_BOUND'));
            assert('the audit never records the account id', !messages.includes(FB_ID_A));
        }
    } finally {
        for (const t of [A, B]) {
            await admin.from('engagement_discovered_posts').delete().eq('workspace_id', t.workspaceId);
            await admin.from('engagement_scan_tasks').delete().eq('workspace_id', t.workspaceId);
            await admin.from('system_logs').delete().eq('workspace_id', t.workspaceId);
            await admin.from('groups').delete().eq('workspace_id', t.workspaceId);
            await admin.from('browser_workers').delete().eq('workspace_id', t.workspaceId);
            await admin.from('pairing_codes').delete().eq('workspace_id', t.workspaceId);
            await admin.from('workspace_members').delete().eq('workspace_id', t.workspaceId);
            await admin.from('workspaces').delete().eq('id', t.workspaceId);
            await admin.auth.admin.deleteUser(t.userId);
        }
        console.log('\n  fixtures cleaned');
    }

    console.log(`\n${passed} passed, ${failed} failed`);
    process.exitCode = failed ? 1 : 0;
})().catch(error => {
    console.error('Test run error:', error);
    process.exitCode = 2;
});
