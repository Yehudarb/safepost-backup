/**
 * Phase 24 - read-only Engagement scanner and MV3 lifecycle regression tests.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { pathToFileURL } = require('url');
const { JSDOM } = require('jsdom');

const SCAN_ID = '11111111-1111-4111-8111-111111111111';
const CLAIMED_AT = '2026-09-04T10:00:00.000Z';
// Phase 1C.2 gates scanning on a stable Facebook account id. These suites cover
// the scanner itself, so they run with a matching identity; the mismatch and
// unverified paths are covered by phase26.
const FB_USER_ID = '100000000000001';
const GROUP = Object.freeze({
    id: 'group-qa-1',
    name: 'QA Group',
    url: 'https://www.facebook.com/groups/group-qa-1/',
});
const clone = value => value == null ? null : JSON.parse(JSON.stringify(value));
const yieldAsync = () => new Promise(resolve => setImmediate(resolve));

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

function memoryStorage() {
    let lock = null;
    let preemption = null;
    return {
        async readFacebookActivityLock() { await yieldAsync(); return clone(lock); },
        async writeFacebookActivityLock(value) { await yieldAsync(); lock = clone(value); },
        async clearFacebookActivityLock() { await yieldAsync(); lock = null; },
        async readFacebookActivityPreemption() { await yieldAsync(); return clone(preemption); },
        async writeFacebookActivityPreemption(value) { await yieldAsync(); preemption = clone(value); },
        async clearFacebookActivityPreemption() { await yieldAsync(); preemption = null; },
    };
}

function createActivity(storage) {
    return global.SafePostFacebookActivityLockFactory.createFacebookActivityLock(storage, {
        logger: { log() {}, warn() {} },
        tabs: null,
        sleep: async () => {},
    });
}

function articleHtml(id, text = `Post ${id}`) {
    return `<div role="article">
        <h2><a href="/profile.php?id=${id}">Author ${id}</a></h2>
        <div data-ad-preview="message">${text}</div>
        <a href="/groups/group-qa-1/posts/${id}">1h</a>
    </div>`;
}

function scannerFixture(articleCount = 0) {
    const html = Array.from({ length: articleCount }, (_, index) => articleHtml(index + 1)).join('');
    const dom = new JSDOM(`<main><div role="feed">${html}</div></main>`, { url: GROUP.url });
    const scrolls = [];
    dom.window.scrollBy = options => scrolls.push(options);
    return { dom, scrolls, feed: dom.window.document.querySelector('[role="feed"]') };
}

function response(status, body) {
    return {
        ok: status >= 200 && status < 300,
        status,
        async json() { return clone(body); },
        async text() { return JSON.stringify(body); },
    };
}

function instrumentActivity(base, events) {
    return {
        ...base,
        async acquireFacebookActivityLock(owner, operationId) {
            events.push(`acquire:${owner}`);
            return base.acquireFacebookActivityLock(owner, operationId);
        },
        async attachFacebookActivityScan(owner, operationId, scanId, claimStartedAt) {
            events.push(`attach-scan:${scanId}`);
            return base.attachFacebookActivityScan(owner, operationId, scanId, claimStartedAt);
        },
        async attachFacebookActivityTab(owner, operationId, tabId) {
            events.push(`attach-tab:${tabId}`);
            return base.attachFacebookActivityTab(owner, operationId, tabId);
        },
        async releaseFacebookActivityLock(owner, operationId) {
            events.push(`release:${owner}`);
            return base.releaseFacebookActivityLock(owner, operationId);
        },
    };
}

function createBackgroundHarness(baseActivity, options = {}) {
    const events = [];
    const warnings = [];
    const activity = instrumentActivity(baseActivity, events);
    const local = {
        pairedWorkerId: 'worker-phase24',
        deviceToken: 'test-device-token',
        // The pre-tab identity guard reads the last known account from storage
        // when no Facebook tab is open. These suites run on the matching path;
        // phase26 drives mismatch and unverified explicitly.
        ...(options.persistedFacebookUserId === null ? {} : {
            safepost_currentUserId: options.persistedFacebookUserId || FB_USER_ID,
            safepost_currentUser: 'QA Account',
        }),
    };
    const statuses = [];
    const uploads = [];
    const closedTabs = [];
    const binds = [];
    const intervals = new Set();
    const updateListeners = new Set();
    let nextTimerId = 1;
    let onMessage = null;
    let onRemoved = null;
    let startCallback = null;
    let claimCalls = 0;
    let tabsCreated = 0;
    const noOpEvent = { addListener() {}, removeListener() {} };

    const scan = {
        id: SCAN_ID,
        claimed_at: CLAIMED_AT,
        target_groups: [GROUP],
        max_posts_per_group: 10,
        facebook_user_id: options.scanFacebookUserId === undefined ? FB_USER_ID : options.scanFacebookUserId,
        facebook_user: 'QA Account',
    };

    const context = {
        console: { log() {}, warn: (...args) => warnings.push(args.join(' ')), error() {} },
        importScripts() {},
        SafePostFacebookActivityLock: activity,
        SafePostFacebookActivityLockFactory: {
            FACEBOOK_ACTIVITY_OWNERS: {
                PUBLISHING: 'publishing',
                GROUP_SYNC: 'group_sync',
                ENGAGEMENT: 'engagement',
            },
            FACEBOOK_ACTIVITY_HEARTBEAT_MS: 30000,
            FACEBOOK_ACTIVITY_PREEMPT_WAIT_MS: 30000,
        },
        SafePostEngagementNavigation: global.SafePostEngagementNavigation,
        // background.js reads this at module scope. The harness stubs
        // importScripts, so the real module has to be handed in explicitly or
        // every scan aborts with "cannot read properties of undefined".
        SafePostEngagementIdentity: global.SafePostEngagementIdentity,
        SafePostExternalTrust: { validateExternalSender: () => ({ ok: false }) },
        ExtStorage: {
            async getApiUrl() { return 'http://localhost:3001'; },
            async getCooldownTimestamp() { return null; },
            async getLastJobId() { return null; },
            async setLastJobId() {},
            async clearLastJobId() {},
            async setCooldown() {},
        },
        chrome: {
            alarms: {
                create() {},
                clear(_name, callback) { callback?.(); },
                get(_name, callback) { callback?.(null); },
                onAlarm: noOpEvent,
            },
            runtime: {
                id: 'phase24-extension',
                lastError: null,
                getManifest: () => ({ version: '9.2' }),
                onInstalled: noOpEvent,
                onStartup: noOpEvent,
                onMessage: { addListener(listener) { onMessage = listener; } },
                onMessageExternal: noOpEvent,
            },
            storage: {
                local: {
                    async get(keys) {
                        const names = Array.isArray(keys) ? keys : [keys];
                        return Object.fromEntries(names.filter(name => name in local).map(name => [name, local[name]]));
                    },
                    async set(values) { Object.assign(local, values); },
                },
                onChanged: noOpEvent,
            },
            tabs: {
                onRemoved: { addListener(listener) { onRemoved = listener; } },
                onUpdated: {
                    addListener(listener) { updateListeners.add(listener); },
                    removeListener(listener) { updateListeners.delete(listener); },
                },
                async create(createOptions) {
                    events.push('tab-create');
                    tabsCreated++;
                    if (options.tabCreateError) throw new Error('expected tab creation failure');
                    return { id: 91, status: 'complete', url: createOptions.url };
                },
                async remove(tabId) {
                    events.push(`tab-close:${tabId}`);
                    if (options.tabRemoveError) throw new Error('expected tab removal failure');
                    closedTabs.push(tabId);
                    if (options.emitRemovedOnClose) queueMicrotask(() => onRemoved?.(tabId));
                },
                async get(tabId) {
                    if (options.missingExistingTab) throw new Error('No tab with id');
                    return { id: tabId, status: 'complete', url: GROUP.url };
                },
                async query() { return []; },
                sendMessage(tabId, message, callback) {
                    events.push(`message:${message.action}`);
                    if (message.action === 'GET_FACEBOOK_USER') {
                        // The pre-scan identity guard re-reads c_user through the
                        // freshly loaded content script. Answering with the id the
                        // task carries keeps these scanner suites on the matching
                        // path; phase26 drives the mismatch and unverified cases.
                        callback({
                            facebook_user: options.tabFacebookUser === undefined ? 'QA Account' : options.tabFacebookUser,
                            facebook_user_id: options.tabFacebookUserId === undefined ? FB_USER_ID : options.tabFacebookUserId,
                        });
                        return;
                    }
                    if (message.action === 'START_ENGAGEMENT_SCAN') {
                        if (options.scanMode === 'hang' || options.scanMode === 'preempt') {
                            startCallback = callback;
                        } else {
                            queueMicrotask(() => callback({ success: true, postsFound: 2, scrollAttempts: 1 }));
                        }
                        return;
                    }
                    if (message.action === 'ABORT_ENGAGEMENT_SCAN') {
                        callback({ ok: true, aborted: true });
                        if (options.scanMode === 'preempt' && startCallback) {
                            const pendingPost = {
                                facebookPostId: '999',
                                facebookPostUrl: `${GROUP.url}posts/999`,
                                authorName: 'Final Batch Author',
                                postText: 'Collected before publishing preemption',
                                rawMetadata: { test: true },
                            };
                            onMessage({
                                action: 'ENGAGEMENT_SCAN_BATCH',
                                scanId: SCAN_ID,
                                group: { id: 'tampered-group', name: 'Tampered' },
                                posts: [pendingPost],
                            }, { tab: { id: tabId } }, () => {
                                const finish = startCallback;
                                startCallback = null;
                                finish({ success: false, aborted: true, errorCode: 'SCAN_PREEMPTED_BY_PUBLISH' });
                            });
                        }
                    }
                },
            },
            scripting: {
                async executeScript(details) {
                    if (details.files) {
                        events.push(`inject:${details.files.join(',')}`);
                        return [];
                    }
                    // The real page inspector returns membership evidence alongside
                    // the page classification; the identity gate depends on it.
                    const membership = options.membership === undefined
                        ? { member: true, strategy: 'group_header_joined_control', signal: 'joined_affordance' }
                        : options.membership;
                    return [{ result: { ...(options.pageState || { ok: true }), membership } }];
                },
            },
        },
        EventSource: class EventSource { close() {} },
        navigator: { userAgent: 'Chrome/1' },
        AbortController,
        Date,
        Math,
        Promise,
        setTimeout() { return nextTimerId++; },
        clearTimeout() {},
        setInterval() {
            const id = nextTimerId++;
            intervals.add(id);
            return id;
        },
        clearInterval(id) { intervals.delete(id); },
        async fetch(url, fetchOptions = {}) {
            const target = String(url);
            if (target.endsWith('/api/engagement/scans/claim')) {
                events.push('claim');
                claimCalls++;
                if (options.claimStatus) return response(options.claimStatus, { error: 'Rejected' });
                if (options.claimError) throw new Error('expected claim failure');
                if (options.noScan) return response(200, { scan: null });
                return response(200, { scan });
            }
            if (/\/api\/engagement\/scans\/[^/]+\/posts$/.test(target)) {
                events.push('upload');
                const body = JSON.parse(fetchOptions.body);
                uploads.push(body);
                return response(200, { stored: body.posts.length, duplicates: 0 });
            }
            if (/\/api\/engagement\/scans\/[^/]+\/status$/.test(target)) {
                events.push('status');
                statuses.push(JSON.parse(fetchOptions.body));
                return response(200, { status: 'COMPLETED' });
            }
            if (/\/api\/engagement\/scans\/[^/]+\/bind-identity$/.test(target)) {
                events.push('bind-identity');
                binds.push(JSON.parse(fetchOptions.body));
                if (options.bindStatus) return response(options.bindStatus, { error: 'bind rejected' });
                return response(200, { success: true, bound_groups: 1 });
            }
            if (target.includes('/jobs/')) return response(200, { job: null });
            return response(200, {});
        },
    };
    context.globalThis = context;
    const source = fs.readFileSync(path.join(__dirname, '../safe_post_extension/background.js'), 'utf8');
    vm.runInNewContext(`${source}\nglobalThis.__phase24 = {
        ready: facebookActivityReady,
        checkEngagementScans,
        checkJobs,
        pollAvailableWork,
        active: () => activeEngagementActivity,
        unavailableUntil: () => engagementUnavailableUntil
    };`, context);

    const waitForStart = async () => {
        for (let attempt = 0; attempt < 30 && !startCallback; attempt++) await yieldAsync();
        return Boolean(startCallback);
    };

    return {
        api: context.__phase24,
        events,
        warnings,
        binds,
        statuses,
        uploads,
        closedTabs,
        claimCalls: () => claimCalls,
        tabsCreated: () => tabsCreated,
        activeIntervals: () => intervals.size,
        waitForStart,
        removeTab(tabId) {
            onRemoved(tabId);
            if (startCallback) {
                const finish = startCallback;
                startCallback = null;
                queueMicrotask(() => finish(undefined));
            }
        },
    };
}

(async () => {
    global.ExtStorage = memoryStorage();
    await import(`${pathToFileURL(path.join(__dirname, '../safe_post_extension/facebookActivityLock.js')).href}?phase24-lock`);
    await import(`${pathToFileURL(path.join(__dirname, '../safe_post_extension/engagement/identity.js')).href}?phase24-identity`);
    await import(`${pathToFileURL(path.join(__dirname, '../safe_post_extension/engagement/navigation.js')).href}?phase24-nav`);
    await import(`${pathToFileURL(path.join(__dirname, '../safe_post_extension/engagement/postParser.js')).href}?phase24-parser`);
    await import(`${pathToFileURL(path.join(__dirname, '../safe_post_extension/engagement/scanner.js')).href}?phase24-scanner`);

    const OWNER = global.SafePostFacebookActivityLockFactory.FACEBOOK_ACTIVITY_OWNERS;
    const parser = global.SafePostEngagementPostParser;
    const navigation = global.SafePostEngagementNavigation;
    const scannerApi = global.SafePostEngagementScanner;

    console.log('Phase 24 Engagement scanner\n');

    console.log(' A. pure read-only scanner');
    {
        const fixture = scannerFixture(6);
        const batches = [];
        let appended = false;
        const scanner = scannerApi.createReadOnlyScanner({
            document: fixture.dom.window.document,
            window: fixture.dom.window,
            parser,
            navigation,
            detectFacebookState: () => ({ ok: true }),
            sendBatch: async posts => { batches.push(posts.map(post => post.facebookPostId)); },
            sleep: async () => {
                if (!appended) {
                    appended = true;
                    fixture.feed.insertAdjacentHTML('beforeend',
                        Array.from({ length: 6 }, (_, index) => articleHtml(index + 7)).join(''));
                }
            },
        });
        const result = await scanner.scanGroup({ group: GROUP, limit: 10 });
        assert('scanner stops at the controlled task limit', result.success && result.postsFound === 10);
        assert('posts are uploaded incrementally in small batches',
            batches.length === 2 && batches.every(batch => batch.length === 5));
        assert('posts are parsed as virtualized content appears',
            batches.flat().join(',') === '1,2,3,4,5,6,7,8,9,10');
    }
    {
        const fixture = scannerFixture(0);
        const scanner = scannerApi.createReadOnlyScanner({
            document: fixture.dom.window.document,
            window: fixture.dom.window,
            parser,
            navigation,
            detectFacebookState: () => ({ ok: true }),
            sleep: async () => {},
        });
        const result = await scanner.scanGroup({
            group: GROUP,
            maxScrollAttempts: 2,
            maxStagnantScrolls: 10,
        });
        assert('empty feeds use bounded scrolling and do not report false success',
            !result.success && result.errorCode === 'NO_POSTS_FOUND' &&
            result.scrollAttempts === 2 && fixture.scrolls.length === 2);
    }
    {
        const fixture = scannerFixture(0);
        fixture.feed.insertAdjacentHTML('beforeend', articleHtml(55) + articleHtml(55));
        const batches = [];
        const scanner = scannerApi.createReadOnlyScanner({
            document: fixture.dom.window.document,
            window: fixture.dom.window,
            parser,
            navigation,
            detectFacebookState: () => ({ ok: true }),
            sendBatch: async posts => batches.push(posts),
            sleep: async () => {},
        });
        const result = await scanner.scanGroup({ group: GROUP, maxScrollAttempts: 0, maxStagnantScrolls: 1 });
        assert('duplicate DOM observations are submitted once',
            result.postsFound === 1 && batches.flat().length === 1);
    }
    {
        const fixture = scannerFixture(1);
        const controller = new AbortController();
        const batches = [];
        const scanner = scannerApi.createReadOnlyScanner({
            document: fixture.dom.window.document,
            window: fixture.dom.window,
            parser,
            navigation,
            detectFacebookState: () => ({ ok: true }),
            sendBatch: async posts => batches.push(posts),
            sleep: async () => controller.abort(),
        });
        const result = await scanner.scanGroup({ group: GROUP, signal: controller.signal });
        assert('preemption stops further scanning', result.aborted && result.errorCode === 'SCAN_PREEMPTED_BY_PUBLISH');
        assert('preemption flushes already-collected observations', batches.flat().length === 1);
    }
    {
        const fixture = scannerFixture(2);
        const scanner = scannerApi.createReadOnlyScanner({
            document: fixture.dom.window.document,
            window: fixture.dom.window,
            parser,
            navigation,
            detectFacebookState: () => ({ ok: false, errorCode: 'CHECKPOINT_REQUIRED' }),
        });
        const result = await scanner.scanGroup({ group: GROUP });
        assert('Facebook checkpoint aborts before extraction or scrolling',
            !result.success && result.errorCode === 'CHECKPOINT_REQUIRED' && fixture.scrolls.length === 0);
    }
    {
        const scannerSource = fs.readFileSync(
            path.join(__dirname, '../safe_post_extension/engagement/scanner.js'), 'utf8');
        const forbidden = [
            /\.click\s*\(/, /dispatchEvent\s*\(/, /execCommand\s*\(/,
            /insertText/, /contenteditable/i, /keyboard/i, /humanClick/i,
        ];
        assert('scanner source contains no Facebook write primitives',
            forbidden.every(pattern => !pattern.test(scannerSource)));
    }

    console.log('\n B. activity ownership and identity');
    {
        const valid = navigation.validateEngagementScan({
            id: SCAN_ID,
            target_groups: [GROUP],
            max_posts_per_group: 25,
        });
        const arbitrary = navigation.validateEngagementScan({
            id: SCAN_ID,
            target_groups: [{ id: 'outside', url: 'https://example.com/groups/outside/' }],
        });
        const multiple = navigation.validateEngagementScan({
            id: SCAN_ID,
            target_groups: [GROUP, { ...GROUP, id: 'group-qa-2' }],
        });
        assert('validated server task is capped to one group and ten posts',
            valid.ok && valid.limit === 10);
        assert('arbitrary non-Facebook group URLs are rejected before navigation', !arbitrary.ok);
        assert('controlled scanner rejects tasks containing multiple groups', !multiple.ok);
    }
    {
        const storage = memoryStorage();
        const lock = createActivity(storage);
        await lock.acquireFacebookActivityLock(OWNER.PUBLISHING, 'publishing:busy');
        const denied = await lock.acquireFacebookActivityLock(OWNER.ENGAGEMENT, 'engagement:blocked-publish');
        assert('engagement is refused while publishing owns Facebook', !denied.acquired);
    }
    {
        const storage = memoryStorage();
        const lock = createActivity(storage);
        await lock.acquireFacebookActivityLock(OWNER.GROUP_SYNC, 'group_sync:busy');
        const denied = await lock.acquireFacebookActivityLock(OWNER.ENGAGEMENT, 'engagement:blocked-sync');
        assert('engagement is refused while group sync owns Facebook', !denied.acquired);
    }
    {
        const storage = memoryStorage();
        const lock = createActivity(storage);
        await lock.acquireFacebookActivityLock(OWNER.ENGAGEMENT, 'engagement:one');
        const denied = await lock.acquireFacebookActivityLock(OWNER.ENGAGEMENT, 'engagement:two');
        assert('only one engagement activity can own Facebook', !denied.acquired);
        assert('scan identity attaches immutably to its engagement lock',
            await lock.attachFacebookActivityScan(OWNER.ENGAGEMENT, 'engagement:one', SCAN_ID, CLAIMED_AT) &&
            !await lock.attachFacebookActivityScan(
                OWNER.ENGAGEMENT, 'engagement:one', '22222222-2222-4222-8222-222222222222', CLAIMED_AT));
    }

    console.log('\n C. background orchestration and cleanup');
    {
        const lock = createActivity(memoryStorage());
        const harness = createBackgroundHarness(lock, { emitRemovedOnClose: true });
        await harness.api.ready;
        await harness.api.checkEngagementScans();
        const acquireIndex = harness.events.indexOf('acquire:engagement');
        const claimIndex = harness.events.indexOf('claim');
        const createIndex = harness.events.indexOf('tab-create');
        assert('engagement lock is acquired before claim and Facebook tab creation',
            acquireIndex >= 0 && acquireIndex < claimIndex && claimIndex < createIndex);
        assert('claimed scan identity and tabId are attached to the same lock',
            harness.events.includes(`attach-scan:${SCAN_ID}`) && harness.events.includes('attach-tab:91'));
        assert('successful scan reports completion, closes the tab and releases the lock',
            harness.statuses.some(item => item.status === 'COMPLETED') &&
            harness.closedTabs.includes(91) && await lock.getFacebookActivityLock() === null &&
            harness.activeIntervals() === 0);
        assert('owned tab closure does not emit a duplicate disconnect status', harness.statuses.length === 1);
    }
    for (const owner of [OWNER.PUBLISHING, OWNER.GROUP_SYNC]) {
        const lock = createActivity(memoryStorage());
        const harness = createBackgroundHarness(lock);
        await harness.api.ready;
        await lock.acquireFacebookActivityLock(owner, `${owner}:active`);
        await harness.api.checkEngagementScans();
        assert(`background does not claim or open a tab while ${owner} is active`,
            harness.claimCalls() === 0 && harness.tabsCreated() === 0);
    }
    {
        const lock = createActivity(memoryStorage());
        const harness = createBackgroundHarness(lock, { scanMode: 'hang' });
        await harness.api.ready;
        const running = harness.api.checkEngagementScans();
        await harness.waitForStart();
        await harness.api.checkEngagementScans();
        assert('a second poll cannot start another engagement activity',
            harness.claimCalls() === 1 && harness.tabsCreated() === 1);
        harness.removeTab(91);
        await running;
        for (let attempt = 0; attempt < 20 && await lock.getFacebookActivityLock(); attempt++) {
            await yieldAsync();
        }
        assert('manual tab close reports retryable disconnect and releases ownership',
            harness.statuses.some(item => item.error_code === 'WORKER_DISCONNECTED') &&
            await lock.getFacebookActivityLock() === null && harness.activeIntervals() === 0);
    }
    {
        const lock = createActivity(memoryStorage());
        const harness = createBackgroundHarness(lock, { tabCreateError: true });
        await harness.api.ready;
        await harness.api.checkEngagementScans();
        assert('tab-creation exception reports failure and releases ownership',
            harness.statuses.some(item => item.error_code === 'TEMPORARY_SERVER_ERROR') &&
            await lock.getFacebookActivityLock() === null && harness.activeIntervals() === 0);
    }
    {
        const lock = createActivity(memoryStorage());
        const harness = createBackgroundHarness(lock, { tabRemoveError: true });
        await harness.api.ready;
        await harness.api.checkEngagementScans();
        const held = await lock.getFacebookActivityLock();
        assert('failed owned-tab closure keeps the lock instead of allowing concurrent Facebook activity',
            held?.owner === OWNER.ENGAGEMENT && held.tabId === 91);
    }
    {
        // Phase 1C.2 identity guard: a reliably different Facebook account must
        // stop the scan before any DOM work, not merely fail it afterwards.
        const lock = createActivity(memoryStorage());
        const harness = createBackgroundHarness(lock, {
            tabFacebookUserId: '100000000000999',
            persistedFacebookUserId: '100000000000999',
        });
        await harness.api.ready;
        await harness.api.checkEngagementScans();
        assert('a mismatched Facebook account aborts the scan',
            harness.statuses.some(item => item.error_code === 'FACEBOOK_IDENTITY_MISMATCH'),
            JSON.stringify(harness.statuses));
        assert('mismatch stops before the DOM scanner is ever started',
            !harness.events.includes('message:START_ENGAGEMENT_SCAN'), JSON.stringify(harness.events));
        assert('mismatch uploads nothing', harness.uploads.length === 0);
        assert('mismatch is reported as ABORTED, so it does not burn retry attempts',
            harness.statuses.every(item => item.error_code !== 'FACEBOOK_IDENTITY_MISMATCH' || item.status === 'ABORTED'),
            JSON.stringify(harness.statuses));
        assert('mismatch still releases the Facebook activity lock',
            await lock.getFacebookActivityLock() === null);
    }
    {
        // Post-Live-QA-#2 policy: a legacy dataset with no stored account id is
        // still not a failure, but it is no longer bound on the strength of the
        // live session alone. The page must prove the account is a member of THIS
        // group; here it does, so the bind proceeds. The blocked variants are
        // covered in phase28.
        const lock = createActivity(memoryStorage());
        const harness = createBackgroundHarness(lock, {
            scanFacebookUserId: null,
            persistedFacebookUserId: null,
        });
        await harness.api.ready;
        await harness.api.checkEngagementScans();
        assert('a legacy dataset binds the live account instead of failing',
            harness.binds.length === 1 && harness.binds[0].facebook_user_id === FB_USER_ID,
            JSON.stringify(harness.binds));
        assert('binding happens before the DOM scanner starts',
            harness.events.indexOf('bind-identity') >= 0 &&
            harness.events.indexOf('bind-identity') < harness.events.indexOf('message:START_ENGAGEMENT_SCAN'),
            JSON.stringify(harness.events));
        assert('a legacy dataset then completes normally',
            harness.statuses.some(item => item.status === 'COMPLETED'), JSON.stringify(harness.statuses));
        assert('the bind carries the membership evidence that authorised it',
            harness.binds[0].membership_verified === true &&
            harness.binds[0].evidence_strategy === 'group_header_joined_control',
            JSON.stringify(harness.binds));
    }
    {
        // Live QA #2 measured 172 of 175 synced groups owned by a DIFFERENT
        // Facebook identity than the one logged in. Workspace ownership is
        // therefore not evidence, and a page that shows a "Join group" call to
        // action is positive evidence of the opposite.
        const lock = createActivity(memoryStorage());
        const harness = createBackgroundHarness(lock, {
            scanFacebookUserId: null,
            persistedFacebookUserId: null,
            membership: { member: false, strategy: 'group_header_join_call_to_action', signal: 'join_affordance' },
        });
        await harness.api.ready;
        await harness.api.checkEngagementScans();
        assert('a non-member legacy group is never bound',
            harness.binds.length === 0, JSON.stringify(harness.binds));
        assert('a non-member legacy group aborts as FACEBOOK_IDENTITY_UNVERIFIED',
            harness.statuses.some(item =>
                item.status === 'ABORTED' &&
                item.error_code === 'FACEBOOK_IDENTITY_UNVERIFIED' &&
                /signal=not_a_member/.test(item.failure_reason || '')),
            JSON.stringify(harness.statuses));
        assert('a non-member legacy group never starts the DOM scanner',
            !harness.events.includes('message:START_ENGAGEMENT_SCAN'), JSON.stringify(harness.events));
        assert('a non-member legacy group uploads nothing', harness.uploads.length === 0);
        assert('a non-member legacy group still releases the lock',
            await lock.getFacebookActivityLock() === null);
    }
    {
        // No membership affordance at all is absence of evidence, not evidence of
        // membership. It must block just as firmly as an explicit non-member page.
        const lock = createActivity(memoryStorage());
        const harness = createBackgroundHarness(lock, {
            scanFacebookUserId: null,
            persistedFacebookUserId: null,
            membership: { member: null, strategy: 'none', signal: 'no_membership_affordance' },
        });
        await harness.api.ready;
        await harness.api.checkEngagementScans();
        assert('an unverifiable legacy group is never bound', harness.binds.length === 0);
        assert('an unverifiable legacy group aborts as FACEBOOK_IDENTITY_UNVERIFIED',
            harness.statuses.some(item =>
                item.status === 'ABORTED' &&
                item.error_code === 'FACEBOOK_IDENTITY_UNVERIFIED' &&
                /signal=membership_unverified/.test(item.failure_reason || '')),
            JSON.stringify(harness.statuses));
        assert('an unverifiable legacy group uploads nothing', harness.uploads.length === 0);
    }
    {
        // Membership evidence must not rescue a group already bound to another
        // account: an explicit mismatch still wins over a "Joined" page.
        const lock = createActivity(memoryStorage());
        const harness = createBackgroundHarness(lock, {
            tabFacebookUserId: '100000000000999',
            persistedFacebookUserId: '100000000000999',
            membership: { member: true, strategy: 'group_header_joined_control', signal: 'joined_affordance' },
        });
        await harness.api.ready;
        await harness.api.checkEngagementScans();
        assert('a bound group with a different live account aborts even when the page says Joined',
            harness.statuses.some(item => item.error_code === 'FACEBOOK_IDENTITY_MISMATCH'),
            JSON.stringify(harness.statuses));
        assert('that mismatch never rebinds the group', harness.binds.length === 0);
        assert('that mismatch uploads nothing', harness.uploads.length === 0);
    }
    {
        // The backend refuses the bind because another account already owns these
        // groups. That is a real conflict, not a transient error.
        const lock = createActivity(memoryStorage());
        const harness = createBackgroundHarness(lock, {
            scanFacebookUserId: null,
            persistedFacebookUserId: null,
            bindStatus: 409,
        });
        await harness.api.ready;
        await harness.api.checkEngagementScans();
        assert('a refused bind aborts as FACEBOOK_IDENTITY_MISMATCH',
            harness.statuses.some(item => item.error_code === 'FACEBOOK_IDENTITY_MISMATCH'),
            JSON.stringify(harness.statuses));
        assert('a refused bind never starts the DOM scanner',
            !harness.events.includes('message:START_ENGAGEMENT_SCAN'));
        assert('a refused bind releases the lock',
            await lock.getFacebookActivityLock() === null);
    }
    {
        // The only genuine UNVERIFIED: the live account cannot be read at all.
        const lock = createActivity(memoryStorage());
        const harness = createBackgroundHarness(lock, {
            scanFacebookUserId: null,
            persistedFacebookUserId: null,
            tabFacebookUserId: null,
        });
        await harness.api.ready;
        await harness.api.checkEngagementScans();
        assert('an unreadable live account aborts with FACEBOOK_IDENTITY_UNVERIFIED',
            harness.statuses.some(item => item.error_code === 'FACEBOOK_IDENTITY_UNVERIFIED'),
            JSON.stringify(harness.statuses));
        assert('an unreadable live account never binds anything', harness.binds.length === 0);
        assert('an unreadable live account never opens the DOM scanner',
            !harness.events.includes('message:START_ENGAGEMENT_SCAN'));
    }
    {
        // A stale cached id must not be authoritative: the fresh post-load read
        // matches, so the scan proceeds.
        const lock = createActivity(memoryStorage());
        const harness = createBackgroundHarness(lock, {
            persistedFacebookUserId: '100000000000999',
            tabFacebookUserId: FB_USER_ID,
        });
        await harness.api.ready;
        await harness.api.checkEngagementScans();
        assert('a stale cached mismatch does not block a scan the live read approves',
            harness.statuses.some(item => item.status === 'COMPLETED'), JSON.stringify(harness.statuses));
        assert('the live read still runs before the DOM scanner',
            harness.events.includes('message:GET_FACEBOOK_USER') &&
            harness.events.indexOf('message:GET_FACEBOOK_USER') < harness.events.indexOf('message:START_ENGAGEMENT_SCAN'));
    }
    {
        const lock = createActivity(memoryStorage());
        const harness = createBackgroundHarness(lock, {
            pageState: { ok: false, errorCode: 'CHECKPOINT_REQUIRED', detail: { signal: 'checkpoint' } },
        });
        await harness.api.ready;
        await harness.api.checkEngagementScans();
        assert('background checkpoint preflight never starts the DOM scanner',
            harness.statuses.some(item => item.error_code === 'CHECKPOINT_REQUIRED') &&
            !harness.events.includes('message:START_ENGAGEMENT_SCAN'));
        assert('checkpoint cleanup closes the tab and releases ownership',
            harness.closedTabs.includes(91) && await lock.getFacebookActivityLock() === null);
    }
    {
        const lock = createActivity(memoryStorage());
        const harness = createBackgroundHarness(lock, { scanMode: 'preempt' });
        await harness.api.ready;
        const running = harness.api.checkEngagementScans();
        await harness.waitForStart();
        const engagementLock = await lock.getFacebookActivityLock();
        const preemption = await lock.requestFacebookActivityPreemption(
            OWNER.PUBLISHING,
            'publishing:priority'
        );
        await running;
        assert('publishing preemption is cooperatively acknowledged', preemption.acknowledged === true);
        assert('preemption accepts a bounded final batch before cleanup',
            harness.uploads.length === 1 && harness.uploads[0].posts.length === 1);
        assert('the final batch carries the backend claim generation',
            harness.uploads[0].claim_started_at === CLAIMED_AT);
        assert('batch group identity comes from the validated server task, not the content message',
            harness.uploads[0]?.posts[0]?.facebook_group_id === GROUP.id);
        assert('preemption reports retryable semantics and closes the engagement tab',
            harness.statuses.some(item => item.error_code === 'SCAN_PREEMPTED_BY_PUBLISH') &&
            harness.closedTabs.includes(91));
        assert('preemption status carries the backend claim generation',
            harness.statuses.some(item => item.claim_started_at === CLAIMED_AT));
        assert('preemption releases the engagement lock and heartbeat',
            await lock.getFacebookActivityLock() === null && harness.activeIntervals() === 0 &&
            engagementLock.scanId === SCAN_ID);
    }
    {
        const storage = memoryStorage();
        const lock = createActivity(storage);
        await lock.acquireFacebookActivityLock(OWNER.ENGAGEMENT, 'engagement:orphan');
        await lock.attachFacebookActivityScan(OWNER.ENGAGEMENT, 'engagement:orphan', SCAN_ID, CLAIMED_AT);
        await lock.attachFacebookActivityTab(OWNER.ENGAGEMENT, 'engagement:orphan', 91);
        const harness = createBackgroundHarness(lock);
        await harness.api.ready;
        assert('MV3 startup aborts and closes the orphaned engagement tab',
            harness.events.includes('message:ABORT_ENGAGEMENT_SCAN') && harness.closedTabs.includes(91));
        assert('MV3 startup requeues the orphan instead of resuming scroll state',
            harness.statuses.some(item => item.error_code === 'WORKER_DISCONNECTED') &&
            await lock.getFacebookActivityLock() === null);
        assert('MV3 orphan status uses the persisted claim generation',
            harness.statuses.some(item => item.claim_started_at === CLAIMED_AT));
    }
    {
        const lock = createActivity(memoryStorage());
        const harness = createBackgroundHarness(lock, { claimStatus: 404 });
        await harness.api.ready;
        await harness.api.checkEngagementScans();
        const firstClaims = harness.claimCalls();
        await harness.api.checkEngagementScans();
        assert('disabled Engagement endpoint enters backoff instead of a claim loop',
            firstClaims === 1 && harness.claimCalls() === 1 && harness.api.unavailableUntil() > Date.now());
    }
    {
        // Phase 1E: the server rejects extensions below the minimum Engagement
        // version with 426. That is a standing condition, so it must behave like
        // 404 — back off and say so once — instead of polling every minute in
        // silence for as long as the build stays installed.
        const lock = createActivity(memoryStorage());
        const harness = createBackgroundHarness(lock, { claimStatus: 426 });
        await harness.api.ready;
        await harness.api.checkEngagementScans();
        const afterFirst = harness.claimCalls();
        const backoffUntil = harness.api.unavailableUntil();

        await harness.api.checkEngagementScans();
        await harness.api.checkEngagementScans();

        assert('426 enters the same backoff as an unavailable endpoint',
            afterFirst === 1 && backoffUntil > Date.now(), `claims=${afterFirst}`);
        assert('repeated polling during backoff never reaches the endpoint again',
            harness.claimCalls() === 1, `claims=${harness.claimCalls()}`);
        assert('the backoff window is not extended by suppressed polls',
            harness.api.unavailableUntil() === backoffUntil);

        const upgradeWarnings = harness.warnings.filter(line => /below the minimum version/.test(line));
        assert('the operator is told exactly once why Engagement is off',
            upgradeWarnings.length === 1, JSON.stringify(harness.warnings));
        assert('the warning names the installed version and clears publishing',
            /v9\.2/.test(upgradeWarnings[0]) && /Publishing is unaffected/.test(upgradeWarnings[0]),
            upgradeWarnings[0]);

        assert('a rejected claim starts no scan and uploads nothing',
            !harness.events.includes('message:START_ENGAGEMENT_SCAN') && harness.uploads.length === 0);
        assert('a rejected claim reports no status, so no attempt can be consumed',
            harness.statuses.length === 0, JSON.stringify(harness.statuses));
        assert('a rejected claim leaves the Facebook activity lock free',
            await lock.getFacebookActivityLock() === null);
    }
    {
        // Publishing must stay completely unaffected by the Engagement version
        // floor: it is polled first and never consults the Engagement backoff.
        const lock = createActivity(memoryStorage());
        const harness = createBackgroundHarness(lock, { claimStatus: 426 });
        await harness.api.ready;
        let pollError = null;
        try {
            await harness.api.pollAvailableWork();
            await harness.api.pollAvailableWork();
        } catch (error) {
            pollError = error;
        }
        assert('the shared work poll survives a version-blocked Engagement claim',
            pollError === null, String(pollError));
        assert('Engagement stayed backed off across both polls', harness.claimCalls() === 1);

        // The harness has no publishing fixture, so the guarantee that publishing
        // is unaffected is asserted structurally rather than pretended to be
        // exercised: publishing is polled first, and it never reads the
        // Engagement backoff.
        const source = fs.readFileSync(path.join(__dirname, '../safe_post_extension/background.js'), 'utf8');
        const poll = source.slice(source.indexOf('async function pollAvailableWork()'));
        assert('publishing is polled before Engagement',
            poll.indexOf('checkJobs()') < poll.indexOf('checkEngagementScans()'));
        // Bound the slice to checkJobs itself — its closing brace at column 0 —
        // rather than to the next engagement function, which would sweep in
        // hundreds of unrelated lines including the module-scope declarations.
        // Normalise line endings first: the working tree is CRLF, so a '\n}\n'
        // probe silently matches nothing and the slice swallows the whole file.
        const unixSource = source.replace(/\r\n/g, '\n');
        const jobsStart = unixSource.indexOf('async function checkJobs(');
        const jobsEnd = unixSource.indexOf('\n}\n', jobsStart);
        const checkJobsBody = unixSource.slice(jobsStart, jobsEnd);
        assert('the checkJobs slice is bounded to one function',
            jobsEnd > jobsStart && checkJobsBody.split('\n').length < 250,
            `${checkJobsBody.split('\n').length} lines`);
        assert('the publishing path never consults the Engagement backoff',
            !checkJobsBody.includes('engagementUnavailableUntil') &&
            !checkJobsBody.includes('engagementUpgradeWarned'));
    }

    console.log('\n D. source and packaging guardrails');
    {
        const background = fs.readFileSync(path.join(__dirname, '../safe_post_extension/background.js'), 'utf8');
        const claimFlow = background.slice(
            background.indexOf('async function checkEngagementScans()'),
            background.indexOf('async function uploadEngagementBatch(')
        );
        const acquire = claimFlow.indexOf('FacebookActivity.acquireFacebookActivityLock(');
        const claim = claimFlow.indexOf("engagementRequest(pairing, '/scans/claim'");
        assert('claim flow reserves engagement ownership before backend claim',
            acquire >= 0 && acquire < claim);
        assert('Facebook tab creation only consumes the validated server group URL',
            background.includes('chrome.tabs.create({ url: validated.group.url, active: false })'));
        assert('SSE availability and polling fallback are both wired',
            background.includes("data.type === 'engagement_scan_available'") &&
            background.includes('await checkEngagementScans();'));
        assert('all Engagement service-worker dependencies are declared for packaging',
            ['engagement/navigation.js', 'engagement/postParser.js', 'engagement/scanner.js']
                .every(file => background.includes(`'${file}'`)));
        assert('publishing and group-sync implementation files remain outside Phase 1C parser modules',
            !fs.readFileSync(path.join(__dirname, '../safe_post_extension/content.js'), 'utf8')
                .includes('START_ENGAGEMENT_SCAN'));
    }

    console.log(`\n${passed} passed, ${failed} failed`);
    process.exitCode = failed ? 1 : 0;
})().catch(error => {
    console.error('Test run error:', error);
    process.exitCode = 2;
});
