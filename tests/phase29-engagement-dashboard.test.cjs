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

const dashboardApi = async (t, p) => {
    const res = await fetch(`${API_URL}/api${p}`, {
        headers: {
            Authorization: `Bearer ${t.token}`, 'x-workspace-id': t.workspaceId,
            Connection: 'close',
        },
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

function renderPanel(code, { groups = [], workspaceId = null, responses, timers = null }) {
    const dom = new JSDOM('<div id="root"></div>', { url: 'http://dashboard.test/' });
    const { window } = dom;
    const calls = [];
    // The panel talks to the real EngagementAPI client, which is bundled in;
    // only the network is stubbed.
    const fetchStub = async (url, options = {}) => {
        calls.push({ url: String(url), method: options.method || 'GET', body: options.body || null });
        const key = Object.keys(responses)
            .sort((a, b) => b.length - a.length)
            .find(k => String(url).includes(k));
        let entry = key ? responses[key] : { status: 404, body: { error: 'Not found' } };
        if (typeof entry === 'function') entry = await entry({ url: String(url), options, calls });
        if (entry.delay) await new Promise(resolve => setTimeout(resolve, entry.delay));
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
        URL: window.URL, URLSearchParams: window.URLSearchParams,
        setTimeout: window.setTimeout.bind(window), clearTimeout: window.clearTimeout.bind(window),
        setInterval: timers?.setInterval || window.setInterval.bind(window),
        clearInterval: timers?.clearInterval || window.clearInterval.bind(window),
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
    const render = next => root.render(React.createElement(Panel, {
        groups: next?.groups ?? groups,
        workspaceId: next?.workspaceId ?? workspaceId,
    }));
    const restore = () => {
        global.IS_REACT_ACT_ENVIRONMENT = false;
        try { root.unmount(); } catch { /* the case may already have torn down */ }
        global.window = saved.window;
        global.document = saved.document;
        global.navigator = saved.navigator;
        global.fetch = saved.fetch;
        global.IS_REACT_ACT_ENVIRONMENT = saved.act;
    };
    return { window, container, root, React, Panel, calls, restore, render };
}

const flush = () => new Promise(resolve => setTimeout(resolve, 30));
const deferred = () => {
    let resolve;
    let reject;
    const promise = new Promise((next, fail) => { resolve = next; reject = fail; });
    return { promise, resolve, reject };
};

async function mountPanel(code, options) {
    const ctx = renderPanel(code, options);
    const { act } = ctx.React;
    await act(async () => {
        ctx.render(options);
        await flush();
    });
    await act(async () => { await flush(); });
    ctx.act = act;
    return ctx;
}

async function setControl(ctx, selector, value) {
    const control = ctx.container.querySelector(selector);
    if (!control) throw new Error(`Missing control: ${selector}`);
    const prototype = control instanceof ctx.window.HTMLSelectElement
        ? ctx.window.HTMLSelectElement.prototype
        : control instanceof ctx.window.HTMLTextAreaElement
            ? ctx.window.HTMLTextAreaElement.prototype
            : ctx.window.HTMLInputElement.prototype;
    await ctx.act(async () => {
        const previous = control.value;
        Object.getOwnPropertyDescriptor(prototype, 'value').set.call(control, value);
        if (control._valueTracker) control._valueTracker.setValue(previous);
        control.dispatchEvent(new ctx.window.Event('input', { bubbles: true }));
        control.dispatchEvent(new ctx.window.Event('change', { bubbles: true }));
        require('react-dom/test-utils').Simulate.change(control, { target: { value } });
        await flush();
    });
    return control;
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
            created.status === 201 && scanId && !('workspace_id' in created.body.scan),
            `${created.status} ${JSON.stringify(created.body).slice(0, 160)}`);
        assert('a manual scan is limited to one group and ten posts',
            created.body.scan.max_groups === 1 && created.body.scan.max_posts_per_group === 10);
        const overPhaseOneLimit = await dash(enabledTenant, 'POST', '/scans', {
            name: 'too broad', group_ids: [groupId], max_groups: 1, max_posts_per_group: 11,
        });
        assert('the backend rejects scan requests above the controlled Phase 1 limit',
            overPhaseOneLimit.status === 400, `${overPhaseOneLimit.status} ${JSON.stringify(overPhaseOneLimit.body)}`);

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
            ['no-posts', { status: 'FAILED', error_code: 'NO_POSTS_FOUND', posts_discovered: 0 }, 'COMPLETED', true],
            ['identity-blocked', { status: 'ABORTED', error_code: 'FACEBOOK_IDENTITY_UNVERIFIED', failure_reason: 'strategy=legacy_identity_bind;signal=not_a_member' }, 'BLOCKED', true],
            ['identity-mismatch', { status: 'ABORTED', error_code: 'FACEBOOK_IDENTITY_MISMATCH', failure_reason: 'strategy=stable_facebook_user_id_mismatch;signal=x' }, 'BLOCKED', true],
            ['aborted', { status: 'ABORTED', error_code: 'INVALID_SCAN_TASK' }, 'ABORTED', true],
            ['cancelled', { status: 'CANCELLED', error_code: null }, 'CANCELLED', false],
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
        const dashboardGroups = await dashboardApi(enabledTenant, '/groups?user=phase29%20label');
        const dashboardGroup = dashboardGroups.body?.groups?.find(group => group.id === groupId);
        assert('/api/groups preserves the safe fields required by the dashboard',
            dashboardGroups.status === 200 && dashboardGroup?.name === `${groupId} name` &&
            dashboardGroup?.url?.includes(groupId) && dashboardGroup?.workspace_id === enabledTenant.workspaceId &&
            dashboardGroup?.facebook_user === 'phase29 label');
        assert('/api/groups does not expose the internal Facebook account id or backend metadata',
            !JSON.stringify(dashboardGroups.body).includes(FB_ID) &&
            !Object.prototype.hasOwnProperty.call(dashboardGroup || {}, 'facebook_user_id') &&
            !Object.prototype.hasOwnProperty.call(dashboardGroup || {}, 'created_at'));
        const finalStatus = await dash(enabledTenant, 'GET', '/status');
        const finalList = await dash(enabledTenant, 'GET', '/scans');
        assert('the status payload never contains the numeric Facebook account id',
            !JSON.stringify(finalStatus.body).includes(FB_ID), JSON.stringify(finalStatus.body).slice(0, 200));
        assert('the scan summaries never contain the numeric Facebook account id',
            !JSON.stringify(finalList.body.summaries || []).includes(FB_ID));
        assert('scan summaries never carry a raw failure reason',
            !/strategy=|signal=/.test(JSON.stringify(finalList.body.summaries || [])));
        assert('the scan list exposes no worker, lease, creator or workspace fields',
            !/(workspace_id|created_by|worker_id|claimed_at|lock_expires_at|failure_reason)/.test(JSON.stringify(finalList.body)));
        assert('the summaries list is what the dashboard renders',
            Array.isArray(finalList.body.summaries) && finalList.body.summaries.length >= 1);

        await admin.from('engagement_discovered_posts').insert({
            workspace_id: enabledTenant.workspaceId,
            scan_task_id: scanId,
            facebook_group_id: groupId,
            facebook_group_name: 'Phase 29 group',
            facebook_post_id: '29001',
            facebook_post_url: 'https://www.facebook.com/groups/phase29/posts/29001',
            author_name: 'QA Author',
            post_text: 'Phase 29 safe dashboard preview',
            is_truncated: true,
            dedup_key: `${tag}_dedup`,
            raw_metadata: { internal_strategy: 'must-not-leak' },
        });
        const discovered = await dash(enabledTenant, 'GET', '/discovered');
        assert('discovered posts return the safe display contract',
            discovered.status === 200 && discovered.body.posts?.[0]?.post_text === 'Phase 29 safe dashboard preview');
        assert('discovered posts expose no workspace, dedup or raw metadata fields',
            !/(workspace_id|dedup_key|raw_metadata|must-not-leak)/.test(JSON.stringify(discovered.body)));
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
        '/engagement/discovered': { status: 200, body: { posts: extra.posts || [], limit: 50, offset: 0 } },
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
        // Phase 2A added local controls — save a search, filter results, delete.
        // A raw button count was only ever a proxy for the property that matters,
        // which is that exactly ONE control reaches Facebook. Asserting the count
        // now would fail on controls that never leave the backend, and dropping
        // the assertion would lose the guarantee, so it is stated directly.
        assert('exactly one control contacts Facebook, and it is the scan',
            ctx.container.querySelectorAll('[data-testid="engagement-scan-now"]').length === 1 &&
            /scan now/i.test(controlText), controlText);
        assert('the preview action states it makes no Facebook request',
            !/preview/i.test(controlText) || /no facebook request/i.test(
                (ctx.container.textContent || '').toLowerCase()) ||
            !ctx.container.querySelector('[data-testid="preview-result"]'),
            'preview must never imply it reached Facebook');
        assert('no publishing control is introduced',
            !/publish|compose|post now|send/.test(controlText), controlText);
        assert('no scheduling control is introduced',
            !/schedule|recurring|daily|hourly|cron|interval|repeat/.test(controlText), controlText);
        assert('no comment, reply or reaction control is introduced',
            !/comment|reply|react|like|share/.test(controlText), controlText);
        assert('the panel contains no Facebook publishing editor',
            ctx.container.querySelector('[contenteditable], [data-action="publish"], [data-action="comment"]') === null);
        ctx.restore();
    }
    {
        const ctx = await mountPanel(code, { groups: GROUPS, responses: statusResponse(scanOf('RUNNING'), { active: true }) });
        assert('a running scan renders the Running state',
            ctx.container.querySelector('[data-testid="engagement-state-badge"]')?.dataset.state === 'RUNNING');
        assert('the scan button is disabled while one is in flight',
            ctx.container.querySelector('[data-testid="engagement-scan-now"]')?.disabled === true);
        assert('a running scan does not expose cancellation in Phase 1',
            ctx.container.querySelector('[data-testid="engagement-cancel-scan"]') === null);
        ctx.restore();
    }
    {
        const ctx = await mountPanel(code, { groups: GROUPS, responses: statusResponse(scanOf('QUEUED'), { active: true }) });
        assert('a queued scan renders the Queued state',
            ctx.container.querySelector('[data-testid="engagement-state-badge"]')?.dataset.state === 'QUEUED');
        assert('a queued scan exposes its Cancel action',
            Boolean(ctx.container.querySelector('[data-testid="engagement-cancel-scan"]')));
        ctx.restore();
    }
    {
        let cancelled = false;
        const queuedScan = () => scanOf(cancelled ? 'CANCELLED' : 'QUEUED', {
            status: cancelled ? 'CANCELLED' : 'QUEUED',
        });
        const responses = {
            '/engagement/scans/s1/cancel': async () => {
                await new Promise(resolve => setTimeout(resolve, 80));
                cancelled = true;
                return { status: 200, body: { success: true, status: 'CANCELLED' } };
            },
            '/engagement/status': () => ({
                status: 200,
                body: { enabled: true, latest_scan: queuedScan(), discovered_count: 0, active_scan: !cancelled },
            }),
            '/engagement/scans': () => ({ status: 200, body: { summaries: [queuedScan()] } }),
            '/engagement/discovered': { status: 200, body: { posts: [] } },
        };
        const ctx = await mountPanel(code, { groups: GROUPS, responses });
        await ctx.act(async () => {
            const button = ctx.container.querySelector('[data-testid="engagement-cancel-scan"]');
            button.dispatchEvent(new ctx.window.MouseEvent('click', { bubbles: true }));
            button.dispatchEvent(new ctx.window.MouseEvent('click', { bubbles: true }));
            await new Promise(resolve => setTimeout(resolve, 150));
            await flush();
        });
        assert('rapid repeated Cancel clicks send exactly one cancellation request',
            ctx.calls.filter(call => call.method === 'POST' && call.url.includes('/cancel')).length === 1);
        assert('a successful cancellation refreshes the row to CANCELLED',
            ctx.container.querySelector('[data-testid="engagement-state-badge"]')?.dataset.state === 'CANCELLED' &&
            ctx.container.querySelector('[data-testid="engagement-cancel-scan"]') === null);
        assert('a successful cancellation gives friendly confirmation',
            /cancelled/i.test(ctx.container.querySelector('[data-testid="engagement-notice"]')?.textContent || ''));
        ctx.restore();
    }
    {
        const responses = {
            '/engagement/scans/s1/cancel': {
                status: 500,
                body: { error: 'database password and internal cancellation detail' },
            },
            ...statusResponse(scanOf('QUEUED'), { active: true }),
        };
        const ctx = await mountPanel(code, { groups: GROUPS, responses });
        await ctx.act(async () => {
            ctx.container.querySelector('[data-testid="engagement-cancel-scan"]').dispatchEvent(
                new ctx.window.MouseEvent('click', { bubbles: true }));
            await flush();
        });
        const message = ctx.container.querySelector('[data-testid="engagement-error"]')?.textContent || '';
        assert('a cancellation failure gives a fixed friendly recovery message',
            /refresh and try again/i.test(message));
        assert('a cancellation failure never renders the raw backend error',
            !/password|internal cancellation detail/i.test(message));
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
                '/engagement/discovered': { status: 200, body: { posts: [], limit: 50, offset: 0 } },
            },
        });
        const act = ctx.act;
        await setControl(ctx, '[data-testid="engagement-group-select"]', 'g2');
        await setControl(ctx, '[data-testid="engagement-max-posts"]', '8');
        await setControl(ctx, '[data-testid="engagement-instructions"]', 'Keep this as a manual QA note');
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
            body.max_groups === 1 && body.max_posts_per_group === 8, JSON.stringify(body));
        assert('the non-AI scan note is sent as reference text',
            body.search_instructions === 'Keep this as a manual QA note', JSON.stringify(body));
        assert('the manual scan sends no workspace override of its own',
            !('workspace_id' in body) && !('facebook_user_id' in body), JSON.stringify(body));
        assert('the request carries the dashboard session, not worker credentials',
            !JSON.stringify(ctx.calls).includes('x-device-token'));
        ctx.restore();
    }

    console.log('\n E. dashboard usability and lifecycle regressions');
    {
        const completedEmpty = scanOf('COMPLETED', {
            status: 'COMPLETED', posts_discovered: 0, completed_at: '2026-09-04T08:05:00.000Z',
        });
        const ctx = await mountPanel(code, { groups: GROUPS, responses: statusResponse(completedEmpty) });
        assert('an empty scan history has a clear empty state',
            ctx.container.querySelectorAll('[data-testid="engagement-scan-row"]').length === 1);
        assert('a completed scan with zero posts is explained as a successful empty result',
            /completed successfully/i.test(ctx.container.querySelector('[data-testid="engagement-empty-result"]')?.textContent || ''));
        assert('an empty discovered-post list has a clear empty state',
            Boolean(ctx.container.querySelector('[data-testid="engagement-empty-posts"]')));
        ctx.restore();
    }
    {
        const ctx = await mountPanel(code, { groups: GROUPS, responses: statusResponse(null) });
        assert('a workspace with no scans has a clear history empty state',
            Boolean(ctx.container.querySelector('[data-testid="engagement-empty-scans"]')));
        ctx.restore();
    }
    {
        const captcha = scanOf('FAILED', {
            status: 'FAILED', error_code: 'CAPTCHA_REQUIRED',
            reason_summary: 'Facebook asked for a security check. Complete it in the browser, then run the scan again.',
        });
        const ctx = await mountPanel(code, { groups: GROUPS, responses: statusResponse(captcha) });
        assert('a CAPTCHA failure tells the user to complete the check in the browser',
            /security check.*browser/i.test(ctx.container.querySelector('[data-testid="engagement-reason"]')?.textContent || ''));
        ctx.restore();
    }
    {
        const mismatch = scanOf('BLOCKED', {
            status: 'ABORTED', error_code: 'FACEBOOK_IDENTITY_MISMATCH',
            reason_summary: 'The Facebook account signed in right now is not the account this group belongs to.',
        });
        const ctx = await mountPanel(code, { groups: GROUPS, responses: statusResponse(mismatch) });
        assert('an identity mismatch renders the blocked state and actionable explanation',
            ctx.container.querySelector('[data-testid="engagement-state-badge"]')?.dataset.state === 'BLOCKED' &&
            /signed in.*not the account/i.test(ctx.container.querySelector('[data-testid="engagement-reason"]')?.textContent || ''));
        ctx.restore();
    }
    {
        const posts = [
            {
                id: 'p1', facebook_group_name: 'קבוצת בדיקה ארוכה בעברית', author_name: 'בודק QA',
                post_text: 'טקסט עברי עם English words שנשאר קריא', is_truncated: true,
                posted_at: '2026-09-04T08:00:00.000Z',
                facebook_post_url: 'https://www.facebook.com/groups/g1/posts/123',
                facebook_user_id: '100000000000099', raw_metadata: { secret: 'do-not-render' }, dedup_key: 'private-key',
            },
            {
                id: 'p2', facebook_group_name: 'Unsafe link fixture', author_name: 'QA',
                post_text: 'Unsafe URL must not become a link', discovered_at: '2026-09-04T08:01:00.000Z',
                facebook_post_url: 'javascript:alert(1)',
            },
        ];
        const latest = scanOf('COMPLETED', { status: 'COMPLETED', posts_discovered: 2 });
        const ctx = await mountPanel(code, {
            groups: GROUPS,
            responses: statusResponse(latest, { discovered: 2, posts }),
        });
        const html = ctx.container.innerHTML;
        assert('completed scans render discovered post cards from the live API response',
            ctx.container.querySelectorAll('[data-testid="engagement-post"]').length === 2 && html.includes('טקסט עברי'));
        assert('a valid Facebook post URL is exposed with safe new-tab attributes',
            ctx.container.querySelectorAll('[data-testid="engagement-post-link"]').length === 1 &&
            ctx.container.querySelector('[data-testid="engagement-post-link"]')?.rel === 'noreferrer');
        assert('unsafe post URLs are never rendered as links',
            !html.includes('javascript:alert'));
        assert('truncated previews are labelled',
            Boolean(ctx.container.querySelector('[data-testid="engagement-post-truncated"]')));
        assert('internal Facebook identity, metadata and dedup values are never rendered',
            !html.includes('100000000000099') && !html.includes('do-not-render') && !html.includes('private-key'));
        assert('mixed Hebrew and English post text uses automatic direction',
            ctx.container.querySelector('[data-testid="engagement-post"] p')?.getAttribute('dir') === 'auto');
        ctx.restore();
    }
    {
        const ctx = await mountPanel(code, {
            groups: GROUPS,
            responses: statusResponse(null),
        });
        await setControl(ctx, '[data-testid="engagement-group-select"]', 'g1');
        await setControl(ctx, '[data-testid="engagement-max-posts"]', '11');
        await ctx.act(async () => {
            ctx.container.querySelector('[data-testid="engagement-scan-now"]').dispatchEvent(
                new ctx.window.MouseEvent('click', { bubbles: true }));
            await flush();
        });
        assert('client validation explains an out-of-range scan bound',
            /between 1 and 10/i.test(ctx.container.querySelector('[data-testid="engagement-error"]')?.textContent || ''));
        assert('client validation does not send an invalid create request',
            !ctx.calls.some(call => call.method === 'POST'));
        ctx.restore();
    }
    {
        const responses = statusResponse(null);
        responses['/engagement/scans'] = async ({ options }) => {
            if ((options.method || 'GET') === 'POST') {
                return { status: 201, body: { scan: scanOf('QUEUED') }, delay: 80 };
            }
            return { status: 200, body: { scans: [], summaries: [] } };
        };
        const ctx = await mountPanel(code, { groups: GROUPS, responses });
        await setControl(ctx, '[data-testid="engagement-group-select"]', 'g1');
        await ctx.act(async () => {
            const button = ctx.container.querySelector('[data-testid="engagement-scan-now"]');
            button.dispatchEvent(new ctx.window.MouseEvent('click', { bubbles: true }));
            button.dispatchEvent(new ctx.window.MouseEvent('click', { bubbles: true }));
            await new Promise(resolve => setTimeout(resolve, 140));
            await flush();
        });
        assert('rapid repeated clicks create only one scan request',
            ctx.calls.filter(call => call.method === 'POST').length === 1,
            JSON.stringify(ctx.calls.map(call => `${call.method} ${call.url}`)));
        ctx.restore();
    }
    {
        let workspace = 'a';
        let holdFirstA = true;
        const lateAScans = deferred();
        const lateAPosts = deferred();
        const responseScan = label => scanOf('COMPLETED', {
            id: `scan-${label}`,
            group_name: `Workspace ${label.toUpperCase()} group`,
        });
        const responses = {
            '/engagement/status': () => {
                const requestedWorkspace = workspace;
                return {
                    status: 200,
                    body: {
                        enabled: true, active_scan: false, discovered_count: 1,
                        latest_scan: responseScan(requestedWorkspace),
                    },
                };
            },
            '/engagement/scans': () => {
                const requestedWorkspace = workspace;
                if (requestedWorkspace === 'a' && holdFirstA) return lateAScans.promise;
                return { status: 200, body: { summaries: [responseScan(requestedWorkspace)] } };
            },
            '/engagement/discovered': () => {
                const requestedWorkspace = workspace;
                if (requestedWorkspace === 'a' && holdFirstA) return lateAPosts.promise;
                return {
                    status: 200,
                    body: { posts: [{ id: `post-${requestedWorkspace}`, post_text: `Workspace ${requestedWorkspace.toUpperCase()} post` }] },
                };
            },
        };
        const ctx = await mountPanel(code, {
            workspaceId: 'workspace-a',
            groups: [
                { id: 'a1', name: 'A group', workspace_id: 'workspace-a' },
                { id: 'a1', name: 'A duplicate', workspace_id: 'workspace-a' },
                { id: 'b1', name: 'Foreign B group', workspace_id: 'workspace-b' },
            ],
            responses,
        });
        assert('the initial workspace A refresh is held for the late-response regression',
            ctx.calls.filter(call => call.url.includes('/engagement/status')).length === 1 &&
            !ctx.container.textContent.includes('Foreign B group'));
        workspace = 'b';
        await ctx.act(async () => {
            ctx.render({
                workspaceId: 'workspace-b',
                groups: [
                    { id: 'b1', name: 'B group', workspace_id: 'workspace-b' },
                    { id: 'b1', name: 'B duplicate', workspace_id: 'workspace-b' },
                    { id: 'foreign', name: 'Foreign A group', workspace_id: 'workspace-a' },
                ],
            });
            await flush();
        });
        await ctx.act(async () => { await flush(); });
        assert('switching workspace renders the safe group DTO without duplicates or foreign groups',
            ctx.container.textContent.includes('Workspace B post') &&
            ctx.container.querySelectorAll('[data-testid="engagement-group-select"] option').length === 2 &&
            ctx.container.textContent.includes('B group') &&
            !ctx.container.textContent.includes('B duplicate') &&
            !ctx.container.textContent.includes('Foreign A group') &&
            !ctx.container.textContent.includes('Workspace A post') &&
            !ctx.container.textContent.includes('Workspace A group'));
        holdFirstA = false;
        lateAScans.resolve({ status: 200, body: { summaries: [responseScan('a')] } });
        lateAPosts.resolve({
            status: 200,
            body: { posts: [{ id: 'post-a-late', post_text: 'Workspace A late post' }] },
        });
        await ctx.act(async () => { await flush(); });
        assert('late workspace A scan and post responses cannot overwrite workspace B',
            ctx.container.textContent.includes('Workspace B post') &&
            ctx.container.textContent.includes('B group') &&
            !ctx.container.textContent.includes('Workspace A late post') &&
            !ctx.container.textContent.includes('Workspace A group'));
        workspace = 'a';
        await ctx.act(async () => {
            ctx.render({ workspaceId: 'workspace-a', groups: [{ id: 'a2', name: 'A clean group', workspace_id: 'workspace-a' }] });
            await flush();
        });
        await ctx.act(async () => { await flush(); });
        assert('switching back from B to A loads a clean A-only view',
            ctx.container.textContent.includes('Workspace A post') &&
            ctx.container.textContent.includes('A clean group') &&
            !ctx.container.textContent.includes('Workspace B post') &&
            !ctx.container.textContent.includes('B group'));
        ctx.restore();
    }
    {
        const started = [];
        const cleared = [];
        const slowPoll = deferred();
        let holdPoll = false;
        const responses = statusResponse(scanOf('RUNNING'), { active: true });
        responses['/engagement/status'] = () => holdPoll
            ? slowPoll.promise
            : { status: 200, body: { enabled: true, latest_scan: scanOf('RUNNING'), discovered_count: 0, active_scan: true } };
        const ctx = await mountPanel(code, {
            groups: GROUPS,
            responses,
            timers: {
                setInterval: callback => { started.push(callback); return 701; },
                clearInterval: id => cleared.push(id),
            },
        });
        assert('a running scan creates exactly one polling timer', started.length === 1);
        const statusCallsBeforePoll = ctx.calls.filter(call => call.url.includes('/engagement/status')).length;
        holdPoll = true;
        await ctx.act(async () => {
            started[0]();
            started[0]();
            await flush();
        });
        assert('a slow polling refresh cannot overlap with the next interval tick',
            ctx.calls.filter(call => call.url.includes('/engagement/status')).length === statusCallsBeforePoll + 1);
        holdPoll = false;
        slowPoll.resolve({
            status: 200,
            body: { enabled: true, latest_scan: scanOf('COMPLETED'), discovered_count: 0, active_scan: false },
        });
        await ctx.act(async () => { await flush(); });
        assert('polling stops as soon as no active scan remains', cleared.includes(701));
        ctx.restore();
    }
    {
        const started = [];
        const cleared = [];
        let workspace = 'a';
        const responses = statusResponse(scanOf('RUNNING'), { active: true });
        responses['/engagement/status'] = () => ({
            status: 200,
            body: workspace === 'a'
                ? { enabled: true, latest_scan: scanOf('RUNNING'), discovered_count: 0, active_scan: true }
                : { enabled: true, latest_scan: null, discovered_count: 0, active_scan: false },
        });
        const ctx = await mountPanel(code, {
            groups: GROUPS,
            workspaceId: 'workspace-a',
            responses,
            timers: {
                setInterval: callback => { started.push(callback); return 800 + started.length; },
                clearInterval: id => cleared.push(id),
            },
        });
        const firstTimer = 801;
        workspace = 'b';
        await ctx.act(async () => {
            ctx.render({ workspaceId: 'workspace-b', groups: [{ id: 'b1', name: 'B group', workspace_id: 'workspace-b' }] });
            await flush();
        });
        await ctx.act(async () => { await flush(); });
        assert('workspace switching clears the previous workspace polling timer',
            started.length === 1 && cleared.includes(firstTimer), `started=${started.length} cleared=${cleared.join(',')}`);
        ctx.restore();
        assert('unmount does not leave an active polling timer', cleared.includes(firstTimer));
    }
    for (const failureMode of ['server', 'network']) {
        const started = [];
        const cleared = [];
        let failRefresh = false;
        const responses = statusResponse(scanOf('RUNNING'), {
            active: true,
            posts: [{ id: 'stale-post', post_text: 'Stale successful data' }],
        });
        responses['/engagement/status'] = () => {
            if (!failRefresh) {
                return { status: 200, body: { enabled: true, latest_scan: scanOf('RUNNING'), discovered_count: 1, active_scan: true } };
            }
            if (failureMode === 'network') throw new Error('raw network socket detail');
            return { status: 500, body: { error: 'raw database server detail' } };
        };
        const ctx = await mountPanel(code, {
            groups: GROUPS,
            responses,
            timers: {
                setInterval: callback => { started.push(callback); return 901; },
                clearInterval: id => cleared.push(id),
            },
        });
        assert(`${failureMode} fixture begins with successful scan data`,
            ctx.container.textContent.includes('Stale successful data'));
        const callCount = ctx.calls.length;
        failRefresh = true;
        await ctx.act(async () => {
            started[0]();
            await flush();
        });
        const errorText = ctx.container.querySelector('[data-testid="engagement-error"]')?.textContent || '';
        assert(`${failureMode} failure displays a friendly visible error`,
            /try again|check your connection/i.test(errorText) && !/raw|database|socket/i.test(errorText));
        assert(`${failureMode} failure clears stale successful data`,
            !ctx.container.textContent.includes('Stale successful data'));
        assert(`${failureMode} failure stops polling without a retry storm`,
            cleared.includes(901) && ctx.calls.length === callCount + 1,
            `calls=${ctx.calls.length - callCount} cleared=${cleared.join(',')}`);
        ctx.restore();
    }

    console.log(`\n${passed} passed, ${failed} failed`);
    process.exitCode = failed ? 1 : 0;
})().catch(error => {
    console.error('Test run error:', error);
    process.exitCode = 2;
});
