import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const mode = String(import.meta.env.MODE || 'development').toLowerCase();

export const isAuthRequired = import.meta.env.PROD || !['development', 'dev', 'test'].includes(mode);
export const isSupabaseConfigured = Boolean(url && anonKey);
export const authConfigError = isAuthRequired && !isSupabaseConfigured
    ? 'Authentication is required in this environment. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY before starting the dashboard.'
    : null;

if (!isSupabaseConfigured) {
    console.warn(authConfigError || '[auth] VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY not set — authentication is disabled for local development.');
}

export const supabase = isSupabaseConfigured
    ? createClient(url, anonKey, {
        auth: {
            persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: true,
        },
    })
    : null;
