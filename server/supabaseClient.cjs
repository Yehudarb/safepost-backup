const { createClient } = require('@supabase/supabase-js');
const path = require('path');
// Load env vars if not already loaded, assuming running from root or check relative
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const SUPABASE_URL = process.env.SUPABASE_URL;
// Use service_role key for server (RLS bypass); fall back to anon key for compatibility.
// Credentials MUST come from the environment / .env — never hardcoded (see .env.example).
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error("❌ CRITICAL: Missing SUPABASE_URL or SUPABASE_SERVICE_KEY in environment. Set them in .env (see .env.example).");
    // We don't exit here to allow for some graceful error handling or testing contexts,
    // but standard operation requires these.
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

module.exports = { supabase };
