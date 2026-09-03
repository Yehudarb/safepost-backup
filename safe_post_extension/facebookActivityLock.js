(function initFacebookActivityLock(global) {
    'use strict';

    const FACEBOOK_ACTIVITY_OWNERS = Object.freeze({
        PUBLISHING: 'publishing',
        GROUP_SYNC: 'group_sync',
        ENGAGEMENT: 'engagement',
    });
    const VALID_OWNERS = new Set(Object.values(FACEBOOK_ACTIVITY_OWNERS));

    // Group sync can legitimately run for six minutes. A ten-minute heartbeat
    // window recovers an abandoned MV3 worker, while the independent 20-minute
    // cap prevents a hung operation from keeping itself alive forever.
    const FACEBOOK_ACTIVITY_STALE_MS = 10 * 60 * 1000;
    const FACEBOOK_ACTIVITY_MAX_LIFETIME_MS = 20 * 60 * 1000;
    const FACEBOOK_ACTIVITY_HEARTBEAT_MS = 30 * 1000;
    const FACEBOOK_ACTIVITY_PREEMPT_WAIT_MS = 30 * 1000;
    const FACEBOOK_ACTIVITY_PREEMPT_HANDLER_TIMEOUT_MS = 5 * 1000;

    function createFacebookActivityLock(storage, options = {}) {
        if (!storage) throw new Error('Facebook activity storage is required.');

        const now = typeof options.now === 'function' ? options.now : () => Date.now();
        const sleep = typeof options.sleep === 'function'
            ? options.sleep
            : (ms) => new Promise(resolve => setTimeout(resolve, ms));
        const logger = options.logger || console;
        const tabs = options.tabs === undefined ? global.chrome?.tabs : options.tabs;
        const staleMs = options.staleMs || FACEBOOK_ACTIVITY_STALE_MS;
        const maxLifetimeMs = options.maxLifetimeMs || FACEBOOK_ACTIVITY_MAX_LIFETIME_MS;
        const preemptionHandlerTimeoutMs = options.preemptionHandlerTimeoutMs ||
            FACEBOOK_ACTIVITY_PREEMPT_HANDLER_TIMEOUT_MS;
        const handlers = new Map();
        let mutationQueue = Promise.resolve();

        function log(event, details = {}) {
            const warnings = new Set([
                'FACEBOOK_ACTIVITY_LOCK_TIMEOUT',
                'FACEBOOK_ACTIVITY_ABSOLUTE_TIMEOUT',
                'FACEBOOK_ACTIVITY_RECOVERY_BLOCKED',
                'FACEBOOK_ACTIVITY_PREEMPT_HANDLER_TIMEOUT',
                'FACEBOOK_ACTIVITY_PREEMPT_HANDLER_FAILED',
            ]);
            const method = warnings.has(event) ? 'warn' : 'log';
            const output = typeof logger[method] === 'function' ? logger[method] : logger.log;
            if (typeof output === 'function') output.call(logger, event, details);
        }

        function validateIdentity(owner, operationId) {
            if (!VALID_OWNERS.has(owner)) throw new Error(`Invalid Facebook activity owner: ${owner}`);
            if (typeof operationId !== 'string' || !operationId.trim()) {
                throw new Error('Facebook activity operationId is required.');
            }
        }

        function normalizeJobId(jobId) {
            if (jobId == null) return null;
            const value = String(jobId);
            return /^[1-9]\d*$/.test(value) ? value : null;
        }

        function normalizeLock(value) {
            if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
            if (!VALID_OWNERS.has(value.owner)) return null;
            if (typeof value.operationId !== 'string' || !value.operationId) return null;
            return {
                owner: value.owner,
                operationId: value.operationId,
                jobId: normalizeJobId(value.jobId),
                tabId: Number.isInteger(value.tabId) && value.tabId > 0 ? value.tabId : null,
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

        function isFacebookActivityLockAbsoluteExpired(lock, at = now()) {
            const normalized = normalizeLock(lock);
            if (!normalized) return Boolean(lock);
            return !Number.isFinite(normalized.acquiredAt) ||
                at - normalized.acquiredAt > maxLifetimeMs;
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

        function isMissingTabError(error) {
            return /no tab|not found|invalid tab/i.test(String(error?.message || error || ''));
        }

        async function reconcileOwnedTab(lock) {
            if (lock.tabId == null) return { reconciled: true, tab: 'none' };
            if (!tabs || typeof tabs.get !== 'function' || typeof tabs.remove !== 'function') {
                return { reconciled: false, reason: 'tabs-api-unavailable' };
            }

            try {
                await tabs.get(lock.tabId);
            } catch (error) {
                if (isMissingTabError(error)) return { reconciled: true, tab: 'missing' };
                return { reconciled: false, reason: 'tab-inspection-failed' };
            }

            try {
                await tabs.remove(lock.tabId);
                return { reconciled: true, tab: 'closed' };
            } catch (error) {
                if (isMissingTabError(error)) return { reconciled: true, tab: 'missing' };
                return { reconciled: false, reason: 'tab-close-failed' };
            }
        }

        async function recoverLock(lock, reason) {
            const tab = await reconcileOwnedTab(lock);
            if (!tab.reconciled) {
                log('FACEBOOK_ACTIVITY_RECOVERY_BLOCKED', {
                    owner: lock.owner,
                    operationId: lock.operationId,
                    tabId: lock.tabId,
                    reason: tab.reason,
                });
                return false;
            }

            const current = await readLock();
            if (!sameIdentity(current, lock.owner, lock.operationId)) return false;
            await storage.clearFacebookActivityLock();
            await clearPreemptionFor(lock);
            const recoveryEvent = reason === 'absolute-expired'
                ? 'FACEBOOK_ACTIVITY_ABSOLUTE_TIMEOUT'
                : reason === 'restart-recovered'
                    ? 'FACEBOOK_ACTIVITY_RESTART_RECOVERED'
                    : 'FACEBOOK_ACTIVITY_STALE_RECOVERED';
            log(recoveryEvent, {
                owner: lock.owner,
                operationId: lock.operationId,
                tabId: lock.tabId,
                tabRecovery: tab.tab,
            });
            return true;
        }

        async function recoverExpiredLock(lock) {
            if (isFacebookActivityLockAbsoluteExpired(lock)) {
                return recoverLock(lock, 'absolute-expired');
            }
            if (isFacebookActivityLockStale(lock)) {
                return recoverLock(lock, 'heartbeat-stale');
            }
            return false;
        }

        async function recoverStaleFacebookActivityLock() {
            return serializeMutation(async () => {
                const lock = await readLock();
                if (!lock || (!isFacebookActivityLockStale(lock) &&
                    !isFacebookActivityLockAbsoluteExpired(lock))) return false;
                return recoverExpiredLock(lock);
            });
        }

        async function reconcileFacebookActivityLock({ recoverOrphanedGroupSync = false } = {}) {
            return serializeMutation(async () => {
                const lock = await readLock();
                if (!lock) return { recovered: false, reason: 'free' };

                const expired = isFacebookActivityLockAbsoluteExpired(lock) ||
                    isFacebookActivityLockStale(lock);
                const orphanedGroupSync = recoverOrphanedGroupSync &&
                    lock.owner === FACEBOOK_ACTIVITY_OWNERS.GROUP_SYNC;
                if (!expired && !orphanedGroupSync) {
                    return { recovered: false, reason: 'active', lock };
                }

                const recovered = expired
                    ? await recoverExpiredLock(lock)
                    : await recoverLock(lock, 'restart-recovered');
                return {
                    recovered,
                    reason: recovered ? (orphanedGroupSync ? 'orphaned-group-sync' : 'expired') : 'recovery-blocked',
                    lock: recovered ? null : await readLock(),
                };
            });
        }

        async function getFacebookActivityLock() {
            return readLock();
        }

        async function acquireFacebookActivityLock(owner, operationId) {
            validateIdentity(owner, operationId);
            return serializeMutation(async () => {
                let current = await readLock();
                if (current && (isFacebookActivityLockStale(current) ||
                    isFacebookActivityLockAbsoluteExpired(current))) {
                    const recovered = await recoverExpiredLock(current);
                    if (!recovered) {
                        return { acquired: false, reason: 'recovery-blocked', holder: current };
                    }
                    current = null;
                }

                if (current && !sameIdentity(current, owner, operationId)) {
                    return { acquired: false, reason: 'busy', holder: current };
                }

                const timestamp = now();
                const lock = current
                    ? { ...current, heartbeatAt: timestamp }
                    : {
                        owner,
                        operationId,
                        jobId: null,
                        tabId: null,
                        acquiredAt: timestamp,
                        heartbeatAt: timestamp,
                    };
                await storage.writeFacebookActivityLock(lock);

                // Mutations are serialized only within this service-worker/module
                // instance. chrome.storage is not transactional; popup, offscreen,
                // or other contexts must not mutate this lock independently without
                // a stronger cross-context coordination mechanism.
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
                if (isFacebookActivityLockAbsoluteExpired(current)) {
                    await recoverLock(current, 'absolute-expired');
                    return false;
                }
                const refreshed = { ...current, heartbeatAt: now() };
                await storage.writeFacebookActivityLock(refreshed);
                const verified = await readLock();
                const ok = sameIdentity(verified, owner, operationId) &&
                    verified.heartbeatAt === refreshed.heartbeatAt;
                if (ok) log('FACEBOOK_ACTIVITY_LOCK_REFRESHED', { owner, operationId });
                return ok;
            });
        }

        async function attachFacebookActivityTab(owner, operationId, tabId) {
            validateIdentity(owner, operationId);
            if (!Number.isInteger(tabId) || tabId <= 0) return false;
            return serializeMutation(async () => {
                const current = await readLock();
                if (!sameIdentity(current, owner, operationId)) return false;
                const updated = { ...current, tabId, heartbeatAt: now() };
                await storage.writeFacebookActivityLock(updated);
                const verified = await readLock();
                return sameIdentity(verified, owner, operationId) && verified.tabId === tabId;
            });
        }

        async function attachFacebookActivityJob(owner, operationId, jobId) {
            validateIdentity(owner, operationId);
            if (owner !== FACEBOOK_ACTIVITY_OWNERS.PUBLISHING) return false;
            const normalizedJobId = normalizeJobId(jobId);
            if (!normalizedJobId) return false;
            return serializeMutation(async () => {
                const current = await readLock();
                if (!sameIdentity(current, owner, operationId)) return false;
                if (current.jobId != null && current.jobId !== normalizedJobId) return false;
                const updated = { ...current, jobId: normalizedJobId, heartbeatAt: now() };
                await storage.writeFacebookActivityLock(updated);
                const verified = await readLock();
                return sameIdentity(verified, owner, operationId) &&
                    verified.jobId === normalizedJobId;
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
            return Boolean(await readLock());
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
                if (isFacebookActivityLockStale(current) ||
                    isFacebookActivityLockAbsoluteExpired(current)) {
                    const recovered = await recoverExpiredLock(current);
                    return recovered
                        ? { requested: false, reason: 'stale-recovered' }
                        : { requested: false, reason: 'recovery-blocked', holder: current };
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
            if (!handler) return { ...outcome, acknowledged: false, failure: 'handler-unavailable' };

            let timer = null;
            try {
                const handlerResult = Promise.resolve().then(() => handler(outcome.request));
                const timeout = new Promise(resolve => {
                    timer = setTimeout(() => resolve({ timedOut: true }),
                        Math.max(1, preemptionHandlerTimeoutMs));
                });
                const result = await Promise.race([
                    handlerResult.then(value => ({ value })),
                    timeout,
                ]);
                if (result.timedOut) {
                    log('FACEBOOK_ACTIVITY_PREEMPT_HANDLER_TIMEOUT', {
                        owner: outcome.request.targetOwner,
                        operationId: outcome.request.targetOperationId,
                    });
                    return { ...outcome, acknowledged: false, failure: 'handler-timeout' };
                }

                const acknowledged = result.value !== false;
                if (acknowledged) {
                    log('FACEBOOK_ACTIVITY_PREEMPTED', {
                        owner: outcome.request.targetOwner,
                        operationId: outcome.request.targetOperationId,
                        requestedBy: requesterOwner,
                    });
                }
                return { ...outcome, acknowledged };
            } catch (error) {
                log('FACEBOOK_ACTIVITY_PREEMPT_HANDLER_FAILED', {
                    owner: outcome.request.targetOwner,
                    operationId: outcome.request.targetOperationId,
                    error: error?.message || String(error),
                });
                return { ...outcome, acknowledged: false, failure: 'handler-error' };
            } finally {
                if (timer) clearTimeout(timer);
            }
        }

        async function waitForFacebookActivityUnlock({
            timeoutMs = FACEBOOK_ACTIVITY_PREEMPT_WAIT_MS,
            pollIntervalMs = 100,
        } = {}) {
            const deadline = now() + Math.max(1, timeoutMs);
            while (now() < deadline) {
                const lock = await readLock();
                if (!lock) return true;
                if (isFacebookActivityLockStale(lock) ||
                    isFacebookActivityLockAbsoluteExpired(lock)) {
                    await recoverStaleFacebookActivityLock();
                    if (!(await readLock())) return true;
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
            attachFacebookActivityTab,
            attachFacebookActivityJob,
            releaseFacebookActivityLock,
            isFacebookActivityBusy,
            isFacebookActivityLockStale,
            isFacebookActivityLockAbsoluteExpired,
            recoverStaleFacebookActivityLock,
            reconcileFacebookActivityLock,
            requestFacebookActivityPreemption,
            registerFacebookActivityPreemptionHandler,
            waitForFacebookActivityUnlock,
            runWithFacebookActivityLock,
        });
    }

    const factoryApi = {
        FACEBOOK_ACTIVITY_OWNERS,
        FACEBOOK_ACTIVITY_STALE_MS,
        FACEBOOK_ACTIVITY_MAX_LIFETIME_MS,
        FACEBOOK_ACTIVITY_HEARTBEAT_MS,
        FACEBOOK_ACTIVITY_PREEMPT_WAIT_MS,
        FACEBOOK_ACTIVITY_PREEMPT_HANDLER_TIMEOUT_MS,
        createFacebookActivityLock,
    };
    global.SafePostFacebookActivityLockFactory = Object.freeze(factoryApi);
    global.SafePostFacebookActivityLock = createFacebookActivityLock(global.ExtStorage);
})(typeof globalThis !== 'undefined' ? globalThis : this);
