/**
 * Phase 20 - persistent, cooperative Facebook activity mutex.
 */
const fs = require('fs');
const path = require('path');
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

(async () => {
    await import(`${pathToFileURL(path.join(__dirname, '../safe_post_extension/extensionStorage.js')).href}?phase20`);
    await import(`${pathToFileURL(path.join(__dirname, '../safe_post_extension/facebookActivityLock.js')).href}?phase20`);

    const {
        FACEBOOK_ACTIVITY_OWNERS: OWNER,
        FACEBOOK_ACTIVITY_STALE_MS,
        createFacebookActivityLock,
    } = global.SafePostFacebookActivityLockFactory;
    const quiet = { log() {}, warn() {} };
    const make = (storage = memoryStorage(), options = {}) => ({
        storage,
        lock: createFacebookActivityLock(storage, { logger: quiet, ...options }),
    });

    console.log('Phase 20 Facebook activity lock\n');

    console.log(' A. acquisition and ownership');
    {
        const { lock } = make();
        const result = await lock.acquireFacebookActivityLock(OWNER.PUBLISHING, 'publish:1');
        assert('publishing acquires a free lock', result.acquired === true);
    }
    {
        const { lock } = make();
        const result = await lock.acquireFacebookActivityLock(OWNER.GROUP_SYNC, 'sync:1');
        assert('group_sync acquires a free lock', result.acquired === true);
    }
    {
        const { lock } = make();
        const result = await lock.acquireFacebookActivityLock(OWNER.ENGAGEMENT, 'engagement:1');
        assert('engagement acquires a free lock', result.acquired === true);
    }
    {
        const { lock } = make();
        await lock.acquireFacebookActivityLock(OWNER.PUBLISHING, 'publish:1');
        const blocked = await lock.acquireFacebookActivityLock(OWNER.GROUP_SYNC, 'sync:1');
        let groupTabOpened = false;
        const guardedStart = await lock.runWithFacebookActivityLock(
            OWNER.GROUP_SYNC,
            'sync:guarded-start',
            async () => { groupTabOpened = true; }
        );
        assert('another owner cannot acquire a live lock', blocked.acquired === false && blocked.reason === 'busy');
        assert('publishing-active regression: group sync does not open another Facebook tab',
            guardedStart.acquired === false && !groupTabOpened &&
            (await lock.getFacebookActivityLock()).owner === OWNER.PUBLISHING);
    }
    {
        const { lock } = make();
        const results = await Promise.all([
            lock.acquireFacebookActivityLock(OWNER.PUBLISHING, 'publish:race'),
            lock.acquireFacebookActivityLock(OWNER.GROUP_SYNC, 'sync:race'),
        ]);
        assert('concurrent acquisition has exactly one winner',
            results.filter(result => result.acquired).length === 1);
    }

    console.log('\n B. heartbeat and release identity');
    {
        let now = 1000;
        const { lock } = make(memoryStorage(), { now: () => now });
        await lock.acquireFacebookActivityLock(OWNER.PUBLISHING, 'publish:1');
        const before = await lock.getFacebookActivityLock();
        now += 5000;
        const refreshed = await lock.refreshFacebookActivityLock(OWNER.PUBLISHING, 'publish:1');
        const after = await lock.getFacebookActivityLock();
        assert('same owner and operation refresh heartbeat',
            refreshed && after.heartbeatAt > before.heartbeatAt && after.acquiredAt === before.acquiredAt);
        assert('wrong owner cannot release',
            await lock.releaseFacebookActivityLock(OWNER.GROUP_SYNC, 'publish:1') === false);
        assert('wrong operationId cannot release',
            await lock.releaseFacebookActivityLock(OWNER.PUBLISHING, 'publish:2') === false);
        assert('the real owner can still release after rejected attempts',
            await lock.releaseFacebookActivityLock(OWNER.PUBLISHING, 'publish:1') === true);
    }

    console.log('\n C. stale recovery and MV3 restart');
    {
        let now = 1000;
        const storage = memoryStorage();
        const first = make(storage, { now: () => now }).lock;
        await first.acquireFacebookActivityLock(OWNER.GROUP_SYNC, 'sync:stale');
        now += FACEBOOK_ACTIVITY_STALE_MS + 1;
        const second = make(storage, { now: () => now }).lock;
        const result = await second.acquireFacebookActivityLock(OWNER.PUBLISHING, 'publish:after-stale');
        assert('stale lock can be recovered', result.acquired === true && result.lock.owner === OWNER.PUBLISHING);
    }
    {
        let now = 1000;
        const { lock } = make(memoryStorage(), { now: () => now });
        await lock.acquireFacebookActivityLock(OWNER.GROUP_SYNC, 'sync:live');
        now += FACEBOOK_ACTIVITY_STALE_MS - 1000;
        await lock.refreshFacebookActivityLock(OWNER.GROUP_SYNC, 'sync:live');
        now += 2000;
        const result = await lock.acquireFacebookActivityLock(OWNER.PUBLISHING, 'publish:blocked');
        assert('live heartbeat prevents stale recovery', result.acquired === false && result.holder.owner === OWNER.GROUP_SYNC);
    }
    {
        const storage = memoryStorage();
        const first = make(storage).lock;
        await first.acquireFacebookActivityLock(OWNER.PUBLISHING, 'publish:persisted');
        const afterRestart = make(storage).lock;
        assert('service-worker restart reads the persisted lock',
            (await afterRestart.getFacebookActivityLock()).operationId === 'publish:persisted');
    }

    async function cooperativePublishPreemption(lowerOwner, lowerOperation) {
        const { lock } = make();
        await lock.acquireFacebookActivityLock(lowerOwner, lowerOperation);
        lock.registerFacebookActivityPreemptionHandler(lowerOwner, async request => {
            return lock.releaseFacebookActivityLock(request.targetOwner, request.targetOperationId);
        });
        const request = await lock.requestFacebookActivityPreemption(OWNER.PUBLISHING, 'publish:priority');
        const unlocked = await lock.waitForFacebookActivityUnlock({ timeoutMs: 100, pollIntervalMs: 1 });
        const acquired = await lock.acquireFacebookActivityLock(OWNER.PUBLISHING, 'publish:priority');
        return { request, unlocked, acquired, current: await lock.getFacebookActivityLock() };
    }

    console.log('\n D. priority and cooperative pre-emption');
    {
        const result = await cooperativePublishPreemption(OWNER.GROUP_SYNC, 'sync:yield');
        assert('publishing pre-empts group_sync cooperatively',
            result.request.requested && result.request.acknowledged && result.unlocked && result.acquired.acquired);
        assert('group-sync-active regression: publishing starts only after sync releases',
            result.current.owner === OWNER.PUBLISHING);
    }
    {
        const result = await cooperativePublishPreemption(OWNER.ENGAGEMENT, 'engagement:yield');
        assert('publishing pre-empts the engagement hook cooperatively',
            result.request.requested && result.request.acknowledged && result.acquired.acquired);
    }
    {
        const { lock } = make();
        await lock.acquireFacebookActivityLock(OWNER.PUBLISHING, 'publish:live');
        const request = await lock.requestFacebookActivityPreemption(OWNER.GROUP_SYNC, 'sync:request');
        assert('group_sync cannot pre-empt publishing', request.requested === false && request.reason === 'priority-denied');
    }
    {
        const { lock } = make();
        await lock.acquireFacebookActivityLock(OWNER.PUBLISHING, 'publish:live');
        const request = await lock.requestFacebookActivityPreemption(OWNER.ENGAGEMENT, 'engagement:request');
        assert('engagement cannot pre-empt publishing', request.requested === false && request.reason === 'priority-denied');
    }
    {
        const { lock } = make();
        await lock.acquireFacebookActivityLock(OWNER.GROUP_SYNC, 'sync:live');
        const engagement = await lock.acquireFacebookActivityLock(OWNER.ENGAGEMENT, 'engagement:blocked');
        assert('group_sync and engagement cannot overlap', engagement.acquired === false);
    }

    console.log('\n E. guaranteed cleanup');
    {
        const { lock } = make();
        let threw = false;
        try {
            await lock.runWithFacebookActivityLock(OWNER.ENGAGEMENT, 'engagement:exception', async () => {
                throw new Error('test exception');
            });
        } catch {
            threw = true;
        }
        assert('exception cleanup releases the lock', threw && !(await lock.isFacebookActivityBusy()));
    }
    {
        const events = [];
        const logger = { log(event) { events.push(event); }, warn(event) { events.push(event); } };
        const { lock } = make(memoryStorage(), { logger });
        let timedOut = false;
        try {
            await lock.runWithFacebookActivityLock(
                OWNER.GROUP_SYNC,
                'sync:timeout',
                ({ signal }) => new Promise((resolve, reject) => {
                    signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
                }),
                { timeoutMs: 10 }
            );
        } catch (error) {
            timedOut = error.code === 'FACEBOOK_ACTIVITY_TIMEOUT';
        }
        assert('timeout cleanup does not leave a permanent lock', timedOut && !(await lock.isFacebookActivityBusy()));
        assert('timeout transition is logged', events.includes('FACEBOOK_ACTIVITY_LOCK_TIMEOUT'));
    }

    console.log('\n F. background wiring regression');
    const background = fs.readFileSync(path.join(__dirname, '../safe_post_extension/background.js'), 'utf8');
    const syncStart = background.indexOf('async function scanAndSyncGroups');
    const syncAcquire = background.indexOf('acquireFacebookActivityLock', syncStart);
    const syncTab = background.indexOf('chrome.tabs.create', syncStart);
    const publishStart = background.indexOf('async function checkJobs');
    const publishAcquire = background.indexOf('acquirePublishingActivity', publishStart);
    const publishTab = background.indexOf('chrome.tabs.create', publishStart);
    assert('group sync acquires the shared lock before opening Facebook',
        syncStart >= 0 && syncAcquire > syncStart && syncAcquire < syncTab);
    assert('publishing acquires the shared lock before opening Facebook',
        publishStart >= 0 && publishAcquire > publishStart && publishAcquire < publishTab);
    assert('background imports the shared lock module',
        /importScripts\([^)]*facebookActivityLock\.js/.test(background));
    const buildScript = fs.readFileSync(path.join(__dirname, '../build.sh'), 'utf8');
    assert('extension build ships the shared lock module',
        /cp safe_post_extension\/facebookActivityLock\.js dist\/scripts\/facebookActivityLock\.js/.test(buildScript));

    console.log('\n G. transition observability');
    {
        let now = 1000;
        const events = [];
        const logger = { log(event) { events.push(event); }, warn(event) { events.push(event); } };
        const storage = memoryStorage();
        const lock = createFacebookActivityLock(storage, { logger, now: () => now });
        await lock.acquireFacebookActivityLock(OWNER.GROUP_SYNC, 'sync:events');
        now += 1000;
        await lock.refreshFacebookActivityLock(OWNER.GROUP_SYNC, 'sync:events');
        lock.registerFacebookActivityPreemptionHandler(OWNER.GROUP_SYNC, request =>
            lock.releaseFacebookActivityLock(request.targetOwner, request.targetOperationId));
        await lock.requestFacebookActivityPreemption(OWNER.PUBLISHING, 'publish:events');
        await lock.acquireFacebookActivityLock(OWNER.ENGAGEMENT, 'engagement:stale-event');
        now += FACEBOOK_ACTIVITY_STALE_MS + 1;
        await lock.recoverStaleFacebookActivityLock();
        const required = [
            'FACEBOOK_ACTIVITY_LOCK_ACQUIRED',
            'FACEBOOK_ACTIVITY_LOCK_REFRESHED',
            'FACEBOOK_ACTIVITY_LOCK_RELEASED',
            'FACEBOOK_ACTIVITY_PREEMPT_REQUESTED',
            'FACEBOOK_ACTIVITY_PREEMPTED',
            'FACEBOOK_ACTIVITY_STALE_RECOVERED',
        ];
        assert('all non-timeout lock transitions are logged',
            required.every(event => events.includes(event)), events.join(', '));
    }

    console.log(`\n${passed} passed, ${failed} failed`);
    process.exitCode = failed ? 1 : 0;
})().catch(error => {
    console.error('Test run error:', error);
    process.exitCode = 2;
});
