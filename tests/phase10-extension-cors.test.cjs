/**
 * Phase 10 - Extension CORS preflight regression test.
 *
 * The extension's CONTENT SCRIPT calls the API from origin https://www.facebook.com
 * and sends x-device-token / x-worker-id (syncDetectedFacebookUser →
 * /api/profile/sync, called from scrapeAndSyncGroups). Those headers were missing
 * from the manual CORS middleware in server/index.cjs, so every such request died
 * in preflight with:
 *
 *   "Request header field x-device-token is not allowed by
 *    Access-Control-Allow-Headers in preflight response"
 *
 * Background service-worker fetches bypass CORS via host_permissions, which is why
 * /api/groups/sync worked while the content-script leg silently failed.
 *
 * NOTE: there are TWO CORS configurations in index.cjs. The manual middleware
 * answers OPTIONS itself, so the cors() package never sees a preflight — this test
 * exercises what the browser actually gets.
 *
 * Env: API_URL (default http://localhost:3001). Requires the backend running.
 */
const { API_URL = 'http://localhost:3001' } = process.env;

let passed = 0, failed = 0;
const assert = (name, cond) => { cond ? (passed++, console.log(`  OK ${name}`)) : (failed++, console.log(`  FAIL ${name}`)); };

// Every custom header the backend actually reads (worker.cjs + auth.cjs).
const REQUIRED = ['x-device-token', 'x-worker-id', 'x-extension-key', 'x-workspace-id'];

async function preflight(path, requestHeaders) {
    const res = await fetch(`${API_URL}${path}`, {
        method: 'OPTIONS',
        headers: {
            Origin: 'https://www.facebook.com',
            'Access-Control-Request-Method': 'POST',
            'Access-Control-Request-Headers': requestHeaders.join(','),
            // Do not leave keep-alive sockets behind: on Windows + Node 24 a
            // process.exit() with undici sockets still open aborts with
            // "Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)" (exit 127)
            // AFTER the summary prints, which would fail this test in CI on success.
            Connection: 'close',
        },
    });
    const allowed = (res.headers.get('access-control-allow-headers') || '')
        .split(',').map(h => h.trim().toLowerCase()).filter(Boolean);
    return { status: res.status, allowed };
}

(async () => {
    console.log('Phase 10 extension CORS preflight\n');

    const profile = await preflight('/api/profile/sync', ['content-type', 'x-device-token', 'x-worker-id']);
    assert('preflight for /api/profile/sync succeeds', profile.status >= 200 && profile.status < 300);

    for (const header of REQUIRED) {
        assert(`Access-Control-Allow-Headers includes ${header}`, profile.allowed.includes(header));
    }

    // The group-sync leg itself must stay reachable from the content script too.
    const sync = await preflight('/api/groups/sync', ['content-type', 'x-device-token', 'x-worker-id']);
    assert('preflight for /api/groups/sync succeeds', sync.status >= 200 && sync.status < 300);
    assert('/api/groups/sync allows the worker headers',
        REQUIRED.every(h => sync.allowed.includes(h)));

    console.log(`\n${passed} passed, ${failed} failed`);
    process.exitCode = failed ? 1 : 0;
})().catch(err => {
    console.error('Test run error:', err.message);
    process.exitCode = 2;
});
