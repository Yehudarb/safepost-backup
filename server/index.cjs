const express = require('express');
const cors = require('cors');
const { supabase } = require('./supabaseClient.cjs');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');
const multer = require('multer');

// Ensure uploads directory exists
const UPLOAD_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR);
}

// Multer Memory Storage Configuration
const storage = multer.memoryStorage();

const upload = multer({
    storage: storage,
    limits: { fileSize: 50 * 1024 * 1024 }, // 50MB limit
    fileFilter: (req, file, cb) => {
        console.log("🔍 Filtering file:", file.originalname, "Mime:", file.mimetype);
        const allowedTypes = /jpeg|jpg|png|gif|webp|mp4|webm/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype);
        if (mimetype && extname) {
            return cb(null, true);
        }
        console.warn("❌ File rejected by filter:", file.originalname, "Mime:", file.mimetype);
        cb(new Error('Only images and videos are allowed!'));
    }
});

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST", "PATCH", "DELETE"] }
});

const PORT = 3001;
let lastWorkerCheckin = null;
let lastWorkerVersion = 'UNKNOWN';
let lastWorkerOrigin = 'UNKNOWN';
let lastWorkerExtensionId = null;
let workerStopSignal = false;
let workerStopUntil = null;
let pendingSyncCommand = false;
let workerThrottleUntil = null;

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

// Process Error Handlers
process.on('unhandledRejection', (reason, promise) => {
    console.error('🔥 UNHANDLED REJECTION:', reason);
});
process.on('uncaughtException', (err) => {
    console.error('🔥 UNCAUGHT EXCEPTION:', err);
});

console.log("🚀 Server connecting to Supabase...");
// --- MIDDLEWARE ---
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '50mb' }));
app.use('/uploads', express.static(UPLOAD_DIR));

// Health Check Endpoint
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', time: new Date().toISOString(), supabase: !!supabase });
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

    // DELETE all existing groups, then INSERT the fresh scraped ones
    const { error: deleteError } = await supabase
        .from('groups')
        .delete()
        .not('id', 'is', null); // delete all rows (works for both text and integer id)

    if (deleteError) {
        console.error("Sync Delete Error:", deleteError);
        return res.status(500).json({ error: deleteError.message });
    }

    // Include id (Facebook group name/ID) as primary key
    const toInsert = groups.map(g => ({ id: g.id, name: g.name, url: g.url }));
    const { error: insertError } = await supabase
        .from('groups')
        .insert(toInsert);

    if (insertError) {
        console.error("Sync Insert Error:", insertError);
        return res.status(500).json({ error: insertError.message });
    }

    io.emit('groups_updated');
    io.emit('data_updated');
    console.log(`✅ Sync complete: replaced with ${groups.length} groups`);
    res.json({ success: true, added: groups.length, message: `Synced ${groups.length} groups` });
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
    const { error } = await supabase
        .from('group_sets')
        .delete()
        .eq('id', req.params.id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
});

app.post('/api/upload', (req, res, next) => {
    console.log("📥 [PRE-MULTER] Upload attempt. Type:", req.headers['content-type']);
    next();
}, upload.single('file'), async (req, res) => {
    console.log("📂 File upload request received details:", req.file ? req.file.originalname : "No file");
    if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
    }

    try {
        // Sanitize filename: remove non-ascii characters and spaces to avoid Supabase "Invalid key" error
        const cleanName = req.file.originalname.replace(/[^\x00-\x7F]/g, "").replace(/\s+/g, '-');
        const fileName = `${Date.now()}-${cleanName}`;

        console.log("☁️ Attempting Supabase storage upload. Bucket: campaign-media, File:", fileName);

        // Upload to Supabase Storage (Bucket: campaign-media)
        const { data, error } = await supabase.storage
            .from('campaign-media')
            .upload(fileName, req.file.buffer, {
                contentType: req.file.mimetype,
                upsert: true
            });

        if (error) {
            console.error("❌ Supabase Storage Error Object:", JSON.stringify(error, null, 2));
            return res.status(500).json({ error: "Cloud storage upload failed", details: error.message, full_error: error });
        }

        console.log("✅ Supabase upload successful. Data:", data);

        // Get Public URL
        const { data: { publicUrl } } = supabase.storage
            .from('campaign-media')
            .getPublicUrl(fileName);

        console.log("🔗 Public URL generated:", publicUrl);
        res.json({ success: true, file_path: publicUrl, type: req.file.mimetype });
    } catch (err) {
        console.error("🔥 Catch block - Upload process error:", err);
        // Special logged handling for specific Supabase errors if needed
        if (err.message && err.message.includes("The resource was not found")) {
            console.error("💡 HINT: Check if bucket 'campaign-media' exists and is public.");
        }
        res.status(500).json({ error: "Internal server error during upload", details: err.message });
    }
});

// --- 1. PROPER JITTER CALCULATION ---
app.post('/api/posts', async (req, res) => {
    const { group_ids, content, schedule, media_url } = req.body;
    if (!group_ids || !Array.isArray(group_ids) || group_ids.length === 0 || (!content && !media_url)) {
        return res.status(400).json({ error: "Missing groups or content/media" });
    }

    console.log(`🚀 Intelligent Launch: Preparing ${group_ids.length} tasks with 2-3 min jitter...`);

    let nextScheduleTime = schedule ? new Date(schedule) : new Date();
    if (nextScheduleTime < new Date()) nextScheduleTime = new Date();

    const tasks = [];
    group_ids.forEach((gid, index) => {
        // Base delay of 10s for the first one, then 2-3 mins between each
        const jitter = index === 0 ? 10000 : Math.floor(Math.random() * (180000 - 120000 + 1)) + 120000;
        nextScheduleTime = new Date(nextScheduleTime.getTime() + jitter);
        
        tasks.push({
            group_id: gid,
            content: content,
            media_url: media_url || null,
            status: 'PENDING',
            scheduled_time: nextScheduleTime.toISOString(),
            app_source: 'backup'
        });
    });

    const { error } = await supabase.from('posts').insert(tasks);
    if (error) return res.status(500).json({ error: error.message });

    res.json({ success: true, count: group_ids.length });
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
    
    updateTaskStatus(taskId, 'PROCESSING', 'Worker started execution');
    res.json({ success: true });
});

// --- 3. REFACTORED STRICT QUEUE POLLER ---
setInterval(async () => {
    const now = new Date();
    if (workerStopSignal && workerStopUntil && now < workerStopUntil) return;
    if (workerThrottleUntil && now < workerThrottleUntil) return;

    try {
        // A. Check if ANY task is currently being handled
        const { data: activeTasks } = await supabase
            .from('posts')
            .select('id, status')
            .in('status', ['SENT', 'PROCESSING'])
            .eq('app_source', 'backup');

        if (activeTasks && activeTasks.length > 0) {
            // Check for timeouts on SENT tasks (Handshake failure)
            for (const active of activeTasks) {
                if (active.status === 'SENT') {
                    // Logic for timeout could go here (e.g., if sent more than 60s ago)
                }
            }
            return; // Busy - Don't send more
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

        // D. Send via SSE
        const { data: group } = await supabase.from('groups').select('url').eq('id', nextTask.group_id).single();
        broadcastSSE({ 
            type: 'new_job', 
            job: { ...nextTask, group_url: group?.url, status: 'SENT' } 
        });
        
        updateTaskStatus(nextTask.id, 'SENT', 'Waiting for worker handshake...');
        io.emit('queue_updated');

    } catch (e) {
        console.error("Queue Poller Error:", e);
    }
}, 5000);


// HEARTBEAT: Auto-fail or reset stale processing tasks
setInterval(async () => {
    try {
        const now = new Date();
        const threeMinutesAgo = new Date(now.getTime() - 3 * 60 * 1000).toISOString();

        // Find tasks stuck in PROCESSING/SENT for more than 3 minutes
        const { data: staleTasks, error: fetchError } = await supabase
            .from('posts')
            .select('id')
            .in('status', ['PROCESSING', 'SENT'])
            .lte('scheduled_time', threeMinutesAgo)
            .eq('app_source', 'backup');

        if (fetchError) {
            console.error("[Heartbeat] Error fetching stale tasks:", fetchError.message);
            return;
        }

        if (staleTasks && staleTasks.length > 0) {
            console.log(`[Heartbeat] Found ${staleTasks.length} stale PROCESSING tasks. Resetting to PENDING.`);
            const ids = staleTasks.map(t => t.id);
            
            const { error: updateError } = await supabase
                .from('posts')
                .update({ status: 'PENDING' })
                .in('id', ids);

            if (updateError) {
                console.error("[Heartbeat] Error resetting stale tasks:", updateError.message);
            } else {
                io.emit('queue_updated');
                io.emit('data_updated');
            }
        }
    } catch (e) {
        console.error("[Heartbeat] Unexpected error:", e);
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
    await updateTaskStatus(data.id, 'PROCESSING', 'Extension picked up job');

    res.json({
        job: {
            ...data,
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
    const { status, error: failReason, completed_at } = req.body;
    console.log(`📝 [PATCH] /api/tasks/${id}/status → ${status}`);

    const update = { status };
    if (failReason) update.failure_reason = failReason;
    if (completed_at) update.ended_at = completed_at;

    const { error } = await supabase.from('posts').update(update).eq('id', id);
    if (error) console.error('Status update error:', error.message);

    io.emit('status_update', { taskId: parseInt(id) || id, status });
    io.emit('queue_updated');
    res.json({ success: true });
});

// --- QUEUE (POSTS) ---
app.get('/api/queue', async (req, res) => {
    const { data, error } = await supabase
        .from('posts')
        .select('*, groups(name, url)')
        .eq('app_source', 'backup')
        .order('scheduled_time', { ascending: true });

    if (error) return res.status(500).json({ error: error.message });

    // Flatten group info into each row
    const rows = (data || []).map(p => ({
        ...p,
        group_name: p.groups?.name || p.group_id,
        group_url:  p.groups?.url  || null,
        groups: undefined
    }));
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
    console.error("🚨 GLOBAL ERROR CAUGHT:", err.message);
    if (err instanceof multer.MulterError) {
        console.error("📦 Multer Error:", err.code, err.field);
        return res.status(400).json({ error: "File upload error", details: err.message });
    }
    res.status(500).json({ error: "Internal server error", details: err.message });
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`🔥 SafePost OS Server running on http://localhost:${PORT} (Supabase Backend)`);
});
