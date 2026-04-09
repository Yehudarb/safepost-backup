const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
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

// Security headers — applied immediately after app creation
app.use(helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    contentSecurityPolicy: false
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

const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: ALLOWED_ORIGINS, methods: ["GET", "POST", "PATCH", "DELETE"] }
});

const PORT = 3001;
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
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
    res.setHeader('Access-Control-Allow-Origin', origin || '*');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
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
        if (!origin || ALLOWED_ORIGINS.includes(origin) || process.env.NODE_ENV === 'development') {
            callback(null, true);
        } else {
            console.log(`⚠️ CORS blocked origin: ${origin}`);
            callback(null, true); // Allow anyway for debugging
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
    res.json({ groups: data });
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
    const { groups } = req.body;

    if (!groups || !Array.isArray(groups) || groups.length === 0) {
        return res.status(400).json({ error: "No groups provided" });
    }

    // UPSERT newly scraped groups (preserves existing IDs and prevents SET NULL on posts)
    const toUpsert = groups.map(g => ({ id: g.id, name: g.name, url: g.url }));
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
        supabase.from('posts').select('id, status, group_id, created_at, failure_reason').eq('app_source', 'backup').gte('created_at', thirtyDaysAgo),
        supabase.from('groups').select('id, name, url')
    ]);

    if (error) return res.status(500).json({ error: error.message });

    const groupMap = {};
    (groups || []).forEach(g => { groupMap[g.id] = { name: g.name, url: g.url }; });

    const total     = posts.length;
    const success   = posts.filter(p => ['SUCCESS', 'COMPLETED'].includes(p.status)).length;
    const failed    = posts.filter(p => p.status === 'FAILED').length;
    const cancelled = posts.filter(p => p.status === 'CANCELLED').length;
    const pending   = posts.filter(p => ['PENDING', 'SENT', 'PROCESSING'].includes(p.status)).length;
    const successRate = total > 0 ? Math.round((success / (success + failed)) * 100) : 0;

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

    const allGroups = Object.values(groupStats);
    const topGroups     = [...allGroups].sort((a, b) => b.success - a.success).slice(0, 6);
    const problemGroups = allGroups.filter(g => g.failed > 0).sort((a, b) => b.failed - a.failed).slice(0, 5);
    const activeGroups  = [...allGroups].sort((a, b) => b.total - a.total).slice(0, 6);

    // Top error messages
    const errorMap = {};
    posts.filter(p => p.status === 'FAILED' && p.failure_reason).forEach(p => {
        const key = (p.failure_reason || '').trim().slice(0, 120);
        if (key) errorMap[key] = (errorMap[key] || 0) + 1;
    });
    const topErrors = Object.entries(errorMap)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6)
        .map(([message, count]) => ({ message, count }));

    res.json({
        summary: { total, success, failed, cancelled, pending, successRate },
        byDay: Object.entries(byDay).map(([date, d]) => ({ date, ...d })),
        topGroups,
        problemGroups,
        activeGroups,
        topErrors
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
app.post('/api/posts', async (req, res) => {
    const { group_ids, content, schedule, media_url, media_files, ai_spin } = req.body;
    if (!group_ids || !Array.isArray(group_ids) || group_ids.length === 0 || (!content && !media_url && !media_files)) {
        return res.status(400).json({ error: "Missing groups or content/media" });
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

    const tasks = [];
    group_ids.forEach((gid, index) => {
        // First post: within 30s. Subsequent posts: 150–210s (2.5–3.5 min) jitter
        const jitter = index === 0
            ? Math.floor(Math.random() * 20000) + 10000          // 10–30 seconds
            : Math.floor(Math.random() * (210000 - 150000 + 1)) + 150000; // 150–210 seconds
        nextScheduleTime = new Date(nextScheduleTime.getTime() + jitter);

        let finalContent = ai_spin ? spinText(content) : content;

        // Embed media URLs in content
        if (mediaUrls && mediaUrls.length > 0) {
            console.log(`📸 [POSTS] Embedding ${mediaUrls.length} media URL(s) into content`);
            const mediaLinksText = '\n\n📸 Media:\n' + mediaUrls.map(url => `🔗 ${url}`).join('\n');
            finalContent = finalContent + mediaLinksText;
            console.log(`   Content + media = ${finalContent.length} chars`);
        }

        tasks.push({
            group_id: gid,
            content: finalContent,
            media_url: media_url || null,           // Legacy field
            media_paths: mediaPaths || null,        // New field: array of Supabase Storage paths
            status: 'PENDING',
            scheduled_time: nextScheduleTime.toISOString(),
            app_source: 'backup'
        });
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
        
        // Also check sentTaskTimestamps for tasks that NEVER made it to PROCESSING
        for (const [taskId, startTime] of sentTaskTimestamps.entries()) {
            if (now - startTime > FOUR_MINUTES) staleIds.push(taskId);
        }

        if (staleIds.length === 0) return;

        console.log(`[Heartbeat] Resetting ${staleIds.length} stale tasks: ${staleIds.join(', ')}`);
        const newScheduledTime = new Date(now + 180000).toISOString();
        const { error } = await supabase
            .from('posts')
            .update({ status: 'PENDING', scheduled_time: newScheduledTime })
            .in('id', staleIds)
            .in('status', ['PROCESSING', 'SENT']); // Guard: only reset if still in-flight

        if (!error) {
            staleIds.forEach(id => {
                processingStartTimestamps.delete(id);
                sentTaskTimestamps.delete(id);
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

// PATCH task status (called by full_app extension on SUCCESS/FAILED)
app.patch('/api/tasks/:id/status', async (req, res) => {
    const { id } = req.params;
    const { status, failure_reason, error: bodyError, completed_at, proof_url } = req.body;
    const failReason = failure_reason || bodyError;
    console.log(`📝 [PATCH] /api/tasks/${id}/status → ${status} (${failReason || 'No error'})`);

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

    const update = { status, updated_at: new Date().toISOString() };
    if (failReason) update.failure_reason = failReason;
    if (completed_at) update.ended_at = completed_at;
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
    }

    // Clear from tracking maps on end states
    if (['SUCCESS', 'FAILED', 'CANCELLED'].includes(status)) {
        processingStartTimestamps.delete(parseInt(id) || id);
        sentTaskTimestamps.delete(parseInt(id) || id);
    }

    io.emit('status_update', { taskId: parseInt(id) || id, status });
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
        .update({ status: 'CANCELLED' })
        .eq('id', id)
        .in('status', ['PENDING']);
    if (error) return res.status(500).json({ error: error.message });
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
            .select('id')
            .in('status', ['PROCESSING', 'SENT'])
            .eq('app_source', 'backup');
        if (data && data.length > 0) {
            data.forEach(t => processingStartTimestamps.set(t.id, Date.now()));
            console.log(`[Startup] Tracked ${data.length} in-flight task(s) for heartbeat`);
        }
    } catch (e) {
        console.error('[Startup] Could not init processing map:', e.message);
    }
});
