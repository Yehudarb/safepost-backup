'use strict';

const packageJson = require('../../package.json');

const HEALTH_TIMEOUT_MS = 2500;
const PROCESSING_STUCK_MS = 10 * 60 * 1000;
const WORKER_STALE_MS = 5 * 60 * 1000;
const RETRY_OVERDUE_MS = 30 * 60 * 1000;
const RECENT_RETRY_MS = 15 * 60 * 1000;
// The schema default is 3 and application code never overrides max_attempts.
const JOB_MAX_ATTEMPTS = 3;

function withAbortSignal(query, signal) {
    return signal && typeof query.abortSignal === 'function' ? query.abortSignal(signal) : query;
}

async function queryResult(query, signal) {
    const result = await withAbortSignal(query, signal);
    if (result.error) {
        const error = new Error('Database health query failed.');
        error.code = 'HEALTH_DATABASE_QUERY_FAILED';
        throw error;
    }
    return result;
}

function countValue(result) {
    return Number.isFinite(result.count) ? result.count : 0;
}

function createSupabaseHealthReader(database) {
    return {
        async probe(signal) {
            await queryResult(database.from('workspaces').select('id').limit(1), signal);
        },

        async queueDepth(signal) {
            return countValue(await queryResult(database.from('posts')
                .select('id', { count: 'exact', head: true })
                .in('status', ['PENDING', 'SCHEDULED', 'SENT']), signal));
        },

        async processingCount(signal) {
            return countValue(await queryResult(database.from('posts')
                .select('id', { count: 'exact', head: true })
                .eq('status', 'PROCESSING'), signal));
        },

        async processingOver10m(signal, nowMs) {
            const cutoff = new Date(nowMs - PROCESSING_STUCK_MS).toISOString();
            return countValue(await queryResult(database.from('posts')
                .select('id', { count: 'exact', head: true })
                .eq('status', 'PROCESSING')
                .or(`claimed_at.lt.${cutoff},and(claimed_at.is.null,created_at.lt.${cutoff})`), signal));
        },

        async oldestProcessingClaimedAt(signal) {
            // Legacy claim paths predate claimed_at. For those rows, created_at
            // is the only persistent lower bound for how long they have run.
            const [claimed, legacy] = await Promise.all([
                queryResult(database.from('posts')
                    .select('claimed_at')
                    .eq('status', 'PROCESSING')
                    .not('claimed_at', 'is', null)
                    .order('claimed_at', { ascending: true })
                    .limit(1), signal),
                queryResult(database.from('posts')
                    .select('created_at')
                    .eq('status', 'PROCESSING')
                    .is('claimed_at', null)
                    .order('created_at', { ascending: true })
                    .limit(1), signal),
            ]);
            const candidates = [claimed.data?.[0]?.claimed_at, legacy.data?.[0]?.created_at]
                .filter(Boolean)
                .sort((a, b) => new Date(a).getTime() - new Date(b).getTime());
            return candidates[0] || null;
        },

        async onlineWorkers(signal, nowMs) {
            const cutoff = new Date(nowMs - WORKER_STALE_MS).toISOString();
            return countValue(await queryResult(database.from('browser_workers')
                .select('id', { count: 'exact', head: true })
                .is('revoked_at', null)
                .gte('last_seen_at', cutoff), signal));
        },

        async staleWorkers(signal, nowMs) {
            const cutoff = new Date(nowMs - WORKER_STALE_MS).toISOString();
            return countValue(await queryResult(database.from('browser_workers')
                .select('id', { count: 'exact', head: true })
                .is('revoked_at', null)
                .or(`last_seen_at.is.null,last_seen_at.lt.${cutoff}`), signal));
        },

        async jobsAtMaxAttempts(signal) {
            return countValue(await queryResult(database.from('posts')
                .select('id', { count: 'exact', head: true })
                .eq('status', 'FAILED')
                .eq('max_attempts', JOB_MAX_ATTEMPTS)
                .gte('attempt_count', JOB_MAX_ATTEMPTS), signal));
        },

        async retryableOverdue30m(signal, nowMs) {
            const cutoff = new Date(nowMs - RETRY_OVERDUE_MS).toISOString();
            return countValue(await queryResult(database.from('posts')
                .select('id', { count: 'exact', head: true })
                .in('status', ['PENDING', 'SENT'])
                .gt('attempt_count', 0)
                .lt('next_attempt_at', cutoff), signal));
        },

        async recentRetries15m(signal, nowMs) {
            const cutoff = new Date(nowMs - RECENT_RETRY_MS).toISOString();
            return countValue(await queryResult(database.from('posts')
                .select('id', { count: 'exact', head: true })
                .gte('attempt_count', 2)
                .gte('last_attempt_at', cutoff), signal));
        },
    };
}

function applicationInfo(env = process.env) {
    const commit = env.RENDER_GIT_COMMIT || env.SOURCE_VERSION || env.GIT_COMMIT_SHA || null;
    return {
        version: env.APP_VERSION || packageJson.version,
        commit_sha: commit ? String(commit).slice(0, 40) : null,
    };
}

function emptyOperationalFields() {
    return {
        queue_depth: null,
        processing_jobs: null,
        processing_over_10m: null,
        oldest_processing_age_seconds: null,
        online_workers: null,
        stale_workers: null,
        jobs_at_max_attempts: null,
        retryable_overdue_30m: null,
        recent_retries_15m: null,
    };
}

function degradedResult({ nowMs, app, databaseConnected, databaseLatencyMs, reason }) {
    return {
        httpStatus: 503,
        body: {
            status: 'degraded',
            time: new Date(nowMs).toISOString(),
            supabase: databaseConnected,
            database: {
                status: databaseConnected ? 'metrics_unavailable' : 'unavailable',
                latency_ms: databaseLatencyMs,
            },
            application: app,
            ...emptyOperationalFields(),
            reason,
        },
    };
}

async function collectHealthSnapshot(reader, {
    timeoutMs = HEALTH_TIMEOUT_MS,
    nowMs = Date.now(),
    app = applicationInfo(),
} = {}) {
    const controller = new AbortController();
    let databaseConnected = false;
    let databaseLatencyMs = null;
    let timer;

    const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => {
            controller.abort();
            const error = new Error('Health check timed out.');
            error.code = 'HEALTH_TIMEOUT';
            reject(error);
        }, Math.max(1, timeoutMs));
    });

    const operation = (async () => {
        const probeStarted = Date.now();
        await reader.probe(controller.signal);
        databaseConnected = true;
        databaseLatencyMs = Math.max(0, Date.now() - probeStarted);

        const [
            queueDepth,
            processingJobs,
            processingOver10m,
            oldestProcessingClaimedAt,
            onlineWorkers,
            staleWorkers,
            jobsAtMaxAttempts,
            retryableOverdue30m,
            recentRetries15m,
        ] = await Promise.all([
            reader.queueDepth(controller.signal, nowMs),
            reader.processingCount(controller.signal, nowMs),
            reader.processingOver10m(controller.signal, nowMs),
            reader.oldestProcessingClaimedAt(controller.signal, nowMs),
            reader.onlineWorkers(controller.signal, nowMs),
            reader.staleWorkers(controller.signal, nowMs),
            reader.jobsAtMaxAttempts(controller.signal, nowMs),
            reader.retryableOverdue30m(controller.signal, nowMs),
            reader.recentRetries15m(controller.signal, nowMs),
        ]);

        const oldestMs = oldestProcessingClaimedAt ? new Date(oldestProcessingClaimedAt).getTime() : NaN;
        return {
            httpStatus: 200,
            body: {
                status: 'healthy',
                time: new Date(nowMs).toISOString(),
                supabase: true,
                database: { status: 'healthy', latency_ms: databaseLatencyMs },
                application: app,
                queue_depth: queueDepth,
                processing_jobs: processingJobs,
                processing_over_10m: processingOver10m,
                oldest_processing_age_seconds: Number.isFinite(oldestMs)
                    ? Math.max(0, Math.floor((nowMs - oldestMs) / 1000))
                    : null,
                online_workers: onlineWorkers,
                stale_workers: staleWorkers,
                jobs_at_max_attempts: jobsAtMaxAttempts,
                retryable_overdue_30m: retryableOverdue30m,
                recent_retries_15m: recentRetries15m,
            },
        };
    })();

    try {
        return await Promise.race([operation, timeout]);
    } catch (error) {
        return degradedResult({
            nowMs,
            app,
            databaseConnected,
            databaseLatencyMs,
            reason: error?.code === 'HEALTH_TIMEOUT' ? 'database_timeout' : 'database_unavailable',
        });
    } finally {
        clearTimeout(timer);
    }
}

module.exports = {
    HEALTH_TIMEOUT_MS,
    PROCESSING_STUCK_MS,
    WORKER_STALE_MS,
    RETRY_OVERDUE_MS,
    RECENT_RETRY_MS,
    JOB_MAX_ATTEMPTS,
    createSupabaseHealthReader,
    collectHealthSnapshot,
    applicationInfo,
};
