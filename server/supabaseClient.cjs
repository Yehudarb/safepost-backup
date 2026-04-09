const { createClient } = require('@supabase/supabase-js');
const path = require('path');
// Load env vars if not already loaded, assuming running from root or check relative
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://namyhsldzufeoycleqxf.supabase.co';
// Use service_role key for server (RLS bypass); fall back to anon key for compatibility
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY || 'sb_secret_RnLBNjUkhLHjF630ucbfsA_MLuonpua';

if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error("❌ CRITICAL: Missing SUPABASE_URL or SUPABASE_KEY in environment.");
    // We don't exit here to allow for some graceful error handling or testing contexts,
    // but standard operation requires these.
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

module.exports = { supabase };
