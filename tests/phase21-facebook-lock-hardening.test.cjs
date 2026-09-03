/**
 * Phase 21 - independent-review hardening for the Facebook activity lock.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { spawnSync } = require('child_process');
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

function memoryStorage() {
    let lock = null;
    let preemption = null;
    return {
        async readFacebookActivityLock() { return clone(lock); },
        async writeFacebookActivityLock(value) { lock = clone(value); },
        async clearFacebookActivityLock() { lock = null; },
        async readFacebookActivityPreemption() { return clone(preemption); },
        async writeFacebookActivityPreemption(value) { preemption = clone(value); },
        async clearFacebookActivityPreemption() { preemption = null; },
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

function createBackgroundHarness({ acquireResult }) {
    let claimCalls = 0;
    const noOpEvent = { addListener() {}, removeListener() {} };
    const activity = {
        async reconcileFacebookActivityLock() { return { recovered: false, reason: 'free' }; },
        async acquireFacebookActivityLock() { return acquireResult; },
        async requestFacebookActivityPreemption() { return { requested: false }; },
        async waitForFacebookActivityUnlock() { return false; },
        async attachFacebookActivityTab() { return true; },
        async refreshFacebookActivityLock() { return true; },
        async releaseFacebookActivityLock() { return true; },
        registerFacebookActivityPreemptionHandler() { return () => {}; },
    };
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
                id: 'phase21-extension',
                lastError: null,
                getManifest: () => ({ version: '9.1' }),
                onInstalled: noOpEvent,
                onStartup: noOpEvent,
                onMessage: noOpEvent,
                onMessageExternal: noOpEvent,
            },
            storage: {
                local: { async get() { return {}; }, async set() {} },
                onChanged: noOpEvent,
            },
            tabs: {
                onRemoved: noOpEvent,
                onUpdated: noOpEvent,
                async create() { return { id: 1 }; },
                async remove() {},
                async get() { return { id: 1, url: 'https://facebook.com/groups/test' }; },
                async query() { return []; },
                sendMessage() {},
            },
            scripting: { async executeScript() { return []; } },
        },
        EventSource: class EventSource {
            close() {}
        },
        navigator: { userAgent: 'Chrome/1' },
        fetch: async url => {
            if (String(url).includes('/jobs/claim') || String(url).includes('/jobs/next')) claimCalls++;
            return { ok: true, async json() { return { job: null }; } };
        },
        setTimeout: () => 1,
        clearTimeout() {},
        setInterval: () => 1,
        clearInterval() {},
        AbortController,
        Date,
        Math,
        Promise,
    };
    context.globalThis = context;
    const source = fs.readFileSync(path.join(__dirname, '../safe_post_extension/background.js'), 'utf8');
    vm.runInNewContext(`${source}\nglobalThis.__phase21CheckJobs = checkJobs;`, context);
    return { checkJobs: context.__phase21CheckJobs, claimCalls: () => claimCalls };
}

(async () => {
    await import(`${pathToFileURL(path.join(__dirname, '../safe_post_extension/extensionStorage.js')).href}?phase21`);
    await import(`${pathToFileURL(path.join(__dirname, '../safe_post_extension/facebookActivityLock.js')).href}?phase21`);

    const {
        FACEBOOK_ACTIVITY_OWNERS: OWNER,
        createFacebookActivityLock,
    } = global.SafePostFacebookActivityLockFactory;
    const quiet = { log() {}, warn() {} };
    const make = (storage = memoryStorage(), options = {}) => ({
        storage,
        lock: createFacebookActivityLock(storage, { logger: quiet, ...options }),
    });

    console.log('Phase 21 Facebook activity lock hardening\n');

    console.log(' A. publish reservation precedes backend claim');
    {
        const harness = createBackgroundHarness({
            acquireResult: { acquired: false, reason: 'busy', holder: { owner: OWNER.GROUP_SYNC } },
        });
        await harness.checkJobs();
        assert('publish does not claim while another Facebook activity blocks reservation',
            harness.claimCalls() === 0);
        assert('lock contention consumes no backend attempt', harness.claimCalls() === 0);
    }
    {
        const harness = createBackgroundHarness({ acquireResult: { acquired: true } });
        await harness.checkJobs();
        assert('backend claim is reached after a successful reservation', harness.claimCalls() === 1);
    }
    {
        const background = fs.readFileSync(path.join(__dirname, '../safe_post_extension/background.js'), 'utf8');
        const start = background.indexOf('async function checkJobs');
        const reserve = background.indexOf('acquirePublishingActivity(', start);
        const claim = background.indexOf('claimPublishingJob(', start);
        assert('source order keeps reservation before claim', start >= 0 && reserve > start && reserve < claim);
    }

    console.log('\n B. bounded preemption handlers');
    {
        const events = [];
        const logger = { log(event) { events.push(event); }, warn(event) { events.push(event); } };
        const { lock } = make(memoryStorage(), { logger, preemptionHandlerTimeoutMs: 10 });
        await lock.acquireFacebookActivityLock(OWNER.GROUP_SYNC, 'sync:never');
        lock.registerFacebookActivityPreemptionHandler(OWNER.GROUP_SYNC, () => new Promise(() => {}));
        const started = Date.now();
        const result = await lock.requestFacebookActivityPreemption(OWNER.PUBLISHING, 'publish:never');
        assert('handler that never settles returns a defined failure',
            result.acknowledged === false && result.failure === 'handler-timeout');
        assert('requester does not hang on a non-settling handler', Date.now() - started < 250);
        assert('handler timeout leaves ownership defined',
            (await lock.getFacebookActivityLock()).operationId === 'sync:never');
        assert('handler timeout is logged', events.includes('FACEBOOK_ACTIVITY_PREEMPT_HANDLER_TIMEOUT'));
    }
    {
        const { lock } = make(memoryStorage(), { preemptionHandlerTimeoutMs: 10 });
        await lock.acquireFacebookActivityLock(OWNER.GROUP_SYNC, 'sync:throws');
        lock.registerFacebookActivityPreemptionHandler(OWNER.GROUP_SYNC, async () => {
            throw new Error('expected handler failure');
        });
        const result = await lock.requestFacebookActivityPreemption(OWNER.PUBLISHING, 'publish:throws');
        assert('throwing handler is guarded',
            result.acknowledged === false && result.failure === 'handler-error');
        await lock.releaseFacebookActivityLock(OWNER.GROUP_SYNC, 'sync:throws');
        assert('requester remains usable after handler failure',
            (await lock.acquireFacebookActivityLock(OWNER.PUBLISHING, 'publish:retry')).acquired === true);
    }
    {
        let resolveLate;
        const { lock } = make(memoryStorage(), { preemptionHandlerTimeoutMs: 10 });
        await lock.acquireFacebookActivityLock(OWNER.GROUP_SYNC, 'sync:late');
        lock.registerFacebookActivityPreemptionHandler(OWNER.GROUP_SYNC,
            () => new Promise(resolve => { resolveLate = resolve; }));
        const result = await lock.requestFacebookActivityPreemption(OWNER.PUBLISHING, 'publish:late');
        resolveLate(true);
        await new Promise(resolve => setTimeout(resolve, 5));
        assert('late handler resolution cannot change the timeout result',
            result.acknowledged === false && result.failure === 'handler-timeout');
        assert('late handler resolution does not clear the current owner',
            (await lock.getFacebookActivityLock()).operationId === 'sync:late');
    }

    console.log('\n C. absolute lifetime');
    {
        let clock = 1000;
        const events = [];
        const logger = { log(event) { events.push(event); }, warn(event) { events.push(event); } };
        const { lock } = make(memoryStorage(), {
            now: () => clock,
            staleMs: 1000,
            maxLifetimeMs: 100,
            logger,
        });
        await lock.acquireFacebookActivityLock(OWNER.ENGAGEMENT, 'engagement:absolute');
        clock += 101;
        const refreshed = await lock.refreshFacebookActivityLock(OWNER.ENGAGEMENT, 'engagement:absolute');
        assert('absolute lifetime cap recovers an over-age operation',
            refreshed === false && await lock.getFacebookActivityLock() === null);
        assert('absolute timeout is logged', events.includes('FACEBOOK_ACTIVITY_ABSOLUTE_TIMEOUT'));
    }
    {
        let clock = 1000;
        const { lock } = make(memoryStorage(), {
            now: () => clock,
            staleMs: 1000,
            maxLifetimeMs: 100,
        });
        await lock.acquireFacebookActivityLock(OWNER.GROUP_SYNC, 'sync:heartbeat-cap');
        clock += 90;
        assert('heartbeat remains valid before absolute cap',
            await lock.refreshFacebookActivityLock(OWNER.GROUP_SYNC, 'sync:heartbeat-cap') === true);
        clock += 11;
        assert('fresh heartbeat cannot bypass the absolute cap forever',
            await lock.refreshFacebookActivityLock(OWNER.GROUP_SYNC, 'sync:heartbeat-cap') === false &&
            await lock.getFacebookActivityLock() === null);
    }

    console.log('\n D. tab identity and restart reconciliation');
    {
        const { lock } = make();
        await lock.acquireFacebookActivityLock(OWNER.PUBLISHING, 'publish:tab');
        assert('wrong owner cannot attach a tab',
            await lock.attachFacebookActivityTab(OWNER.GROUP_SYNC, 'publish:tab', 10) === false);
        assert('wrong operation cannot attach a tab',
            await lock.attachFacebookActivityTab(OWNER.PUBLISHING, 'publish:other', 10) === false);
        assert('matching owner and operation attach a tab',
            await lock.attachFacebookActivityTab(OWNER.PUBLISHING, 'publish:tab', 10) === true &&
            (await lock.getFacebookActivityLock()).tabId === 10);
    }
    {
        const { lock } = make();
        await lock.acquireFacebookActivityLock(OWNER.GROUP_SYNC, 'sync:old');
        await lock.releaseFacebookActivityLock(OWNER.GROUP_SYNC, 'sync:old');
        await lock.acquireFacebookActivityLock(OWNER.GROUP_SYNC, 'sync:new');
        const attached = await lock.attachFacebookActivityTab(OWNER.GROUP_SYNC, 'sync:old', 11);
        const current = await lock.getFacebookActivityLock();
        assert('late tab callback cannot attach to a newer operation',
            attached === false && current.operationId === 'sync:new' && current.tabId === null);
    }
    {
        const storage = memoryStorage();
        const first = make(storage).lock;
        await first.acquireFacebookActivityLock(OWNER.GROUP_SYNC, 'sync:missing-tab');
        await first.attachFacebookActivityTab(OWNER.GROUP_SYNC, 'sync:missing-tab', 12);
        const tabs = {
            async get() { throw new Error('No tab with id: 12'); },
            async remove() { throw new Error('must not remove a missing tab'); },
        };
        const restarted = make(storage, { tabs }).lock;
        const result = await restarted.reconcileFacebookActivityLock({ recoverOrphanedGroupSync: true });
        assert('restart safely recovers group_sync when its tab is missing',
            result.recovered === true && await restarted.getFacebookActivityLock() === null);
    }
    {
        const storage = memoryStorage();
        const first = make(storage).lock;
        await first.acquireFacebookActivityLock(OWNER.GROUP_SYNC, 'sync:existing-tab');
        await first.attachFacebookActivityTab(OWNER.GROUP_SYNC, 'sync:existing-tab', 13);
        const removed = [];
        const tabs = {
            async get(id) { return { id }; },
            async remove(id) { removed.push(id); },
        };
        const restarted = make(storage, { tabs }).lock;
        const result = await restarted.reconcileFacebookActivityLock({ recoverOrphanedGroupSync: true });
        assert('restart closes and reconciles an existing group_sync tab',
            result.recovered === true && removed[0] === 13 &&
            await restarted.getFacebookActivityLock() === null);
    }
    {
        const storage = memoryStorage();
        const first = make(storage).lock;
        await first.acquireFacebookActivityLock(OWNER.GROUP_SYNC, 'sync:unclosable-tab');
        await first.attachFacebookActivityTab(OWNER.GROUP_SYNC, 'sync:unclosable-tab', 14);
        const tabs = {
            async get(id) { return { id }; },
            async remove() { throw new Error('Chrome refused to close the tab'); },
        };
        const restarted = make(storage, { tabs }).lock;
        const result = await restarted.reconcileFacebookActivityLock({ recoverOrphanedGroupSync: true });
        const publishing = await restarted.acquireFacebookActivityLock(OWNER.PUBLISHING, 'publish:blocked');
        assert('failed tab reconciliation keeps ownership and blocks a second activity',
            result.recovered === false && publishing.acquired === false &&
            (await restarted.getFacebookActivityLock()).operationId === 'sync:unclosable-tab');
    }

    console.log('\n E. build dependency assertion');
    {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'safepost-phase21-'));
        const sourceDirectory = path.join(root, 'source');
        const destination = path.join(root, 'dist');
        fs.mkdirSync(sourceDirectory, { recursive: true });
        fs.mkdirSync(destination, { recursive: true });
        fs.writeFileSync(path.join(sourceDirectory, 'background.js'),
            "importScripts('present.js', 'missing.js');\n");
        fs.writeFileSync(path.join(sourceDirectory, 'present.js'), '// present\n');
        fs.writeFileSync(path.join(sourceDirectory, 'missing.js'), '// source exists\n');
        fs.writeFileSync(path.join(destination, 'background.js'), '// built\n');
        fs.writeFileSync(path.join(destination, 'present.js'), '// built\n');
        const verifier = path.join(__dirname, '../scripts/package-extension-worker.cjs');
        const result = spawnSync(process.execPath, [
            verifier,
            path.join(sourceDirectory, 'background.js'),
            destination,
            '--verify-only',
        ], { encoding: 'utf8' });
        assert('build verification fails when importScripts dependency is missing',
            result.status !== 0 && /missing\.js/.test(result.stderr));
        fs.rmSync(root, { recursive: true, force: true });
    }

    console.log(`\n${passed} passed, ${failed} failed`);
    process.exitCode = failed ? 1 : 0;
})().catch(error => {
    console.error('Test run error:', error);
    process.exitCode = 2;
});
