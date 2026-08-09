// Phase 5 — Worker device-token auth + pairing helpers.
//
// Paired Chrome extensions authenticate with a scoped device token sent as
// `x-device-token` (+ `x-worker-id`). Only the token HASH is stored server-side.
// Tokens are scoped to one worker + one workspace and are revocable.

const crypto = require('crypto');
const { supabase } = require('../supabaseClient.cjs');

function generateDeviceToken() {
    return crypto.randomBytes(32).toString('hex'); // 64-char secret (plaintext, returned once)
}

function hashToken(token) {
    return crypto.createHash('sha256').update(String(token)).digest('hex');
}

// Human-enterable pairing code: 8 chars, unambiguous alphabet.
function generatePairingCode() {
    const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O/1/I/L
    let code = '';
    const bytes = crypto.randomBytes(8);
    for (let i = 0; i < 8; i++) code += alphabet[bytes[i] % alphabet.length];
    return code;
}

// Validate the device token and attach req.worker (+ workspaceId). Always
// enforced — worker endpoints require a valid, non-revoked token.
async function requireWorker(req, res, next) {
    const workerId = req.headers['x-worker-id'] || req.params.workerId || null;
    const token = req.headers['x-device-token'] || null;
    if (!workerId || !token) {
        return res.status(401).json({ error: 'Worker credentials required.' });
    }
    const { data: worker, error } = await supabase
        .from('browser_workers')
        .select('*')
        .eq('id', workerId)
        .maybeSingle();

    if (error) return res.status(500).json({ error: 'Worker lookup failed.' });
    if (!worker) return res.status(401).json({ error: 'Unknown worker.' });
    if (worker.revoked_at) return res.status(403).json({ error: 'Worker has been revoked.' });
    if (worker.device_token_hash !== hashToken(token)) {
        return res.status(401).json({ error: 'Invalid device token.' });
    }
    // If the URL carries a workerId param, it must match the authenticated worker.
    if (req.params.workerId && req.params.workerId !== worker.id) {
        return res.status(403).json({ error: 'Worker id mismatch.' });
    }

    req.worker = worker;
    req.workspaceId = worker.workspace_id;
    next();
}

module.exports = { generateDeviceToken, hashToken, generatePairingCode, requireWorker };
