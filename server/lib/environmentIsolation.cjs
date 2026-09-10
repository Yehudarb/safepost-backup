'use strict';

const QA_SUPABASE_REF = 'tesagheacuzkhecaihte';

function parseUrl(name, value) {
    try {
        return new URL(value);
    } catch {
        throw new Error(`${name} must be a valid absolute URL.`);
    }
}

function parseOrigins(value) {
    return String(value || '').split(',').map(item => item.trim()).filter(Boolean).map(origin => {
        const url = parseUrl('ALLOWED_DASHBOARD_ORIGINS', origin);
        if (url.protocol !== 'https:' || url.pathname !== '/' || url.search || url.hash) {
            throw new Error('ALLOWED_DASHBOARD_ORIGINS entries must be HTTPS origins without paths.');
        }
        return url.origin;
    });
}

function assertEnvironmentIsolation(env = process.env) {
    const target = String(env.SAFEPOST_ENV || '').toLowerCase();
    if (!target) return { target: 'legacy', dashboardOrigins: [] };
    if (!['qa', 'production'].includes(target)) throw new Error('SAFEPOST_ENV must be qa or production.');

    const expectedRef = String(env.SAFEPOST_EXPECTED_SUPABASE_REF || '');
    const requiredRef = target === 'qa' ? QA_SUPABASE_REF : expectedRef;
    if (!requiredRef || (target === 'qa' && expectedRef !== QA_SUPABASE_REF))
        throw new Error(`SAFEPOST_EXPECTED_SUPABASE_REF must equal the ${target} project ref.`);
    const supabaseUrl = parseUrl('SUPABASE_URL', env.SUPABASE_URL);
    if (supabaseUrl.protocol !== 'https:' || supabaseUrl.hostname !== `${requiredRef}.supabase.co`) {
        throw new Error(`SUPABASE_URL does not match SAFEPOST_ENV=${target}.`);
    }
    if (!env.SUPABASE_SERVICE_KEY) throw new Error('SUPABASE_SERVICE_KEY is required.');
    if (!env.SUPABASE_ANON_KEY) throw new Error('SUPABASE_ANON_KEY is required.');
    if (String(env.AUTH_ENFORCED).toLowerCase() !== 'true') throw new Error('AUTH_ENFORCED=true is required.');
    if (String(env.WORKER_AUTH_ENFORCED).toLowerCase() !== 'true') throw new Error('WORKER_AUTH_ENFORCED=true is required.');
    if (target === 'qa' && String(env.ENGAGEMENT_ENABLED).toLowerCase() !== 'true') {
        throw new Error('ENGAGEMENT_ENABLED=true is required in QA.');
    }
    const dashboardOrigins = parseOrigins(env.ALLOWED_DASHBOARD_ORIGINS);
    if (!dashboardOrigins.length) throw new Error('ALLOWED_DASHBOARD_ORIGINS is required.');
    if (target === 'qa' && dashboardOrigins.some(origin => origin !== String(env.QA_DASHBOARD_ORIGIN || '').trim()))
        throw new Error('QA dashboard origins must exactly match QA_DASHBOARD_ORIGIN.');
    return { target, expectedRef, dashboardOrigins };
}

module.exports = {
    QA_SUPABASE_REF,
    parseOrigins, assertEnvironmentIsolation,
};
