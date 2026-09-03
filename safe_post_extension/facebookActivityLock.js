(function initFacebookActivityLock(global) {
    'use strict';

    const FACEBOOK_ACTIVITY_OWNERS = Object.freeze({
        PUBLISHING: 'publishing',
        GROUP_SYNC: 'group_sync',
        ENGAGEMENT: 'engagement',
    });
    const VALID_OWNERS = new Set(Object.values(FACEBOOK_ACTIVITY_OWNERS));

    // Group sync can legitimately run for six minutes. Ten minutes gives an
    // active operation room to finish while still recovering an abandoned MV3
    // service-worker lock in bounded time. Staleness is based on heartbeatAt,
    // not the age of acquiredAt.
    const FACEBOOK_ACTIVITY_STALE_MS = 10 * 60 * 1000;
    const FACEBOOK_ACTIVITY_HEARTBEAT_MS = 30 * 1000;
    const FACEBOOK_ACTIVITY_PREEMPT_WAIT_MS = 30 * 1000;

    function createFacebookActivityLock(storage, options = {}) {
        if (!storage) throw new Error('Facebook activity storage is required.');

        const now = typeof options.now === 'function' ? options.now : () => Date.now();
        const sleep = typeof options.sleep === 'function'
            ? options.sleep
            : (ms) => new Promise(resolve => setTimeout(resolve, ms));
        const logger = options.logger || console;
        const staleMs = options.staleMs || FACEBOOK_ACTIVITY_STALE_MS;
        const handlers = new Map();
        let mutationQueue = Promise.resolve();

        function log(event, details = {}) {
            const method = event === 'FACEBOOK_ACTIVITY_LOCK_TIMEOUT' ? 'warn' : 'log';
            const output = typeof logger[method] === 'function' ? logger[method] : logger.log;
            if (typeof output === 'function') output.call(logger, event, details);
        }

        function validateIdentity(owner, operationId) {
            if (!VALID_OWNERS.has(owner)) throw new Error(`Invalid Facebook activity owner: ${owner}`);
            if (typeof operationId !== 'string' || !operationId.trim()) {
                throw new Error('Facebook activity operationId is required.');
            }
        }

        function normalizeLock(value) {
            if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
            if (!VALID_OWNERS.has(value.owner)) return null;
            if (typeof value.operationId !== 'string' || !value.operationId) return null;
            return {
                owner: value.owner,
                operationId: value.operationId,
                acquiredAt: Number(value.acquiredAt),
                heartbeatAt: Number(value.heartbeatAt),
            };
        }

        function sameIdentity(lock, owner, operationId) {
            return Boolean(lock && lock.owner === owner && lock.operationId === operationId);
        }

        function isFacebookActivityLockStale(lock, at = now()) {
            const normalized = normalizeLock(lock);
            if (!normalized) return Boolean(lock);
            const heartbeat = Number.isFinite(normalized.heartbeatAt)
                ? normalized.heartbeatAt
                : normalized.acquiredAt;
            return !Number.isFinite(heartbeat) || at - heartbeat > staleMs;
        }

        function serializeMutation(task) {
            const result = mutationQueue.then(task, task);
            mutationQueue = result.catch(() => {});
            return result;
        }

        async function readLock() {
            return normalizeLock(await storage.readFacebookActivityLock());
        }

        async function clearPreemptionFor(lock) {
            const request = await storage.readFacebookActivityPreemption();
            if (request && request.targetOwner === lock.owner &&
                request.targetOperationId === lock.operationId) {
                await storage.clearFacebookActivityPreemption();
            }
        }

        async function recoverStaleFacebookActivityLock() {
            return serializeMutation(async () => {
                const lock = await readLock();
                if (!lock || !isFacebookActivityLockStale(lock)) return false;
                await storage.clearFacebookActivityLock();
                await clearPreemptionFor(lock);
                log('FACEBOOK_ACTIVITY_STALE_RECOVERED', {
                    owner: lock.owner,
                    operationId: lock.operationId,
                });
                return true;
            });
        }

        async function getFacebookActivityLock() {
            return readLock();
        }

        async function acquireFacebookActivityLock(owner, operationId) {
            validateIdentity(owner, operationId);
            return serializeMutation(async () => {
                let current = await readLock();
                if (current && isFacebookActivityLockStale(current)) {
                    await storage.clearFacebookActivityLock();
                    await clearPreemptionFor(current);
                    log('FACEBOOK_ACTIVITY_STALE_RECOVERED', {
                        owner: current.owner,
                        operationId: current.operationId,
                    });
                    current = null;
                }

                if (current && !sameIdentity(current, owner, operationId)) {
                    return { acquired: false, reason: 'busy', holder: current };
                }

                const timestamp = now();
                const lock = current
                    ? { ...current, heartbeatAt: timestamp }
                    : { owner, operationId, acquiredAt: timestamp, heartbeatAt: timestamp };
                await storage.writeFacebookActivityLock(lock);

                // chrome.storage.local has no compare-and-set. Mutations in this
                // service worker are serialized, and this read-back prevents a
                // second context from silently overwriting ownership.
                const verified = await readLock();
                if (!sameIdentity(verified, owner, operationId)) {
                    return { acquired: false, reason: 'lost-race', holder: verified };
                }

                log('FACEBOOK_ACTIVITY_LOCK_ACQUIRED', { owner, operationId });
                return { acquired: true, lock: verified, reentrant: Boolean(current) };
            });
        }

        async function refreshFacebookActivityLock(owner, operationId) {
            validateIdentity(owner, operationId);
            return serializeMutation(async () => {
                const current = await readLock();
                if (!sameIdentity(current, owner, operationId)) return false;
                const refreshed = { ...current, heartbeatAt: now() };
                await storage.writeFacebookActivityLock(refreshed);
                const verified = await readLock();
                const ok = sameIdentity(verified, owner, operationId) &&
                    verified.heartbeatAt === refreshed.heartbeatAt;
                if (ok) log('FACEBOOK_ACTIVITY_LOCK_REFRESHED', { owner, operationId });
                return ok;
            });
        }

        async function releaseFacebookActivityLock(owner, operationId) {
            validateIdentity(owner, operationId);
            return serializeMutation(async () => {
                const current = await readLock();
                if (!sameIdentity(current, owner, operationId)) return false;
                await storage.clearFacebookActivityLock();
                await clearPreemptionFor(current);
                log('FACEBOOK_ACTIVITY_LOCK_RELEASED', { owner, operationId });
                return true;
            });
        }

        async function isFacebookActivityBusy() {
            const lock = await readLock();
            return Boolean(lock && !isFacebookActivityLockStale(lock));
        }

        function registerFacebookActivityPreemptionHandler(owner, handler) {
            if (!VALID_OWNERS.has(owner)) throw new Error(`Invalid Facebook activity owner: ${owner}`);
            if (typeof handler !== 'function') throw new Error('Preemption handler must be a function.');
            handlers.set(owner, handler);
            return () => {
                if (handlers.get(owner) === handler) handlers.delete(owner);
            };
        }

        async function requestFacebookActivityPreemption(requesterOwner, requesterOperationId) {
            validateIdentity(requesterOwner, requesterOperationId);
            const outcome = await serializeMutation(async () => {
                const current = await readLock();
                if (!current) return { requested: false, reason: 'free' };
                if (isFacebookActivityLockStale(current)) {
                    await storage.clearFacebookActivityLock();
                    await clearPreemptionFor(current);
                    log('FACEBOOK_ACTIVITY_STALE_RECOVERED', {
                        owner: current.owner,
                        operationId: current.operationId,
                    });
                    return { requested: false, reason: 'stale-recovered' };
                }
                if (requesterOwner !== FACEBOOK_ACTIVITY_OWNERS.PUBLISHING ||
                    current.owner === FACEBOOK_ACTIVITY_OWNERS.PUBLISHING) {
                    return { requested: false, reason: 'priority-denied', holder: current };
                }

                const request = {
                    targetOwner: current.owner,
                    targetOperationId: current.operationId,
                    requestedBy: requesterOwner,
                    requestOperationId: requesterOperationId,
                    requestedAt: now(),
                };
                await storage.writeFacebookActivityPreemption(request);
                log('FACEBOOK_ACTIVITY_PREEMPT_REQUESTED', {
                    owner: current.owner,
                    operationId: current.operationId,
                    requestedBy: requesterOwner,
                });
                return { requested: true, request, holder: current };
            });

            if (!outcome.requested) return outcome;
            const handler = handlers.get(outcome.request.targetOwner);
            if (!handler) return { ...outcome, acknowledged: false };

            const acknowledged = (await handler(outcome.request)) !== false;
            if (acknowledged) {
                log('FACEBOOK_ACTIVITY_PREEMPTED', {
                    owner: outcome.request.targetOwner,
                    operationId: outcome.request.targetOperationId,
                    requestedBy: requesterOwner,
                });
            }
            return { ...outcome, acknowledged };
        }

        async function waitForFacebookActivityUnlock({
            timeoutMs = FACEBOOK_ACTIVITY_PREEMPT_WAIT_MS,
            pollIntervalMs = 100,
        } = {}) {
            const deadline = now() + Math.max(1, timeoutMs);
            while (now() < deadline) {
                const lock = await readLock();
                if (!lock) return true;
                if (isFacebookActivityLockStale(lock)) {
                    await recoverStaleFacebookActivityLock();
                    return !(await isFacebookActivityBusy());
                }
                await sleep(Math.min(pollIntervalMs, Math.max(1, deadline - now())));
            }
            const holder = await readLock();
            log('FACEBOOK_ACTIVITY_LOCK_TIMEOUT', {
                owner: holder?.owner || null,
                operationId: holder?.operationId || null,
            });
            return false;
        }

        async function runWithFacebookActivityLock(owner, operationId, operation, { timeoutMs } = {}) {
            if (typeof operation !== 'function') throw new Error('Facebook activity operation is required.');
            const acquired = await acquireFacebookActivityLock(owner, operationId);
            if (!acquired.acquired) return { acquired: false, reason: acquired.reason };

            const controller = new AbortController();
            let timer = null;
            try {
                const running = Promise.resolve().then(() => operation({ signal: controller.signal }));
                if (!Number.isFinite(timeoutMs)) return { acquired: true, value: await running };
                const timeout = new Promise((_, reject) => {
                    timer = setTimeout(() => {
                        controller.abort();
                        const error = new Error('Facebook activity timed out.');
                        error.code = 'FACEBOOK_ACTIVITY_TIMEOUT';
                        log('FACEBOOK_ACTIVITY_LOCK_TIMEOUT', { owner, operationId });
                        reject(error);
                    }, Math.max(1, timeoutMs));
                });
                return { acquired: true, value: await Promise.race([running, timeout]) };
            } finally {
                if (timer) clearTimeout(timer);
                controller.abort();
                await releaseFacebookActivityLock(owner, operationId);
            }
        }

        return Object.freeze({
            getFacebookActivityLock,
            acquireFacebookActivityLock,
            refreshFacebookActivityLock,
            releaseFacebookActivityLock,
            isFacebookActivityBusy,
            isFacebookActivityLockStale,
            recoverStaleFacebookActivityLock,
            requestFacebookActivityPreemption,
            registerFacebookActivityPreemptionHandler,
            waitForFacebookActivityUnlock,
            runWithFacebookActivityLock,
        });
    }

    const factoryApi = {
        FACEBOOK_ACTIVITY_OWNERS,
        FACEBOOK_ACTIVITY_STALE_MS,
        FACEBOOK_ACTIVITY_HEARTBEAT_MS,
        FACEBOOK_ACTIVITY_PREEMPT_WAIT_MS,
        createFacebookActivityLock,
    };
    global.SafePostFacebookActivityLockFactory = Object.freeze(factoryApi);
    global.SafePostFacebookActivityLock = createFacebookActivityLock(global.ExtStorage);
})(typeof globalThis !== 'undefined' ? globalThis : this);
