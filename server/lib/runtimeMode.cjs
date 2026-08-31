const path = require('path');

require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const NODE_ENV = String(process.env.NODE_ENV || 'development').toLowerCase();
const DEV_LIKE_ENVS = new Set(['development', 'dev', 'test']);
const isSecureRuntime = !DEV_LIKE_ENVS.has(NODE_ENV);

function envFlag(name) {
    return String(process.env[name] || '').toLowerCase() === 'true';
}

const AUTH_ENFORCED = isSecureRuntime ? process.env.AUTH_ENFORCED !== 'false' : envFlag('AUTH_ENFORCED');
const WORKER_AUTH_ENFORCED = isSecureRuntime ? process.env.WORKER_AUTH_ENFORCED !== 'false' : envFlag('WORKER_AUTH_ENFORCED');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertSecureRuntimeConfig() {
    if (!isSecureRuntime) return;

    if (process.env.AUTH_ENFORCED === 'false') {
        throw new Error('AUTH_ENFORCED=false is not allowed outside development/test.');
    }
    if (process.env.WORKER_AUTH_ENFORCED === 'false') {
        throw new Error('WORKER_AUTH_ENFORCED=false is not allowed outside development/test.');
    }
    if (!process.env.SUPABASE_URL) {
        throw new Error('SUPABASE_URL is required outside development/test.');
    }
    if (!(process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY)) {
        throw new Error('SUPABASE_SERVICE_KEY is required outside development/test.');
    }
    if (process.env.EXTENSION_API_KEY && !process.env.EXTENSION_KEY_WORKSPACE_ID) {
        throw new Error('EXTENSION_KEY_WORKSPACE_ID is required when EXTENSION_API_KEY is set outside development/test.');
    }
    if (process.env.EXTENSION_KEY_WORKSPACE_ID && !UUID_RE.test(process.env.EXTENSION_KEY_WORKSPACE_ID)) {
        throw new Error('EXTENSION_KEY_WORKSPACE_ID must be a valid UUID.');
    }
}

module.exports = {
    NODE_ENV,
    isSecureRuntime,
    AUTH_ENFORCED,
    WORKER_AUTH_ENFORCED,
    UUID_RE,
    assertSecureRuntimeConfig,
};
