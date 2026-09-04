/**
 * Phase 29 — Dashboard Phase 1D.
 *
 * Two halves:
 *
 *  A. The backend contract the dashboard depends on. /status is the only
 *     engagement route that answers while the workspace flag is off, because
 *     the dashboard has to be able to say "Engagement is off here". The fleet
 *     kill switch still hides everything. Nothing the dashboard receives may
 *     carry the numeric Facebook account id or an internal failure reason.
 *
 *  B. The panel itself, rendered for real with react-dom into jsdom, driven by
 *     a stubbed fetch. This is what proves the five UI states, that the scan
 *     action is unavailable when the feature is off, and that no publishing or
 *     scheduling affordance was introduced.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');
const esbuild = require('esbuild');
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

const tag = `p29_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
const FB_ID = '100000000000099';

// ---------------------------------------------------------------- API helpers

async function makeTenant(label, { engagement = true } = {}) {
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
    await admin.from('workspaces').update({ engagement_enabled: engagement }).eq('id', workspaceId);
    return { label, userId: created.user.id, token, workspaceId };
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

const seedGroup = (workspaceId, id) => admin.from('groups').insert({
    id, name: `${id} name`, url: `https://www.facebook.com/groups/${id}`,
    workspace_id: workspaceId, facebook_user: 'phase29 label', facebook_user_id: null,
});

// ------------------------------------------------------- component harness

async function buildPanel() {
    // Only the session and the API base are stubbed. Everything else — including
    // the real EngagementAPI client — is bundled from source, so this exercises
    // the shipped code rather than a copy of it.
    const STUBS = {
        '@/lib/session': 'export const getAuthHeaders = async () => ({ Authorization: "Bearer test" });',
        '@/lib/apiConfig': 'export const API_BASE = "http://engagement.test/api";',
    };
    const resolver = {
        name: 'safepost-aliases',
        setup(build) {
            build.onResolve({ filter: /^@\// }, args => {
                if (args.path in STUBS) return { path: args.path, namespace: 'stub' };
                // Returning an explicit path skips esbuild's extension probing,
                // so the extension has to be resolved here.
                const base = path.join(__dirname, '..', 'src', args.path.slice(2));
                const found = ['', '.jsx', '.js', '/index.jsx', '/index.js']
                    .map(suffix => base + suffix)
                    .find(candidate => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
                return { path: found || base };
            });
            build.onLoad({ filter: /.*/, namespace: 'stub' }, args => ({
                contents: STUBS[args.path], loader: 'js',
            }));
        },
    };
    // Plugins require the async esbuild API.
    const result = await esbuild.build({
        entryPoints: [path.join(__dirname, '../src/components/engagement/EngagementPanel.jsx')],
        bundle: true,
        format: 'cjs',
        platform: 'node',
        jsx: 'automatic',
        write: false,
        resolveExtensions: ['.jsx', '.js', '.json'],
        external: ['react', 'react-dom', 'react/jsx-runtime', 'react-dom/client'],
        plugins: [resolver],
    });
    return result.outputFiles[0].text;
}

function renderPanel(code, { groups = [], responses }) {
    const dom = new JSDOM('<div id="root"></div>', { url: 'http://dashboard.test/' });
    const { window } = dom;
    const calls = [];
    // The panel talks to the real EngagementAPI client, which is bundled in;
    // only the network is stubbed.
    const fetchStub = async (url, options = {}) => {
        calls.push({ url: String(url), method: options.method || 'GET', body: options.body || null });
        const key = Object.keys(responses).find(k => String(url).includes(k));
        const entry = key ? responses[key] : { status: 404, body: { error: 'Not found' } };
        return {
            ok: entry.status >= 200 && entry.status < 300,
            status: entry.status,
            json: async () => entry.body,
        };
    };
    window.fetch = fetchStub;

    const sandbox = {
        window, document: window.document, navigator: window.navigator,
        fetch: fetchStub, console,
        setTimeout: window.setTimeout.bind(window), clearTimeout: window.clearTimeout.bind(window),
        setInterval: window.setInterval.bind(window), clearInterval: window.clearInterval.bind(window),
        module: { exports: {} }, exports: {},
        require: name => require(name),
        global: undefined,
    };
    sandbox.global = sandbox;
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(code, sandbox);

    const React = require('react');
    const { createRoot } = require('react-dom/client');
    const Panel = sandbox.module.exports.default || sandbox.module.exports;

    // react-dom runs in this realm, not inside the vm, so it needs the jsdom
    // globals installed here. They are restored after each case.
    const saved = {
        window: global.window, document: global.document,
        navigator: global.navigator, fetch: global.fetch,
        act: global.IS_REACT_ACT_ENVIRONMENT,
    };
    global.window = window;
    global.document = window.document;
    global.navigator = window.navigator;
    global.fetch = fetchStub;
    global.IS_REACT_ACT_ENVIRONMENT = true;

    const container = window.document.getElementById('root');
    const root = createRoot(container);
    const restore = () => {
        try { root.unmount(); } catch { /* the case may already have torn down */ }
        global.window = saved.window;
        global.document = saved.document;
        global.navigator = saved.navigator;
        global.fetch = saved.fetch;
        global.IS_REACT_ACT_ENVIRONMENT = saved.act;
    };
    return { window, container, root, React, Panel, calls, restore };
}

const flush = () => new Promise(resolve => setTimeout(resolve, 30));

async function mountPanel(code, options) {
    const ctx = renderPanel(code, options);
    const { act } = ctx.React;
    await act(async () => {
        ctx.root.render(ctx.React.createElement(ctx.Panel, { groups: options.groups || [] }));
        await flush();
    });
    await act(async () => { await flush(); });
    ctx.act = act;
    return ctx;
}

// -------------------------------------------------------------------- suite

(async () => {
    console.log('Phase 29 Engagement dashboard (Phase 1D)\n');

    console.log(' A. backend contract');
    const tenants = [];
    const track = async (label, opts) => { const t = await makeTenant(label, opts); tenants.push(t); return t; };
    try {
        const enabledTenant = await track('on', { engagement: true });
        const disabledTenant = await track('off', { engagement: false });
        const otherTenant = await track('other', { engagement: true });

        const groupId = `${tag}_grp`;
        const otherGroupId = `${tag}_grp_other`;
        await seedGroup(enabledTenant.workspaceId, groupId);
        await seedGroup(otherTenant.workspaceId, otherGroupId);

        // -- flag off ------------------------------------------------------
        const offStatus = await dash(disabledTenant, 'GET', '/status');
        assert('status answers while the workspace flag is off',
            offStatus.status === 200 && offStatus.body.enabled === false,
            `${offStatus.status} ${JSON.stringify(offStatus.body)}`);
        assert('a disabled workspace reports no scans and no discovered posts',
            offStatus.body.latest_scan === null && offStatus.body.discovered_count === 0 &&
            offStatus.body.active_scan === false);

        const offList = await dash(disabledTenant, 'GET', '/scans');
        assert('listing scans is unavailable while the flag is off', offList.status === 404);

        const offCreate = await dash(disabledTenant, 'POST', '/scans', {
            name: 'should not exist', group_ids: [groupId], max_groups: 1, max_posts_per_group: 10,
        });
        assert('starting a scan is refused while the flag is off', offCreate.status === 404);

        const { count: leaked } = await admin.from('engagement_scan_tasks')
            .select('id', { count: 'exact', head: true }).eq('workspace_id', disabledTenant.workspaceId);
        assert('a refused scan creates no row at all', (leaked || 0) === 0, `count=${leaked}`);

        // -- flag on -------------------------------------------------------
        const onStatus = await dash(enabledTenant, 'GET', '/status');
        assert('status reports the feature enabled for an enabled workspace',
            onStatus.status === 200 && onStatus.body.enabled === true);
        assert('an enabled workspace with no history reports no latest scan',
            onStatus.body.latest_scan === null);

        const created = await dash(enabledTenant, 'POST', '/scans', {
            name: 'Manual scan — phase29', group_ids: [groupId], max_groups: 1, max_posts_per_group: 10,
        });
        const scanId = created.body?.scan?.id;
        assert('a manual scan is created for the caller workspace',
            created.status === 201 && created.body.scan.workspace_id === enabledTenant.workspaceId,
            `${created.status} ${JSON.stringify(created.body).slice(0, 160)}`);
        assert('a manual scan is limited to one group and ten posts',
            created.body.scan.max_groups === 1 && created.body.scan.max_posts_per_group === 10);

        const queued = await dash(enabledTenant, 'GET', '/status');
        assert('a freshly created scan surfaces as QUEUED',
            queued.body.latest_scan?.ui_state === 'QUEUED' && queued.body.active_scan === true,
            JSON.stringify(queued.body.latest_scan));

        // -- workspace isolation -------------------------------------------
        const otherList = await dash(otherTenant, 'GET', '/scans');
        assert('another workspace cannot see this workspace\'s scans',
            otherList.status === 200 && (otherList.body.scans || []).every(s => s.id !== scanId),
            JSON.stringify((otherList.body.scans || []).map(s => s.id)));

        const otherStatus = await dash(otherTenant, 'GET', '/status');
        assert('another workspace\'s status does not report this scan',
            otherStatus.body.latest_scan === null, JSON.stringify(otherStatus.body.latest_scan));

        const otherCancel = await dash(otherTenant, 'POST', `/scans/${scanId}/cancel`);
        assert('another workspace cannot cancel this scan', otherCancel.status === 404);

        const otherTrigger = await dash(otherTenant, 'POST', '/scans', {
            name: 'cross tenant', group_ids: [groupId], max_groups: 1, max_posts_per_group: 10,
        });
        assert('another workspace cannot trigger a scan against this workspace\'s group',
            otherTrigger.status === 400, `${otherTrigger.status}`);

        // -- terminal states -------------------------------------------------
        const states = [
            ['RUNNING', { status: 'RUNNING', error_code: null }, 'RUNNING', false],
            ['COMPLETED', { status: 'COMPLETED', error_code: null, posts_discovered: 4 }, 'COMPLETED', false],
            ['identity-blocked', { status: 'ABORTED', error_code: 'FACEBOOK_IDENTITY_UNVERIFIED', failure_reason: 'strategy=legacy_identity_bind;signal=not_a_member' }, 'BLOCKED', true],
            ['identity-mismatch', { status: 'ABORTED', error_code: 'FACEBOOK_IDENTITY_MISMATCH', failure_reason: 'strategy=stable_facebook_user_id_mismatch;signal=x' }, 'BLOCKED', true],
            ['failed', { status: 'FAILED', error_code: 'PAGE_LOAD_TIMEOUT' }, 'FAILED', true],
        ];
        for (const [label, patch, expectedState, expectReason] of states) {
            await admin.from('engagement_scan_tasks').update(patch).eq('id', scanId);
            const seen = await dash(enabledTenant, 'GET', '/status');
            const latest = seen.body.latest_scan;
            assert(`${label} maps to ui_state ${expectedState}`,
                latest?.ui_state === expectedState, JSON.stringify(latest));
            if (expectReason) {
                assert(`${label} carries a user-facing explanation`,
                    typeof latest.reason_summary === 'string' && latest.reason_summary.length > 10,
                    JSON.stringify(latest.reason_summary));
                assert(`${label} never leaks the internal reason string`,
                    !/strategy=|signal=/.test(JSON.stringify(seen.body)),
                    JSON.stringify(seen.body.latest_scan));
            }
        }

        // -- nothing sensitive in anything the dashboard receives -----------
        await admin.from('engagement_scan_tasks').update({ facebook_user_id: FB_ID }).eq('id', scanId);
        await admin.from('groups').update({ facebook_user_id: FB_ID })
            .eq('workspace_id', enabledTenant.workspaceId).eq('id', groupId);
        const finalStatus = await dash(enabledTenant, 'GET', '/status');
        const finalList = await dash(enabledTenant, 'GET', '/scans');
        assert('the status payload never contains the numeric Facebook account id',
            !JSON.stringify(finalStatus.body).includes(FB_ID), JSON.stringify(finalStatus.body).slice(0, 200));
        assert('the scan summaries never contain the numeric Facebook account id',
            !JSON.stringify(finalList.body.summaries || []).includes(FB_ID));
        assert('scan summaries never carry a raw failure reason',
            !/strategy=|signal=/.test(JSON.stringify(finalList.body.summaries || [])));
        assert('the summaries list is what the dashboard renders',
            Array.isArray(finalList.body.summaries) && finalList.body.summaries.length >= 1);
    } finally {
        for (const t of tenants) {
            await admin.from('engagement_discovered_posts').delete().eq('workspace_id', t.workspaceId);
            await admin.from('engagement_scan_tasks').delete().eq('workspace_id', t.workspaceId);
            await admin.from('system_logs').delete().eq('workspace_id', t.workspaceId);
            await admin.from('groups').delete().eq('workspace_id', t.workspaceId);
            await admin.from('browser_workers').delete().eq('workspace_id', t.workspaceId);
            await admin.from('pairing_codes').delete().eq('workspace_id', t.workspaceId);
            await admin.from('workspace_members').delete().eq('workspace_id', t.workspaceId);
            await admin.from('workspaces').delete().eq('id', t.workspaceId);
            await admin.auth.admin.deleteUser(t.userId).catch(() => {});
        }
        if (tenants.length) {
            const { data: survivors } = await admin.from('workspaces')
                .select('id').in('id', tenants.map(t => t.workspaceId));
            assert('every workspace this suite created is removed',
                Array.isArray(survivors) && survivors.length === 0, JSON.stringify(survivors));
        }
    }

    console.log('\n B. the panel renders the five states');
    const code = await buildPanel();
    const GROUPS = [{ id: 'g1', name: 'Group One' }, { id: 'g2', name: 'Group Two' }];
    const statusResponse = (latest, extra = {}) => ({
        '/engagement/status': { status: 200, body: { enabled: true, latest_scan: latest, discovered_count: extra.discovered ?? 0, active_scan: extra.active ?? false } },
        '/engagement/scans': { status: 200, body: { scans: [], summaries: latest ? [latest] : [] } },
    });
    const scanOf = (uiState, over = {}) => ({
        id: 's1', name: 'Manual scan', status: uiState, ui_state: uiState,
        error_code: null, reason_summary: null, group_name: 'Group One',
        groups_scanned: 1, posts_discovered: 0,
        created_at: '2026-09-04T08:00:00.000Z', started_at: null, completed_at: null,
        ...over,
    });

    {
        const ctx = await mountPanel(code, { groups: GROUPS, responses: statusResponse(scanOf('COMPLETED', { posts_discovered: 4, completed_at: '2026-09-04T08:05:00.000Z' }), { discovered: 4 }) });
        const html = ctx.container.innerHTML;
        assert('a completed scan renders the Completed state',
            ctx.container.querySelector('[data-testid="engagement-state-badge"]')?.dataset.state === 'COMPLETED',
            html.slice(0, 200));
        assert('the discovered count is shown',
            ctx.container.querySelector('[data-testid="engagement-discovered-count"]')?.textContent === '4');
        assert('the last-run timestamp is shown',
            (ctx.container.querySelector('[data-testid="engagement-latest-time"]')?.textContent || '') !== '—');
        assert('the scan action is offered when the feature is enabled',
            Boolean(ctx.container.querySelector('[data-testid="engagement-scan-now"]')));
        // Assert on the CONTROLS, not on the prose: the panel's own description
        // says it never comments or reacts, and that sentence must not be read
        // as evidence of a comment button.
        const controlText = Array.from(ctx.container.querySelectorAll('button, select, input, a, [role="button"]'))
            .map(el => `${el.getAttribute('aria-label') || ''} ${el.textContent || ''}`)
            .join(' | ')
            .toLowerCase();
        assert('the panel offers exactly one action, and it is the scan',
            ctx.container.querySelectorAll('button').length === 1 &&
            /scan now/i.test(controlText), controlText);
        assert('no publishing control is introduced',
            !/publish|compose|post now|send/.test(controlText), controlText);
        assert('no scheduling control is introduced',
            !/schedule|recurring|daily|hourly|cron|interval|repeat/.test(controlText), controlText);
        assert('no comment, reply or reaction control is introduced',
            !/comment|reply|react|like|share/.test(controlText), controlText);
        assert('the panel contains no form that could post to Facebook',
            ctx.container.querySelector('form, textarea, [contenteditable]') === null);
        ctx.restore();
    }
    {
        const ctx = await mountPanel(code, { groups: GROUPS, responses: statusResponse(scanOf('RUNNING'), { active: true }) });
        assert('a running scan renders the Running state',
            ctx.container.querySelector('[data-testid="engagement-state-badge"]')?.dataset.state === 'RUNNING');
        assert('the scan button is disabled while one is in flight',
            ctx.container.querySelector('[data-testid="engagement-scan-now"]')?.disabled === true);
        ctx.restore();
    }
    {
        const ctx = await mountPanel(code, { groups: GROUPS, responses: statusResponse(scanOf('QUEUED'), { active: true }) });
        assert('a queued scan renders the Queued state',
            ctx.container.querySelector('[data-testid="engagement-state-badge"]')?.dataset.state === 'QUEUED');
        ctx.restore();
    }
    {
        const blocked = scanOf('BLOCKED', {
            status: 'ABORTED',
            error_code: 'FACEBOOK_IDENTITY_UNVERIFIED',
            reason_summary: 'Could not confirm that this Facebook account belongs to the selected group. The scan stopped before reading anything.',
        });
        const ctx = await mountPanel(code, { groups: GROUPS, responses: statusResponse(blocked) });
        const html = ctx.container.innerHTML;
        assert('an identity-blocked scan renders the Blocked state',
            ctx.container.querySelector('[data-testid="engagement-state-badge"]')?.dataset.state === 'BLOCKED');
        assert('the blocked state is explained in plain language',
            (ctx.container.querySelector('[data-testid="engagement-reason"]')?.textContent || '').includes('Could not confirm'));
        assert('the blocked explanation leaks no internals',
            !/strategy=|signal=|legacy_identity_bind|not_a_member/.test(html), html.slice(0, 300));
        assert('no numeric Facebook account id is rendered',
            !/\b\d{9,}\b/.test(html.replace(/2026-09-04T[0-9:.]+Z/g, '')), html.slice(0, 300));
        ctx.restore();
    }
    {
        const ctx = await mountPanel(code, { groups: GROUPS, responses: statusResponse(scanOf('FAILED', { status: 'FAILED', error_code: 'PAGE_LOAD_TIMEOUT', reason_summary: 'The group page did not finish loading.' })) });
        assert('a failed scan renders the Failed state',
            ctx.container.querySelector('[data-testid="engagement-state-badge"]')?.dataset.state === 'FAILED');
        ctx.restore();
    }

    console.log('\n C. the feature flag governs the panel');
    {
        const ctx = await mountPanel(code, {
            groups: GROUPS,
            responses: {
                '/engagement/status': { status: 200, body: { enabled: false, latest_scan: null, discovered_count: 0, active_scan: false } },
            },
        });
        assert('a disabled workspace is told the feature is off',
            Boolean(ctx.container.querySelector('[data-testid="engagement-disabled-note"]')));
        assert('a disabled workspace is offered no scan action',
            ctx.container.querySelector('[data-testid="engagement-scan-now"]') === null);
        assert('a disabled workspace is offered no group picker',
            ctx.container.querySelector('[data-testid="engagement-group-select"]') === null);
        assert('a disabled workspace never requests the scan list',
            !ctx.calls.some(call => call.url.includes('/engagement/scans')),
            JSON.stringify(ctx.calls.map(c => c.url)));
        ctx.restore();
    }
    {
        // Fleet kill switch: every engagement route 404s, so the panel must not
        // render at all — the dashboard is then identical to before the feature.
        const ctx = await mountPanel(code, { groups: GROUPS, responses: {} });
        assert('the panel renders nothing when engagement is off fleet-wide',
            ctx.container.innerHTML === '', ctx.container.innerHTML.slice(0, 120));
        ctx.restore();
    }

    console.log('\n D. the manual scan request');
    {
        const ctx = await mountPanel(code, {
            groups: GROUPS,
            responses: {
                '/engagement/status': { status: 200, body: { enabled: true, latest_scan: null, discovered_count: 0, active_scan: false } },
                '/engagement/scans': { status: 200, body: { scans: [], summaries: [] } },
            },
        });
        const act = ctx.act;
        const select = ctx.container.querySelector('[data-testid="engagement-group-select"]');
        await act(async () => {
            const setter = Object.getOwnPropertyDescriptor(ctx.window.HTMLSelectElement.prototype, 'value').set;
            setter.call(select, 'g2');
            select.dispatchEvent(new ctx.window.Event('change', { bubbles: true }));
            await flush();
        });
        await act(async () => {
            ctx.container.querySelector('[data-testid="engagement-scan-now"]').dispatchEvent(
                new ctx.window.MouseEvent('click', { bubbles: true }));
            await flush();
        });
        const post = ctx.calls.find(call => call.method === 'POST');
        assert('the scan action posts to the engagement scans route',
            Boolean(post) && post.url.endsWith('/engagement/scans'), JSON.stringify(ctx.calls.map(c => `${c.method} ${c.url}`)));
        const body = post ? JSON.parse(post.body) : {};
        assert('the manual scan targets exactly the selected group',
            Array.isArray(body.group_ids) && body.group_ids.length === 1 && body.group_ids[0] === 'g2',
            JSON.stringify(body));
        assert('the manual scan stays inside the controlled limits',
            body.max_groups === 1 && body.max_posts_per_group === 10, JSON.stringify(body));
        assert('the manual scan sends no workspace override of its own',
            !('workspace_id' in body) && !('facebook_user_id' in body), JSON.stringify(body));
        assert('the request carries the dashboard session, not worker credentials',
            !JSON.stringify(ctx.calls).includes('x-device-token'));
        ctx.restore();
    }

    console.log(`\n${passed} passed, ${failed} failed`);
    process.exitCode = failed ? 1 : 0;
})().catch(error => {
    console.error('Test run error:', error);
    process.exitCode = 2;
});
