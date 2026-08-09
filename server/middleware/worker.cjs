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
// Credentials normally travel as headers. The one exception is the SSE stream:
// EventSource cannot set request headers, so /api/stream/jobs passes them as
// query parameters instead. That is a weaker channel — query strings show up in
// access logs and proxy logs — but the alternative for that endpoint is no
// authentication at all, and it broadcasts full job payloads (post text and
// group URL). Device tokens are per-worker, hashed at rest, and revocable from
// the dashboard, which limits what a leaked log line is worth.
function readWorkerCredentials(req) {
    return {
        workerId: req.headers['x-worker-id'] || req.query.worker_id || req.params.workerId || null,
        token: req.headers['x-device-token'] || req.query.device_token || null,
    };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function requireWorker(req, res, next) {
    const { workerId, token } = readWorkerCredentials(req);
    if (!workerId || !token) {
        return res.status(401).json({ error: 'Worker credentials required.' });
    }
    // browser_workers.id is a uuid column, so a malformed id makes Postgres
    // raise a type error, which used to surface as a 500 — an attacker probing
    // with junk got "server error" instead of "rejected", and the noise buried
    // real failures. A bad id is bad credentials, so answer 401 without a query.
    if (!UUID_RE.test(workerId)) {
        return res.status(401).json({ error: 'Invalid worker credentials.' });
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

// The legacy extension endpoints (jobs/next, groups/sync, tasks/:id/status, the
// heartbeat, the SSE stream …) shipped with no authentication at all, because an
// unpaired extension has no credentials to send. That leaves them readable and
// writable by anyone who knows the URL.
//
// Closing that cannot be a flag-day change: an already-installed, unpaired
// extension would stop publishing the moment it deployed. So this mirrors the
// AUTH_ENFORCED transition safety used in auth.cjs —
//
//   WORKER_AUTH_ENFORCED unset/false (default)
//       A request carrying worker credentials still gets them VALIDATED, and is
//       rejected if they are wrong — a bad token is never treated as anonymous.
//       A request with no credentials is allowed through, as today.
//
//   WORKER_AUTH_ENFORCED=true
//       Anonymous requests are rejected. Flip this only once the extension is
//       paired, otherwise publishing stops.
//
// So deploying this changes nothing until the flag is set.
async function optionalWorker(req, res, next) {
    const { workerId, token } = readWorkerCredentials(req);

    if (workerId && token) return requireWorker(req, res, next);

    if (process.env.WORKER_AUTH_ENFORCED === 'true') {
        return res.status(401).json({ error: 'Worker credentials required.' });
    }

    req.worker = null;
    return next();
}

module.exports = { generateDeviceToken, hashToken, generatePairingCode, requireWorker, optionalWorker };
