const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

console.log("🔍 Testing Supabase Connection...\n");
console.log("URL:", SUPABASE_URL);
console.log("Key exists:", !!SUPABASE_KEY, "\n");

if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error("❌ Missing credentials!");
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function testSupabase() {
    try {
        // 1. Test Connection - List Buckets
        console.log("1️⃣ Testing Storage Buckets...");
        const { data: buckets, error: bucketError } = await supabase.storage.listBuckets();
        
        if (bucketError) {
            console.error("❌ Failed to list buckets:", bucketError.message);
        } else {
            console.log("✅ Connected! Found buckets:");
            buckets.forEach(b => console.log(`   - ${b.id} (Public: ${b.public})`));
        }

        // 2. Check Tables
        console.log("\n2️⃣ Checking Database Tables...");
        const tables = ['groups', 'posts'];
        for (const table of tables) {
            const { data, error } = await supabase.from(table).select('count', { count: 'exact', head: true }).limit(1);
            if (error) {
                console.error(`❌ Table '${table}': ${error.message}`);
            } else {
                console.log(`✅ Table '${table}': OK`);
            }
        }

        console.log("\n✅ Supabase connection successful!");

    } catch (e) {
        console.error("🔥 Error:", e.message);
    }
}

testSupabase();
