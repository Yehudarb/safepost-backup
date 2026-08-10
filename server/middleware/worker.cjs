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

// Shared-secret alternative to per-device pairing. One EXTENSION_API_KEY on the
// server, the same value pasted into the extension's settings popup — no codes,
// no browser_workers rows, no dashboard step. Suited to a single operator; if
// several people or machines ever need separate, individually revocable access,
// the pairing flow above is the better fit.
function readExtensionKey(req) {
    // Query fallback exists only because EventSource cannot set headers — see
    // the note on readWorkerCredentials.
    return req.headers['x-extension-key'] || req.query.extension_key || null;
}

// Constant-time compare so a wrong key cannot be recovered by timing how long
// the rejection takes.
function keyMatches(presented, expected) {
    if (!presented || !expected) return false;
    const a = Buffer.from(String(presented));
    const b = Buffer.from(String(expected));
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
}

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

    // 1. A paired worker's device token, when present.
    if (workerId && token) return requireWorker(req, res, next);

    // 2. The shared extension key, when both sides have one configured. A key
    //    that is present but WRONG is rejected outright — never quietly
    //    downgraded to "anonymous", which would make the whole check bypassable
    //    by sending a deliberately bad key.
    const presentedKey = readExtensionKey(req);
    const expectedKey = process.env.EXTENSION_API_KEY;
    if (presentedKey && expectedKey) {
        if (!keyMatches(presentedKey, expectedKey)) {
            return res.status(401).json({ error: 'Invalid extension key.' });
        }
        req.worker = null;
        req.extensionKeyAuthed = true;
        // The key proves "an authorised extension", not "which tenant". Without
        // a workspace, every scoped query downstream silently degrades to
        // unscoped — /api/jobs/next would hand this extension whichever tenant's
        // post happens to be next in the global queue, and publish it from the
        // wrong Facebook account. EXTENSION_KEY_WORKSPACE_ID pins the key to one
        // workspace, which is the only coherent reading of a single shared
        // secret: one operator, one tenant. Several tenants need pairing, where
        // the workspace comes from the device token instead.
        const boundWorkspace = process.env.EXTENSION_KEY_WORKSPACE_ID;
        if (boundWorkspace) {
            // A malformed id would be passed straight into a uuid column filter
            // and raise a 500 on every extension request. Refuse it loudly once,
            // here, rather than letting it look like an outage.
            if (!UUID_RE.test(boundWorkspace)) {
                console.error('[worker] EXTENSION_KEY_WORKSPACE_ID is not a valid uuid — ignoring it. Extension requests will be UNSCOPED.');
            } else {
                req.workspaceId = boundWorkspace;
            }
        }
        return next();
    }
    // A key presented to a server that has none configured is ignored rather
    // than rejected, and falls through to the anonymous rules below. Rejecting
    // it would buy nothing — with no key set and the flag off, anonymous access
    // is permitted anyway — while breaking the extension for anyone who saved
    // the key in the popup before setting it on the server.

    // 3. No credentials at all.
    if (process.env.WORKER_AUTH_ENFORCED === 'true') {
        return res.status(401).json({ error: 'Worker credentials required.' });
    }

    req.worker = null;
    return next();
}

module.exports = { generateDeviceToken, hashToken, generatePairingCode, requireWorker, optionalWorker };
