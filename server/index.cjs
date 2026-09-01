const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const Joi = require('joi');
const { supabase } = require('./supabaseClient.cjs');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const Anthropic = require('@anthropic-ai/sdk');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');
const multer = require('multer');

// --- HEBREW SYMBOL DICTIONARY FOR AUTO-SPIN ---
const HEBREW_SYNONYMS = {
    'היי': ['שלום', 'אהלן', 'בוקר טוב', 'ערב טוב', 'היי'],
    'שלום': ['היי', 'אהלן', 'מה קורה', 'שלום'],
    'מדהים': ['נפלא', 'מטורף', 'נדיר', 'חובה', 'מעולה', 'מדהים'],
    'מטורף': ['מדהים', 'נדיר', 'חזק', 'משוגע', 'נקי', 'מטורף'],
    'קבלו': ['תראו', 'תעיפו מבט', 'שימו לב', 'תראו מה מצאתי', 'קבלו'],
    'דיל': ['מבצע', 'הטבה', 'קופון', 'הזדמנות', 'דיל'],
    'מבצע': ['דיל', 'הטבה', 'הזדמנות', 'סייל', 'מבצע'],
    'חלומי': ['מרגש', 'מושקע', 'איכותי', 'נדיר', 'חלומי'],
    'מהרו': ['אל תחכו', 'צריך להזדרז', 'מומלץ לתפוס מהר', 'מהרו'],
    'בלעדי': ['בלעדי לקבוצה', 'רק אצלנו', 'משהו מיוחד', 'בלעדי'],
    'מחיר': ['עלות', 'מחיר פצצה', 'מחיר שוק', 'מחיר'],
    'מוצר': ['פריט', 'דגם', 'מציאה', 'מוצר'],
};

function spinText(text, useAutoSynonyms = true) {
    if (!text) return text;
    
    // 1. Process Spintax {a|b|c}
    let spun = text.replace(/\{([^{}]*)\}/g, (match, options) => {
        const choices = options.split('|');
        return choices[Math.floor(Math.random() * choices.length)];
    });

    // 2. Process Auto Synonyms (simple word-based)
    if (useAutoSynonyms) {
        Object.keys(HEBREW_SYNONYMS).forEach(word => {
            const regex = new RegExp(`\\b${word}\\b`, 'g');
            // 20% chance to swap if found
            if (Math.random() < 0.3) {
                const choices = HEBREW_SYNONYMS[word];
                spun = spun.replace(regex, choices[Math.floor(Math.random() * choices.length)]);
            }
        });
    }

    return spun;
}

// Resolves {{TOKEN}} placeholders using data already fetched for the campaign.
// Must run BEFORE spinText: spinText's spintax regex /\{([^{}]*)\}/g matches
// the INNER {GROUP_NAME} of an unresolved {{GROUP_NAME}} first (since [^{}]*
// stops before the second brace), treats "GROUP_NAME" as a single spintax
// choice, and collapses the token to a single-brace {GROUP_NAME} — permanently
// corrupting it before placeholder resolution ever runs. Resolve first, spin second.
function resolvePlaceholders(text, group, facebookUser) {
    if (!text) return text;
    return text
        .replace(/\{\{\s*GROUP_NAME\s*\}\}/gi, group?.name || '')
        .replace(/\{\{\s*GROUP_URL\s*\}\}/gi, group?.url || '')
        .replace(/\{\{\s*DATE\s*\}\}/gi, new Date().toLocaleDateString('he-IL'))
        .replace(/\{\{\s*FB_USER\s*\}\}/gi, facebookUser || '');
}

// Reduces a flat posts array into per-group {success, failed, cancelled,
// consecutiveFailures}. consecutiveFailures counts FAILED/CANCELLED rows from
// the most recent post backwards, stopping at the first SUCCESS — a "cold
// streak" signal shared by the health score and the throttle suggestion.
// Pure function: caller decides date range / app_source scoping via the
// `posts` array it passes in, so /api/groups and /api/analytics can each
// scope their own query while sharing this one aggregation.
function buildGroupHealthStats(posts) {
    const stats = {};
    (posts || []).forEach(p => {
        if (!stats[p.group_id]) stats[p.group_id] = { success: 0, failed: 0, cancelled: 0, posts: [] };
        const s = stats[p.group_id];
        if (['SUCCESS', 'COMPLETED'].includes(p.status)) s.success++;
        else if (p.status === 'FAILED') s.failed++;
        else if (p.status === 'CANCELLED') s.cancelled++;
        s.posts.push(p);
    });
    Object.values(stats).forEach(s => {
        const sorted = [...s.posts].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        let streak = 0;
        for (const p of sorted) {
            if (p.status === 'FAILED' || p.status === 'CANCELLED') streak++;
            else if (['SUCCESS', 'COMPLETED'].includes(p.status)) break;
        }
        s.consecutiveFailures = streak;
        delete s.posts; // don't leak raw rows to callers
    });
    return stats;
}

// Derives a 0-100 health score from one group's aggregated stats, or null if
// the group has no post history yet (don't fabricate a score from nothing).
// Follows the same "derived field, not a stored column" pattern as
// requires_moderation in GET /api/groups.
function computeGroupHealth(stats) {
    const total = (stats?.success || 0) + (stats?.failed || 0) + (stats?.cancelled || 0);
    if (total === 0) return null;
    const successRate = stats.success / total;
    const modPenalty = stats.cancelled > 0 ? 0.3 : 0;
    const failPenalty = Math.min(stats.failed / total, 0.5);
    const streakPenalty = (stats.consecutiveFailures || 0) >= 3 ? 0.2 : 0;
    return Math.round(Math.max(0, successRate - modPenalty - failPenalty - streakPenalty) * 100);
}

// Manual per-group timezone bias (Item 6). Facebook exposes no group
// location/timezone, so this only applies when the operator has explicitly
// tagged a group (groups.timezone, migration 0009) — untagged groups are
// completely unaffected. No timezone library needed: Intl.DateTimeFormat with
// a timeZone option reads the local hour for any IANA zone string natively.
const POST_WINDOW = { start: 8, end: 22 }; // 08:00–22:00 local
function localHour(date, tz) {
    try {
        return parseInt(new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hour12: false }).format(date), 10);
    } catch {
        return null; // invalid/unsupported IANA string — caller treats this as "don't bias"
    }
}
function biasIntoWindow(date, tz) {
    const hour = localHour(date, tz);
    if (hour === null) return date; // fail safe: unknown tz never blocks scheduling
    let d = date, guard = 0;
    while (guard++ < 48 && (localHour(d, tz) < POST_WINDOW.start || localHour(d, tz) >= POST_WINDOW.end)) {
        d = new Date(d.getTime() + 3600000); // nudge forward one hour at a time
    }
    return d;
}

// Ensure uploads directory exists
const UPLOAD_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR);
}

// Multer Memory Storage Configuration.
//
// memoryStorage buffers the WHOLE file in RAM, so this limit is a memory
// budget, not just a policy: two concurrent uploads at the limit cost twice
// this much. Raise UPLOAD_MAX_MB only alongside the container's memory, and
// note the storage bucket enforces its own ceiling independently — when that
// is the lower of the two, its error is now surfaced verbatim.
const UPLOAD_MAX_MB = Number(process.env.UPLOAD_MAX_MB) || 50;

const storage = multer.memoryStorage();

const upload = multer({
    storage: storage,
    limits: { fileSize: UPLOAD_MAX_MB * 1024 * 1024 }
});

const ALLOWED_ORIGINS = [
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'http://0.0.0.0:5173',
    'http://localhost:3001',
    'http://127.0.0.1:3001',
    'http://0.0.0.0:3001',
    'https://safepost-backup.vercel.app',
    'https://safepost-backup.onrender.com',
    'https://www.facebook.com',
    'https://web.facebook.com'
];

function isLocalOrigin(origin) {
    if (!origin || typeof origin !== 'string') return false;
    try {
        const url = new URL(origin);
        return ['http:', 'https:'].includes(url.protocol) && (
            url.hostname === 'localhost' ||
            url.hostname === '127.0.0.1' ||
            url.hostname === '0.0.0.0' ||
            /^10\./.test(url.hostname) ||
            /^192\.168\./.test(url.hostname) ||
            /^172\.(1[6-9]|2\d|3[01])\./.test(url.hostname)
        );
    } catch (_) {
        return false;
    }
}

function isAllowedOrigin(origin) {
    return !!origin && (
        ALLOWED_ORIGINS.includes(origin) ||
        origin.startsWith('chrome-extension://') ||
        isLocalOrigin(origin)
    );
}

const app = express();

// Trust Render's reverse proxy so express-rate-limit can read real client IPs
app.set('trust proxy', 1);

// Ensure UTF-8 charset for all JSON responses
app.use((req, res, next) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    next();
});

// Security headers — applied immediately after app creation
app.use(helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'"],
            styleSrc: ["'self'"],
        }
    }
}));

// Standard limiter — 500 requests per minute per IP (dashboard + polling)
const apiLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 500,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests. Please try again later.' }
});

// Strict limiter — 20 requests per 15 minutes (upload/AI — expensive endpoints)
const strictLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests to this endpoint. Please slow down.' }
});

// ========== VALIDATION SCHEMAS ==========

// Schema for POST /api/posts (create tasks)
const postsSchema = Joi.object({
    group_ids: Joi.array().items(Joi.string()).required().min(1).messages({
        'array.required': 'group_ids is required and must be an array',
        'array.min': 'group_ids must have at least 1 item'
    }),
    content: Joi.string().optional().allow('').max(50000).messages({
        'string.max': 'Content cannot exceed 50000 characters'
    }),
    schedule: Joi.date().optional(),
    media_url: Joi.string().optional().allow(null).uri({ scheme: ['http', 'https'] }),
    media_files: Joi.array().items(
        Joi.object({
            filePath: Joi.string().required(),
            fileName: Joi.string().optional(),
            size: Joi.number().optional()
        })
    ).optional(),
    ai_spin: Joi.boolean().optional().default(false),
    facebook_user: Joi.string().optional().allow(null).max(500),
    // A-B testing: when present, each group gets one variant round-robin
    // instead of the single shared `content` field. Requires migration 0009
    // (posts.variant_label) to be applied before this is used.
    content_variants: Joi.array().items(Joi.object({
        label: Joi.string().max(50).required(),
        content: Joi.string().max(50000).required()
    })).min(1).optional()
});

// Schema for POST /api/tasks/update-status
const updateStatusSchema = Joi.object({
    taskId: Joi.alternatives(Joi.string(), Joi.number()).required().messages({
        'any.required': 'taskId is required'
    }),
    status: Joi.string().required().valid('PENDING', 'SENT', 'PROCESSING', 'SUCCESS', 'FAILED', 'CANCELLED', 'LOG').messages({
        'any.required': 'status is required',
        'any.only': 'status must be one of: PENDING, SENT, PROCESSING, SUCCESS, FAILED, CANCELLED, LOG'
    }),
    failure_reason: Joi.string().optional().allow(null).max(1000),
    proof_url: Joi.string().optional().allow(null).uri({ scheme: ['http', 'https'] }),
    metadata: Joi.object().optional()
}).unknown(true);

// Schema for PATCH /api/tasks/:id/status
// NOTE: the extension (content.js/background.js) includes taskId + metadata in the
// body of every report (including terminal SUCCESS/FAILED and LOG traces). These
// must be permitted or Joi rejects the whole report with 400 — which silently
// leaves tasks stuck in PROCESSING. `.unknown(true)` tolerates any extra fields.
const patchStatusSchema = Joi.object({
    taskId: Joi.alternatives(Joi.string(), Joi.number()).optional(),
    status: Joi.string().required().valid('PENDING', 'SENT', 'PROCESSING', 'SUCCESS', 'FAILED', 'CANCELLED', 'LOG').messages({
        'any.required': 'status is required',
        'any.only': 'status must be one of: PENDING, SENT, PROCESSING, SUCCESS, FAILED, CANCELLED, LOG'
    }),
    failure_reason: Joi.string().optional().allow(null).max(1000),
    error: Joi.string().optional().allow(null).max(1000),
    completed_at: Joi.date().optional(),
    proof_url: Joi.string().optional().allow(null).uri({ scheme: ['http', 'https'] }),
    metadata: Joi.object().optional()
}).unknown(true);

// Validation middleware
const validate = (schema) => {
    return (req, res, next) => {
        const { error, value } = schema.validate(req.body, { abortEarly: false });
        if (error) {
            const messages = error.details.map(d => `${d.path.join('.')}: ${d.message}`).join('; ');
            console.error(`[VALIDATION] ${messages}`);
            return res.status(400).json({ error: 'Validation failed', details: messages });
        }
        req.validated = value;
        next();
    };
};

// Retry governor for stuck-dispatch recovery (SENT handshake timeout / stale heartbeat).
// Two competing goals here:
//   • Fast recovery when the extension was momentarily busy (MV3 service-worker
//     suspend, mid-sync, tab switch) — the vast majority of "stuck" cases.
//   • Slow re-dispatch when the group itself is broken/rate-limited so we don't
//     hammer Facebook and get the account checkpointed.
// Solution: fast initial retries (extension usually just needs a moment), then
// escalate to the long backoffs only if it keeps failing.
const MAX_DISPATCH_RETRIES = 5;
function dispatchBackoffMs(attempt) {
    if (attempt <= 1) return 30000;   // 30s — likely just needs a moment
    if (attempt === 2) return 90000;  // 1.5min
    if (attempt === 3) return 300000; // 5min — now assume something's actually wrong
    if (attempt === 4) return 600000; // 10min
    return 15 * 60 * 1000;            // 15min cap
}
// The extension has ~15s of grace to acknowledge a SENT job before we consider
// the handshake failed. Was 45s — that was too aggressive; MV3 service workers
// can idle briefly and miss the SSE tick, but the /api/jobs/next alarm is on a
// 60-second cadence so 90s gives it a full poll cycle plus buffer.
const SENT_HANDSHAKE_TIMEOUT_MS = 90000;

const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: function(origin, callback) {
            callback(null, true); // Allow all origins for WebSocket
        },
        methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
        credentials: true,
        allowEIO3: true
    },
    transports: ['websocket', 'polling'],
    maxHttpBufferSize: 50 * 1024 * 1024
});

// --- Phase 3: authenticated Socket.IO handshake (permissive during transition) ---
// Validates the access token if present and joins the client to its workspace
// room. Stays permissive (never rejects) so anonymous/legacy clients keep working
// until the auth cutover; emits are tightened to rooms alongside route scoping.
const {
    resolveUser,
    requireAuth,
    requireWorkspaceAccess,
    denyDemo,
    scopeToWorkspace,
    workspaceFields,
} = require('./middleware/auth.cjs');
const {
    AUTH_ENFORCED,
    WORKER_AUTH_ENFORCED,
    isSecureRuntime,
    assertSecureRuntimeConfig,
} = require('./lib/runtimeMode.cjs');
const { resetDemoWorkspace } = require('./demo/seed.cjs');
const {
    generateDeviceToken,
    hashToken,
    generatePairingCode,
    requireWorker,
    optionalWorker,
} = require('./middleware/worker.cjs');
const {
    claimNextJob,
    extendLock,
    reportJobStatus,
    sweepExpiredLocks,
    sweepMissedSchedules,
} = require('./lib/queue.cjs');
const {
    createTenantEventLog,
    selectWorkspaceEventLogs,
} = require('./lib/logIsolation.cjs');
// Convenience: dashboard routes require auth + a resolved workspace.
const dashboardAuth = [requireAuth, requireWorkspaceAccess];
assertSecureRuntimeConfig();
io.use(async (socket, next) => {
    try {
        const token = socket.handshake.auth?.token || null;
        const wsId = socket.handshake.auth?.workspaceId || null;
        if (token) {
            const user = await resolveUser(token);
            if (user) {
                socket.data.userId = user.id;
                if (wsId) {
                    const { data } = await supabase
                        .from('workspace_members')
                        .select('workspace_id')
                        .eq('user_id', user.id)
                        .eq('workspace_id', wsId)
                        .limit(1);
                    if (data && data.length) socket.data.workspaceId = wsId;
                }
            }
        }
        if (AUTH_ENFORCED && isSecureRuntime && !socket.data.userId) {
            return next(new Error('Authentication required.'));
        }
    } catch (e) {
        if (AUTH_ENFORCED && isSecureRuntime) return next(new Error('Authentication required.'));
    }
    next();
});
io.on('connection', (socket) => {
    if (socket.data.workspaceId) socket.join(`ws:${socket.data.workspaceId}`);
});

const PORT = 3001;
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Idempotency Key Store (taskId -> Set of processed request hashes)
// This prevents duplicate status updates if the client retries with the same data
const idempotencyStore = new Map();

// Generate a hash for idempotency checking (taskId + status + reason)
function generateIdempotencyKey(taskId, status, failureReason = '') {
    const data = `${taskId}:${status}:${failureReason || ''}`;
    // Simple hash: just use data as-is for now (good enough for most cases)
    return data;
}

// Check if this exact request was already processed (within last 5 minutes)
function isIdempotentDuplicate(taskId, idempotencyKey) {
    if (!idempotencyStore.has(taskId)) {
        idempotencyStore.set(taskId, new Set());
    }
    const processedKeys = idempotencyStore.get(taskId);
    const isDuplicate = processedKeys.has(idempotencyKey);
    if (!isDuplicate) {
        processedKeys.add(idempotencyKey);
        // Clean up old entries after 5 minutes
        setTimeout(() => {
            processedKeys.delete(idempotencyKey);
        }, 5 * 60 * 1000);
    }
    return isDuplicate;
}
// --- PER-TENANT RUNTIME STATE ---
//
// All of this used to be a dozen module-level `let`s shared by every request.
// That is invisible while there is one tenant, but with several it means: one
// account's "Stop Worker" halts everyone; one account's Facebook identity
// overwrites another's and is served back by /api/profile/current; a sync
// request queued by one dashboard is consumed by another's extension; and the
// dashboard reports someone else's extension as connected.
//
// Now keyed by workspace id. The `null` key holds the legacy single-tenant
// state used whenever no workspace is resolved (unauthenticated/open mode),
// so behaviour with one tenant is exactly as before.
const tenantStates = new Map();

function tenantState(workspaceId) {
    const key = workspaceId || null;
    let state = tenantStates.get(key);
    if (!state) {
        state = {
            lastWorkerCheckin: null,
            lastWorkerVersion: 'UNKNOWN',
            lastWorkerOrigin: 'UNKNOWN',
            lastWorkerExtensionId: null,
            workerStopSignal: false,
            workerStopUntil: null,
            pendingSyncCommand: false,
            // The Facebook account the dashboard was viewing when it requested a
            // sync — a fallback for when the extension's group-scan tab could not
            // detect the logged-in account itself. Cleared once a sync uses it.
            pendingSyncFacebookUser: null,
            // Read by the dispatcher but never assigned anywhere, here or before
            // this refactor — kept so the check reads the same, not load-bearing.
            workerThrottleUntil: null,
            lastFacebookProfile: null,
            lastFacebookUser: null,
        };
        tenantStates.set(key, state);
    }
    return state;
}

// Which workspace the last dashboard-initiated sync was for. Unlike the state
// above this cannot be keyed by tenant, because the extension that answers the
// sync is unpaired in exactly the case where it is needed and so has no
// workspace of its own to look up. It is only consulted when nothing is paired
// — a paired worker's verified workspace always takes precedence.
let legacyPendingSyncWorkspaceId = null;

const sentTaskTimestamps = new Map();
const processingStartTimestamps = new Map();

// --- ULTRA-EARLY REQUEST LOGGER (MORGAN STYLE) ---
app.use((req, res, next) => {
    const start = Date.now();
    const id = Math.random().toString(36).substring(7);
    console.log(`[${id}] 📡 ${req.method} ${req.url} (Content-Type: ${req.headers['content-type'] || 'none'})`);
    res.on('finish', () => {
        const duration = Date.now() - start;
        console.log(`[${id}] 🏁 ${res.statusCode} (${duration}ms)`);
    });
    next();
});

// --- MANUAL CORS HEADERS (BEFORE ALL MIDDLEWARE) ---
app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (isAllowedOrigin(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Credentials', 'true');
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,PUT,DELETE,OPTIONS,HEAD');
    // This manual block answers OPTIONS itself (res.end below), so the cors()
    // package further down NEVER sees a preflight — this list is the effective
    // one and must stay in sync with it. The extension's content script calls the
    // API from origin https://www.facebook.com with x-device-token/x-worker-id,
    // which were missing here: every /api/profile/sync from content.js failed
    // preflight with "Request header field x-device-token is not allowed by
    // Access-Control-Allow-Headers". Background service-worker fetches bypass CORS
    // via host_permissions, which is why /api/groups/sync worked and this did not.
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,x-requested-with,x-workspace-id,x-device-token,x-worker-id,x-extension-key');
    res.setHeader('Access-Control-Max-Age', '86400');

    if (req.method === 'OPTIONS') {
        res.statusCode = 200;
        res.end();
        return;
    }
    next();
});

// Process Error Handlers
process.on('unhandledRejection', (reason, promise) => {
    console.error('🔥 UNHANDLED REJECTION:', reason);
});
process.on('uncaughtException', (err) => {
    console.error('🔥 UNCAUGHT EXCEPTION:', err);
    // A failure to bind the port is fatal and must NOT be swallowed. The dispatch
    // loop (setInterval(runDispatchTick)) is registered at module load, so a
    // process that lost the port race kept polling Supabase forever as an
    // invisible second dispatcher. Several of those accumulated over days: they
    // raced to mark tasks SENT, never received the extension's ack (only the
    // process holding the port can), then timed the tasks out and failed them
    // with "No worker handshake after N attempts". Die instead.
    if (err && err.code === 'EADDRINUSE') {
        console.error(`❌ Port ${PORT} is already in use — another SafePost server is running. Exiting so this process cannot become a second dispatcher.`);
        process.exit(1);
    }
});

console.log("🚀 Server connecting to Supabase...");

// CORS must come before rate limiter so preflight OPTIONS requests get CORS headers
app.use(cors({
    origin: function (origin, callback) {
        // Allow all origins in development, whitelist in production
        if (!origin || isAllowedOrigin(origin) || process.env.NODE_ENV === 'development') {
            callback(null, true);
        } else {
            console.log(`⚠️ CORS blocked origin: ${origin}`);
            callback(new Error('Not allowed by CORS'), false);
        }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    // Every custom header the app actually reads must be listed, or the browser
    // fails the preflight and the request never reaches Express. The extension's
    // CONTENT SCRIPT calls the API from origin https://www.facebook.com and sends
    // x-device-token/x-worker-id (see syncDetectedFacebookUser → /api/profile/sync),
    // which was rejected with "Request header field x-device-token is not allowed
    // by Access-Control-Allow-Headers". Background service-worker fetches are not
    // affected — host_permissions exempt them — so this only ever broke the
    // content-script leg. x-workspace-id is the same class of bug for the
    // dashboard whenever it is not same-origin (i.e. deployed, talking to Render).
    allowedHeaders: ['Content-Type', 'Authorization', 'x-requested-with',
        'x-device-token', 'x-worker-id', 'x-extension-key', 'x-workspace-id'],
    optionsSuccessStatus: 200
}));

// Rate limiting — applied after CORS so preflight responses include CORS headers
app.use('/api/', apiLimiter);

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use('/uploads', express.static(UPLOAD_DIR));

// Health Check Endpoint
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', time: new Date().toISOString(), supabase: !!supabase });
});

app.get('/api/debug/state', requireAuth, requireWorkspaceAccess, (req, res) => {
    const state = tenantState(req.workspaceId);
    res.json({
        workspaceId: req.workspaceId || null,
        workerStopSignal: state.workerStopSignal,
        workerStopUntil: state.workerStopUntil,
        workerThrottleUntil: state.workerThrottleUntil,
        sentTaskCount: sentTaskTimestamps.size,
        processingTaskCount: processingStartTimestamps.size,
        activeSseClients: sseClients.size,
        knownTenants: tenantStates.size,
        serverTime: new Date().toISOString()
    });
});

// --- SSE: Real-Time push to Extension ---
// Entries are { workspaceId, send }. workspaceId is null for an unpaired
// extension, which is the only kind that exists while the deployment is
// single-tenant. See broadcastSSE for what that means for delivery.
const sseClients = new Set();

function emitWorkspaceEvent(workspaceId, event, payload = {}) {
    if (workspaceId) {
        io.to(`ws:${workspaceId}`).emit(event, payload);
        return;
    }
    if (!isSecureRuntime) {
        io.emit(event, payload);
    }
}

function emitWorkspaceRefresh(workspaceId, { queue = false, data = false } = {}) {
    if (queue) emitWorkspaceEvent(workspaceId, 'queue_updated');
    if (data) emitWorkspaceEvent(workspaceId, 'data_updated');
}

function emitWorkspaceStatus(workspaceId, payload) {
    emitWorkspaceEvent(workspaceId, 'status_update', payload);
}

app.get('/api/stream/jobs', optionalWorker, (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // disable any proxy buffering so events flush immediately
    res.flushHeaders();

    const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);
    send({ type: 'connected' });
    const client = { workspaceId: req.workspaceId || null, send };
    sseClients.add(client);

    // Keep the connection warm. Without periodic traffic, MV3 service workers
    // (and any intermediate proxy) can silently drop the socket, which stops
    // job_available events from reaching the extension and turns dispatch into
    // a 60-second-alarm poll. A 20s ping is well under the typical idle-kill
    // threshold and cheap.
    const pingId = setInterval(() => {
        try { res.write(': ping\n\n'); } catch { /* client gone, cleaned up on close */ }
    }, 20000);

    // Deliver a pending sync to an extension that (re)connects — but clear the flag
    // immediately so we don't re-trigger a full group scan on EVERY reconnect. The
    // SSE reconnects roughly every 30s (and whenever the MV3 service worker wakes),
    // so without this clear one dashboard click looped group syncs forever.
    // Only this client's own tenant's pending sync — otherwise a reconnecting
    // extension would pick up a sync another account had queued.
    const connectState = tenantState(req.workspaceId);
    if (connectState.pendingSyncCommand) {
        send({ type: 'sync_groups' });
        connectState.pendingSyncCommand = false;
        console.log('📡 Delivered pending sync_groups on SSE (re)connect — flag cleared');
    }

    req.on('close', () => {
        clearInterval(pingId);
        sseClients.delete(client);
    });
});

// Push an event to connected extensions.
//
// `workspaceId` names the tenant an event belongs to. This matters because
// job_available carries the full post payload (content + group URL), and this
// used to go to EVERY connected extension — so with more than one tenant, one
// account's post text was delivered to another account's browser.
//
// Delivery rules:
//   • Paired client (has a workspaceId) — only events for its own workspace,
//     plus events sent without one (server-wide notices).
//   • Unpaired client (workspaceId null) — receives everything while
//     WORKER_AUTH_ENFORCED is off, which preserves today's single-tenant
//     behaviour; once enforcement is on, an unpaired client cannot receive
//     workspace-scoped events at all, because it has no proven tenant.
function broadcastSSE(data, workspaceId = null) {
    const enforced = WORKER_AUTH_ENFORCED;
    sseClients.forEach(client => {
        if (workspaceId) {
            if (client.workspaceId) {
                if (client.workspaceId !== workspaceId) return;
            } else if (enforced) {
                return; // unproven tenant, and we are no longer in legacy mode
            }
        }
        try { client.send(data); } catch { sseClients.delete(client); }
    });
}

// --- HELPER: Transactional Status Update ---
async function updateTaskStatus(taskId, status, message = null, metadata = null) {
    console.log(`[StatusUpdate] Task ${taskId}: ${status} - ${message || ''}`);
    let workspaceId = null;
    if (taskId !== 'DEBUG' && status !== 'LOG') {
        const { data: taskRow } = await supabase.from('posts').select('workspace_id').eq('id', taskId).maybeSingle();
        workspaceId = taskRow?.workspace_id || null;
    }
    // Track processing start/end for heartbeat
    if (status === 'PROCESSING') {
        if (!processingStartTimestamps.has(taskId)) {
            processingStartTimestamps.set(taskId, Date.now());
        }
    } else if (['SUCCESS', 'FAILED', 'CANCELLED'].includes(status)) {
        processingStartTimestamps.delete(taskId);
        sentTaskTimestamps.delete(taskId);
        if (status === 'CANCELLED') {
            logEvent(workspaceId, taskId, 'CANCELLED', `Task cancelled`, { failure_reason: message });
        }
    }
    try {
        // 1. Update Post Status (Only if not a transient log)
        if (status !== 'LOG' && taskId !== 'DEBUG') {
            const { error: postError } = await supabase
                .from('posts')
                .update({ status: status })
                .eq('id', taskId);

            if (postError) {
                console.error("Supabase Update Error:", postError);
            }
        }

        // 2. Broadcast to dashboard
        emitWorkspaceStatus(workspaceId, { taskId, status, message, metadata });
        return true;
    } catch (e) {
        console.error("Update Status Error:", e.message);
        throw e;
    }
}

// --- API ROUTES ---

// The detected Facebook identity is per tenant — see tenantState. Sharing one
// value meant whichever account synced last was reported to everyone.
app.get('/api/profile/current', ...dashboardAuth, (req, res) => {
    const state = tenantState(req.workspaceId);
    console.log(`📋 [PROFILE] GET /api/profile/current → returning: "${state.lastFacebookUser || '(none)'}"`);
    res.json({
        current_user: state.lastFacebookProfile?.facebook_user || null,
        current_user_id: state.lastFacebookProfile?.facebook_user_id || null,
        source: state.lastFacebookProfile?.source || null,
        detected_at: state.lastFacebookProfile?.detected_at || null
    });
});

app.post('/api/profile/sync', optionalWorker, (req, res) => {
    console.log('🧭 [PROFILE] POST /api/profile/sync received:', JSON.stringify(req.body));
    const facebook_user = typeof req.body?.facebook_user === 'string' ? req.body.facebook_user.trim() : '';
    if (!facebook_user) {
        console.log('⚠️ [PROFILE] facebook_user is empty or missing');
        return res.status(400).json({ error: 'facebook_user is required' });
    }
    const facebook_user_id = typeof req.body?.facebook_user_id === 'string' ? req.body.facebook_user_id.trim() : '';
    const source = typeof req.body?.source === 'string' ? req.body.source.trim() : '';
    const detected_at = typeof req.body?.detected_at === 'string' ? req.body.detected_at.trim() : '';
    const state = tenantState(req.workspaceId);
    state.lastFacebookProfile = {
        facebook_user,
        facebook_user_id: facebook_user_id || null,
        source: source || 'extension',
        detected_at: detected_at || new Date().toISOString()
    };
    state.lastFacebookUser = state.lastFacebookProfile.facebook_user;
    console.log('✅ [PROFILE] Current Facebook user updated to:', state.lastFacebookUser);
    res.json({
        success: true,
        current_user: state.lastFacebookProfile.facebook_user,
        current_user_id: state.lastFacebookProfile.facebook_user_id,
        source: state.lastFacebookProfile.source,
        detected_at: state.lastFacebookProfile.detected_at
    });
});

app.get('/api/groups', ...dashboardAuth, async (req, res) => {
    const { data, error } = await scopeToWorkspace(supabase
        .from('groups')
        .select('*'), req)
        .order('name', { ascending: true });

    if (error) return res.status(500).json({ error: error.message });

    // Find groups with pending-moderation failures — these should not be re-used
    // without admin action (accepting the pending post in Facebook or disabling
    // group moderation). Mark them so the UI can warn or filter them out.
    const { data: moderationBuggers } = await scopeToWorkspace(supabase
        .from('posts')
        .select('distinct group_id')
        .like('failure_reason', '%ממתין לאישור מנהל%'), req);
    const modGroupIds = new Set((moderationBuggers || []).map(r => r.group_id).filter(Boolean));

    // Group Health Score — derived from full posts history per group, same
    // "computed field" pattern as requires_moderation above.
    const { data: healthPosts } = await scopeToWorkspace(supabase
        .from('posts')
        .select('group_id, status, created_at'), req);
    const healthStats = buildGroupHealthStats(healthPosts);

    // Filter by facebook_user if provided — but ALWAYS keep untagged groups
    // (facebook_user null). Groups synced by the extension carry no account
    // attribution, so a strict equality filter would hide every one of them the
    // moment a current user is selected. Untagged groups belong to "all accounts".
    let filtered = data || [];
    if (req.query.user && data) {
        filtered = data.filter(g => !g.facebook_user || g.facebook_user === req.query.user);
    }

    // Tag groups that have pending-moderation failures + attach health score
    filtered = filtered.map(g => ({
        ...g,
        requires_moderation: modGroupIds.has(g.id),
        health_score: computeGroupHealth(healthStats[g.id])
    }));

    const facebookUsers = [...new Set((data || [])
        .map(g => g.facebook_user)
        .filter(Boolean))];

    res.json({
        groups: filtered,
        current_user: req.query.user || (facebookUsers.length === 1 ? facebookUsers[0] : null),
        facebook_users: facebookUsers
    });
});

app.delete('/api/groups', ...dashboardAuth, async (req, res) => {
    console.log('🗑️ [GROUPS] Deleting all groups...');
    const { error } = await scopeToWorkspace(supabase.from('groups').delete().neq('id', ''), req);

    if (error) return res.status(500).json({ error: error.message });
    console.log('✅ [GROUPS] All groups deleted');
    res.json({ success: true, message: 'All groups deleted' });
});

// Fix stuck tasks - mark PROCESSING tasks older than 4 minutes as FAILED
app.post('/api/tasks/fix-stuck', ...dashboardAuth, async (req, res) => {
    const fourMinutesAgo = new Date(Date.now() - 4 * 60 * 1000).toISOString();

    console.log('🔧 [TASKS] Fixing stuck tasks (PROCESSING > 4 min)...');

    const { data: stuckTasks, error: fetchError } = await scopeToWorkspace(supabase
        .from('posts')
        .select('id')
        .eq('status', 'PROCESSING')
        .lt('created_at', fourMinutesAgo), req);

    if (fetchError) return res.status(500).json({ error: fetchError.message });

    if (!stuckTasks || stuckTasks.length === 0) {
        return res.json({ success: true, fixed: 0 });
    }

    const { error: updateError } = await scopeToWorkspace(supabase
        .from('posts')
        .update({ status: 'FAILED', failure_reason: 'Task timeout - stuck in PROCESSING > 4min' })
        .eq('status', 'PROCESSING')
        .lt('created_at', fourMinutesAgo), req);

    if (updateError) return res.status(500).json({ error: updateError.message });

    console.log(`✅ [TASKS] Fixed ${stuckTasks.length} stuck tasks`);
    res.json({ success: true, fixed: stuckTasks.length });
});

app.post('/api/groups', ...dashboardAuth, async (req, res) => {
    const { groups } = req.body;
    if (!groups || !Array.isArray(groups)) return res.status(400).json({ error: "Invalid data" });

    // Upsert items. Groups are keyed per (workspace_id, facebook_user, id); an
    // optional per-group facebook_user is honored, defaulting to '' (the DB
    // sentinel for "unattributed") so the composite-key upsert is well-defined.
    const { data, error } = await supabase
        .from('groups')
        .upsert(groups.map(g => ({
            id: g.id,
            name: g.name,
            url: g.url,
            facebook_user: g.facebook_user || '',
            ...workspaceFields(req)
        })), { onConflict: 'workspace_id,facebook_user,id' });

    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true, count: groups.length });
});

// Manual per-group timezone tag (Item 6). Facebook exposes no group
// location/timezone, so this is operator-set, not auto-detected — consumed by
// POST /api/posts' biasIntoWindow to nudge that group's scheduled posts toward
// an 08:00-22:00 local window. Requires migration 0009 (groups.timezone).
app.patch('/api/groups/:id/timezone', ...dashboardAuth, async (req, res) => {
    const { id } = req.params;
    const { facebook_user, timezone } = req.body;

    if (timezone) {
        try { new Intl.DateTimeFormat('en', { timeZone: timezone }); }
        catch { return res.status(400).json({ error: 'Invalid IANA timezone string (e.g. "Asia/Jerusalem").' }); }
    }

    // Groups are keyed per (workspace_id, facebook_user, id) since migration
    // 0008 — must match on all three, or this silently updates the wrong
    // per-user copy of a shared group id.
    const { error } = await scopeToWorkspace(supabase
        .from('groups')
        .update({ timezone: timezone || null })
        .eq('id', id)
        .eq('facebook_user', facebook_user || ''), req);

    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
});

// --- SYNC ENDPOINT ---
app.post('/api/groups/sync', optionalWorker, async (req, res) => {
    const { groups, facebook_user, facebook_user_id = null } = req.body;
    console.log(`[GROUPS] Received sync: ${groups?.length || 0} groups, facebook_user="${facebook_user || '(null)'}"`);

    if (!groups || !Array.isArray(groups) || groups.length === 0) {
        return res.status(400).json({ error: "No groups provided" });
    }

    const dedupedGroups = [];
    const seenGroupIds = new Set();
    for (const group of groups) {
        const id = typeof group?.id === 'string' || typeof group?.id === 'number' ? String(group.id).trim() : '';
        const name = typeof group?.name === 'string' ? group.name.trim() : '';
        const url = typeof group?.url === 'string' ? group.url.trim() : '';
        if (!id || !name || !url || seenGroupIds.has(id)) continue;
        seenGroupIds.add(id);
        dedupedGroups.push({ id, name, url });
    }

    if (!dedupedGroups.length) {
        return res.status(400).json({ error: "No valid groups provided" });
    }

    // req.workspaceId comes from a verified device token and therefore wins over
    // the x-workspace-id header, which the caller can set to anything. The
    // legacy hint below is only reachable when nothing is paired — i.e. the
    // single-tenant case — because a paired worker always resolves above it.
    let workspaceId = req.workspaceId
        || req.headers['x-workspace-id']
        || legacyPendingSyncWorkspaceId
        || null;
    if (!workspaceId) {
        const { data: ws, error: wsError } = await supabase
            .from('workspaces')
            .select('id')
            .eq('is_demo', false)
            .limit(1)
            .maybeSingle();
        if (wsError || !ws) {
            console.error("Sync Error: could not resolve a workspace", wsError);
            return res.status(400).json({ error: "Could not resolve target workspace for sync" });
        }
        workspaceId = ws.id;
    }
    legacyPendingSyncWorkspaceId = null;

    // Groups are keyed per (workspace_id, facebook_user, id) — the same Facebook
    // group can be saved separately for each account. `fbUser` is '' when unknown
    // (matches the DB sentinel) so it can participate in the composite key.
    //
    // The group-scan tab sometimes fails to read the logged-in account, arriving
    // here as null. Fall back through the strongest signals we have, in order:
    //   1. What the extension detected (most authoritative — the actual scan tab).
    //   2. The account the dashboard was showing when it requested this sync.
    //   3. The last account the content script reported to /api/profile/sync.
    //   4. '' sentinel (legacy / truly unattributed).
    const incomingId = typeof facebook_user_id === 'string' ? facebook_user_id.trim() : null;
    let fbUser = (facebook_user && facebook_user.trim()) || null;
    let attributionSource = fbUser ? 'request' : null;

    // Hints are read from the state of the workspace this sync resolved to, not
    // from a server-wide value — otherwise another tenant's dashboard hint or
    // last-known account could be applied to these groups.
    const syncState = tenantState(workspaceId);

    if (!fbUser) {
        const dashboardHint = syncState.pendingSyncFacebookUser && syncState.pendingSyncFacebookUser.trim();
        if (dashboardHint) {
            fbUser = dashboardHint;
            attributionSource = 'dashboard_hint';
        } else if (syncState.lastFacebookUser) {
            // Only trust the last-known name if it isn't contradicted by the account
            // actually active in this request — a mismatched id means the browser has
            // since switched accounts, and reusing the old name would silently
            // misattribute the new account's groups to the previous one.
            const knownId = syncState.lastFacebookProfile?.facebook_user_id || null;
            const idConflicts = incomingId && knownId && incomingId !== knownId;
            if (!idConflicts) {
                fbUser = syncState.lastFacebookUser;
                attributionSource = 'last_known_profile';
            }
        }
    }
    fbUser = fbUser || '';
    syncState.pendingSyncFacebookUser = null; // consume the hint so it never leaks into a later sync
    console.log(`[GROUPS] Effective facebook_user for this sync: "${fbUser || '(unattributed)'}" (source: ${attributionSource || 'none'})`);

    // This sync path (the dashboard-triggered scan) doesn't call /api/profile/sync
    // separately, so record a fresh, request-attributed detection here too — otherwise
    // the id-conflict check above would keep comparing against a profile from whatever
    // account synced last via the OTHER path.
    if (attributionSource === 'request' && incomingId) {
        syncState.lastFacebookProfile = { facebook_user: fbUser, facebook_user_id: incomingId, source: 'groups_sync', detected_at: new Date().toISOString() };
        syncState.lastFacebookUser = fbUser;
    }

    // Preserve real names against placeholder overwrites. The extension emits
    // "קבוצה {id}" only as a last-resort placeholder when it couldn't extract
    // the actual FB group name. If a previous sync (or manual repair) already
    // stored a real name for a row, do NOT downgrade it back to the placeholder.
    const PLACEHOLDER_NAME = /^קבוצה [^\s]+$/;
    const { data: existingRows } = await supabase
        .from('groups')
        .select('id, name')
        .eq('workspace_id', workspaceId)
        .eq('facebook_user', fbUser)
        .in('id', dedupedGroups.map(g => g.id));
    const existingNameById = new Map((existingRows || []).map(r => [r.id, r.name]));

    // Upsert only THIS user's rows. onConflict targets the composite key, so a
    // group already owned by a DIFFERENT user is never touched — it gets its own
    // row for this user instead of overwriting the other account's copy.
    const toUpsert = dedupedGroups.map((g) => {
        const incomingIsPlaceholder = PLACEHOLDER_NAME.test(g.name || '');
        const existing = existingNameById.get(g.id);
        const existingIsReal = existing && !PLACEHOLDER_NAME.test(existing);
        const finalName = (incomingIsPlaceholder && existingIsReal) ? existing : g.name;
        return {
            id: g.id,
            name: finalName,
            url: g.url,
            workspace_id: workspaceId,
            facebook_user: fbUser,
        };
    });

    const { error: upsertError } = await supabase
        .from('groups')
        .upsert(toUpsert, { onConflict: 'workspace_id,facebook_user,id' });

    if (upsertError) {
        console.error("Sync Upsert Error:", upsertError);
        return res.status(500).json({ error: upsertError.message });
    }

    // Stale-delete is scoped strictly to THIS user (and workspace): groups the
    // account left since the last sync are removed, while every OTHER user's
    // groups are left completely untouched.
    const currentIds = dedupedGroups.map((g) => `"${String(g.id).replace(/"/g, '""')}"`);
    if (currentIds.length > 0) {
        const { error: staleDeleteError } = await supabase
            .from('groups')
            .delete()
            .eq('workspace_id', workspaceId)
            .eq('facebook_user', fbUser)
            .not('id', 'in', `(${currentIds.join(',')})`);
        if (staleDeleteError) console.warn('Delete stale groups warning:', staleDeleteError.message);
    }

    emitWorkspaceEvent(workspaceId, 'groups_updated');
    emitWorkspaceRefresh(workspaceId, { data: true });
    console.log(`[GROUPS] Sync complete: upserted ${dedupedGroups.length} groups`);
    res.json({
        success: true,
        added: dedupedGroups.length,
        synced: dedupedGroups.length,
        facebook_user: facebook_user || null,
        facebook_user_id: facebook_user_id || null,
        message: `Synced ${dedupedGroups.length} groups`
    });
});
// Dashboard requests extension to sync groups via SSE
app.post('/api/groups/request-sync', ...dashboardAuth, (req, res) => {
    const dashboardUser = typeof req.body?.facebook_user === 'string' ? req.body.facebook_user.trim() : '';
    console.log(`📡 Dashboard requested group sync from extension (user hint: "${dashboardUser || '(none)'}")`);
    const requestState = tenantState(req.workspaceId);
    legacyPendingSyncWorkspaceId = req.workspaceId || null;
    requestState.pendingSyncFacebookUser = dashboardUser || null;
    if (sseClients.size > 0) {
        // An extension is connected — deliver once, now, and do NOT leave the flag set
        // (leaving it set is what caused every later SSE reconnect to re-run the scan).
        broadcastSSE({ type: 'sync_groups' }, req.workspaceId || null);
        requestState.pendingSyncCommand = false;
        console.log(`📡 sync_groups delivered to ${sseClients.size} connected client(s)`);
    } else {
        // No extension connected right now — hold the request until one reconnects,
        // where the /api/stream/jobs handler delivers it once and clears the flag.
        requestState.pendingSyncCommand = true;
        console.log('📡 No SSE client connected — will deliver on next reconnect');
    }
    res.json({ success: true });
});

app.get('/api/groups/pending-sync', optionalWorker, (req, res) => {
    // Only this tenant's pending sync, so one account's poll cannot swallow the
    // request another account queued.
    const pollState = tenantState(req.workspaceId);
    const sync_needed = pollState.pendingSyncCommand;
    if (sync_needed) {
        console.log('📡 Pending group sync consumed by extension poll');
    }
    pollState.pendingSyncCommand = false;
    res.json({ success: true, sync_needed });
});

// --- DEMO: reset synthetic data (demo workspaces only) ---
app.post('/api/demo/reset', ...dashboardAuth, async (req, res) => {
    if (!req.isDemo) return res.status(403).json({ error: 'Reset is only available in demo mode.' });
    try {
        await resetDemoWorkspace(req.workspaceId, req.user.id);
        emitWorkspaceRefresh(req.workspaceId, { queue: true, data: true });
        res.json({ success: true, message: 'Demo data reset.' });
    } catch (e) {
        console.error('[DEMO] reset error:', e.message);
        res.status(500).json({ error: 'Demo reset failed.' });
    }
});

// ===================== PHASE 5: EXTENSION PAIRING / WORKERS =====================

// Dashboard: generate a short-lived, single-use pairing code
// denyDemo: a pairing code is a bearer credential that lets a real browser
// extension join this workspace and claim its jobs. Demo workspaces must never
// hand one out — every other real-effect route (upload, worker stop/resume) is
// already guarded, this one was missed when Phase 5 was added.
app.post('/api/workers/pairing-code', ...dashboardAuth, denyDemo, async (req, res) => {
    const code = generatePairingCode();
    const expires_at = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 min
    const { error } = await supabase.from('pairing_codes').insert({
        code, workspace_id: req.workspaceId, user_id: req.user.id, expires_at,
    });
    if (error) return res.status(500).json({ error: error.message });
    res.json({ code, expires_at, expires_in_seconds: 600 });
});

// Extension: exchange a pairing code for a scoped device token (public).
app.post('/api/workers/pair', async (req, res) => {
    const { code, worker_name, extension_version, browser_version } = req.body || {};
    if (!code) return res.status(400).json({ error: 'Missing pairing code.' });

    const { data: pc } = await supabase
        .from('pairing_codes').select('*')
        .eq('code', String(code).toUpperCase().trim()).maybeSingle();

    if (!pc) return res.status(404).json({ error: 'Invalid pairing code.' });
    if (pc.used_at) return res.status(409).json({ error: 'Pairing code already used.' });
    if (new Date(pc.expires_at).getTime() < Date.now()) return res.status(410).json({ error: 'Pairing code expired.' });

    // Single-use: atomically claim the code.
    const { data: claimed } = await supabase
        .from('pairing_codes').update({ used_at: new Date().toISOString() })
        .eq('id', pc.id).is('used_at', null).select('id').maybeSingle();
    if (!claimed) return res.status(409).json({ error: 'Pairing code already used.' });

    const token = generateDeviceToken();
    const { data: worker, error } = await supabase.from('browser_workers').insert({
        workspace_id: pc.workspace_id,
        user_id: pc.user_id,
        worker_name: worker_name || 'Chrome Extension',
        device_token_hash: hashToken(token),
        extension_version: extension_version || null,
        browser_version: browser_version || null,
        status: 'online',
        last_seen_at: new Date().toISOString(),
    }).select('id, workspace_id').single();

    if (error) return res.status(500).json({ error: error.message });
    // Plaintext token returned ONCE; server keeps only the hash.
    res.json({ worker_id: worker.id, workspace_id: worker.workspace_id, device_token: token });
});

// Worker: heartbeat (device-token auth).
app.post('/api/workers/:workerId/heartbeat', requireWorker, async (req, res) => {
    const { extension_version, browser_version, status } = req.body || {};
    await supabase.from('browser_workers').update({
        last_seen_at: new Date().toISOString(),
        status: status || 'online',
        extension_version: extension_version != null ? extension_version : req.worker.extension_version,
        browser_version: browser_version != null ? browser_version : req.worker.browser_version,
    }).eq('id', req.worker.id);
    // Extend the lock on any job this worker is still processing.
    await extendLock(req.worker.id);
    res.json({ success: true });
});

// Worker: claim the next job in THIS worker's workspace only (locked, atomic).
app.post('/api/workers/:workerId/jobs/claim', requireWorker, async (req, res) => {
    const job = await claimNextJob({ workspaceId: req.workspaceId, workerId: req.worker.id });
    if (!job) {
        await supabase.from('browser_workers').update({ last_seen_at: new Date().toISOString(), status: 'online' }).eq('id', req.worker.id);
        return res.json({ job: null });
    }
    await supabase.from('browser_workers').update({
        current_job_id: job.id, status: 'busy', last_seen_at: new Date().toISOString(),
    }).eq('id', req.worker.id);
    res.json({ job });
});

// Worker: report job status (retry/backoff + idempotency; workspace-scoped).
app.post('/api/workers/:workerId/jobs/:jobId/status', requireWorker, async (req, res) => {
    const { status, failure_reason, proof_url, error_code } = req.body || {};
    // content.js's findPostPermalink() falls back to the GROUP url when it cannot
    // locate the new post's permalink, so `proof_url` is not always a post URL.
    // external_post_url must only ever hold a real permalink — reportJobStatus
    // treats a present external_post_url as proof the job already published and
    // short-circuits as idempotent, so a group URL there would make any later
    // report for that job a no-op. The unverified value is still kept in proof_url.
    const isPermalink = typeof proof_url === 'string' && /\/(permalink|posts)\//.test(proof_url);
    const result = await reportJobStatus({
        jobId: req.params.jobId, workspaceId: req.workspaceId,
        status, errorCode: error_code, failureReason: failure_reason,
        externalUrl: isPermalink ? proof_url : null,
        proofUrl: proof_url || null,
    });
    if (!result.ok) return res.status(result.code || 400).json({ error: 'Status update rejected.' });
    await supabase.from('browser_workers').update({ current_job_id: null, status: 'online', last_seen_at: new Date().toISOString() }).eq('id', req.worker.id);
    io.to(`ws:${req.workspaceId}`).emit('queue_updated');
    res.json({ success: true, ...result });
});

// Worker: append a log (scoped to the worker's workspace).
app.post('/api/workers/:workerId/logs', requireWorker, async (req, res) => {
    const { level, message } = req.body || {};
    await supabase.from('system_logs').insert({
        log_level: level || 'info', source: 'worker', message: message || '', workspace_id: req.workspaceId,
    });
    res.json({ success: true });
});

// Dashboard: list workers in the active workspace.
app.get('/api/workers', ...dashboardAuth, async (req, res) => {
    const { data, error } = await scopeToWorkspace(supabase
        .from('browser_workers')
        .select('id, worker_name, status, last_seen_at, extension_version, browser_version, current_job_id, revoked_at, created_at'), req)
        .order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    res.json({ workers: data || [] });
});

// Dashboard: revoke a worker (own workspace only).
app.post('/api/workers/:workerId/revoke', ...dashboardAuth, async (req, res) => {
    const { data: w } = await supabase.from('browser_workers').select('id, workspace_id').eq('id', req.params.workerId).maybeSingle();
    if (!w || w.workspace_id !== req.workspaceId) return res.status(403).json({ error: 'Not your worker.' });
    await supabase.from('browser_workers').update({ revoked_at: new Date().toISOString(), status: 'offline' }).eq('id', w.id);
    res.json({ success: true });
});

// Dashboard: rename a worker (own workspace only).
app.patch('/api/workers/:workerId', ...dashboardAuth, async (req, res) => {
    const { worker_name } = req.body || {};
    const { data: w } = await supabase.from('browser_workers').select('id, workspace_id').eq('id', req.params.workerId).maybeSingle();
    if (!w || w.workspace_id !== req.workspaceId) return res.status(403).json({ error: 'Not your worker.' });
    await supabase.from('browser_workers').update({ worker_name: worker_name || 'Chrome Extension' }).eq('id', w.id);
    res.json({ success: true });
});

// Dashboard: remove a worker (own workspace only).
app.delete('/api/workers/:workerId', ...dashboardAuth, async (req, res) => {
    const { data: w } = await supabase.from('browser_workers').select('id, workspace_id').eq('id', req.params.workerId).maybeSingle();
    if (!w || w.workspace_id !== req.workspaceId) return res.status(403).json({ error: 'Not your worker.' });
    await supabase.from('browser_workers').delete().eq('id', w.id);
    res.json({ success: true });
});

// Sync failed — tell dashboard to stop spinner
app.post('/api/groups/sync-failed', optionalWorker, (req, res) => {
    const { error } = req.body;
    console.warn(`⚠️ Group sync failed: ${error}`);
    emitWorkspaceEvent(req.workspaceId || null, 'groups_sync_failed', { error });
    res.json({ success: true });
});

// --- GROUP SETS (FOLDERS) ---
app.get('/api/group-sets', ...dashboardAuth, async (req, res) => {
    const { data, error } = await scopeToWorkspace(supabase
        .from('group_sets')
        .select('*'), req)
        .order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    res.json({ sets: data });
});

app.post('/api/group-sets', ...dashboardAuth, async (req, res) => {
    const { name, group_ids } = req.body;
    if (!name || !Array.isArray(group_ids) || group_ids.length === 0)
        return res.status(400).json({ error: 'Missing name or group_ids' });
    const { data, error } = await supabase
        .from('group_sets')
        .insert([{ name, group_ids, ...workspaceFields(req) }])
        .select()
        .single();
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true, set: data });
});

app.delete('/api/group-sets/:id', ...dashboardAuth, async (req, res) => {
    const id = req.params.id;
    if (!/^[0-9a-f-]{8,}$/i.test(id)) return res.status(400).json({ error: 'Invalid ID format' });
    const { error } = await scopeToWorkspace(supabase
        .from('group_sets')
        .delete()
        .eq('id', id), req);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
});

// --- POST TEMPLATES ---
app.get('/api/templates', ...dashboardAuth, async (req, res) => {
    const { data, error } = await scopeToWorkspace(supabase
        .from('post_templates')
        .select('*'), req)
        .order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    res.json({ templates: data });
});

// --- EXTENSION CONFIG: Dynamic DOM selectors as configuration ---
app.get('/api/extension/config', optionalWorker, async (req, res) => {
    console.log('⚙️ [CONFIG] Fetching extension configuration from Supabase...');

    const { data, error } = await supabase
        .from('app_config')
        .select('config_data, updated_at')
        .eq('config_key', 'extension_selectors')
        .single();

    if (error) {
        console.error('❌ [CONFIG] Supabase error:', error.message);
        return res.status(500).json({ error: error.message });
    }

    if (!data) {
        console.warn('⚠️ [CONFIG] No config found for key: extension_selectors');
        return res.status(404).json({ error: 'Config not found' });
    }

    console.log(`✅ [CONFIG] Config fetched (last updated: ${data.updated_at})`);
    console.log(`   createPostTriggers: ${data.config_data.createPostTriggers?.length} phrases`);
    console.log(`   composeBox: ${data.config_data.composeBox?.length} selectors`);
    console.log(`   submitButton: ${data.config_data.submitButton?.length} phrases`);
    console.log(`   photoVideoButton: ${data.config_data.photoVideoButton?.length} selectors`);

    res.json(data.config_data);
});

app.post('/api/templates', ...dashboardAuth, async (req, res) => {
    const { name, content, media_url } = req.body;
    if (!name) return res.status(400).json({ error: 'Template name is required' });

    const { data, error } = await supabase
        .from('post_templates')
        .insert([{ name, content, media_url, app_source: 'backup', ...workspaceFields(req) }])
        .select()
        .single();
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true, template: data });
});

app.delete('/api/templates/:id', ...dashboardAuth, async (req, res) => {
    const id = req.params.id;
    if (!/^[0-9a-f-]{8,}$/i.test(id)) return res.status(400).json({ error: 'Invalid ID format' });
    const { error } = await scopeToWorkspace(supabase
        .from('post_templates')
        .delete()
        .eq('id', id), req);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
});

// Simplified upload endpoint - accepts multipart or JSON with base64
app.post('/api/upload', strictLimiter, ...dashboardAuth, denyDemo, async (req, res) => {
    try {
        let fileBuffer, fileName, mimetype;

        // Try multer first for multipart/form-data
        if (req.headers['content-type']?.includes('multipart')) {
            try {
                await new Promise((resolve, reject) => {
                    upload.single('file')(req, res, (err) => {
                        if (err) reject(err);
                        if (!req.file) reject(new Error('No file in request'));
                        resolve();
                    });
                });

                fileBuffer = req.file.buffer;
                fileName = `${Date.now()}-${req.file.originalname.replace(/[^\x00-\x7F]/g, "").replace(/\s+/g, '-').toLowerCase()}`;
                mimetype = req.file.mimetype || 'application/octet-stream';
            } catch (multerErr) {
                // This used to answer 200 with a placeholder.com URL, which the
                // dashboard accepted as a successful upload — so an oversized
                // video looked like it had uploaded and the post went out with a
                // placeholder image attached instead. Report the real failure.
                if (multerErr.code === 'LIMIT_FILE_SIZE') {
                    console.warn(`⚠️ Upload rejected: over the ${UPLOAD_MAX_MB}MB limit`);
                    return res.status(413).json({
                        success: false,
                        error: `File is larger than the ${UPLOAD_MAX_MB}MB limit.`,
                        limit_mb: UPLOAD_MAX_MB
                    });
                }
                console.warn("⚠️ Upload failed:", multerErr.message);
                return res.status(400).json({ success: false, error: multerErr.message });
            }
        } else if (req.body.file) {
            // Handle JSON base64 upload
            const base64Data = req.body.file.replace(/^data:.*;base64,/, '');
            fileBuffer = Buffer.from(base64Data, 'base64');
            fileName = `${Date.now()}-${(req.body.name || 'upload').replace(/[^\x00-\x7F]/g, "").toLowerCase()}`;
            mimetype = req.body.mimetype || 'application/octet-stream';
        } else {
            return res.status(400).json({ error: "No file data provided" });
        }

        console.log("☁️ Uploading:", fileName);

        const { error } = await supabase.storage
            .from('campaign-media')
            .upload(fileName, fileBuffer, { contentType: mimetype, upsert: true });

        if (error) {
            // Surfaced verbatim rather than swallowed: the useful cases here are
            // the bucket's own size ceiling and a missing/misnamed bucket, and
            // both are only fixable if the operator can see which one it is.
            console.error("❌ Supabase storage error:", error.message);
            return res.status(502).json({
                success: false,
                error: `Storage rejected the upload: ${error.message}`
            });
        }

        // Try public URL first; fall back to 1-year signed URL if bucket is private
        const { data: { publicUrl } } = supabase.storage.from('campaign-media').getPublicUrl(fileName);
        let fileUrl = publicUrl;
        if (!fileUrl || fileUrl.includes('undefined')) {
            const { data: signed } = await supabase.storage.from('campaign-media').createSignedUrl(fileName, 31536000);
            fileUrl = signed?.signedUrl || publicUrl;
        }
        console.log("✅ Upload complete:", fileName);
        res.json({ success: true, file_path: fileUrl });
    } catch (err) {
        console.error("🔥 Upload error:", err.message);
        res.status(500).json({ success: false, error: err.message || 'Upload failed.' });
    }
});

// --- PRE-SIGNED URL ENDPOINT FOR DIRECT CLIENT-SIDE UPLOADS ---
app.post('/api/upload/presigned', strictLimiter, ...dashboardAuth, denyDemo, async (req, res) => {
    try {
        console.log('🔗 [PRESIGNED] Request received');
        console.log('   Payload:', JSON.stringify(req.body, null, 2));

        const { fileName, fileSize, mimeType } = req.body;

        // Validation
        if (!fileName) {
            console.error('❌ [PRESIGNED] Missing fileName');
            return res.status(400).json({ error: 'fileName is required' });
        }
        if (!mimeType) {
            console.error('❌ [PRESIGNED] Missing mimeType');
            return res.status(400).json({ error: 'mimeType is required' });
        }
        if (fileSize && fileSize > 50 * 1024 * 1024) {
            console.error('❌ [PRESIGNED] File too large:', fileSize);
            return res.status(400).json({ error: 'File size exceeds 50MB limit' });
        }

        // Sanitize filename
        const sanitized = `${Date.now()}-${fileName
            .replace(/[^\x00-\x7F]/g, '') // Remove non-ASCII
            .replace(/\s+/g, '-')           // Replace spaces with hyphens
            .toLowerCase()}`;

        console.log('   Sanitized filename:', sanitized);
        console.log('   MIME type:', mimeType);
        console.log('   File size:', fileSize || 'unknown');

        // Generate pre-signed PUT URL (valid for 1 hour)
        console.log('   Calling Supabase createSignedUrl...');
        const { data, error } = await supabase.storage
            .from('campaign-media')
            .createSignedUrl(sanitized, 3600); // 1 hour expiry

        if (error) {
            console.error('❌ [PRESIGNED] Supabase error:', error.message);
            return res.status(500).json({ error: 'Failed to generate pre-signed URL', details: error.message });
        }

        if (!data || !data.signedUrl) {
            console.error('❌ [PRESIGNED] No signedUrl in response');
            return res.status(500).json({ error: 'Failed to generate pre-signed URL: empty response' });
        }

        console.log('✅ [PRESIGNED] URL generated successfully');
        console.log('   Signed URL:', data.signedUrl.substring(0, 80) + '...');
        console.log('   Path:', sanitized);
        console.log('   Expiry:', new Date(Date.now() + 3600 * 1000).toISOString());

        res.json({
            success: true,
            signedUrl: data.signedUrl,
            filePath: `campaign-media/${sanitized}`,
            fileName: sanitized,
            expiresIn: 3600,
            expiresAt: new Date(Date.now() + 3600 * 1000).toISOString()
        });

    } catch (err) {
        console.error('🔥 [PRESIGNED] Unexpected error:', err.message);
        console.error('   Stack:', err.stack);
        res.status(500).json({ error: 'Internal server error', details: err.message });
    }
});

// --- ANALYTICS ---
app.get('/api/analytics', ...dashboardAuth, async (req, res) => {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    const [{ data: posts, error }, { data: groups }] = await Promise.all([
        scopeToWorkspace(supabase.from('posts').select('id, status, group_id, created_at, ended_at, failure_reason').in('app_source', ['backup', 'demo']).gte('created_at', thirtyDaysAgo), req),
        scopeToWorkspace(supabase.from('groups').select('id, name, url'), req)
    ]);

    if (error) return res.status(500).json({ error: error.message });

    const groupMap = {};
    (groups || []).forEach(g => { groupMap[g.id] = { name: g.name, url: g.url }; });

    // Shared with GET /api/groups' health score — same posts array, no extra query.
    const healthStats = buildGroupHealthStats(posts);

    const total     = posts.length;
    const success   = posts.filter(p => ['SUCCESS', 'COMPLETED'].includes(p.status)).length;
    const failed    = posts.filter(p => p.status === 'FAILED').length;
    const cancelled = posts.filter(p => p.status === 'CANCELLED').length;
    const pending   = posts.filter(p => ['PENDING', 'SENT', 'PROCESSING'].includes(p.status)).length;
    const successRate = (success + failed) > 0 ? Math.round((success / (success + failed)) * 100) : 0;

    // Posts per day (last 7 days)
    const byDay = {};
    for (let i = 6; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        byDay[d.toISOString().slice(0, 10)] = { success: 0, failed: 0, total: 0 };
    }
    posts.forEach(p => {
        const day = (p.created_at || '').slice(0, 10);
        if (byDay[day]) {
            byDay[day].total++;
            if (['SUCCESS', 'COMPLETED'].includes(p.status)) byDay[day].success++;
            if (p.status === 'FAILED') byDay[day].failed++;
        }
    });

    // Per-group stats
    const groupStats = {};
    posts.forEach(p => {
        if (!groupStats[p.group_id]) groupStats[p.group_id] = { name: groupMap[p.group_id]?.name || p.group_id, url: groupMap[p.group_id]?.url || null, success: 0, failed: 0, total: 0 };
        groupStats[p.group_id].total++;
        if (['SUCCESS', 'COMPLETED'].includes(p.status)) groupStats[p.group_id].success++;
        if (p.status === 'FAILED') groupStats[p.group_id].failed++;
    });
    // Fold in the health score computed above (same helper GET /api/groups uses).
    Object.entries(groupStats).forEach(([gid, s]) => { s.health_score = computeGroupHealth(healthStats[gid]); });

    const allGroups = Object.values(groupStats);
    const topGroups     = [...allGroups].sort((a, b) => b.success - a.success).slice(0, 6);
    const problemGroups = allGroups.filter(g => g.failed > 0).sort((a, b) => b.failed - a.failed).slice(0, 5);
    const activeGroups  = [...allGroups].sort((a, b) => b.total - a.total).slice(0, 6);

    // Count pending by group
    const pendingGroupStats = {};
    posts.filter(p => ['PENDING', 'SENT', 'PROCESSING'].includes(p.status)).forEach(p => {
        if (!pendingGroupStats[p.group_id]) pendingGroupStats[p.group_id] = { name: groupMap[p.group_id]?.name || p.group_id, url: groupMap[p.group_id]?.url || null, pending: 0 };
        pendingGroupStats[p.group_id].pending++;
    });
    const pendingGroups = Object.values(pendingGroupStats).filter(g => g.pending > 0).sort((a, b) => b.pending - a.pending).slice(0, 6);

    // Top error messages
    const errorMap = {};
    posts.filter(p => p.status === 'FAILED' && p.failure_reason).forEach(p => {
        const key = (p.failure_reason || '').trim().slice(0, 120);
        if (key) errorMap[key] = (errorMap[key] || 0) + 1;
    });
    const topErrors = Object.entries(errorMap)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6)
        .map(([message, count]) => ({ message, count, percent: failed > 0 ? Math.round(count / failed * 100) : 0 }));

    // Queue-to-completion timing. Only created_at→ended_at is reliably populated
    // (CANCELLED posts didn't get ended_at until the Item-8 fix, so this measures
    // queue wait + execution + report latency for SUCCESS/FAILED only — not pure
    // Facebook post-execution duration).
    const timedDurationsSec = posts
        .filter(p => ['SUCCESS', 'COMPLETED', 'FAILED'].includes(p.status) && p.ended_at && p.created_at)
        .map(p => (new Date(p.ended_at) - new Date(p.created_at)) / 1000)
        .filter(sec => sec >= 0)
        .sort((a, b) => a - b);
    const timing = {
        sampleSize: timedDurationsSec.length,
        avgQueueToCompletionSeconds: timedDurationsSec.length
            ? Math.round(timedDurationsSec.reduce((a, b) => a + b, 0) / timedDurationsSec.length) : null,
        medianQueueToCompletionSeconds: timedDurationsSec.length
            ? Math.round(timedDurationsSec[Math.floor(timedDurationsSec.length / 2)]) : null,
        note: 'Measures created_at → ended_at (queue wait + execution + report latency), not pure Facebook post-execution time. SUCCESS/FAILED only.'
    };

    // Throttle suggestion — a heuristic on this operator's own posting history,
    // not machine learning. Nothing here is auto-applied to POST /api/posts'
    // jitter; it's surfaced for the operator to act on manually.
    const moderationFailures = posts.filter(p => (p.failure_reason || '').includes('ממתין לאישור מנהל')).length;
    const handshakeTimeoutFailures = posts.filter(p => (p.failure_reason || '').toLowerCase().includes('handshake')).length;
    const throttleFailRate = total > 0 ? (moderationFailures + handshakeTimeoutFailures) / total : 0;
    const THROTTLE_FAIL_RATE_THRESHOLD = 0.15;
    const groupsWithFailureStreaks = Object.entries(healthStats)
        .filter(([, s]) => (s.consecutiveFailures || 0) >= 3)
        .map(([gid, s]) => ({ group_id: gid, name: groupMap[gid]?.name || gid, consecutiveFailures: s.consecutiveFailures }));
    const throttleSuggestion = {
        currentSpacingSeconds: { min: 150, max: 210 }, // matches the literal jitter in POST /api/posts
        sampleSize: total,
        moderationRate: total > 0 ? Math.round(moderationFailures / total * 100) : 0,
        handshakeTimeoutRate: total > 0 ? Math.round(handshakeTimeoutFailures / total * 100) : 0,
        groupsWithFailureStreaks,
        suggestion: throttleFailRate > THROTTLE_FAIL_RATE_THRESHOLD ? 'increase_spacing' : 'ok',
        suggestedSpacingSeconds: throttleFailRate > THROTTLE_FAIL_RATE_THRESHOLD ? { min: 210, max: 280 } : null,
        note: 'Heuristic derived from your own posting history — not machine learning. Nothing is auto-applied; the jitter in POST /api/posts is unchanged.'
    };

    // A-B variant breakdown (Item 5). Deliberately a SEPARATE, defensive query
    // rather than adding variant_label to the main select above: that column
    // only exists after migration 0009 is applied, and this endpoint is on the
    // dashboard's hot path — a missing column here must not break the rest of
    // /api/analytics. Resolves to [] until the migration lands.
    let variantStats = [];
    try {
        const { data: variantPosts, error: variantError } = await scopeToWorkspace(supabase
            .from('posts')
            .select('variant_label, status')
            .in('app_source', ['backup', 'demo'])
            .gte('created_at', thirtyDaysAgo)
            .not('variant_label', 'is', null), req);
        if (!variantError && variantPosts) {
            const vMap = {};
            variantPosts.forEach(p => {
                if (!vMap[p.variant_label]) vMap[p.variant_label] = { label: p.variant_label, success: 0, failed: 0, total: 0 };
                vMap[p.variant_label].total++;
                if (['SUCCESS', 'COMPLETED'].includes(p.status)) vMap[p.variant_label].success++;
                if (p.status === 'FAILED') vMap[p.variant_label].failed++;
            });
            variantStats = Object.values(vMap).sort((a, b) => b.total - a.total);
        }
    } catch (e) {
        console.error('[Analytics] variant stats query failed (migration 0009 not applied yet?):', e.message);
    }

    res.json({
        summary: { total, success, failed, cancelled, pending, successRate },
        byDay: Object.entries(byDay).map(([date, d]) => ({ date, ...d })),
        topGroups,
        problemGroups,
        pendingGroups,
        activeGroups,
        topErrors,
        timing,
        throttleSuggestion,
        variantStats
    });
});

// GET detailed report of successes and failures
app.get('/api/report/tasks', ...dashboardAuth, async (req, res) => {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    const [{ data: posts }, { data: groups }] = await Promise.all([
        scopeToWorkspace(supabase.from('posts')
            .select('id, status, group_id, content, failure_reason, created_at')
            .in('app_source', ['backup', 'demo'])
            .gte('created_at', thirtyDaysAgo)
            .order('created_at', { ascending: false }), req),
        scopeToWorkspace(supabase.from('groups').select('id, name, url'), req)
    ]);

    if (!posts) return res.status(500).json({ error: 'Failed to fetch posts' });

    const groupMap = {};
    (groups || []).forEach(g => { groupMap[g.id] = g; });

    const successes = posts.filter(p => ['SUCCESS', 'COMPLETED'].includes(p.status)).map(p => ({
        id: p.id,
        status: p.status,
        group: groupMap[p.group_id]?.name || p.group_id,
        groupUrl: groupMap[p.group_id]?.url || null,
        timestamp: p.created_at,
        contentPreview: (p.content || '').substring(0, 100)
    }));

    const failures = posts.filter(p => p.status === 'FAILED').map(p => ({
        id: p.id,
        status: p.status,
        group: groupMap[p.group_id]?.name || p.group_id,
        groupUrl: groupMap[p.group_id]?.url || null,
        timestamp: p.created_at,
        reason: p.failure_reason || 'Unknown error',
        contentPreview: (p.content || '').substring(0, 100)
    }));

    // Error summary
    const errorReasons = {};
    failures.forEach(f => {
        const key = (f.reason || '').trim();
        errorReasons[key] = (errorReasons[key] || 0) + 1;
    });

    res.json({
        summary: {
            total: posts.length,
            successes: successes.length,
            failures: failures.length,
            successRate: posts.length > 0 ? Math.round((successes.length / posts.length) * 100) : 0
        },
        successes: successes.slice(0, 100),
        failures: failures.slice(0, 100),
        errorSummary: Object.entries(errorReasons)
            .sort((a, b) => b[1] - a[1])
            .map(([reason, count]) => ({ reason, count }))
    });
});

// --- LOGS STORAGE (in-memory for simplicity, persists within session) ---
const eventLogs = [];
const MAX_LOGS = 500; // Keep last 500 events

function logEvent(workspaceId, taskId, type, message, metadata = {}) {
    try {
        const entry = createTenantEventLog({ workspaceId, taskId, type, message, metadata });
        eventLogs.unshift(entry);
        if (eventLogs.length > MAX_LOGS) eventLogs.pop();
        console.log(`[EVENT] ${type} - Task #${taskId}: ${message}`);
        return true;
    } catch (error) {
        console.error(`[EVENT] Refused unscoped tenant log for task #${taskId}: ${error.message}`);
        return false;
    }
}

app.get('/api/logs', ...dashboardAuth, (req, res) => {
    // This endpoint is always closed, even when the wider development runtime
    // is intentionally permissive. Logs can contain customer and job data.
    if (!req.user) return res.status(401).json({ error: 'Authentication required.' });
    if (!req.workspaceId) return res.status(403).json({ error: 'Workspace access required.' });

    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const type = req.query.type; // Optional filter by type
    const selected = selectWorkspaceEventLogs(eventLogs, req.workspaceId, { type, limit });

    res.json({
        total: selected.total,
        returned: selected.logs.length,
        logs: selected.logs
    });
});

// --- AI CONTENT GENERATION (GEMINI + CLAUDE FALLBACK) ---
app.post('/api/ai/generate', strictLimiter, requireAuth, async (req, res) => {
    const { prompt, history = [] } = req.body;
    if (!prompt?.trim()) return res.status(400).json({ error: 'Prompt is required' });

    // Build Claude messages with conversation history
    const buildMessages = () => {
        const msgs = [];
        for (const h of history) {
            if (h.role === 'user') msgs.push({ role: 'user', content: h.content });
            else if (h.role === 'ai') msgs.push({ role: 'assistant', content: h.content });
        }
        msgs.push({ role: 'user', content: prompt });
        return msgs;
    };

    // Try Google Gemini first (no history support in basic API)
    try {
        console.log(`🤖 Trying Gemini: "${prompt.substring(0, 50)}..."`);
        const model = genAI.getGenerativeModel({ model: 'text-bison' });
        const result = await model.generateContent(prompt);
        const text = result.response.text();
        console.log(`✅ Gemini generated ${text.length} characters`);
        return res.json({ success: true, text, source: 'gemini' });
    } catch (geminiErr) {
        const geminiMsg = geminiErr.message || '';
        console.warn('⚠️ Gemini failed:', geminiMsg.substring(0, 100));

        // Try Claude as fallback (with full conversation history)
        try {
            console.log(`🤖 Fallback to Claude: "${prompt.substring(0, 50)}..."`);
            const message = await anthropic.messages.create({
                model: 'claude-sonnet-4-6',
                max_tokens: 1024,
                messages: buildMessages()
            });
            const text = message.content[0].text;
            console.log(`✅ Claude generated ${text.length} characters`);
            return res.json({ success: true, text, source: 'claude' });
        } catch (claudeErr) {
            const claudeMsg = claudeErr.message || '';
            console.error('❌ Both AI services failed. Gemini:', geminiMsg.substring(0, 50), 'Claude:', claudeMsg.substring(0, 50));

            // Return graceful error
            return res.json({
                success: false,
                error: 'AI services unavailable',
                message: 'שני שירותי ה-AI לא זמינים כרגע. נסה שנית בעוד כמה שעות.',
                unavailable: true
            });
        }
    }
});

// --- 1. PROPER JITTER CALCULATION ---
app.post('/api/posts', validate(postsSchema), ...dashboardAuth, async (req, res) => {
    const { group_ids, content, schedule, media_url, media_files, ai_spin, facebook_user, content_variants } = req.validated;

    // Additional validation: must have content, media, or A-B variants
    if (!content && !media_url && !media_files && !(content_variants && content_variants.length)) {
        return res.status(400).json({ error: "Must provide content, media_url, media_files, or content_variants" });
    }

    console.log(`🚀 [POSTS] Intelligent Launch: Preparing ${group_ids.length} tasks...`);
    console.log(`   AI Spin: ${ai_spin}`);
    console.log(`   Content length: ${content ? content.length : 0} chars`);
    console.log(`   Media files: ${media_files ? media_files.length : 0}`);
    if (media_files && media_files.length > 0) {
        console.log(`   Files: ${media_files.map(f => f.filePath || f).join(', ')}`);
    }

    // A. Find the last scheduled mission time to avoid overlaps
    let nextScheduleTime = schedule ? new Date(schedule) : new Date();
    if (nextScheduleTime < new Date()) nextScheduleTime = new Date();

    try {
        const { data: lastTasks } = await scopeToWorkspace(
            supabase
                .from('posts')
                .select('scheduled_time')
                .eq('app_source', 'backup')
                .in('status', ['PENDING', 'SENT', 'PROCESSING'])
                .order('scheduled_time', { ascending: false })
                .limit(1),
            req
        );

        if (lastTasks && lastTasks.length > 0) {
            const lastTime = new Date(lastTasks[0].scheduled_time);
            if (lastTime > nextScheduleTime) {
                console.log(`📎 [POSTS] Existing queue detected. Appending after: ${lastTime.toISOString()}`);
                nextScheduleTime = lastTime;
            }
        }
    } catch (e) {
        console.error("❌ [POSTS] Error fetching last task time, defaulting to now:", e.message);
    }

    // Extract file paths from media_files objects
    const mediaPaths = media_files
        ? media_files.map(f => f.filePath || f).filter(Boolean)
        : null;

    // Build media URLs from paths (Supabase public URLs)
    const getMediaPublicUrl = (filePath) => {
        const SUPABASE_URL = process.env.SUPABASE_URL;
        const bucket = 'campaign-media';
        // Encode filename safely
        const encodedPath = filePath.split('/').pop();
        return `${SUPABASE_URL}/storage/v1/object/public/${bucket}/${encodedPath}`;
    };

    const mediaUrls = mediaPaths ? mediaPaths.map(getMediaPublicUrl) : null;

    // Fetch {id, name, url} for the target groups once, so {{GROUP_NAME}} /
    // {{GROUP_URL}} placeholders can be resolved per group below.
    const groupMap = new Map();
    try {
        const { data: groupRows } = await scopeToWorkspace(
            supabase.from('groups').select('id, name, url').in('id', group_ids), req);
        (groupRows || []).forEach(g => groupMap.set(g.id, g));
    } catch (e) {
        console.error('❌ [POSTS] Error fetching group names for placeholders:', e.message);
    }

    // Group timezone tags (Item 6) — SEPARATE, defensive query. The timezone
    // column only exists after migration 0009 is applied, and this feeds the
    // core launch path used on every campaign, so a missing column must not
    // break normal posting. No tag found (pre-migration or just untagged) →
    // groupTimezones stays empty → biasIntoWindow is never called → today's
    // scheduling behavior, unchanged.
    const groupTimezones = new Map();
    try {
        const { data: tzRows, error: tzError } = await scopeToWorkspace(
            supabase.from('groups').select('id, timezone').in('id', group_ids).not('timezone', 'is', null), req);
        if (!tzError) (tzRows || []).forEach(g => { if (g.timezone) groupTimezones.set(g.id, g.timezone); });
    } catch (e) {
        console.error('[POSTS] Group timezone lookup failed (migration 0009 not applied yet?):', e.message);
    }

    const tasks = [];
    group_ids.forEach((gid, index) => {
        // First post: within 30s. Subsequent posts: 150–210s (2.5–3.5 min) jitter
        const jitter = index === 0
            ? Math.floor(Math.random() * 20000) + 10000          // 10–30 seconds
            : Math.floor(Math.random() * (210000 - 150000 + 1)) + 150000; // 150–210 seconds
        nextScheduleTime = new Date(nextScheduleTime.getTime() + jitter);

        // Per-task scheduled time, optionally biased toward this group's tagged
        // local posting window (08:00-22:00). Bias is applied to a COPY, not to
        // nextScheduleTime itself — the running accumulator that subsequent
        // groups' jitter builds on — so one tagged group's multi-hour bias never
        // bleeds into an untagged group's schedule later in the same campaign.
        const groupTz = groupTimezones.get(gid);
        const taskScheduledTime = groupTz ? biasIntoWindow(nextScheduleTime, groupTz) : nextScheduleTime;

        // A-B testing: round-robin this group onto one content_variants entry
        // instead of the single shared `content` field. Absent → today's
        // single-content path, unchanged.
        const variant = (content_variants && content_variants.length)
            ? content_variants[index % content_variants.length]
            : null;
        const rawContent = variant ? variant.content : content;

        // Resolve {{GROUP_NAME}} etc. BEFORE spinning — spinText's spintax regex
        // would otherwise corrupt an unresolved {{TOKEN}} (see resolvePlaceholders
        // comment above spinText's definition).
        const resolvedContent = resolvePlaceholders(rawContent, groupMap.get(gid), facebook_user);
        let finalContent = ai_spin ? spinText(resolvedContent) : resolvedContent;

        // Embed media URLs in content
        if (mediaUrls && mediaUrls.length > 0) {
            console.log(`📸 [POSTS] Embedding ${mediaUrls.length} media URL(s) into content`);
            const mediaLinksText = '\n\n📸 Media:\n' + mediaUrls.map(url => `🔗 ${url}`).join('\n');
            finalContent = finalContent + mediaLinksText;
            console.log(`   Content + media = ${finalContent.length} chars`);
        }

        const task = {
            group_id: gid,
            content: finalContent,
            media_url: media_url || null,           // Legacy field
            media_paths: mediaPaths || null,        // New field: array of Supabase Storage paths
            status: 'PENDING',
            scheduled_time: taskScheduledTime.toISOString(),
            // Demo workspaces produce app_source='demo' posts, which the worker
            // (jobs/next filters app_source='backup') never claims/publishes.
            app_source: req.isDemo ? 'demo' : 'backup',
            ...workspaceFields(req)
        };
        // NOTE: posts has no facebook_user column in production (only groups does,
        // via migration 0008) — PostgREST rejects an insert containing an unknown
        // column outright rather than silently dropping it, which broke every launch
        // that had a current user selected (i.e. almost always). facebook_user is
        // still used above for {{}} placeholder resolution; it's just never written here.
        // Only set variant_label when variants are actually in use — this column
        // only exists after migration 0009 is applied. Never touching it on the
        // ordinary single-content path (the overwhelming majority of requests)
        // means this code is safe to ship BEFORE the migration runs; only a
        // request that explicitly opts into content_variants can fail, and it
        // fails with a clear DB error rather than corrupting anything.
        if (variant) {
            task.variant_label = variant.label;
        }
        tasks.push(task);
    });

    console.log(`   Creating ${tasks.length} tasks...`);
    const { error } = await supabase.from('posts').insert(tasks);
    if (error) {
        console.error(`❌ [POSTS] Database error:`, error.message);
        return res.status(500).json({ error: error.message });
    }

    console.log(`✅ [POSTS] Successfully created ${tasks.length} tasks`);
    res.json({ success: true, count: group_ids.length, mediaCount: mediaPaths ? mediaPaths.length : 0 });
    emitWorkspaceRefresh(req.workspaceId, { queue: true });
});

// --- 2. WORKER ACKNOWLEDGEMENT ---
app.post('/api/worker/ack', optionalWorker, async (req, res) => {
    const { taskId } = req.body;
    console.log(`🤝 Handshake: Worker acknowledged task ${taskId}`);

    const { error } = await supabase
        .from('posts')
        .update({ status: 'PROCESSING' })
        .eq('id', taskId)
        .eq('status', 'SENT'); // Only if it was in SENT state

    if (error) return res.status(500).json({ error: error.message });

    sentTaskTimestamps.delete(taskId);
    processingStartTimestamps.set(taskId, Date.now());
    updateTaskStatus(taskId, 'PROCESSING', 'Worker started execution');
    res.json({ success: true });
});

// --- 3. REFACTORED STRICT QUEUE POLLER ---
//
// Runs on a 5-second timer AND is invoked directly right after each terminal
// task transition (SUCCESS/FAILED/CANCELLED). That direct call collapses the
// gap between one post finishing and the next going out: instead of waiting up
// to 5s for the timer to notice the worker is free again, the next dispatch
// starts immediately. A lightweight mutex prevents overlapping runs if a
// terminal update lands mid-tick.
let dispatchLockActive = false;
// How many due tasks to consider per tick. This is a window across ALL tenants,
// so it must comfortably exceed the number of active workspaces — otherwise a
// single tenant with a large backlog fills the window and starves the rest.
const DISPATCH_SCAN_LIMIT = 200;

// Hand one already-locked task to its tenant's extension.
// Split out of runDispatchTick so the tick can dispatch for several workspaces
// in one pass; the body is unchanged from when it was inline.
async function dispatchTask(nextTask) {
    // A group id can now exist once PER user, so scope the URL lookup to this
    // task's workspace + facebook_user (falling back to any match) and never
    // use .single() — that would throw when multiple users share the group.
    let groupQuery = supabase.from('groups').select('url').eq('id', nextTask.group_id);
    if (nextTask.workspace_id) groupQuery = groupQuery.eq('workspace_id', nextTask.workspace_id);
    if (nextTask.facebook_user) groupQuery = groupQuery.eq('facebook_user', nextTask.facebook_user);
    const { data: group } = await groupQuery.limit(1).maybeSingle();

    // NOTE: the extension's SSE handler listens for 'job_available' (not
    // 'new_job') to trigger an immediate checkJobs(). Sending the matching
    // event gives real-time pickup instead of waiting for the ~1min MV3 alarm.
    // Scoped to the task's own workspace: this payload contains the post
    // content and target group, so it must reach only that tenant.
    broadcastSSE({
        type: 'job_available',
        job: { ...nextTask, group_url: group?.url, status: 'SENT' }
    }, nextTask.workspace_id || null);

    await updateTaskStatus(nextTask.id, 'SENT', 'Waiting for worker handshake...');

    await supabase.from('system_logs').insert([{
        log_level: 'info',
        source: 'server_scheduler',
        message: `📡 Dispatched Task #${nextTask.id} to group: ${group?.url || nextTask.group_id}`
    }]);

    emitWorkspaceRefresh(nextTask.workspace_id, { queue: true });
}

// Dispatch runs PER TENANT.
//
// It used to hold one global "is anything in flight?" gate and one global
// stop/throttle flag, which meant a single busy or paused account stalled
// publishing for every other account on the server. Each workspace now gets
// its own gate, so tenants proceed independently — while keeping the property
// that matters within a tenant: at most one task in flight at a time, which is
// what stops repeated navigation to the same Facebook group.
async function runDispatchTick() {
    if (dispatchLockActive) return;
    dispatchLockActive = true;
    const now = new Date();

    try {
        // A. Bucket in-flight tasks by workspace, handling handshake timeouts.
        const { data: activeTasks } = await supabase
            .from('posts')
            .select('id, status, attempt_count, group_id, workspace_id')
            .in('status', ['SENT', 'PROCESSING'])
            .eq('app_source', 'backup');

        const activeByWorkspace = new Map();
        const bumpActive = (wsId) => {
            const key = wsId || null;
            activeByWorkspace.set(key, (activeByWorkspace.get(key) || 0) + 1);
        };

        if (activeTasks && activeTasks.length > 0) {
            // Check for timeouts on SENT tasks (Handshake failure)
            for (const active of activeTasks) {
                let stillActive = true;
                if (active.status === 'SENT') {
                    let sentAt = sentTaskTimestamps.get(active.id);
                    if (!sentAt) {
                        sentAt = now.getTime();
                        sentTaskTimestamps.set(active.id, sentAt);
                    }
                    if (now.getTime() - sentAt > SENT_HANDSHAKE_TIMEOUT_MS) {
                        sentTaskTimestamps.delete(active.id);
                        stillActive = false; // timed out — no longer occupies its tenant's slot
                        // RETRY CAP + BACKOFF: a stuck-SENT task used to be reset to PENDING
                        // unconditionally, so a group with a broken selector got re-dispatched
                        // every ~2min forever — the extension kept opening a tab and navigating
                        // to the SAME Facebook group over and over, which reads as bot/spam
                        // behavior to Facebook and got the account rate-limited/checkpointed.
                        // Now we cap retries and back off exponentially instead.
                        const attempts = (active.attempt_count || 0) + 1;
                        if (attempts >= MAX_DISPATCH_RETRIES) {
                            console.log(`🛑 [Retry Cap] Task ${active.id} (group ${active.group_id}) exceeded ${MAX_DISPATCH_RETRIES} handshake attempts — marking FAILED instead of re-hitting the group.`);
                            await supabase.from('posts').update({
                                status: 'FAILED', attempt_count: attempts,
                                failure_reason: `No worker handshake after ${MAX_DISPATCH_RETRIES} attempts (stopped to avoid repeated navigation to the same group)`
                            }).eq('id', active.id);
                            logEvent(active.workspace_id, active.id, 'FAILED', 'Retry cap reached — stopped re-dispatching to protect the account from rate limiting', { attempts, group_id: active.group_id });
                        } else {
                            const delayMs = dispatchBackoffMs(attempts);
                            console.log(`⏳ [Timeout] Task ${active.id} stuck in SENT for >${SENT_HANDSHAKE_TIMEOUT_MS/1000}s (attempt ${attempts}/${MAX_DISPATCH_RETRIES}). Backing off ${Math.round(delayMs / 1000)}s before retry.`);
                            await supabase.from('posts').update({
                                status: 'PENDING', attempt_count: attempts,
                                scheduled_time: new Date(now.getTime() + delayMs).toISOString()
                            }).eq('id', active.id);
                        }
                    }
                } else if (active.status === 'PROCESSING') {
                    // Ensure processing tasks are in our tracking map for the heartbeat
                    if (!processingStartTimestamps.has(active.id)) {
                        processingStartTimestamps.set(active.id, now.getTime() - 10000); // Assume it started 10s ago
                    }
                }
                if (stillActive) bumpActive(active.workspace_id);
            }
        }

        // B. Take the due queue in time order and dispatch at most one task per
        //    idle tenant. The limit is a window over all tenants rather than a
        //    single row, so one workspace's backlog cannot starve another's.
        const { data: dueTasks, error: fetchError } = await supabase
            .from('posts')
            .select('*')
            .eq('status', 'PENDING')
            .eq('app_source', 'backup')
            .lte('scheduled_time', now.toISOString())
            .order('scheduled_time', { ascending: true })
            .limit(DISPATCH_SCAN_LIMIT);

        if (fetchError || !dueTasks || dueTasks.length === 0) return;

        const dispatchedWorkspaces = new Set();

        for (const nextTask of dueTasks) {
            const wsKey = nextTask.workspace_id || null;

            // One in flight per tenant, and one dispatch per tenant per tick.
            if (dispatchedWorkspaces.has(wsKey)) continue;
            if ((activeByWorkspace.get(wsKey) || 0) > 0) continue;

            // This tenant's own stop signal and throttle window.
            const state = tenantState(wsKey);
            if (state.workerStopSignal && state.workerStopUntil && now < state.workerStopUntil) continue;
            if (state.workerThrottleUntil && now < state.workerThrottleUntil) continue;

            console.log(`📡 Dispatching Task ${nextTask.id} to worker...`);

            // C. Mark as SENT (Pre-lock). Conditional on still being PENDING, so
            //    two ticks racing cannot both claim the same row.
            const { error: lockError } = await supabase
                .from('posts')
                .update({ status: 'SENT' })
                .eq('id', nextTask.id)
                .eq('status', 'PENDING');

            if (lockError) continue;

            sentTaskTimestamps.set(nextTask.id, Date.now());
            dispatchedWorkspaces.add(wsKey);
            await dispatchTask(nextTask);
        }
    } catch (e) {
        console.error("Queue Poller Error:", e);
        try {
            await supabase.from('system_logs').insert([{
                log_level: 'error',
                source: 'server_scheduler',
                message: `🔴 Poller Critical Error: ${e.message || e}`
            }]);
        } catch (inner) { console.error("Logger failed:", inner); }
    } finally {
        dispatchLockActive = false;
    }
}
setInterval(runDispatchTick, 5000);


// HEARTBEAT: Reset tasks stuck in PROCESSING/SENT for more than 4 minutes
setInterval(async () => {
    try {
        const now = Date.now();
        const FOUR_MINUTES = 4 * 60 * 1000;

        // Demo tasks are never dispatched to a real worker (jobs/next filters
        // app_source='backup'), so nothing above ever moves them out of SENT/
        // PROCESSING if they're seeded/left in that state — they'd sit "in
        // progress" forever and the dashboard's countdown would show a
        // permanently stuck clock. Self-heal by resetting the whole demo
        // workspace back to its canonical seed state (same as /api/demo/reset).
        try {
            const DEMO_STUCK_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes
            const { data: stuckDemoTasks } = await supabase
                .from('posts')
                .select('id, workspace_id, created_by, created_at')
                .in('status', ['PROCESSING', 'SENT'])
                .eq('app_source', 'demo')
                .lt('created_at', new Date(now - DEMO_STUCK_THRESHOLD_MS).toISOString());
            const staleDemoWorkspaces = new Map();
            for (const t of stuckDemoTasks || []) {
                if (t.workspace_id && !staleDemoWorkspaces.has(t.workspace_id)) {
                    staleDemoWorkspaces.set(t.workspace_id, t.created_by);
                }
            }
            for (const [wsId, ownerId] of staleDemoWorkspaces) {
                console.log(`[Heartbeat] Demo workspace ${wsId} has tasks stuck > 30min — resetting to seed state.`);
                await resetDemoWorkspace(wsId, ownerId);
            }
        } catch (e) {
            console.error('[Heartbeat] Demo self-heal failed:', e.message);
        }

        const staleIds = [];
        for (const [taskId, startTime] of processingStartTimestamps.entries()) {
            if (now - startTime > FOUR_MINUTES) staleIds.push(taskId);
        }
        for (const [taskId, startTime] of sentTaskTimestamps.entries()) {
            if (now - startTime > FOUR_MINUTES) staleIds.push(taskId);
        }

        // DB fallback: catch tasks that never made it into the in-memory map
        // (e.g. server restarted while task was mid-flight and startup populate failed)
        const { data: dbStuck } = await supabase
            .from('posts')
            .select('id, created_at, attempt_count, group_id, workspace_id')
            .in('status', ['PROCESSING', 'SENT'])
            .eq('app_source', 'backup');
        if (!dbStuck) return;

        const staleTasks = [];
        for (const t of dbStuck) {
            const id = t.id;
            const trackedStart = processingStartTimestamps.get(id) || sentTaskTimestamps.get(id);
            const ageMs = trackedStart ? (now - trackedStart) : (now - new Date(t.created_at).getTime());
            if (ageMs > FOUR_MINUTES) {
                staleTasks.push(t);
            } else if (!trackedStart) {
                // Register it so next heartbeat can track it
                processingStartTimestamps.set(id, new Date(t.created_at).getTime());
            }
        }

        // SCHEDULED RESUME (moderation cooldown): give moderation-blocked posts
        // one more shot instead of leaving them CANCELLED forever. Capped via
        // attempt_count — moderation-CANCELLED posts reach CANCELLED directly
        // from the content script's pre-flight check, never through the
        // SENT/handshake retry path below, so attempt_count is always 0 for them
        // at cancel time and sharing the column here is safe. Placed BEFORE the
        // `staleTasks.length === 0` early return so this still runs every tick
        // even when nothing is currently stuck in PROCESSING/SENT.
        const MODERATION_COOLDOWN_MS = 48 * 60 * 60 * 1000; // 48h
        const MODERATION_RESUME_CAP = 2;
        const modCutoff = new Date(now - MODERATION_COOLDOWN_MS).toISOString();
        // RESUME ONLY WHAT WAS PROVABLY NEVER SUBMITTED.
        //
        // The comment above was written when the pre-flight check was the ONLY way a
        // post reached moderation-CANCELLED, and there nothing had been sent — so
        // re-queueing was harmless. content.js now also reports CANCELLED with the
        // same 'ממתין לאישור מנהל' marker for a post that WAS submitted and is
        // waiting in the group's approval queue. Resuming that one republishes
        // content a moderator may already have approved: a duplicate Facebook post.
        //
        // The two cases are told apart by error_code, not by the reason prose.
        // Selecting positively on MODERATION_BLOCKED_NOT_SENT also makes the default
        // safe: anything unmarked (legacy rows, or a report that came through the
        // legacy PATCH route, which does not persist error_code) is left CANCELLED
        // for a human rather than republished on a guess.
        const { data: modCancelled } = await supabase
            .from('posts').select('id, group_id, attempt_count, workspace_id')
            .eq('status', 'CANCELLED').eq('app_source', 'backup')
            .eq('error_code', 'MODERATION_BLOCKED_NOT_SENT')
            .like('failure_reason', '%ממתין לאישור מנהל%')
            .not('ended_at', 'is', null).lte('ended_at', modCutoff);

        let resumedAny = false;
        for (const p of modCancelled || []) {
            const attempts = p.attempt_count || 0;
            if (attempts >= MODERATION_RESUME_CAP) continue; // stays CANCELLED — operator must act manually (approve in FB or clear the group's moderation setting)
            await supabase.from('posts').update({
                status: 'PENDING', attempt_count: attempts + 1,
                scheduled_time: new Date(now).toISOString(),
                // Clear the moderation marker too: the row is an ordinary queued job
                // again, and a stale code would misreport this attempt's outcome.
                failure_reason: null, error_code: null
            }).eq('id', p.id).eq('status', 'CANCELLED');
            resumedAny = true;
            console.log(`[Heartbeat] Task ${p.id} (group ${p.group_id}) auto-resumed after 48h moderation cooldown (attempt ${attempts + 1}/${MODERATION_RESUME_CAP}).`);
            logEvent(p.workspace_id, p.id, 'PENDING', `Auto-resumed after 48h moderation cooldown (attempt ${attempts + 1}/${MODERATION_RESUME_CAP})`, { group_id: p.group_id, reset_by: 'moderation_resume_sweep' });
        }
        if (resumedAny) {
            const workspaceIds = [...new Set((modCancelled || []).map(p => p.workspace_id).filter(Boolean))];
            workspaceIds.forEach(workspaceId => emitWorkspaceRefresh(workspaceId, { queue: true, data: true }));
        }

        if (staleTasks.length === 0) return;

        // RETRY CAP + BACKOFF (see MAX_DISPATCH_RETRIES / dispatchBackoffMs above): resetting
        // a stuck task to PENDING unconditionally caused it to be re-dispatched to the same
        // Facebook group every few minutes indefinitely, which looks like bot/spam behavior
        // to Facebook and triggered an account checkpoint. Cap retries per task instead.
        for (const t of staleTasks) {
            processingStartTimestamps.delete(t.id);
            sentTaskTimestamps.delete(t.id);
            const attempts = (t.attempt_count || 0) + 1;
            if (attempts >= MAX_DISPATCH_RETRIES) {
                await supabase.from('posts').update({
                    status: 'FAILED', attempt_count: attempts,
                    failure_reason: `Stuck > 4 minutes, ${MAX_DISPATCH_RETRIES} attempts exhausted (stopped to avoid repeated navigation to the same group)`
                }).in('id', [t.id]).in('status', ['PROCESSING', 'SENT']);
                console.log(`🛑 [Heartbeat Retry Cap] Task ${t.id} (group ${t.group_id}) exceeded ${MAX_DISPATCH_RETRIES} attempts — marked FAILED.`);
                logEvent(t.workspace_id, t.id, 'FAILED', 'Retry cap reached via heartbeat — stopped re-dispatching to protect the account from rate limiting', { attempts, group_id: t.group_id, reset_by: 'heartbeat' });
            } else {
                const delayMs = dispatchBackoffMs(attempts);
                await supabase.from('posts').update({
                    status: 'PENDING', attempt_count: attempts,
                    scheduled_time: new Date(now + delayMs).toISOString()
                }).in('id', [t.id]).in('status', ['PROCESSING', 'SENT']);
                console.log(`[Heartbeat] Task ${t.id} stale, attempt ${attempts}/${MAX_DISPATCH_RETRIES}, backing off ${Math.round(delayMs / 1000)}s.`);
                logEvent(t.workspace_id, t.id, 'STUCK', 'Heartbeat auto-reset stuck task to PENDING', { reset_by: 'heartbeat', attempts });
            }
        }
        const staleWorkspaceIds = [...new Set(staleTasks.map(t => t.workspace_id).filter(Boolean))];
        staleWorkspaceIds.forEach(workspaceId => emitWorkspaceRefresh(workspaceId, { queue: true, data: true }));
    } catch (e) {
        console.error('[Heartbeat] Unexpected error:', e);
    }
}, 60000);

// --- SYSTEM STATUS ---
app.get('/api/system/status', requireAuth, requireWorkspaceAccess, async (req, res) => {
    const now = new Date();
    // Worker presence is per tenant: without this the dashboard reported
    // whichever extension checked in last, no matter whose it was.
    const state = tenantState(req.workspaceId);

    // A PAIRED extension heartbeats to /api/workers/:id/heartbeat, which writes to
    // browser_workers — it never touches this in-memory state, which only the
    // legacy /api/worker/heartbeat fills. Reading the memory alone therefore
    // reported a paired (and perfectly healthy) worker as OFFLINE with version
    // UNKNOWN forever. Take whichever source checked in more recently, so paired
    // and unpaired installs both report correctly.
    let dbWorker = null;
    if (req.workspaceId) {
        const { data } = await supabase.from('browser_workers')
            .select('last_seen_at, extension_version, browser_version, status')
            .eq('workspace_id', req.workspaceId).is('revoked_at', null)
            .order('last_seen_at', { ascending: false, nullsFirst: false }).limit(1);
        dbWorker = (data && data[0]) || null;
    }

    const memAt = state.lastWorkerCheckin ? new Date(state.lastWorkerCheckin) : null;
    const dbAt = dbWorker && dbWorker.last_seen_at ? new Date(dbWorker.last_seen_at) : null;
    const dbIsFresher = dbAt && (!memAt || dbAt > memAt);
    const lastCheckin = dbIsFresher ? dbAt.toISOString() : state.lastWorkerCheckin;
    const version = (dbIsFresher && dbWorker.extension_version)
        ? dbWorker.extension_version
        : state.lastWorkerVersion;

    const checkinAge = lastCheckin ? (now - new Date(lastCheckin)) / 1000 : null;
    // Extension heartbeats fire on a chrome.alarms 1-minute period (MV3's minimum
    // resolution, and its actual firing time can drift/lag when the service worker
    // was suspended). A 60s window flaps to OFFLINE between ticks; 90s gives slack.
    const workerActive = checkinAge !== null && checkinAge < 90;

    res.json({
        worker_status: workerActive ? 'ACTIVE' : 'OFFLINE',
        worker_message: workerActive ? 'Worker is active' : 'No recent worker check-in',
        last_worker_checkin: lastCheckin,
        worker_version: version,
        worker_origin: state.lastWorkerOrigin,
        worker_extension_id: state.lastWorkerExtensionId,
        worker_stopped: state.workerStopSignal,
        server_time: now.toISOString()
    });
});

// The job routes below hand a concrete task — post text, target group, media —
// to whichever extension asked. Every other scoped route degrades harmlessly
// without a workspace (a list comes back wider than it should), but these two
// cause an ACTION: publishing one tenant's content to another tenant's group
// from a third party's Facebook session. That is not a leak that can be undone
// by fixing the filter afterwards.
//
// So once the deployment is locked down (WORKER_AUTH_ENFORCED=true), an
// unscoped caller is refused outright rather than served globally. Reaching
// here without a workspace at that point means a real misconfiguration:
// EXTENSION_API_KEY set but EXTENSION_KEY_WORKSPACE_ID missing (see
// middleware/worker.cjs). The message says so, because "no jobs" would send
// someone hunting through the queue instead of the env vars.
function refuseIfUnscoped(req, res) {
    if (req.workspaceId) return false;
    if (!WORKER_AUTH_ENFORCED) return false;
    console.warn('[jobs] refused an unscoped job request — pair the extension, or set EXTENSION_KEY_WORKSPACE_ID');
    res.status(409).json({
        error: 'This extension is not bound to a workspace. Pair it from the dashboard, or set EXTENSION_KEY_WORKSPACE_ID on the server.',
        code: 'WORKSPACE_UNRESOLVED'
    });
    return true;
}

// Next Job for Extension (polled by background.js every 6s)
//
// Scoped to the caller's workspace when it is a paired worker, or when the
// shared extension key is bound to one. Without that filter this handed out
// whichever task was next GLOBALLY — see refuseIfUnscoped above.
app.get('/api/jobs/next', optionalWorker, async (req, res) => {
    if (refuseIfUnscoped(req, res)) return;
    let nextQuery = supabase
        .from('posts')
        .select('*')
        .eq('status', 'SENT')
        .eq('app_source', 'backup');
    if (req.workspaceId) nextQuery = nextQuery.eq('workspace_id', req.workspaceId);

    const { data } = await nextQuery
        .order('scheduled_time', { ascending: true })
        .limit(1)
        .maybeSingle();

    if (!data) return res.json({ job: null });

    // Fetch group URL separately (posts table doesn't store group_url).
    // A group id can exist once per user, so scope to this task's workspace +
    // facebook_user and cap at one row — .maybeSingle() alone would throw when
    // several users share the group.
    let nextGroupQuery = supabase.from('groups').select('name, url').eq('id', data.group_id);
    if (data.workspace_id) nextGroupQuery = nextGroupQuery.eq('workspace_id', data.workspace_id);
    if (data.facebook_user) nextGroupQuery = nextGroupQuery.eq('facebook_user', data.facebook_user);
    const { data: group } = await nextGroupQuery.limit(1).maybeSingle();

    // Mark as PROCESSING immediately to prevent double-dispatch. The row already
    // came from a workspace-filtered read above, so this filter is belt and
    // braces — but it keeps the guarantee local to the write rather than
    // depending on a caller several lines up.
    let claimQuery = supabase.from('posts').update({ status: 'PROCESSING' }).eq('id', data.id);
    if (req.workspaceId) claimQuery = claimQuery.eq('workspace_id', req.workspaceId);
    await claimQuery;
    sentTaskTimestamps.delete(data.id);
    processingStartTimestamps.set(data.id, Date.now()); // START TRACKING HERE
    await updateTaskStatus(data.id, 'PROCESSING', 'Extension picked up job');

    // Explicitly list safe fields — avoid spreading database objects to prevent prototype pollution
    res.json({
        job: {
            id: data.id,
            content: data.content,
            group_id: data.group_id,
            media_url: data.media_url || null,
            image_url: data.image_url || null,
            status: data.status,
            scheduled_time: data.scheduled_time,
            created_at: data.created_at,
            group_url: group?.url || data.group_url || null,
            group_name: group?.name || data.group_id
        }
    });
});

// Job lookup by group URL — used by content.js auto-execute fallback
app.get('/api/jobs/for-url', optionalWorker, async (req, res) => {
    if (refuseIfUnscoped(req, res)) return;
    const { url } = req.query;
    if (!url) return res.json({ job: null });

    const normalizedUrl = url.replace(/\/$/, '');

    // Find group by URL. The same URL can now map to several per-user rows, so
    // cap at one (id/name are identical across a group's copies). Scoped to the
    // caller's workspace when paired, for the same reason as /api/jobs/next —
    // a shared group URL otherwise resolves to whichever tenant's row came first.
    let groupQuery = supabase
        .from('groups')
        .select('id, name')
        .or(`url.eq.${normalizedUrl},url.eq.${normalizedUrl}/`);
    if (req.workspaceId) groupQuery = groupQuery.eq('workspace_id', req.workspaceId);
    const { data: group } = await groupQuery.limit(1).maybeSingle();

    if (!group) return res.json({ job: null });

    // Find PROCESSING task for this group
    let taskQuery = supabase
        .from('posts')
        .select('*')
        .eq('status', 'PROCESSING')
        .eq('app_source', 'backup')
        .eq('group_id', group.id);
    if (req.workspaceId) taskQuery = taskQuery.eq('workspace_id', req.workspaceId);
    const { data: task } = await taskQuery
        .order('scheduled_time', { ascending: true })
        .limit(1)
        .maybeSingle();

    res.json({ job: task ? { ...task, group_url: normalizedUrl, group_name: group.name || task.group_id } : null });
});

// POST task status update (called by backup extension background.js REPORT_STATUS)
app.post('/api/tasks/update-status', optionalWorker, validate(updateStatusSchema), async (req, res) => {
    const { taskId, status, failure_reason, proof_url } = req.validated;
    const numericId = parseInt(taskId) || taskId;
    console.log(`📝 [POST] /api/tasks/update-status → Task ${numericId}: ${status}`);

    if (status === 'LOG') {
        if (failure_reason) {
            await supabase.from('system_logs').insert([{ log_level: 'info', source: 'extension_worker', message: `Task #${numericId}: ${failure_reason}` }]);
        }
        return res.json({ success: true, logged: true });
    }

    // Idempotency check: prevent duplicate updates
    const idempotencyKey = generateIdempotencyKey(numericId, status, failure_reason);
    if (isIdempotentDuplicate(numericId, idempotencyKey)) {
        console.log(`[IDEMPOTENCY] Duplicate update detected for task ${numericId}, skipping`);
        return res.json({ success: true, duplicate: true });
    }

    const update = { status };
    if (failure_reason) update.failure_reason = failure_reason;
    if (proof_url) update.proof_url = proof_url;

    // First, fetch the task to get group_id. Scoped to the caller's workspace
    // when paired, so one tenant's worker cannot report on another's task.
    let taskLookup = supabase.from('posts').select('group_id, workspace_id').eq('id', numericId);
    if (req.workspaceId) taskLookup = taskLookup.eq('workspace_id', req.workspaceId);
    const { data: taskData } = await taskLookup.maybeSingle();

    if (req.workspaceId && !taskData) {
        return res.status(404).json({ error: 'Task not found in this workspace.' });
    }

    let updateQuery = supabase.from('posts').update(update).eq('id', numericId);
    if (req.workspaceId) updateQuery = updateQuery.eq('workspace_id', req.workspaceId);
    const { error } = await updateQuery;
    if (error) {
        console.error('Status update error:', error.message);
        return res.status(500).json({ error: error.message });
    }

    console.log(`✅ [POST] Task ${numericId} updated to ${status} in DB`);

    if (status === 'FAILED') {
        await supabase.from('system_logs').insert([{ log_level: 'error', source: 'extension_worker', message: `Task #${numericId} FAILED: ${failure_reason || 'Unknown error'}` }]);
        logEvent(req.workspaceId || taskData?.workspace_id, numericId, 'FAILED', failure_reason || 'Task failed with unknown error', { source: 'extension_worker' });
    }

    if (['SUCCESS', 'FAILED', 'CANCELLED'].includes(status)) {
        processingStartTimestamps.delete(numericId);
        sentTaskTimestamps.delete(numericId);
    }

    // Emit with group_id for real-time dashboard update
    emitWorkspaceStatus(req.workspaceId || taskData?.workspace_id || null, { taskId: numericId, status, group_id: taskData?.group_id });
    // Delayed queue_updated to let status_update settle in frontend first
    setTimeout(() => emitWorkspaceRefresh(req.workspaceId || taskData?.workspace_id || null, { queue: true }), 500);
    res.json({ success: true });
});

// PATCH task status (called by full_app extension on SUCCESS/FAILED)
app.patch('/api/tasks/:id/status', optionalWorker, validate(patchStatusSchema), async (req, res) => {
    const { id } = req.params;
    const { status, failure_reason, error: bodyError, completed_at, proof_url } = req.validated;
    const failReason = failure_reason || bodyError;
    console.log(`📝 [PATCH] /api/tasks/${id}/status → ${status} (${failReason || 'No error'})`);

    // Idempotency check: prevent duplicate updates
    const idempotencyKey = generateIdempotencyKey(id, status, failReason);
    if (isIdempotentDuplicate(id, idempotencyKey)) {
        console.log(`[IDEMPOTENCY] Duplicate PATCH detected for task ${id}, skipping`);
        return res.json({ success: true, duplicate: true });
    }

    // SPECIAL: If status is 'LOG', don't update post status, just insert into system_logs
    if (status === 'LOG') {
        if (failReason) {
            await supabase.from('system_logs').insert([{
                log_level: 'info',
                source: 'extension_worker',
                message: `Task #${id}: ${failReason}`
            }]);
        }
        return res.json({ success: true, logged: true });
    }

    // Fetch task data including group_id before updating. Scoped to the
    // caller's workspace when paired — see /api/tasks/update-status above.
    let taskLookup = supabase.from('posts').select('group_id, workspace_id').eq('id', id);
    if (req.workspaceId) taskLookup = taskLookup.eq('workspace_id', req.workspaceId);
    const { data: taskData } = await taskLookup.maybeSingle();

    if (req.workspaceId && !taskData) {
        return res.status(404).json({ error: 'Task not found in this workspace.' });
    }

    const update = { status };
    if (failReason) update.failure_reason = failReason;
    if (completed_at) update.ended_at = completed_at;
    // The content script's moderation-block path (content.js ~825-835) sends
    // CANCELLED with no completed_at, so ended_at was never set for these rows —
    // leaving nothing for the moderation-resume sweep below to anchor its 48h
    // cooldown on. Stamp it here for any CANCELLED that didn't already get one.
    else if (status === 'CANCELLED') update.ended_at = new Date().toISOString();
    if (proof_url) update.proof_url = proof_url;

    let patchQuery = supabase.from('posts').update(update).eq('id', id);
    if (req.workspaceId) patchQuery = patchQuery.eq('workspace_id', req.workspaceId);
    const { error } = await patchQuery;
    if (error) console.error('Status update error:', error.message);

    // Automation Failure AUDIT LOG
    if (status === 'FAILED') {
        await supabase.from('system_logs').insert([{
            log_level: 'error',
            source: 'extension_worker',
            message: `Task #${id} FAILED: ${failReason || 'Unknown error'}`
        }]);
        logEvent(req.workspaceId || taskData?.workspace_id, id, 'FAILED', failReason || 'Task failed with unknown error', { source: 'extension_worker' });
    }

    // Task Cancellation LOG
    if (status === 'CANCELLED') {
        await supabase.from('system_logs').insert([{
            log_level: 'warn',
            source: 'extension_worker',
            message: `Task #${id} CANCELLED: ${failReason || 'Manual cancellation'}`
        }]);
        logEvent(req.workspaceId || taskData?.workspace_id, id, 'CANCELLED', failReason || 'Task cancelled', { source: 'extension_worker', reason: failReason });
    }

    // Clear from tracking maps on end states
    if (['SUCCESS', 'FAILED', 'CANCELLED'].includes(status)) {
        processingStartTimestamps.delete(parseInt(id) || id);
        sentTaskTimestamps.delete(parseInt(id) || id);
    }

    // Emit with group_id for real-time dashboard update
    emitWorkspaceStatus(req.workspaceId || taskData?.workspace_id || null, { taskId: parseInt(id) || id, status, group_id: taskData?.group_id });
    emitWorkspaceRefresh(req.workspaceId || taskData?.workspace_id || null, { queue: true });
    res.json({ success: true });

    // Kick the dispatcher immediately when the worker just finished a task —
    // otherwise we wait up to 5s (the poller cadence) with an idle extension
    // and a scheduled-time-in-the-past task sitting in PENDING.
    if (['SUCCESS', 'FAILED', 'CANCELLED'].includes(status)) {
        setImmediate(() => { runDispatchTick().catch(err => console.error('Immediate dispatch failed:', err)); });
    }
});

// --- QUEUE (POSTS) ---
app.get('/api/queue', ...dashboardAuth, async (req, res) => {
    console.log('📋 [QUEUE] Fetching queue...');

    // No embedded groups(...) join here — the migration 0008 dropped the
    // posts→groups FK (a group id is no longer globally unique; it exists once
    // per facebook_user), and PostgREST refuses to resolve the auto-relationship
    // without a FK. Fetch posts, then merge in group name/url manually.
    const { data, error } = await scopeToWorkspace(supabase
        .from('posts')
        .select('*')
        .in('app_source', ['backup', 'demo']), req)
        .order('scheduled_time', { ascending: true })
        .range(0, 4999);

    if (error) {
        console.error('❌ [QUEUE] Error:', error.message);
        return res.status(500).json({ error: error.message });
    }

    // Look up each post's group name/url, matching the group to the SAME
    // account the post belongs to (a shared group id can be attributed to
    // multiple accounts under the new per-user key).
    const groupIds = [...new Set((data || []).map(p => p.group_id).filter(Boolean))];
    const groupIndex = new Map(); // key: `${fbUser}\x1f${id}` and fallback `${id}`
    if (groupIds.length > 0) {
        const { data: groups } = await scopeToWorkspace(supabase
            .from('groups')
            .select('id, name, url, facebook_user')
            .in('id', groupIds), req);
        (groups || []).forEach(g => {
            groupIndex.set(`${g.facebook_user || ''}\x1f${g.id}`, g);
            // Keep a plain-id fallback for posts that don't carry a facebook_user
            // (e.g. legacy rows created before the per-user era).
            if (!groupIndex.has(g.id)) groupIndex.set(g.id, g);
        });
    }

    const rows = (data || []).map(p => {
        const g = groupIndex.get(`${p.facebook_user || ''}\x1f${p.group_id}`)
               || groupIndex.get(p.group_id);
        return {
            ...p,
            group_name: g?.name || p.group_id,
            group_url:  g?.url  || null,
        };
    });

    console.log(`✅ [QUEUE] Fetched ${rows.length} tasks`);
    if (rows.length > 0) {
        const tasksWithMedia = rows.filter(r => r.media_paths && r.media_paths.length > 0).length;
        console.log(`   Tasks with media: ${tasksWithMedia}`);
    }

    res.json({ queue: rows });
});

// --- TASK MANAGEMENT ---

// Cancel a single task
app.post('/api/tasks/:id/cancel', ...dashboardAuth, async (req, res) => {
    const { id } = req.params;
    const { error } = await scopeToWorkspace(supabase
        .from('posts')
        .update({ status: 'CANCELLED', failure_reason: 'ביטול ידני' })
        .eq('id', id)
        .in('status', ['PENDING']), req);
    if (error) return res.status(500).json({ error: error.message });
    logEvent(req.workspaceId, id, 'CANCELLED', 'Task manually cancelled', { reason: 'ביטול ידני' });
    emitWorkspaceRefresh(req.workspaceId, { queue: true });
    res.json({ success: true });
});

// Cancel all pending tasks
app.post('/api/tasks/cancel-all-pending', ...dashboardAuth, async (req, res) => {
    const { error } = await scopeToWorkspace(supabase
        .from('posts')
        .update({ status: 'CANCELLED' })
        .eq('status', 'PENDING')
        .eq('app_source', 'backup'), req);
    if (error) return res.status(500).json({ error: error.message });
    emitWorkspaceRefresh(req.workspaceId, { queue: true });
    res.json({ success: true });
});

// Bulk delete tasks
app.post('/api/tasks/bulk-delete', ...dashboardAuth, async (req, res) => {
    const { ids } = req.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0)
        return res.status(400).json({ error: 'Missing ids' });
    const { error } = await scopeToWorkspace(supabase.from('posts').delete().in('id', ids), req);
    if (error) return res.status(500).json({ error: error.message });
    emitWorkspaceRefresh(req.workspaceId, { queue: true });
    res.json({ success: true });
});

// Update a task
app.patch('/api/tasks/:id', ...dashboardAuth, async (req, res) => {
    const { id } = req.params;
    const updates = { ...req.body };
    // Never allow the client to move a row between workspaces or reassign ownership.
    delete updates.workspace_id;
    delete updates.created_by;
    const { error } = await scopeToWorkspace(supabase.from('posts').update(updates).eq('id', id), req);
    if (error) return res.status(500).json({ error: error.message });
    emitWorkspaceRefresh(req.workspaceId, { queue: true });
    res.json({ success: true });
});

// Delete a task
app.delete('/api/tasks/:id', ...dashboardAuth, async (req, res) => {
    const { id } = req.params;
    const { error } = await scopeToWorkspace(supabase.from('posts').delete().eq('id', id), req);
    if (error) return res.status(500).json({ error: error.message });
    emitWorkspaceRefresh(req.workspaceId, { queue: true });
    res.json({ success: true });
});

// --- WORKER CONTROL ---
// Stop/resume apply to the calling tenant only. As one shared flag, any
// account pressing Stop halted publishing for everybody on the server.
app.post('/api/worker/stop', ...dashboardAuth, denyDemo, (req, res) => {
    const state = tenantState(req.workspaceId);
    state.workerStopSignal = true;
    state.workerStopUntil  = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h safety
    broadcastSSE({ type: 'stop_worker' }, req.workspaceId || null);
    emitWorkspaceEvent(req.workspaceId, 'worker_stop_signal');
    console.log('🛑 Worker stop signal sent');
    res.json({ success: true });
});

app.post('/api/worker/resume', ...dashboardAuth, denyDemo, (req, res) => {
    const state = tenantState(req.workspaceId);
    state.workerStopSignal = false;
    state.workerStopUntil  = null;
    emitWorkspaceEvent(req.workspaceId, 'worker_resumed');
    console.log('▶️ Worker resumed');
    res.json({ success: true });
});

// Worker heartbeat (extension calls this to register presence)
app.post('/api/worker/heartbeat', optionalWorker, (req, res) => {
    // The extension (background.js) sends manifest_version/origin_folder/extension_id —
    // accept both those field names and the older version/origin/extensionId names so
    // this doesn't silently regress again if either side changes independently.
    const state = tenantState(req.workspaceId);
    state.lastWorkerCheckin   = new Date().toISOString();
    state.lastWorkerVersion   = req.body.manifest_version || req.body.version || state.lastWorkerVersion;
    state.lastWorkerOrigin    = req.body.origin_folder || req.body.origin || state.lastWorkerOrigin;
    state.lastWorkerExtensionId = req.body.extension_id || req.body.extensionId || state.lastWorkerExtensionId;
    res.json({ success: true, stop_signal: state.workerStopSignal });
});

// --- MANUAL STUCK TASK RESET ---
app.post('/api/tasks/reset-stuck', ...dashboardAuth, async (req, res) => {
    try {
        const now = Date.now();
        const FOUR_MINUTES = 4 * 60 * 1000;

        // Find tasks stuck in PROCESSING/SENT for >4 minutes (using created_at as proxy)
        const { data: stuckTasks, error: fetchError } = await scopeToWorkspace(supabase
            .from('posts')
            .select('id, status, created_at')
            .in('status', ['PROCESSING', 'SENT'])
            .eq('app_source', 'backup'), req);

        if (fetchError) throw fetchError;

        const toReset = [];
        if (stuckTasks) {
            stuckTasks.forEach(task => {
                const ageMs = now - new Date(task.created_at).getTime();
                // A task is stuck if it's been in system for >4 mins AND still in PROCESSING/SENT
                if (ageMs > FOUR_MINUTES) {
                    toReset.push(task.id);
                }
            });
        }

        if (toReset.length === 0) {
            return res.json({ success: true, message: 'No stuck tasks found', reset_count: 0 });
        }

        // Reset stuck tasks to PENDING
        const newScheduledTime = new Date(now + 180000).toISOString();
        const { error: updateError } = await supabase
            .from('posts')
            .update({ status: 'PENDING', scheduled_time: newScheduledTime })
            .in('id', toReset);

        if (updateError) throw updateError;

        // Clear from in-memory tracking and log
        toReset.forEach(id => {
            processingStartTimestamps.delete(id);
            sentTaskTimestamps.delete(id);
            logEvent(req.workspaceId, id, 'STUCK', 'Manually reset from stuck state', { reset_by: 'manual' });
        });

        emitWorkspaceRefresh(req.workspaceId, { queue: true, data: true });

        console.log(`[ManualReset] Reset ${toReset.length} stuck task(s): ${toReset.join(', ')}`);
        res.json({ success: true, message: `Reset ${toReset.length} stuck task(s)`, reset_count: toReset.length, task_ids: toReset });
    } catch (error) {
        console.error('[ManualReset] Error:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// --- GLOBAL ERROR HANDLER ---
app.use((err, req, res, next) => {
    console.error("🚨 GLOBAL ERROR:", err.message, "Code:", err.code);
    if (err instanceof multer.MulterError) {
        console.error("📦 Multer Error - Code:", err.code, "Field:", err.field);
        return res.status(400).json({ error: `Multer: ${err.message}` });
    }
    res.status(500).json({ error: err.message || "Server error" });
});

// Phase 6: periodic queue maintenance — recovers jobs whose worker lock expired
// (worker/browser/server crash) and handles schedules missed during downtime.
// Persistent (DB-backed), so it survives restarts.
const QUEUE_SWEEP_MS = 60 * 1000;
setInterval(() => {
    sweepExpiredLocks().catch(e => console.error('[sweep] locks:', e.message));
    sweepMissedSchedules().catch(e => console.error('[sweep] missed:', e.message));
}, QUEUE_SWEEP_MS);

// Belt-and-braces alongside the uncaughtException guard above: http.Server
// emits 'error' for bind failures, which is the documented place to catch them.
server.on('error', (err) => {
    if (err && err.code === 'EADDRINUSE') {
        console.error(`❌ Port ${PORT} is already in use — another SafePost server is running. Exiting.`);
        process.exit(1);
    }
    console.error('🔥 HTTP server error:', err);
    process.exit(1);
});

server.listen(PORT, '0.0.0.0', async () => {
    console.log(`🔥 SafePost OS Server running on http://localhost:${PORT} (Supabase Backend)`);
    // Populate processingStartTimestamps for any in-flight tasks from before server restart
    try {
        const { data } = await supabase
            .from('posts')
            .select('id, created_at, status, workspace_id')
            .in('status', ['PROCESSING', 'SENT'])
            .eq('app_source', 'backup');
        if (data && data.length > 0) {
            const now = Date.now();
            const FOUR_MINUTES = 4 * 60 * 1000;
            const stuckTasks = [];

            data.forEach(t => {
                const createdTime = new Date(t.created_at).getTime();
                const ageMs = now - createdTime;

                // Use actual created_at from DB, not current time
                if (t.status === 'PROCESSING') {
                    processingStartTimestamps.set(t.id, createdTime);
                } else {
                    sentTaskTimestamps.set(t.id, createdTime);
                }

                // If already stuck >4 mins (based on created_at), mark for immediate reset
                if (ageMs > FOUR_MINUTES) {
                    stuckTasks.push({ id: t.id, workspaceId: t.workspace_id, age: Math.round(ageMs / 1000) });
                }
            });

            console.log(`[Startup] Tracked ${data.length} in-flight task(s) for heartbeat`);

            // Immediately reset any tasks already stuck
            if (stuckTasks.length > 0) {
                console.log(`[Startup] Found ${stuckTasks.length} stuck task(s), resetting: ${stuckTasks.map(t => `#${t.id}(${t.age}s)`).join(', ')}`);
                const newScheduledTime = new Date(now + 180000).toISOString();
                await supabase
                    .from('posts')
                    .update({ status: 'PENDING', scheduled_time: newScheduledTime })
                    .in('id', stuckTasks.map(t => t.id))
                    .in('status', ['PROCESSING', 'SENT']);

                // Log stuck task resets
                stuckTasks.forEach(t => {
                    logEvent(t.workspaceId, t.id, 'STUCK', `Task was stuck for ${t.age}s on startup, reset to PENDING`, { age_seconds: t.age });
                });
            }
        }
    } catch (e) {
        console.error('[Startup] Could not init processing map:', e.message);
    }

    // NOTE: a second "auto-cleanup" sweep used to run here on the same 60s cadence as the
    // HEARTBEAT above, both racing to handle the same stuck PROCESSING/SENT tasks — this one
    // force-failed anything >4min past created_at unconditionally, which fought with the
    // heartbeat's retry/backoff bookkeeping (a task correctly backing off 8-20min after a
    // retry could get yanked to FAILED here mid-backoff). The heartbeat is now the single
    // owner of stuck-task recovery (with MAX_DISPATCH_RETRIES + dispatchBackoffMs), so this
    // duplicate was removed rather than reconciled.
});
