'use strict';

const fs = require('fs');
const path = require('path');
const { resolveFrontendEnvironment, forbiddenProductionReferences, root } = require('./environment-isolation.cjs');
const { assertEnvironmentIsolation, QA_SUPABASE_REF } = require('../server/lib/environmentIsolation.cjs');
const PROD_SUPABASE_REF = 'hfpsdzfggugoerythnug';
const PROD_API_HOST = 'safepost-backup.onrender.com';

function assert(condition, message) { if (!condition) throw new Error(message); }

const front = resolveFrontendEnvironment(process.env);
assert(front.target === 'qa', 'Isolation verification must run with SAFEPOST_ENV=qa.');
assertEnvironmentIsolation({
    ...process.env,
    SUPABASE_URL: process.env.VITE_SUPABASE_URL,
    SUPABASE_SERVICE_KEY: process.env.SUPABASE_SERVICE_KEY || 'verification-placeholder',
    SUPABASE_ANON_KEY: process.env.VITE_SUPABASE_ANON_KEY,
    AUTH_ENFORCED: 'true', WORKER_AUTH_ENFORCED: 'true', ENGAGEMENT_ENABLED: 'true',
    ALLOWED_DASHBOARD_ORIGINS: process.env.VITE_PUBLIC_APP_ORIGIN,
    QA_DASHBOARD_ORIGIN: process.env.VITE_PUBLIC_APP_ORIGIN,
});
assert(front.apiOrigin !== 'https://safepost-backup.onrender.com', 'QA API equals production API.');
assert(front.supabaseOrigin === `https://${QA_SUPABASE_REF}.supabase.co`, 'QA Supabase ref mismatch.');
assert(!front.apiOrigin.includes(PROD_API_HOST), 'QA API contains production host.');
const output = path.join(root, '.vercel', 'output');
assert(fs.existsSync(path.join(output, 'config.json')), 'Build .vercel/output before verification.');
const hits = forbiddenProductionReferences(output);
assert(hits.length === 0, `QA build contains production references: ${hits.join(', ')}`);
const bundle = JSON.stringify(JSON.parse(fs.readFileSync(path.join(output, 'config.json'), 'utf8')));
assert(bundle.includes(front.apiOrigin) && bundle.includes(front.supabaseOrigin), 'Generated CSP omits QA endpoints.');
assert(!bundle.includes(PROD_SUPABASE_REF), 'Generated CSP includes production Supabase.');
console.log('QA isolation verification PASS');
