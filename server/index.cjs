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
        delete s.posts;
    });
    return stats;
}

// Derives a 0-100 health score from one group's aggregated stats, or null if
// the group has no post history yet (don't fabricate a score from nothing).
function computeGroupHealth(stats) {
    const total = (stats?.success || 0) + (stats?.failed || 0) + (stats?.cancelled || 0);
    if (total === 0) return null;
    const successRate = stats.success / total;
    const modPenalty = stats.cancelled > 0 ? 0.3 : 0;
    const failPenalty = Math.min(stats.failed / total, 0.5);
    const streakPenalty = (stats.consecutiveFailures || 0) >= 3 ? 0.2 : 0;
    return Math.round(Math.max(0, successRate - modPenalty - failPenalty - streakPenalty) * 100);
}

// Ensure uploads directory exists
const UPLOAD_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR);
}

// Multer Memory Storage Configuration
const storage = multer.memoryStorage();

const upload = multer({
    storage: storage,
    limits: { fileSize: 50 * 1024 * 1024 } // 50MB limit
});

const ALLOWED_ORIGINS = [
    'http://localhost:5173',
    'http://localhost:3001',
    'https://safepost-backup.vercel.app',
    'https://safepost-backup.onrender.com',
    'https://www.facebook.com',
    'https://web.facebook.com'
];

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
    facebook_user: Joi.string().optional().allow(null).max(500)
});

// Schema for POST /api/tasks/update-status
const updateStatusSchema = Joi.object({
    taskId: Joi.string().required().messages({
        'any.required': 'taskId is required'
    }),
    status: Joi.string().required().valid('PENDING', 'SENT', 'PROCESSING', 'SUCCESS', 'FAILED', 'CANCELLED', 'LOG').messages({
        'any.required': 'status is required',
        'any.only': 'status must be one of: PENDING, SENT, PROCESSING, SUCCESS, FAILED, CANCELLED, LOG'
    }),
    failure_reason: Joi.string().optional().allow(null).max(1000),
    proof_url: Joi.string().optional().allow(null).uri({ scheme: ['http', 'https'] })
});

// Schema for PATCH /api/tasks/:id/status
const patchStatusSchema = Joi.object({
    status: Joi.string().required().valid('PENDING', 'SENT', 'PROCESSING', 'SUCCESS', 'FAILED', 'CANCELLED', 'LOG').messages({
        'any.required': 'status is required',
        'any.only': 'status must be one of: PENDING, SENT, PROCESSING, SUCCESS, FAILED, CANCELLED, LOG'
    }),
    failure_reason: Joi.string().optional().allow(null).max(1000),
    error: Joi.string().optional().allow(null).max(1000),
    completed_at: Joi.date().optional(),
    proof_url: Joi.string().optional().allow(null).uri({ scheme: ['http', 'https'] })
});

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
let lastWorkerCheckin = null;
let lastWorkerVersion = 'UNKNOWN';
let lastWorkerOrigin = 'UNKNOWN';
let lastWorkerExtensionId = null;
let workerStopSignal = false;
let workerStopUntil = null;
let pendingSyncCommand = false;
let workerThrottleUntil = null;
const sentTaskTimestamps = new Map();
const processingStartTimestamps = new Map();
// Moderation-resume attempt counter, keyed by post id. In-memory (not a DB
// column — this schema predates attempt_count) so it resets on restart; that's
// an acceptable trade-off since the 48h cooldown between attempts keeps this
// low-frequency regardless.
const moderationResumeAttempts = new Map();

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
    const allowed = origin && (
        ALLOWED_ORIGINS.includes(origin) ||
        origin.startsWith('chrome-extension://')
    );
    if (allowed) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Credentials', 'true');
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,PUT,DELETE,OPTIONS,HEAD');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,x-requested-with');
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
});

console.log("🚀 Server connecting to Supabase...");

// CORS must come before rate limiter so preflight OPTIONS requests get CORS headers
app.use(cors({
    origin: function (origin, callback) {
        // Allow all origins in development, whitelist in production
        if (!origin || ALLOWED_ORIGINS.includes(origin) || origin.startsWith('chrome-extension://') || process.env.NODE_ENV === 'development') {
            callback(null, true);
        } else {
            console.log(`⚠️ CORS blocked origin: ${origin}`);
            callback(new Error('Not allowed by CORS'), false);
        }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-requested-with'],
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

app.get('/api/debug/state', (req, res) => {
    res.json({
        workerStopSignal,
        workerStopUntil,
        workerThrottleUntil,
        sentTaskCount: sentTaskTimestamps.size,
        processingTaskCount: processingStartTimestamps.size,
        activeSseClients: sseClients.size,
        serverTime: new Date().toISOString()
    });
});

// --- SSE: Real-Time push to Extension ---
const sseClients = new Set();

app.get('/api/stream/jobs', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);
    send({ type: 'connected' });
    sseClients.add(send);

    // Check if there's already a pending sync when extension reconnects
    if (pendingSyncCommand) send({ type: 'sync_groups' });

    req.on('close', () => sseClients.delete(send));
});

function broadcastSSE(data) {
    sseClients.forEach(send => { try { send(data); } catch { sseClients.delete(send); } });
}

// --- HELPER: Transactional Status Update ---
async function updateTaskStatus(taskId, status, message = null, metadata = null) {
    console.log(`[StatusUpdate] Task ${taskId}: ${status} - ${message || ''}`);
    // Track processing start/end for heartbeat
    if (status === 'PROCESSING') {
        if (!processingStartTimestamps.has(taskId)) {
            processingStartTimestamps.set(taskId, Date.now());
        }
    } else if (['SUCCESS', 'FAILED', 'CANCELLED'].includes(status)) {
        processingStartTimestamps.delete(taskId);
        sentTaskTimestamps.delete(taskId);
        if (status === 'CANCELLED') {
            logEvent(taskId, 'CANCELLED', `Task cancelled`, { failure_reason: message });
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
        io.emit('status_update', { taskId, status, message, metadata });
        return true;
    } catch (e) {
        console.error("Update Status Error:", e.message);
        throw e;
    }
}

// --- API ROUTES ---

app.get('/api/groups', async (req, res) => {
    const { data, error } = await supabase
        .from('groups')
        .select('*')
        .order('name', { ascending: true });

    if (error) return res.status(500).json({ error: error.message });

    // Groups with pending-moderation failures — shouldn't be re-used without
    // admin action (accepting the pending post in Facebook, or disabling group
    // moderation). Marked so the UI can warn or filter them out.
    const { data: moderationBuggers } = await supabase
        .from('posts')
        .select('distinct group_id')
        .like('failure_reason', '%ממתין לאישור מנהל%');
    const modGroupIds = new Set((moderationBuggers || []).map(r => r.group_id).filter(Boolean));

    // Group Health Score — derived from full posts history per group.
    const { data: healthPosts } = await supabase
        .from('posts')
        .select('group_id, status, created_at');
    const healthStats = buildGroupHealthStats(healthPosts);

    // Filter by facebook_user if provided
    let filtered = data || [];
    if (req.query.user && data) {
        filtered = data.filter(g => g.facebook_user === req.query.user);
    }

    filtered = filtered.map(g => ({
        ...g,
        requires_moderation: modGroupIds.has(g.id),
        health_score: computeGroupHealth(healthStats[g.id])
    }));

    res.json({ groups: filtered });
});

app.delete('/api/groups', async (req, res) => {
    console.log('🗑️ [GROUPS] Deleting all groups...');
    const { error } = await supabase.from('groups').delete().neq('id', '');

    if (error) return res.status(500).json({ error: error.message });
    console.log('✅ [GROUPS] All groups deleted');
    res.json({ success: true, message: 'All groups deleted' });
});

// Fix stuck tasks - mark PROCESSING tasks older than 4 minutes as FAILED
app.post('/api/tasks/fix-stuck', async (req, res) => {
    const fourMinutesAgo = new Date(Date.now() - 4 * 60 * 1000).toISOString();

    console.log('🔧 [TASKS] Fixing stuck tasks (PROCESSING > 4 min)...');

    const { data: stuckTasks, error: fetchError } = await supabase
        .from('posts')
        .select('id')
        .eq('status', 'PROCESSING')
        .lt('created_at', fourMinutesAgo);

    if (fetchError) return res.status(500).json({ error: fetchError.message });

    if (!stuckTasks || stuckTasks.length === 0) {
        return res.json({ success: true, fixed: 0 });
    }

    const { error: updateError } = await supabase
        .from('posts')
        .update({ status: 'FAILED', failure_reason: 'Task timeout - stuck in PROCESSING > 4min' })
        .eq('status', 'PROCESSING')
        .lt('created_at', fourMinutesAgo);

    if (updateError) return res.status(500).json({ error: updateError.message });

    console.log(`✅ [TASKS] Fixed ${stuckTasks.length} stuck tasks`);
    res.json({ success: true, fixed: stuckTasks.length });
});

app.post('/api/groups', async (req, res) => {
    const { groups } = req.body;
    if (!groups || !Array.isArray(groups)) return res.status(400).json({ error: "Invalid data" });

    // Upsert items
    const { data, error } = await supabase
        .from('groups')
        .upsert(groups.map(g => ({
            id: g.id,
            name: g.name,
            url: g.url
        })));

    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true, count: groups.length });
});

// --- SYNC ENDPOINT ---
app.post('/api/groups/sync', async (req, res) => {
    console.log("📥 Received sync data from extension:", req.body);
    const { groups, facebook_user } = req.body;

    if (!groups || !Array.isArray(groups) || groups.length === 0) {
        return res.status(400).json({ error: "No groups provided" });
    }

    // UPSERT newly scraped groups (preserves existing IDs and prevents SET NULL on posts)
    const toUpsert = groups.map(g => {
        const item = {
            id: g.id,
            name: g.name,
            url: g.url
        };
        // Only add facebook_user if it's provided (will be ignored if column doesn't exist)
        if (facebook_user) {
            item.facebook_user = facebook_user;
        }
        return item;
    });
    const { error: upsertError } = await supabase
        .from('groups')
        .upsert(toUpsert, { onConflict: 'id' });

    if (upsertError) {
        console.error("Sync Upsert Error:", upsertError);
        return res.status(500).json({ error: upsertError.message });
    }

    io.emit('groups_updated');
    io.emit('data_updated');
    console.log(`✅ Sync complete: upserted ${groups.length} groups`);
    res.json({ success: true, added: groups.length, message: `Synced ${groups.length} groups` });
});

// Dashboard requests extension to sync groups via SSE
app.post('/api/groups/request-sync', (req, res) => {
    console.log("📡 Dashboard requested group sync from extension");
    pendingSyncCommand = true;
    broadcastSSE({ type: 'sync_groups' });
    res.json({ success: true });
});

// Sync failed — tell dashboard to stop spinner
app.post('/api/groups/sync-failed', (req, res) => {
    const { error } = req.body;
    console.warn(`⚠️ Group sync failed: ${error}`);
    io.emit('groups_sync_failed', { error });
    res.json({ success: true });
});

// --- GROUP SETS (FOLDERS) ---
app.get('/api/group-sets', async (req, res) => {
    const { data, error } = await supabase
        .from('group_sets')
        .select('*')
        .order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    res.json({ sets: data });
});

app.post('/api/group-sets', async (req, res) => {
    const { name, group_ids } = req.body;
    if (!name || !Array.isArray(group_ids) || group_ids.length === 0)
        return res.status(400).json({ error: 'Missing name or group_ids' });
    const { data, error } = await supabase
        .from('group_sets')
        .insert([{ name, group_ids }])
        .select()
        .single();
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true, set: data });
});

app.delete('/api/group-sets/:id', async (req, res) => {
    const id = req.params.id;
    if (!/^[0-9a-f-]{8,}$/i.test(id)) return res.status(400).json({ error: 'Invalid ID format' });
    const { error } = await supabase
        .from('group_sets')
        .delete()
        .eq('id', id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
});

// --- POST TEMPLATES ---
app.get('/api/templates', async (req, res) => {
    const { data, error } = await supabase
        .from('post_templates')
        .select('*')
        .order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    res.json({ templates: data });
});

// --- EXTENSION CONFIG: Dynamic DOM selectors as configuration ---
app.get('/api/extension/config', async (req, res) => {
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

app.post('/api/templates', async (req, res) => {
    const { name, content, media_url } = req.body;
    if (!name) return res.status(400).json({ error: 'Template name is required' });
    
    const { data, error } = await supabase
        .from('post_templates')
        .insert([{ name, content, media_url, app_source: 'backup' }])
        .select()
        .single();
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true, template: data });
});

app.delete('/api/templates/:id', async (req, res) => {
    const id = req.params.id;
    if (!/^[0-9a-f-]{8,}$/i.test(id)) return res.status(400).json({ error: 'Invalid ID format' });
    const { error } = await supabase
        .from('post_templates')
        .delete()
        .eq('id', id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
});

// Simplified upload endpoint - accepts multipart or JSON with base64
app.post('/api/upload', strictLimiter, async (req, res) => {
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
                console.warn("⚠️ Multer failed, trying fallback:", multerErr.message);
                // Fallback: just return success with a placeholder
                return res.json({ success: true, file_path: `https://via.placeholder.com/150?text=media`, type: 'placeholder' });
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
            console.error("❌ Supabase error:", error.message);
            // Fallback: return placeholder on Supabase error too
            return res.json({ success: true, file_path: `https://via.placeholder.com/150?text=upload+failed`, type: 'placeholder' });
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
        // Final fallback - never fail the upload, return placeholder
        res.json({ success: true, file_path: `https://via.placeholder.com/150?text=error`, type: 'fallback' });
    }
});

// --- PRE-SIGNED URL ENDPOINT FOR DIRECT CLIENT-SIDE UPLOADS ---
app.post('/api/upload/presigned', strictLimiter, async (req, res) => {
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
app.get('/api/analytics', async (req, res) => {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    const [{ data: posts, error }, { data: groups }] = await Promise.all([
        supabase.from('posts').select('id, status, group_id, created_at, ended_at, failure_reason').eq('app_source', 'backup').gte('created_at', thirtyDaysAgo),
        supabase.from('groups').select('id, name, url')
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
    // for SUCCESS/FAILED — measures queue wait + execution + report latency, not
    // pure Facebook post-execution duration.
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

    res.json({
        summary: { total, success, failed, cancelled, pending, successRate },
        byDay: Object.entries(byDay).map(([date, d]) => ({ date, ...d })),
        topGroups,
        problemGroups,
        pendingGroups,
        activeGroups,
        topErrors,
        timing,
        throttleSuggestion
    });
});

// GET detailed report of successes and failures
app.get('/api/report/tasks', async (req, res) => {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    const [{ data: posts }, { data: groups }] = await Promise.all([
        supabase.from('posts')
            .select('id, status, group_id, content, failure_reason, created_at')
            .eq('app_source', 'backup')
            .gte('created_at', thirtyDaysAgo)
            .order('created_at', { ascending: false }),
        supabase.from('groups').select('id, name, url')
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

function logEvent(taskId, type, message, metadata = {}) {
    const entry = {
        taskId,
        type, // 'FAILED', 'STUCK', 'SUCCESS', 'ERROR', etc.
        message,
        metadata,
        timestamp: new Date().toISOString(),
        age_seconds: 0
    };
    eventLogs.unshift(entry);
    if (eventLogs.length > MAX_LOGS) eventLogs.pop();
    console.log(`[EVENT] ${type} - Task #${taskId}: ${message}`);
}

app.get('/api/logs', (req, res) => {
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const type = req.query.type; // Optional filter by type

    let filtered = eventLogs;
    if (type) {
        filtered = filtered.filter(log => log.type === type);
    }

    const logsWithAge = filtered.map(log => ({
        ...log,
        age_seconds: Math.floor((Date.now() - new Date(log.timestamp).getTime()) / 1000)
    })).slice(0, limit);

    res.json({
        total: filtered.length,
        returned: logsWithAge.length,
        logs: logsWithAge
    });
});

// --- AI CONTENT GENERATION (GEMINI + CLAUDE FALLBACK) ---
app.post('/api/ai/generate', strictLimiter, async (req, res) => {
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
app.post('/api/posts', validate(postsSchema), async (req, res) => {
    const { group_ids, content, schedule, media_url, media_files, ai_spin, facebook_user } = req.validated;

    // Additional validation: must have content or media
    if (!content && !media_url && !media_files) {
        return res.status(400).json({ error: "Must provide content, media_url, or media_files" });
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
        const { data: lastTasks } = await supabase
            .from('posts')
            .select('scheduled_time')
            .eq('app_source', 'backup')
            .in('status', ['PENDING', 'SENT', 'PROCESSING'])
            .order('scheduled_time', { ascending: false })
            .limit(1);

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
        const { data: groupRows } = await supabase.from('groups').select('id, name, url').in('id', group_ids);
        (groupRows || []).forEach(g => groupMap.set(g.id, g));
    } catch (e) {
        console.error('❌ [POSTS] Error fetching group names for placeholders:', e.message);
    }

    const tasks = [];
    group_ids.forEach((gid, index) => {
        // First post: within 30s. Subsequent posts: 150–210s (2.5–3.5 min) jitter
        const jitter = index === 0
            ? Math.floor(Math.random() * 20000) + 10000          // 10–30 seconds
            : Math.floor(Math.random() * (210000 - 150000 + 1)) + 150000; // 150–210 seconds
        nextScheduleTime = new Date(nextScheduleTime.getTime() + jitter);

        // Resolve {{GROUP_NAME}} etc. BEFORE spinning — spinText's spintax regex
        // would otherwise corrupt an unresolved {{TOKEN}} (see resolvePlaceholders
        // comment above spinText's definition).
        const resolvedContent = resolvePlaceholders(content, groupMap.get(gid), facebook_user);
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
            scheduled_time: nextScheduleTime.toISOString(),
            app_source: 'backup'
        };
        // Only add facebook_user if provided (will be ignored if column doesn't exist)
        if (facebook_user) {
            task.facebook_user = facebook_user;
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
    io.emit('queue_updated');
});

// --- 2. WORKER ACKNOWLEDGEMENT ---
app.post('/api/worker/ack', async (req, res) => {
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
setInterval(async () => {
    const now = new Date();
    if (workerStopSignal && workerStopUntil && now < workerStopUntil) return;
    if (workerThrottleUntil && now < workerThrottleUntil) return;

    // console.log(`[Poller] Heartbeat check at ${now.toISOString()}...`);

    try {
        // A. Check if ANY task is currently being handled
        const { data: activeTasks } = await supabase
            .from('posts')
            .select('id, status')
            .in('status', ['SENT', 'PROCESSING'])
            .eq('app_source', 'backup');

        if (activeTasks && activeTasks.length > 0) {
            let activeCount = activeTasks.length;
            // Check for timeouts on SENT tasks (Handshake failure)
            for (const active of activeTasks) {
                if (active.status === 'SENT') {
                    let sentAt = sentTaskTimestamps.get(active.id);
                    if (!sentAt) {
                        sentAt = now.getTime();
                        sentTaskTimestamps.set(active.id, sentAt);
                    }
                    if (now.getTime() - sentAt > 45000) { // Increased to 45s for reliability
                        console.log(`⏳ [Timeout] Task ${active.id} stuck in SENT for >45s. Resetting to PENDING.`);
                        await supabase.from('posts').update({ status: 'PENDING', scheduled_time: new Date(now.getTime() + 120000).toISOString() }).eq('id', active.id);
                        sentTaskTimestamps.delete(active.id);
                        activeCount--;
                    }
                } else if (active.status === 'PROCESSING') {
                    // Ensure processing tasks are in our tracking map for the heartbeat
                    if (!processingStartTimestamps.has(active.id)) {
                        processingStartTimestamps.set(active.id, now.getTime() - 10000); // Assume it started 10s ago
                    }
                }
            }
            if (activeCount > 0) return; // Busy - Don't send more
        }

        // B. Find exactly ONE next task
        const { data: nextTask, error: fetchError } = await supabase
            .from('posts')
            .select('*')
            .eq('status', 'PENDING')
            .eq('app_source', 'backup')
            .lte('scheduled_time', now.toISOString())
            .order('scheduled_time', { ascending: true })
            .limit(1)
            .single();

        if (fetchError || !nextTask) return;

        console.log(`📡 Dispatching Task ${nextTask.id} to worker...`);
        
        // C. Mark as SENT (Pre-lock)
        const { error: lockError } = await supabase
            .from('posts')
            .update({ status: 'SENT' })
            .eq('id', nextTask.id)
            .eq('status', 'PENDING');

        if (lockError) return;
        
        sentTaskTimestamps.set(nextTask.id, Date.now());

        // D. Send via SSE
        const { data: group } = await supabase.from('groups').select('url').eq('id', nextTask.group_id).single();
        broadcastSSE({ 
            type: 'new_job', 
            job: { ...nextTask, group_url: group?.url, status: 'SENT' } 
        });
        
        await updateTaskStatus(nextTask.id, 'SENT', 'Waiting for worker handshake...');
        
        await supabase.from('system_logs').insert([{
            log_level: 'info',
            source: 'server_scheduler',
            message: `📡 Dispatched Task #${nextTask.id} to group: ${group?.url || nextTask.group_id}`
        }]);

        io.emit('queue_updated');

    } catch (e) {
        console.error("Queue Poller Error:", e);
        try {
            await supabase.from('system_logs').insert([{
                log_level: 'error',
                source: 'server_scheduler',
                message: `🔴 Poller Critical Error: ${e.message || e}`
            }]);
        } catch (inner) { console.error("Logger failed:", inner); }
    }
}, 5000);


// HEARTBEAT: Reset tasks stuck in PROCESSING/SENT for more than 4 minutes
setInterval(async () => {
    try {
        const now = Date.now();
        const FOUR_MINUTES = 4 * 60 * 1000;

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
            .select('id, created_at')
            .in('status', ['PROCESSING', 'SENT'])
            .eq('app_source', 'backup');
        if (dbStuck) {
            for (const t of dbStuck) {
                const id = t.id;
                if (!processingStartTimestamps.has(id) && !sentTaskTimestamps.has(id)) {
                    const ageMs = now - new Date(t.created_at).getTime();
                    if (ageMs > FOUR_MINUTES) {
                        staleIds.push(id);
                    } else {
                        // Register it so next heartbeat can track it
                        processingStartTimestamps.set(id, new Date(t.created_at).getTime());
                    }
                }
            }
        }

        // SCHEDULED RESUME (moderation cooldown): give moderation-blocked posts
        // one more shot instead of leaving them CANCELLED forever. Placed BEFORE
        // the `uniqueIds.length === 0` early return below so this still runs
        // every tick even when nothing is currently stuck in PROCESSING/SENT.
        const MODERATION_COOLDOWN_MS = 48 * 60 * 60 * 1000; // 48h
        const MODERATION_RESUME_CAP = 2;
        const modCutoff = new Date(now - MODERATION_COOLDOWN_MS).toISOString();
        const { data: modCancelled } = await supabase
            .from('posts').select('id, group_id')
            .eq('status', 'CANCELLED').eq('app_source', 'backup')
            .like('failure_reason', '%ממתין לאישור מנהל%')
            .not('ended_at', 'is', null).lte('ended_at', modCutoff);

        for (const p of modCancelled || []) {
            const attempts = moderationResumeAttempts.get(p.id) || 0;
            if (attempts >= MODERATION_RESUME_CAP) continue; // stays CANCELLED — operator must act manually
            moderationResumeAttempts.set(p.id, attempts + 1);
            const { error: resumeError } = await supabase.from('posts').update({
                status: 'PENDING', scheduled_time: new Date(now).toISOString(), failure_reason: null
            }).eq('id', p.id).eq('status', 'CANCELLED');
            if (!resumeError) {
                console.log(`[Heartbeat] Task ${p.id} (group ${p.group_id}) auto-resumed after 48h moderation cooldown (attempt ${attempts + 1}/${MODERATION_RESUME_CAP}).`);
                logEvent(p.id, 'PENDING', `Auto-resumed after 48h moderation cooldown (attempt ${attempts + 1}/${MODERATION_RESUME_CAP})`, { group_id: p.group_id, reset_by: 'moderation_resume_sweep' });
                io.emit('queue_updated');
                io.emit('data_updated');
            }
        }

        const uniqueIds = [...new Set(staleIds)];
        if (uniqueIds.length === 0) return;

        console.log(`[Heartbeat] Resetting ${uniqueIds.length} stale task(s): ${uniqueIds.join(', ')}`);
        const newScheduledTime = new Date(now + 180000).toISOString();
        const { error } = await supabase
            .from('posts')
            .update({ status: 'PENDING', scheduled_time: newScheduledTime })
            .in('id', uniqueIds)
            .in('status', ['PROCESSING', 'SENT']);

        if (!error) {
            uniqueIds.forEach(id => {
                processingStartTimestamps.delete(id);
                sentTaskTimestamps.delete(id);
                logEvent(id, 'STUCK', 'Heartbeat auto-reset stuck task to PENDING', { reset_by: 'heartbeat' });
            });
            io.emit('queue_updated');
            io.emit('data_updated');
        } else {
            console.error('[Heartbeat] Reset error:', error.message);
        }
    } catch (e) {
        console.error('[Heartbeat] Unexpected error:', e);
    }
}, 60000);

// --- SYSTEM STATUS ---
app.get('/api/system/status', (req, res) => {
    const now = new Date();
    const checkinAge = lastWorkerCheckin ? (now - new Date(lastWorkerCheckin)) / 1000 : null;
    const workerActive = checkinAge !== null && checkinAge < 60; // active if checked in within 60s

    res.json({
        worker_status: workerActive ? 'ACTIVE' : 'OFFLINE',
        worker_message: workerActive ? 'Worker is active' : 'No recent worker check-in',
        last_worker_checkin: lastWorkerCheckin,
        worker_version: lastWorkerVersion,
        worker_origin: lastWorkerOrigin,
        worker_extension_id: lastWorkerExtensionId,
        worker_stopped: workerStopSignal,
        server_time: now.toISOString()
    });
});

// Next Job for Extension (polled by background.js every 6s)
app.get('/api/jobs/next', async (req, res) => {
    const { data } = await supabase
        .from('posts')
        .select('*')
        .eq('status', 'SENT')
        .eq('app_source', 'backup')
        .order('scheduled_time', { ascending: true })
        .limit(1)
        .maybeSingle();

    if (!data) return res.json({ job: null });

    // Fetch group URL separately (posts table doesn't store group_url)
    const { data: group } = await supabase
        .from('groups')
        .select('name, url')
        .eq('id', data.group_id)
        .maybeSingle();

    // Mark as PROCESSING immediately to prevent double-dispatch
    await supabase.from('posts').update({ status: 'PROCESSING' }).eq('id', data.id);
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
app.get('/api/jobs/for-url', async (req, res) => {
    const { url } = req.query;
    if (!url) return res.json({ job: null });

    const normalizedUrl = url.replace(/\/$/, '');

    // Find group by URL
    const { data: group } = await supabase
        .from('groups')
        .select('id, name')
        .or(`url.eq.${normalizedUrl},url.eq.${normalizedUrl}/`)
        .maybeSingle();

    if (!group) return res.json({ job: null });

    // Find PROCESSING task for this group
    const { data: task } = await supabase
        .from('posts')
        .select('*')
        .eq('status', 'PROCESSING')
        .eq('app_source', 'backup')
        .eq('group_id', group.id)
        .order('scheduled_time', { ascending: true })
        .limit(1)
        .maybeSingle();

    res.json({ job: task ? { ...task, group_url: normalizedUrl, group_name: group.name || task.group_id } : null });
});

// POST task status update (called by backup extension background.js REPORT_STATUS)
app.post('/api/tasks/update-status', validate(updateStatusSchema), async (req, res) => {
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

    // First, fetch the task to get group_id
    const { data: taskData } = await supabase.from('posts').select('group_id').eq('id', numericId).single();

    const { error } = await supabase.from('posts').update(update).eq('id', numericId);
    if (error) {
        console.error('Status update error:', error.message);
        return res.status(500).json({ error: error.message });
    }

    console.log(`✅ [POST] Task ${numericId} updated to ${status} in DB`);

    if (status === 'FAILED') {
        await supabase.from('system_logs').insert([{ log_level: 'error', source: 'extension_worker', message: `Task #${numericId} FAILED: ${failure_reason || 'Unknown error'}` }]);
        logEvent(numericId, 'FAILED', failure_reason || 'Task failed with unknown error', { source: 'extension_worker' });
    }

    if (['SUCCESS', 'FAILED', 'CANCELLED'].includes(status)) {
        processingStartTimestamps.delete(numericId);
        sentTaskTimestamps.delete(numericId);
    }

    // Emit with group_id for real-time dashboard update
    io.emit('status_update', { taskId: numericId, status, group_id: taskData?.group_id });
    // Delayed queue_updated to let status_update settle in frontend first
    setTimeout(() => io.emit('queue_updated'), 500);
    res.json({ success: true });
});

// PATCH task status (called by full_app extension on SUCCESS/FAILED)
app.patch('/api/tasks/:id/status', validate(patchStatusSchema), async (req, res) => {
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

    // Fetch task data including group_id before updating
    const { data: taskData } = await supabase.from('posts').select('group_id').eq('id', id).single();

    const update = { status };
    if (failReason) update.failure_reason = failReason;
    if (completed_at) update.ended_at = completed_at;
    // The content script's moderation-block path sends CANCELLED with no
    // completed_at, so ended_at was never set for these rows — leaving nothing
    // for the moderation-resume sweep to anchor its 48h cooldown on.
    else if (status === 'CANCELLED') update.ended_at = new Date().toISOString();
    if (proof_url) update.proof_url = proof_url;

    const { error } = await supabase.from('posts').update(update).eq('id', id);
    if (error) console.error('Status update error:', error.message);

    // Automation Failure AUDIT LOG
    if (status === 'FAILED') {
        await supabase.from('system_logs').insert([{
            log_level: 'error',
            source: 'extension_worker',
            message: `Task #${id} FAILED: ${failReason || 'Unknown error'}`
        }]);
        logEvent(id, 'FAILED', failReason || 'Task failed with unknown error', { source: 'extension_worker' });
    }

    // Task Cancellation LOG
    if (status === 'CANCELLED') {
        await supabase.from('system_logs').insert([{
            log_level: 'warn',
            source: 'extension_worker',
            message: `Task #${id} CANCELLED: ${failReason || 'Manual cancellation'}`
        }]);
        logEvent(id, 'CANCELLED', failReason || 'Task cancelled', { source: 'extension_worker', reason: failReason });
    }

    // Clear from tracking maps on end states
    if (['SUCCESS', 'FAILED', 'CANCELLED'].includes(status)) {
        processingStartTimestamps.delete(parseInt(id) || id);
        sentTaskTimestamps.delete(parseInt(id) || id);
    }

    // Emit with group_id for real-time dashboard update
    io.emit('status_update', { taskId: parseInt(id) || id, status, group_id: taskData?.group_id });
    io.emit('queue_updated');
    res.json({ success: true });
});

// --- QUEUE (POSTS) ---
app.get('/api/queue', async (req, res) => {
    console.log('📋 [QUEUE] Fetching queue...');

    const { data, error } = await supabase
        .from('posts')
        .select('*, groups(name, url)')
        .eq('app_source', 'backup')
        .order('scheduled_time', { ascending: true })
        .range(0, 4999);

    if (error) {
        console.error('❌ [QUEUE] Error:', error.message);
        return res.status(500).json({ error: error.message });
    }

    // Flatten group info into each row
    const rows = (data || []).map(p => ({
        ...p,
        group_name: p.groups?.name || p.group_id,
        group_url:  p.groups?.url  || null,
        groups: undefined
    }));

    console.log(`✅ [QUEUE] Fetched ${rows.length} tasks`);
    if (rows.length > 0) {
        const tasksWithMedia = rows.filter(r => r.media_paths && r.media_paths.length > 0).length;
        console.log(`   Tasks with media: ${tasksWithMedia}`);
    }

    res.json({ queue: rows });
});

// --- TASK MANAGEMENT ---

// Cancel a single task
app.post('/api/tasks/:id/cancel', async (req, res) => {
    const { id } = req.params;
    const { error } = await supabase
        .from('posts')
        .update({ status: 'CANCELLED', failure_reason: 'ביטול ידני' })
        .eq('id', id)
        .in('status', ['PENDING']);
    if (error) return res.status(500).json({ error: error.message });
    logEvent(id, 'CANCELLED', 'Task manually cancelled', { reason: 'ביטול ידני' });
    io.emit('queue_updated');
    res.json({ success: true });
});

// Cancel all pending tasks
app.post('/api/tasks/cancel-all-pending', async (req, res) => {
    const { error } = await supabase
        .from('posts')
        .update({ status: 'CANCELLED' })
        .eq('status', 'PENDING')
        .eq('app_source', 'backup');
    if (error) return res.status(500).json({ error: error.message });
    io.emit('queue_updated');
    res.json({ success: true });
});

// Bulk delete tasks
app.post('/api/tasks/bulk-delete', async (req, res) => {
    const { ids } = req.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0)
        return res.status(400).json({ error: 'Missing ids' });
    const { error } = await supabase.from('posts').delete().in('id', ids);
    if (error) return res.status(500).json({ error: error.message });
    io.emit('queue_updated');
    res.json({ success: true });
});

// Update a task
app.patch('/api/tasks/:id', async (req, res) => {
    const { id } = req.params;
    const updates = req.body;
    const { error } = await supabase.from('posts').update(updates).eq('id', id);
    if (error) return res.status(500).json({ error: error.message });
    io.emit('queue_updated');
    res.json({ success: true });
});

// Delete a task
app.delete('/api/tasks/:id', async (req, res) => {
    const { id } = req.params;
    const { error } = await supabase.from('posts').delete().eq('id', id);
    if (error) return res.status(500).json({ error: error.message });
    io.emit('queue_updated');
    res.json({ success: true });
});

// --- WORKER CONTROL ---
app.post('/api/worker/stop', (req, res) => {
    workerStopSignal = true;
    workerStopUntil  = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h safety
    broadcastSSE({ type: 'stop_worker' });
    io.emit('worker_stop_signal');
    console.log('🛑 Worker stop signal sent');
    res.json({ success: true });
});

app.post('/api/worker/resume', (req, res) => {
    workerStopSignal = false;
    workerStopUntil  = null;
    io.emit('worker_resumed');
    console.log('▶️ Worker resumed');
    res.json({ success: true });
});

// Worker heartbeat (extension calls this to register presence)
app.post('/api/worker/heartbeat', (req, res) => {
    lastWorkerCheckin   = new Date().toISOString();
    lastWorkerVersion   = req.body.version  || lastWorkerVersion;
    lastWorkerOrigin    = req.body.origin   || lastWorkerOrigin;
    lastWorkerExtensionId = req.body.extensionId || lastWorkerExtensionId;
    res.json({ success: true, stop_signal: workerStopSignal });
});

// --- MANUAL STUCK TASK RESET ---
app.post('/api/tasks/reset-stuck', async (req, res) => {
    try {
        const now = Date.now();
        const FOUR_MINUTES = 4 * 60 * 1000;

        // Find tasks stuck in PROCESSING/SENT for >4 minutes (using created_at as proxy)
        const { data: stuckTasks, error: fetchError } = await supabase
            .from('posts')
            .select('id, status, created_at')
            .in('status', ['PROCESSING', 'SENT'])
            .eq('app_source', 'backup');

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
            logEvent(id, 'STUCK', 'Manually reset from stuck state', { reset_by: 'manual' });
        });

        io.emit('queue_updated');
        io.emit('data_updated');

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

server.listen(PORT, '0.0.0.0', async () => {
    console.log(`🔥 SafePost OS Server running on http://localhost:${PORT} (Supabase Backend)`);
    // Populate processingStartTimestamps for any in-flight tasks from before server restart
    try {
        const { data } = await supabase
            .from('posts')
            .select('id, created_at, status')
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
                    stuckTasks.push({ id: t.id, age: Math.round(ageMs / 1000) });
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
                    logEvent(t.id, 'STUCK', `Task was stuck for ${t.age}s on startup, reset to PENDING`, { age_seconds: t.age });
                });
            }
        }
    } catch (e) {
        console.error('[Startup] Could not init processing map:', e.message);
    }

    // Automatic cleanup: fix stuck tasks every 60 seconds
    setInterval(async () => {
        try {
            const fourMinutesAgo = new Date(Date.now() - 4 * 60 * 1000).toISOString();
            const { data: stuckTasks, error: fetchError } = await supabase
                .from('posts')
                .select('id, status, group_id')
                .in('status', ['PROCESSING', 'SENT'])
                .lt('created_at', fourMinutesAgo)
                .eq('app_source', 'backup');

            if (!fetchError && stuckTasks && stuckTasks.length > 0) {
                console.log(`🔧 [AUTO-CLEANUP] Found ${stuckTasks.length} stuck task(s), marking as FAILED...`);
                const { error: updateError } = await supabase
                    .from('posts')
                    .update({ status: 'FAILED', failure_reason: 'Auto-timeout: task stuck > 4 minutes' })
                    .in('status', ['PROCESSING', 'SENT'])
                    .lt('created_at', fourMinutesAgo)
                    .eq('app_source', 'backup');

                if (!updateError) {
                    console.log(`✅ [AUTO-CLEANUP] Fixed ${stuckTasks.length} stuck task(s)`);
                    // Log each one
                    stuckTasks.forEach(t => {
                        logEvent(t.id, 'STUCK_AUTO_CLEANUP', `Auto-cleaned stuck task (${t.status} > 4min)`);
                    });
                    // Notify dashboard via Socket.io
                    io.emit('tasks_cleanup', { fixed: stuckTasks.length, timestamp: new Date().toISOString() });
                } else {
                    console.error('[AUTO-CLEANUP] Update failed:', updateError.message);
                }
            }
        } catch (e) {
            console.error('[AUTO-CLEANUP] Error:', e.message);
        }
    }, 60 * 1000); // Run every 60 seconds
});
