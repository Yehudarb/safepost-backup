/**
 * Phase 33 - Facebook account identity binding on group sync.
 *
 * Regression cover for the defect that left facebook_user_id NULL on every
 * synced group row: each identity path bottomed out on a page-script read of
 * document.cookie, which returns nothing when Facebook serves c_user as
 * HttpOnly. The display name still resolved from sources that need no id, so a
 * sync looked healthy while producing zero identity bindings.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

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

const root = path.join(__dirname, '..');
const readSource = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const backgroundSource = readSource('safe_post_extension/background.js');
const FB_USER_ID = '100000000000009';
const yieldAsync = () => new Promise(resolve => setImmediate(resolve));
const noOpEvent = { addListener() {}, removeListener() {} };

// A context carrying only what background.js touches at module scope, plus the
// hooks each test needs. Kept deliberately small: the point is to exercise the
// identity path, not to re-host the whole service worker.
function loadBackground(options = {}) {
    const local = {};
    const syncBodies = [];
    const updateListeners = new Set();
    const cookieJar = options.cookies || {};
    const cookieCalls = [];

    const context = {
        console: { log() {}, warn() {}, error() {} },
        setTimeout,
        clearTimeout,
        setInterval,
        clearInterval,
        queueMicrotask,
        Promise,
        Date,
        Math,
        JSON,
        String,
        Number,
        Boolean,
        Object,
        Array,
        Set,
        Map,
        RegExp,
        Error,
        URL,
        AbortController,
        TextEncoder,
        importScripts() {},
        crypto: { randomUUID: () => '00000000-0000-4000-8000-000000000000' },
        SafePostFacebookActivityLockFactory: {
            FACEBOOK_ACTIVITY_OWNERS: { PUBLISHING: 'publishing', GROUP_SYNC: 'group_sync', ENGAGEMENT: 'engagement' },
            FACEBOOK_ACTIVITY_HEARTBEAT_MS: 30000,
            FACEBOOK_ACTIVITY_PREEMPT_WAIT_MS: 30000,
        },
        SafePostFacebookActivityLock: {
            async acquireFacebookActivityLock() { return { acquired: true }; },
            async releaseFacebookActivityLock() { return true; },
            async attachFacebookActivityTab() { return true; },
            async refreshFacebookActivityLock() { return true; },
            async readFacebookActivityLock() { return null; },
            async requestFacebookActivityPreemption() { return true; },
            async clearFacebookActivityPreemption() { return true; },
            async readFacebookActivityPreemption() { return null; },
            async reconcileFacebookActivityLock() { return { recovered: true }; },
            async attachFacebookActivityJob() { return true; },
            async attachFacebookActivityScan() { return true; },
            async getFacebookActivityLock() { return null; },
            async waitForFacebookActivityUnlock() { return true; },
            // Returns its own unregister callback; the sync path calls it in finally.
            registerFacebookActivityPreemptionHandler() { return () => {}; },
        },
        SafePostEngagementNavigation: global.SafePostEngagementNavigation || {},
        SafePostEngagementIdentity: global.SafePostEngagementIdentity || {},
        SafePostExternalTrust: { validateExternalSender: () => ({ ok: false }) },
        ExtStorage: {
            async getApiUrl() { return 'http://localhost:3001'; },
            async getCooldownTimestamp() { return null; },
            async getLastJobId() { return null; },
            async setLastJobId() {},
            async clearLastJobId() {},
            async setCooldown() {},
            async getWorkerIdentity() { return { workerId: 'w-1', deviceToken: 't-1' }; },
        },
        chrome: {
            alarms: { create() {}, clear(_n, cb) { cb?.(); }, get(_n, cb) { cb?.(null); }, onAlarm: noOpEvent },
            runtime: {
                id: 'phase33',
                lastError: null,
                getManifest: () => ({ version: '9.4' }),
                onInstalled: noOpEvent,
                onStartup: noOpEvent,
                onMessage: noOpEvent,
                onMessageExternal: noOpEvent,
            },
            storage: {
                local: {
                    async get(keys) {
                        const names = Array.isArray(keys) ? keys : [keys];
                        return Object.fromEntries(names.filter(n => n in local).map(n => [n, local[n]]));
                    },
                    async set(values) { Object.assign(local, values); },
                },
                onChanged: noOpEvent,
            },
            // The subject under test. Absent entirely when options.noCookieApi is
            // set, which is how an older Chrome or a withheld permission looks.
            ...(options.noCookieApi ? {} : {
                cookies: {
                    async get({ url, name }) {
                        cookieCalls.push(`${name}@${url}`);
                        if (options.cookieThrows) throw new Error('expected cookie failure');
                        const value = cookieJar[url];
                        return value === undefined ? null : { name, value, httpOnly: true };
                    },
                },
            }),
            tabs: {
                onRemoved: noOpEvent,
                onUpdated: {
                    addListener(l) { updateListeners.add(l); },
                    removeListener(l) { updateListeners.delete(l); },
                },
                // The group-sync path calls this callback-style and only registers
                // its onUpdated listener once the callback has awaited the activity
                // lock, so the load event has to be announced after that settles.
                create(createOptions, callback) {
                    const tab = { id: 77, status: 'complete', url: createOptions.url };
                    callback?.(tab);
                    setTimeout(() => {
                        for (const listener of [...updateListeners]) listener(77, { status: 'complete' }, tab);
                    }, 20);
                    return Promise.resolve(tab);
                },
                async get(tabId) { return { id: tabId, url: 'https://www.facebook.com/groups/joins/' }; },
                async remove() {},
                async query() { return options.facebookTabs === undefined ? [{ id: 5 }] : options.facebookTabs; },
                sendMessage(_tabId, message, callback) {
                    if (message.action === 'GET_FACEBOOK_USER') {
                        callback({
                            facebook_user: options.contentName === undefined ? 'Yehuda Arbely' : options.contentName,
                            facebook_user_id: options.contentId === undefined ? null : options.contentId,
                        });
                        return;
                    }
                    callback?.({});
                },
            },
            scripting: {
                async executeScript() {
                    return [{ result: {
                        groups: [{ id: 'g1', name: 'Group One', url: 'https://www.facebook.com/groups/g1/' }],
                        facebook_user: options.scrapedName === undefined ? 'Yehuda Arbely' : options.scrapedName,
                        facebook_user_id: options.scrapedId === undefined ? null : options.scrapedId,
                    } }];
                },
            },
        },
        fetch: async (url, fetchOptions = {}) => {
            const target = String(url);
            if (target.includes('/api/groups/sync')) {
                syncBodies.push(JSON.parse(fetchOptions.body));
                return { ok: true, status: 200, async json() { return { success: true, added: 1 }; } };
            }
            return { ok: true, status: 200, async json() { return {}; } };
        },
    };
    context.globalThis = context;
    context.self = context;

    vm.runInNewContext(`${backgroundSource}\nglobalThis.__phase33 = {
        readFacebookUserIdFromCookieStore,
        getFacebookUserFromContent,
        scanAndSyncGroups,
    };`, context);

    return { api: context.__phase33, syncBodies, cookieCalls };
}

async function run() {
    console.log('\nPhase 33 - identity binding\n');

    console.log('Cookie-store account id read (the fix)');
    {
        const { api, cookieCalls } = loadBackground({
            cookies: { 'https://www.facebook.com/': FB_USER_ID },
        });
        const id = await api.readFacebookUserIdFromCookieStore();
        assert('reads c_user from the browser cookie store', id === FB_USER_ID, `got ${id}`);
        assert('queries the c_user cookie by name', cookieCalls[0] === `c_user@https://www.facebook.com/`, cookieCalls[0]);
    }
    {
        // The production case: page script cannot see the cookie at all.
        const { api } = loadBackground({ cookies: { 'https://www.facebook.com/': FB_USER_ID } });
        assert('an HttpOnly cookie is still resolved', await api.readFacebookUserIdFromCookieStore() === FB_USER_ID);
    }
    {
        const { api } = loadBackground({ cookies: { 'https://facebook.com/': FB_USER_ID } });
        assert('falls back to the bare facebook.com origin', await api.readFacebookUserIdFromCookieStore() === FB_USER_ID);
    }
    {
        const { api } = loadBackground({ cookies: { 'https://www.facebook.com/': 'not-a-number' } });
        assert('rejects a non-numeric cookie value', await api.readFacebookUserIdFromCookieStore() === null);
    }
    {
        const { api } = loadBackground({ cookies: {} });
        assert('returns null when no cookie is set', await api.readFacebookUserIdFromCookieStore() === null);
    }
    {
        const { api } = loadBackground({ noCookieApi: true });
        assert('degrades to null without the cookies permission', await api.readFacebookUserIdFromCookieStore() === null);
    }
    {
        const { api } = loadBackground({ cookieThrows: true });
        assert('a cookie read failure never throws', await api.readFacebookUserIdFromCookieStore() === null);
    }

    console.log('\nGroup-sync payload carries the identity');
    {
        // Exactly the failing production shape: a name resolves, no page-visible
        // id anywhere, and only the cookie store knows the account.
        const { api, syncBodies } = loadBackground({
            cookies: { 'https://www.facebook.com/': FB_USER_ID },
            contentId: null,
            scrapedId: null,
        });
        await api.scanAndSyncGroups();
        await yieldAsync();
        const body = syncBodies[0];
        assert('a sync request was sent', Boolean(body));
        assert('payload carries facebook_user_id from the cookie store',
            body?.facebook_user_id === FB_USER_ID, JSON.stringify(body?.facebook_user_id));
        assert('payload still carries the display name',
            body?.facebook_user === 'Yehuda Arbely', String(body?.facebook_user));
        assert('groups are unaffected', Array.isArray(body?.groups) && body.groups.length === 1);
    }
    {
        // Regression guard for the original bug: without the cookie store this
        // is precisely the unbound payload that produced 175 NULL rows.
        const { api, syncBodies } = loadBackground({ noCookieApi: true, contentId: null, scrapedId: null });
        await api.scanAndSyncGroups();
        await yieldAsync();
        assert('unbound sync is still sent rather than silently dropped', Boolean(syncBodies[0]));
        assert('unbound sync reports a null id (the documented degraded state)',
            syncBodies[0]?.facebook_user_id === null, JSON.stringify(syncBodies[0]?.facebook_user_id));
    }
    {
        const { api, syncBodies } = loadBackground({
            cookies: { 'https://www.facebook.com/': FB_USER_ID },
            contentId: '999999999999999',
        });
        await api.scanAndSyncGroups();
        await yieldAsync();
        assert('the cookie store outranks a page-reported id',
            syncBodies[0]?.facebook_user_id === FB_USER_ID, String(syncBodies[0]?.facebook_user_id));
    }

    console.log('\nIn-tab detector no longer discards a good id');
    {
        const marker = 'return userId ? { name: null, id: userId } : null;';
        assert('the name-scrape failure path preserves the cookie id',
            backgroundSource.includes(marker));
        const detectStart = backgroundSource.indexOf('const detectFBUserInTab');
        const detectEnd = backgroundSource.indexOf(marker, detectStart);
        assert('that path belongs to detectFBUserInTab',
            detectStart > 0 && detectEnd > detectStart && (detectEnd - detectStart) < 1600,
            `start=${detectStart} end=${detectEnd}`);
    }

    console.log('\nBackend preserves the binding on conflict');
    {
        const serverSource = readSource('server/index.cjs');
        assert('facebook_user_id is written only when one arrived',
            serverSource.includes('...(incomingId ? { facebook_user_id: incomingId } : {})'),
            'omitting the key is what keeps a re-sync from nulling a stored id');
        assert('the id is never logged verbatim',
            !/facebook_user_id[^\n]*\$\{incomingId\}/.test(serverSource));
        assert('an unbound sync is called out in the log',
            serverSource.includes("account id: ${incomingId ? 'bound' : 'MISSING"));
        assert('the upsert still conflicts on (workspace_id,id)',
            serverSource.includes("onConflict: 'workspace_id,id'"));
    }

    console.log('\nRelease version is decoupled from the fleet floor');
    {
        const { MINIMUM_ENGAGEMENT_EXTENSION_VERSION, isVersionAtLeast } = require('../server/lib/extensionVersion.cjs');
        const manifest = JSON.parse(readSource('safe_post_extension/manifest.json'));
        assert('the Engagement floor is unchanged at 9.2',
            MINIMUM_ENGAGEMENT_EXTENSION_VERSION === '9.2', MINIMUM_ENGAGEMENT_EXTENSION_VERSION);
        assert('the shipped manifest is 9.4', manifest.version === '9.4', manifest.version);
        assert('the shipped build satisfies the floor',
            isVersionAtLeast(manifest.version, MINIMUM_ENGAGEMENT_EXTENSION_VERSION));
        // Audit SP-C1/SP-H4: clipboardRead could read whatever the user copied in a
        // browser that is also logged into Facebook, and nothing in the extension
        // ever used it. Removed in 9.4; asserted so it cannot drift back.
        assert('no clipboard permission is requested',
            !(manifest.permissions || []).some(p => /clipboard/i.test(p)),
            (manifest.permissions || []).join(', '));
        assert('the manifest declares the cookies permission',
            Array.isArray(manifest.permissions) && manifest.permissions.includes('cookies'));
        assert('facebook.com host permission is present',
            (manifest.host_permissions || []).some(h => h.includes('facebook.com')));
        const buildSource = readSource('scripts/build-extension.cjs');
        assert('the build gate compares versions instead of demanding equality',
            buildSource.includes('isVersionAtLeast(manifest.version, MINIMUM_ENGAGEMENT_EXTENSION_VERSION)') &&
            !buildSource.includes('manifest.version !== MINIMUM_ENGAGEMENT_EXTENSION_VERSION'));
    }

    console.log('\nDevices panel is reachable');
    {
        const appSource = readSource('src/App.jsx');
        assert('WorkersPanel is imported',
            appSource.includes("import WorkersPanel from '@/components/panels/WorkersPanel'"));
        assert('showWorkers state is declared',
            appSource.includes('const [showWorkers, setShowWorkers] = useState(false)'));
        assert('the panel is mounted',
            /\{showWorkers && \(\s*<WorkersPanel api=\{ApiService\} onClose=\{\(\) => setShowWorkers\(false\)\}/.test(appSource));
        assert('a visible header control opens it',
            appSource.includes('onClick={() => setShowWorkers(true)}'));
        const paletteUses = (appSource.match(/setShowWorkers\(true\)/g) || []).length;
        assert('both the header button and the command palette open it', paletteUses === 2, `found ${paletteUses}`);

        const panelSource = readSource('src/components/panels/WorkersPanel.jsx');
        for (const method of ['getWorkers', 'createPairingCode', 'renameWorker', 'revokeWorker', 'removeWorker']) {
            assert(`WorkersPanel still uses api.${method}`, panelSource.includes(`api.${method}(`));
            assert(`ApiService still provides ${method}`, new RegExp(`static ${method}\\s*\\(`).test(appSource));
        }
    }

    console.log(`\nPhase 33: ${passed} passed, ${failed} failed\n`);
    // Loading background.js starts the service worker's own alarms and heartbeat
    // timers inside the vm context. They keep the event loop alive forever, so the
    // exit has to be explicit or the suite hangs after reporting a clean pass.
    process.exit(failed > 0 ? 1 : 0);
}

run().catch(error => {
    console.error(error);
    process.exit(1);
});
