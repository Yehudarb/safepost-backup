const { supabase } = require('./server/supabaseClient.cjs');

async function fixSupabase() {
    console.log("🛠️ Starting Supabase Fixer...");

    try {
        // 1. Create Bucket
        const { data: buckets, error: listError } = await supabase.storage.listBuckets();
        if (listError) {
            console.error("❌ Failed to list buckets:", listError);
            return;
        }

        const bucketName = 'campaign-media';
        const bucketExists = buckets.find(b => b.id === bucketName);

        if (!bucketExists) {
            console.log(`⚠️ Bucket '${bucketName}' not found. Creating...`);
            const { data, error } = await supabase.storage.createBucket(bucketName, {
                public: false // Private — use signed URLs for file access
            });

            if (error) {
                console.error("❌ Failed to create bucket:", error);
            } else {
                console.log("✅ Bucket created successfully:", data);
            }
        } else {
            console.log(`✅ Bucket '${bucketName}' already exists.`);
        }

        // 2. Check Tables
        console.log("🔍 Checking Tables...");
        const tables = ['groups', 'posts'];
        for (const table of tables) {
            const { data, error } = await supabase.from(table).select('count', { count: 'exact', head: true }).limit(1);
            if (error) {
                console.error(`❌ Table '${table}' check failed:`, error.message);
                // Try to create table if missing? 
                // Creating tables is complex via JS client, usually requires SQL. 
                // I'll log a warning and we might need to use execute_sql tool.
            } else {
                console.log(`✅ Table '${table}' exists.`);
            }
        }

    } catch (e) {
        console.error("🔥 Unexpected Error:", e);
    }
}

fixSupabase();
