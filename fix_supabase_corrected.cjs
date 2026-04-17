const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function fixSupabase() {
    console.log("🛠️ Starting Supabase Setup...\n");

    try {
        // 1. Create Bucket
        console.log("1️⃣ Checking Storage Bucket...");
        const { data: buckets, error: listError } = await supabase.storage.listBuckets();
        
        if (listError) {
            console.error("❌ Failed to list buckets:", listError.message);
            return;
        }

        const bucketName = 'campaign-media';
        const bucketExists = buckets.find(b => b.id === bucketName);

        if (!bucketExists) {
            console.log(`⚠️ Bucket '${bucketName}' not found. Creating...`);
            const { data, error } = await supabase.storage.createBucket(bucketName, {
                public: false
            });

            if (error) {
                console.error("❌ Failed to create bucket:", error.message);
            } else {
                console.log("✅ Bucket 'campaign-media' created successfully!");
            }
        } else {
            console.log(`✅ Bucket '${bucketName}' already exists.`);
        }

        console.log("\n✅ Supabase setup complete!");

    } catch (e) {
        console.error("🔥 Error:", e.message);
    }
}

fixSupabase();
