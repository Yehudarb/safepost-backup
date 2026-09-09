/**
 * Phase 35 - credentials must not reach logs (audit finding SP-C1).
 *
 * The extension authenticates its SSE stream by query parameter, because
 * EventSource cannot send headers. The request logger printed `req.url`
 * verbatim, so every stream connection wrote a live 64-hex device token into the
 * platform log stream. A device token satisfies `requireWorker`: whoever reads
 * one can claim jobs and publish to that workspace's Facebook groups.
 *
 * Two layers are asserted here:
 *   1. The redaction helpers behave correctly, including the cases that make a
 *      naive implementation useless (unparseable queries, nested bodies, tokens
 *      quoted inside an error message).
 *   2. The call sites actually use them - a correct helper that nothing calls
 *      fixes nothing, which is the failure mode worth guarding against.
 */
const fs = require('fs');
const path = require('path');
const {
    REDACTED, looksLikeSecret, isSensitiveName,
    redactUrl, redactValue, redactJson, redactText,
} = require('../server/lib/logRedaction.cjs');

let passed = 0;
let failed = 0;
function assert(name, condition, detail = '') {
    if (condition) {
        passed++;
        console.log(`  OK ${name}`);
    } else {
        failed++;
        console.log(`  FAIL ${name}${detail ? ` - ${detail}` : ''}`);
    }
}

const root = path.join(__dirname, '..');
// Shaped exactly like a real one: crypto.randomBytes(32).toString('hex').
const DEVICE_TOKEN = 'a3f1c09e7b2d4856ff01a9c3e5d7b8420f6a1c3e5d7b9f0a2c4e6b8d0f1a3c5e';
const WORKER_ID = '9e234ad6-df11-43b4-a34e-62b0712c478a';
const JWT = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk';

function run() {
    console.log('\nPhase 35 - log redaction (SP-C1)\n');

    console.log('A. The SSE stream URL that caused the finding');
    {
        const raw = `/api/stream/jobs?worker_id=${WORKER_ID}&device_token=${DEVICE_TOKEN}`;
        const safe = redactUrl(raw);
        assert('the device token is gone', !safe.includes(DEVICE_TOKEN), safe);
        assert('no fragment of the token survives',
            !safe.includes(DEVICE_TOKEN.slice(0, 16)), safe);
        assert('the redaction marker is present', safe.includes(REDACTED), safe);
        assert('the path is preserved', safe.startsWith('/api/stream/jobs?'), safe);
        // worker_id is an identifier, not a credential: requireWorker verifies the
        // token against a stored hash, so keeping the id costs nothing and is what
        // makes the log line useful.
        assert('worker_id is kept for observability', safe.includes(WORKER_ID), safe);
    }

    console.log('\nB. redactUrl');
    {
        assert('a URL with no query is untouched',
            redactUrl('/api/health') === '/api/health');
        assert('ordinary parameters survive',
            redactUrl('/api/queue?limit=50&offset=0') === '/api/queue?limit=50&offset=0');
        assert('a token parameter is redacted',
            redactUrl('/x?token=abc123') === `/x?token=${REDACTED}`);
        assert('access_token is redacted',
            redactUrl('/x?access_token=short') === `/x?access_token=${REDACTED}`);
        assert('a pairing code is redacted',
            redactUrl('/x?code=ABCD2345') === `/x?code=${REDACTED}`);
        assert('facebook_user_id is redacted',
            redactUrl('/x?facebook_user_id=100000000000009') === `/x?facebook_user_id=${REDACTED}`);
        assert('a JWT is redacted even under an unknown parameter name',
            redactUrl(`/x?whatever=${JWT}`) === `/x?whatever=${REDACTED}`);
        assert('a long hex value is redacted under an unknown name',
            redactUrl(`/x?blob=${DEVICE_TOKEN}`) === `/x?blob=${REDACTED}`);
        assert('mixed parameters keep the safe half',
            redactUrl(`/x?page=2&device_token=${DEVICE_TOKEN}`) === `/x?page=2&device_token=${REDACTED}`);
        assert('parameter names are matched case-insensitively',
            redactUrl('/x?Device_Token=abc') === `/x?Device_Token=${REDACTED}`);
        assert('a UUID is NOT redacted - ids identify rows all over this system',
            redactUrl(`/x?id=${WORKER_ID}`) === `/x?id=${WORKER_ID}`);
        assert('an empty query yields a bare path', redactUrl('/x?') === '/x');
        assert('a non-string input is returned as-is', redactUrl(null) === null);
    }

    console.log('\nC. looksLikeSecret');
    {
        assert('a 64-char hex token looks like a secret', looksLikeSecret(DEVICE_TOKEN));
        assert('a JWT looks like a secret', looksLikeSecret(JWT));
        assert('a UUID does not', !looksLikeSecret(WORKER_ID));
        assert('a short string does not', !looksLikeSecret('abc'));
        assert('a sentence does not', !looksLikeSecret('the quick brown fox jumped over it'));
        assert('a URL does not', !looksLikeSecret('https://www.facebook.com/groups/12345'));
        assert('a non-string does not', !looksLikeSecret(12345));
        assert('sensitive names are recognised case-insensitively',
            isSensitiveName('DEVICE_TOKEN') && isSensitiveName('authorization'));
        assert('an ordinary name is not sensitive', !isSensitiveName('limit'));
    }

    console.log('\nD. redactValue on request bodies');
    {
        const body = {
            facebook_user: 'Yehuda Arbely',
            facebook_user_id: '100000000000009',
            device_token: DEVICE_TOKEN,
            source: 'extension_content',
            nested: { authorization: `Bearer ${JWT}`, keep: 'visible' },
            list: [{ token: 'secret-value' }, 'plain'],
        };
        const safe = redactValue(body);
        assert('the account id is redacted', safe.facebook_user_id === REDACTED);
        assert('the device token is redacted', safe.device_token === REDACTED);
        assert('a nested authorization header is redacted', safe.nested.authorization === REDACTED);
        assert('a token inside an array element is redacted', safe.list[0].token === REDACTED);
        assert('the display name is kept', safe.facebook_user === 'Yehuda Arbely');
        assert('unrelated fields are kept', safe.source === 'extension_content' && safe.nested.keep === 'visible');
        assert('plain array entries are kept', safe.list[1] === 'plain');
        assert('the original object is not mutated', body.device_token === DEVICE_TOKEN);

        const serialised = redactJson(body);
        assert('redactJson emits no token', !serialised.includes(DEVICE_TOKEN), serialised);
        assert('redactJson emits no account id', !serialised.includes('100000000000009'));
        assert('redactJson is valid JSON', (() => { try { JSON.parse(serialised); return true; } catch { return false; } })());
    }
    {
        const cyclic = { name: 'loop' };
        cyclic.self = cyclic;
        let threw = false;
        try { redactValue(cyclic); } catch { threw = true; }
        assert('a cyclic object is depth-limited rather than fatal', !threw);
        assert('redactJson survives an unserialisable value',
            typeof redactJson(cyclic) === 'string');
    }

    console.log('\nE. redactText on error messages');
    {
        const message = `connect ECONNREFUSED /api/stream/jobs?worker_id=${WORKER_ID}&device_token=${DEVICE_TOKEN}`;
        const safe = redactText(message);
        assert('a token quoted in an error message is removed',
            !safe.includes(DEVICE_TOKEN), safe);
        assert('the useful part of the message survives',
            safe.includes('ECONNREFUSED') && safe.includes('/api/stream/jobs'), safe);
        assert('a bare hex token in free text is removed',
            !redactText(`failed for ${DEVICE_TOKEN}`).includes(DEVICE_TOKEN));
        assert('a bare JWT in free text is removed',
            !redactText(`token ${JWT} rejected`).includes(JWT));
        assert('an ordinary message is unchanged',
            redactText('Validation failed: content too long') === 'Validation failed: content too long');
        assert('a non-string is returned as-is', redactText(null) === null);
    }

    console.log('\nF. The call sites actually use it');
    {
        const indexSource = fs.readFileSync(path.join(root, 'server/index.cjs'), 'utf8');
        assert('index.cjs imports the redaction helpers',
            indexSource.includes("require('./lib/logRedaction.cjs')"));
        assert('the request logger redacts the URL',
            /console\.log\(`\[\$\{id\}\] [^`]*\$\{redactUrl\(req\.url\)\}/.test(indexSource));
        assert('no logger prints req.url unredacted',
            !/console\.\w+\([^)]*\$\{req\.url\}/.test(indexSource),
            'a raw ${req.url} is still being logged');
        assert('no logger prints req.originalUrl unredacted',
            !/console\.\w+\([^)]*req\.originalUrl/.test(indexSource));
        assert('the global error handler redacts the message',
            indexSource.includes('redactText(err.message)'));
        assert('no route logs a raw JSON.stringify(req.body)',
            !/JSON\.stringify\(req\.body/.test(indexSource),
            'a request body is still logged unredacted');
        assert('no logger prints an authorization header',
            !/console\.\w+\([^)]*headers\[['"]authorization/i.test(indexSource));
        assert('no logger prints a device token header',
            !/console\.\w+\([^)]*headers\[['"]x-device-token/i.test(indexSource));
    }
    {
        // Every server file, not just index.cjs - a future route module must not
        // reintroduce the same leak somewhere this suite was not looking.
        const offenders = [];
        const walk = (dir) => {
            for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                const full = path.join(dir, entry.name);
                if (entry.isDirectory()) { if (entry.name !== 'tests') walk(full); continue; }
                if (!entry.name.endsWith('.cjs')) continue;
                const source = fs.readFileSync(full, 'utf8');
                if (/console\.\w+\([^)]*\$\{req\.url\}/.test(source)
                    || /console\.\w+\([^)]*req\.originalUrl/.test(source)
                    || /JSON\.stringify\(req\.body/.test(source)
                    || /console\.\w+\([^)]*headers\[['"](authorization|x-device-token|x-extension-key)/i.test(source)) {
                    offenders.push(path.relative(root, full));
                }
            }
        };
        walk(path.join(root, 'server'));
        assert('no server file logs a raw URL, body or credential header',
            offenders.length === 0, offenders.join(', '));
    }

    console.log(`\nPhase 35: ${passed} passed, ${failed} failed\n`);
    if (failed > 0) process.exit(1);
}

run();
