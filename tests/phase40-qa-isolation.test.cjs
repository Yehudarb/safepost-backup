'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { assertEnvironmentIsolation } = require('../server/lib/environmentIsolation.cjs');
const { resolveFrontendEnvironment } = require('../scripts/environment-isolation.cjs');

const QA_REF = 'tesagheacuzkhecaihte';
const PROD_REF = 'hfpsdzfggugoerythnug';
const qaFront = {
    SAFEPOST_ENV: 'qa', SAFEPOST_EXPECTED_SUPABASE_REF: QA_REF,
    VITE_API_URL: 'https://safepost-qa.onrender.com',
    VITE_SUPABASE_URL: `https://${QA_REF}.supabase.co`,
    VITE_SUPABASE_ANON_KEY: 'qa-anon-placeholder',
    VITE_PUBLIC_APP_ORIGIN: 'https://safepost-qa.vercel.app',
};
const qaBack = {
    SAFEPOST_ENV: 'qa', SAFEPOST_EXPECTED_SUPABASE_REF: QA_REF,
    SUPABASE_URL: `https://${QA_REF}.supabase.co`,
    SUPABASE_SERVICE_KEY: 'qa-service-placeholder', SUPABASE_ANON_KEY: 'qa-anon-placeholder',
    AUTH_ENFORCED: 'true', WORKER_AUTH_ENFORCED: 'true', ENGAGEMENT_ENABLED: 'true',
    ALLOWED_DASHBOARD_ORIGINS: 'https://safepost-qa.vercel.app',
    QA_DASHBOARD_ORIGIN: 'https://safepost-qa.vercel.app',
};

assert.equal(resolveFrontendEnvironment(qaFront).target, 'qa');
assert.equal(assertEnvironmentIsolation(qaBack).target, 'qa');
for (const [name, change] of Object.entries({
    'production database': { SUPABASE_URL: `https://${PROD_REF}.supabase.co` },
    'wrong expected ref': { SAFEPOST_EXPECTED_SUPABASE_REF: PROD_REF },
    'production frontend origin': { ALLOWED_DASHBOARD_ORIGINS: 'https://safepost-backup.vercel.app' },
    'different QA origin': { ALLOWED_DASHBOARD_ORIGINS: 'https://preview-safepost-qa.vercel.app' },
    'auth disabled': { AUTH_ENFORCED: 'false' },
    'worker auth disabled': { WORKER_AUTH_ENFORCED: 'false' },
    'engagement disabled': { ENGAGEMENT_ENABLED: 'false' },
})) assert.throws(() => assertEnvironmentIsolation({ ...qaBack, ...change }), name);

for (const [name, change] of Object.entries({
    'production API': { VITE_API_URL: 'https://safepost-backup.onrender.com' },
    'production Supabase': { VITE_SUPABASE_URL: `https://${PROD_REF}.supabase.co` },
    'production app origin': { VITE_PUBLIC_APP_ORIGIN: 'https://safepost-backup.vercel.app' },
    'missing API': { VITE_API_URL: '' },
})) assert.throws(() => resolveFrontendEnvironment({ ...qaFront, ...change }), name);

const apiSource = fs.readFileSync(path.join(__dirname, '../src/lib/apiConfig.js'), 'utf8');
assert(!apiSource.includes('safepost-backup.onrender.com'), 'shared API resolver has no production fallback');
const serverSource = fs.readFileSync(path.join(__dirname, '../server/index.cjs'), 'utf8');
assert(serverSource.includes("process.env.NODE_ENV === 'production' ? []"), 'production mode excludes fixed local origins');
assert(serverSource.includes("process.env.NODE_ENV !== 'production' && isLocalOrigin(origin)"), 'production mode rejects dynamic local origins');
assert(!serverSource.includes('safepost-backup.onrender.com'), 'QA backend source has no production API host');
const vercelConfig = fs.readFileSync(path.join(__dirname, '../vercel.json'), 'utf8');
assert(!vercelConfig.includes('onrender.com') && !vercelConfig.includes('supabase.co'), 'vercel.json has no fixed endpoints');

const output = path.join(__dirname, '../.vercel/output');
if (fs.existsSync(output)) {
    const child = spawnSync(process.execPath, [path.join(__dirname, '../scripts/verify-qa-isolation.cjs')], {
        cwd: path.join(__dirname, '..'), env: { ...process.env, ...qaFront, SUPABASE_SERVICE_KEY: 'verification-placeholder' }, encoding: 'utf8',
    });
    assert.equal(child.status, 0, child.stdout + child.stderr);
}
console.log('Phase 40 QA isolation: PASS');
