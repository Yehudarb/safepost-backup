/**
 * Phase 22 - persisted publishing identity across MV3 service-worker restarts.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { pathToFileURL } = require('url');

const extensionStorageState = {};
global.chrome = {
    storage: {
        local: {
            async get(keys) {
                const names = Array.isArray(keys) ? keys : [keys];
                return Object.fromEntries(names.filter(name => name in extensionStorageState)
                    .map(name => [name, extensionStorageState[name]]));
            },
            async set(values) { Object.assign(extensionStorageState, values); },
            async remove(keys) {
                for (const key of (Array.isArray(keys) ? keys : [keys])) delete extensionStorageState[key];
            },
        },
    },
};

const clone = value => value == null ? null : JSON.parse(JSON.stringify(value));
const yieldAsync = () => new Promise(resolve => setImmediate(resolve));

function yieldingMemoryStorage() {
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

function instrumentActivity(base) {
    const refreshes = [];
    const releases = [];
    return {
        activity: {
            ...base,
            async refreshFacebookActivityLock(owner, operationId) {
                refreshes.push({ owner, operationId });
                return base.refreshFacebookActivityLock(owner, operationId);
            },
            async releaseFacebookActivityLock(owner, operationId) {
                releases.push({ owner, operationId });
                return base.releaseFacebookActivityLock(owner, operationId);
            },
        },
        refreshes,
        releases,
    };
}

function createBackgroundHarness(activity, { claimMode = 'no-job' } = {}) {
    let onMessage = null;
    let onRemoved = null;
    let claimCalls = 0;
    let tabsCreated = 0;
    let nextTimerId = 1;
    const intervals = new Set();
    const noOpEvent = { addListener() {}, removeListener() {} };
    const context = {
        console: { log() {}, warn() {}, error() {} },
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
                clear(_name, callback) { if (callback) callback(); },
                async get() { return null; },
                onAlarm: noOpEvent,
            },
            runtime: {
                id: 'phase22-extension',
                lastError: null,
                getManifest: () => ({ version: '9.1' }),
                onInstalled: noOpEvent,
                onStartup: noOpEvent,
                onMessage: { addListener(listener) { onMessage = listener; } },
                onMessageExternal: noOpEvent,
            },
            storage: {
                local: { async get() { return {}; }, async set() {} },
                onChanged: noOpEvent,
            },
            tabs: {
                onRemoved: { addListener(listener) { onRemoved = listener; } },
                onUpdated: noOpEvent,
                async create() { tabsCreated++; return { id: 91 }; },
                async remove() {},
                async get(id) { return { id, url: 'https://www.facebook.com/groups/test' }; },
                async query() { return []; },
                sendMessage() {},
            },
            scripting: { async executeScript() { return []; } },
        },
        EventSource: class EventSource { close() {} },
        navigator: { userAgent: 'Chrome/1' },
        AbortController,
        Date,
        Math,
        Promise,
        setTimeout(callback, delay) {
            const id = nextTimerId++;
            if (claimMode === 'timeout' && delay === 30000) queueMicrotask(callback);
            return id;
        },
        clearTimeout() {},
        setInterval() {
            const id = nextTimerId++;
            intervals.add(id);
            return id;
        },
        clearInterval(id) { intervals.delete(id); },
        async fetch(url, options = {}) {
            const isClaim = String(url).includes('/jobs/claim') || String(url).includes('/jobs/next');
            if (!isClaim) return { ok: true, status: 200, async json() { return {}; } };
            claimCalls++;
            if (claimMode === 'failure') throw new Error('expected claim network failure');
            if (claimMode === 'timeout') {
                return new Promise((resolve, reject) => {
                    options.signal.addEventListener('abort', () => {
                        const error = new Error('aborted');
                        error.name = 'AbortError';
                        reject(error);
                    }, { once: true });
                });
            }
            if (claimMode === 'job') {
                return {
                    ok: true,
                    status: 200,
                    async json() { return { job: { id: 2257, group_url: 'https://facebook.com/groups/test' } }; },
                };
            }
            return { ok: true, status: 200, async json() { return { job: null }; } };
        },
    };
    context.globalThis = context;
    const source = fs.readFileSync(path.join(__dirname, '../safe_post_extension/background.js'), 'utf8');
    vm.runInNewContext(`${source}\nglobalThis.__phase22 = {
        checkJobs,
        isScanning: () => isScanning,
        refreshPublishingActivity,
        finishPublishingActivity
    };`, context);

    async function dispatchMessage(request, sender = {}) {
        return new Promise((resolve, reject) => {
            let responded = false;
            const keepOpen = onMessage(request, sender, response => {
                responded = true;
                resolve(response);
            });
            if (keepOpen !== true && !responded) reject(new Error('Message channel was not kept open.'));
        });
    }

    return {
        api: context.__phase22,
        dispatchMessage,
        removeTab(tabId) { onRemoved(tabId); },
        claimCalls: () => claimCalls,
        tabsCreated: () => tabsCreated,
        activeIntervals: () => intervals.size,
    };
}

(async () => {
    await import(`${pathToFileURL(path.join(__dirname, '../safe_post_extension/extensionStorage.js')).href}?phase22`);
    await import(`${pathToFileURL(path.join(__dirname, '../safe_post_extension/facebookActivityLock.js')).href}?phase22`);

    const {
        FACEBOOK_ACTIVITY_OWNERS: OWNER,
        createFacebookActivityLock,
    } = global.SafePostFacebookActivityLockFactory;
    const quiet = { log() {}, warn() {} };
    const make = (storage = yieldingMemoryStorage()) => ({
        storage,
        lock: createFacebookActivityLock(storage, { logger: quiet, tabs: null }),
    });
    const seedPublishing = async (lock, operationId, jobId, tabId = null) => {
        await lock.acquireFacebookActivityLock(OWNER.PUBLISHING, operationId);
        if (jobId != null) await lock.attachFacebookActivityJob(OWNER.PUBLISHING, operationId, jobId);
        if (tabId != null) await lock.attachFacebookActivityTab(OWNER.PUBLISHING, operationId, tabId);
    };

    console.log('Phase 22 publishing lock identity\n');

    console.log(' A. immutable job metadata with asynchronous storage');
    {
        const { lock } = make();
        const acquired = await lock.acquireFacebookActivityLock(OWNER.PUBLISHING, 'publishing:pending-one');
        assert('publishing lock starts with jobId null',
            acquired.acquired && acquired.lock.jobId === null);
        const attached = await lock.attachFacebookActivityJob(
            OWNER.PUBLISHING, 'publishing:pending-one', 2257);
        const current = await lock.getFacebookActivityLock();
        assert('claimed job attaches to the same operationId across async yields',
            attached && current.operationId === 'publishing:pending-one' && current.jobId === '2257');
        assert('jobId cannot move to another job',
            await lock.attachFacebookActivityJob(
                OWNER.PUBLISHING, 'publishing:pending-one', 2258) === false);
        assert('wrong owner cannot attach a job',
            await lock.attachFacebookActivityJob(
                OWNER.GROUP_SYNC, 'publishing:pending-one', 2257) === false);
        assert('wrong operationId cannot attach a job',
            await lock.attachFacebookActivityJob(
                OWNER.PUBLISHING, 'publishing:pending-other', 2257) === false);
    }
    {
        const { lock } = make();
        await lock.acquireFacebookActivityLock(OWNER.GROUP_SYNC, 'group_sync:no-job');
        assert('non-publishing owner cannot attach job metadata to its own lock',
            await lock.attachFacebookActivityJob(
                OWNER.GROUP_SYNC, 'group_sync:no-job', 2257) === false);
    }
    {
        const { lock } = make();
        await seedPublishing(lock, 'publishing:pending-old', 1001);
        await lock.releaseFacebookActivityLock(OWNER.PUBLISHING, 'publishing:pending-old');
        await seedPublishing(lock, 'publishing:pending-new', 1002);
        const late = await lock.attachFacebookActivityJob(
            OWNER.PUBLISHING, 'publishing:pending-old', 1001);
        assert('late job callback cannot overwrite a newer operation',
            late === false && (await lock.getFacebookActivityLock()).jobId === '1002');
    }

    console.log('\n B. LOG and terminal recovery after MV3 restart');
    {
        const { lock } = make();
        await seedPublishing(lock, 'publishing:pending-log', 2257, 71);
        const instrumented = instrumentActivity(lock);
        const harness = createBackgroundHarness(instrumented.activity);
        await harness.dispatchMessage({
            action: 'REPORT_STATUS',
            payload: { taskId: 2257, status: 'LOG', failure_reason: 'heartbeat' },
        }, { tab: { id: 71 } });
        assert('LOG heartbeat finds the persisted lock after in-memory loss',
            instrumented.refreshes.length === 1);
        assert('LOG heartbeat uses the actual persisted operationId',
            instrumented.refreshes[0]?.operationId === 'publishing:pending-log');
        assert('LOG heartbeat keeps ownership intact',
            (await lock.getFacebookActivityLock()).jobId === '2257');
    }
    {
        const { lock } = make();
        await seedPublishing(lock, 'publishing:pending-terminal', 2257, 72);
        const instrumented = instrumentActivity(lock);
        const harness = createBackgroundHarness(instrumented.activity);
        await harness.dispatchMessage({
            action: 'REPORT_STATUS',
            payload: { taskId: 2257, status: 'SUCCESS' },
        }, { tab: { id: 72 } });
        assert('terminal REPORT_STATUS releases after simulated MV3 restart',
            await lock.getFacebookActivityLock() === null);
        assert('terminal release uses the persisted operationId',
            instrumented.releases.some(item => item.operationId === 'publishing:pending-terminal'));
    }
    {
        const { lock } = make();
        await seedPublishing(lock, 'publishing:pending-tab', 2257, 73);
        const instrumented = instrumentActivity(lock);
        const harness = createBackgroundHarness(instrumented.activity);
        harness.removeTab(73);
        await yieldAsync();
        await yieldAsync();
        await yieldAsync();
        assert('tabs.onRemoved cleans the matching persisted publish operation',
            await lock.getFacebookActivityLock() === null &&
            instrumented.releases.some(item => item.operationId === 'publishing:pending-tab'));
    }
    {
        const { lock } = make();
        await seedPublishing(lock, 'publishing:pending-newer', 3002, 82);
        const instrumented = instrumentActivity(lock);
        const harness = createBackgroundHarness(instrumented.activity);
        await harness.dispatchMessage({
            action: 'REPORT_STATUS',
            payload: { taskId: 3001, status: 'SUCCESS' },
        }, { tab: { id: 81 } });
        assert('stale terminal callback cannot release a newer operation',
            (await lock.getFacebookActivityLock()).operationId === 'publishing:pending-newer' &&
            instrumented.releases.length === 0);
        await harness.dispatchMessage({
            action: 'REPORT_STATUS',
            payload: { taskId: 9999, status: 'LOG' },
        }, { tab: { id: 82 } });
        assert('wrong jobId cannot refresh the current lock', instrumented.refreshes.length === 0);
        assert('wrong jobId cannot release the current lock',
            await harness.api.finishPublishingActivity(9999, 82) === false &&
            (await lock.getFacebookActivityLock()).operationId === 'publishing:pending-newer');
    }

    console.log('\n C. claim cleanup and timeout');
    {
        const { lock } = make();
        const instrumented = instrumentActivity(lock);
        const harness = createBackgroundHarness(instrumented.activity, { claimMode: 'job' });
        await harness.api.checkJobs();
        const current = await lock.getFacebookActivityLock();
        assert('successful publish flow keeps the pending operationId after claim',
            current.operationId.startsWith('publishing:pending-'));
        assert('successful publish flow attaches jobId before handing off', current.jobId === '2257');
        assert('successful publish flow attaches tabId to the same lock', current.tabId === 91);
        await harness.api.finishPublishingActivity(2257, 91);
        assert('successful flow cleanup stops its heartbeat and releases the lock',
            harness.activeIntervals() === 0 && await lock.getFacebookActivityLock() === null);
    }
    for (const scenario of [
        { mode: 'no-job', label: 'no-job' },
        { mode: 'failure', label: 'claim failure' },
        { mode: 'timeout', label: 'claim timeout' },
    ]) {
        const { lock } = make();
        const instrumented = instrumentActivity(lock);
        const harness = createBackgroundHarness(instrumented.activity, { claimMode: scenario.mode });
        await harness.api.checkJobs();
        assert(`${scenario.label} releases the pending lock`,
            await lock.getFacebookActivityLock() === null);
        assert(`${scenario.label} resets isScanning`, harness.api.isScanning() === false);
        assert(`${scenario.label} opens no Facebook tab`, harness.tabsCreated() === 0);
        assert(`${scenario.label} stops the reservation heartbeat`, harness.activeIntervals() === 0);
    }

    console.log(`\n${passed} passed, ${failed} failed`);
    process.exitCode = failed ? 1 : 0;
})().catch(error => {
    console.error('Test run error:', error);
    process.exitCode = 2;
});
