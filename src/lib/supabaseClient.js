// Frontend Supabase client — used ONLY for authentication (login/register/reset,
// session persistence). All business data still flows through the Express API.
//
// Configure via env (dev/staging project):
//   VITE_SUPABASE_URL
//   VITE_SUPABASE_ANON_KEY
import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(url && anonKey);

if (!isSupabaseConfigured) {
    // Don't throw — let the UI show a friendly "auth not configured" message.
    console.warn('[auth] VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY not set — authentication is disabled.');
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
