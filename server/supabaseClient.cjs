const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const { assertSecureRuntimeConfig, isSecureRuntime } = require('./lib/runtimeMode.cjs');

require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('CRITICAL: Missing SUPABASE_URL or SUPABASE_SERVICE_KEY in environment. Set them in .env (see .env.example).');
}

if (isSecureRuntime) {
    assertSecureRuntimeConfig();
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

module.exports = { supabase };
