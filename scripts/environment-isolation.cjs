'use strict';

const fs = require('fs');
const path = require('path');
const { QA_SUPABASE_REF } = require('../server/lib/environmentIsolation.cjs');
const PROD_SUPABASE_REF = 'hfpsdzfggugoerythnug';
const PROD_API_HOST = 'safepost-backup.onrender.com';

const root = path.resolve(__dirname, '..');

function requireValue(env, name) {
    const value = String(env[name] || '').trim();
    if (!value) throw new Error(`${name} is required.`);
    return value;
}

function exactHttpsUrl(name, value) {
    let url;
    try { url = new URL(value); } catch { throw new Error(`${name} must be an absolute URL.`); }
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
        throw new Error(`${name} must be a clean HTTPS URL.`);
    }
    return url;
}

function resolveFrontendEnvironment(env = process.env) {
    const target = requireValue(env, 'SAFEPOST_ENV').toLowerCase();
    if (!['qa', 'production'].includes(target)) throw new Error('SAFEPOST_ENV must be qa or production.');
    const requiredRef = target === 'qa' ? QA_SUPABASE_REF : PROD_SUPABASE_REF;
    if (requireValue(env, 'SAFEPOST_EXPECTED_SUPABASE_REF') !== requiredRef) {
        throw new Error(`SAFEPOST_EXPECTED_SUPABASE_REF must equal the ${target} project ref.`);
    }
    const api = exactHttpsUrl('VITE_API_URL', requireValue(env, 'VITE_API_URL'));
    const supabase = exactHttpsUrl('VITE_SUPABASE_URL', requireValue(env, 'VITE_SUPABASE_URL'));
    const publicOrigin = exactHttpsUrl('VITE_PUBLIC_APP_ORIGIN', requireValue(env, 'VITE_PUBLIC_APP_ORIGIN'));
    if (supabase.hostname !== `${requiredRef}.supabase.co`) throw new Error('VITE_SUPABASE_URL does not match SAFEPOST_ENV.');
    requireValue(env, 'VITE_SUPABASE_ANON_KEY');
    if (target === 'qa') {
        const serialized = [api.href, supabase.href, publicOrigin.href].join(' ');
        if (serialized.includes(PROD_SUPABASE_REF) || serialized.includes(PROD_API_HOST) || serialized.includes('safepost-backup.vercel.app')) {
            throw new Error('QA frontend configuration references production.');
        }
        if (api.hostname === publicOrigin.hostname) throw new Error('QA frontend and backend must be separate services.');
    }
    return {
        target,
        apiOrigin: api.origin,
        apiWebSocketOrigin: `wss://${api.host}`,
        supabaseOrigin: supabase.origin,
        publicOrigin: publicOrigin.origin,
        publicHost: publicOrigin.host,
    };
}

function forbiddenProductionReferences(directory) {
    const needles = [PROD_SUPABASE_REF, PROD_API_HOST, 'safepost-backup.vercel.app'];
    const hits = [];
    function walk(current) {
        for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
            const file = path.join(current, entry.name);
            if (entry.isDirectory()) walk(file);
            else if (entry.isFile()) {
                const content = fs.readFileSync(file);
                for (const needle of needles) if (content.includes(Buffer.from(needle))) hits.push(`${path.relative(directory, file)}:${needle}`);
            }
        }
    }
    walk(directory);
    return hits;
}

module.exports = { root, resolveFrontendEnvironment, forbiddenProductionReferences };
