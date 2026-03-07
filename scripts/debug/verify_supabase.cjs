const { supabase } = require('./server/supabaseClient.cjs');

async function testSupabase() {
    console.log("🔍 Starting Supabase Diagnostics...");

    try {
        // 1. List Buckets
        console.log("📂 Listing Storage Buckets...");
        const { data: buckets, error: bucketError } = await supabase.storage.listBuckets();

        if (bucketError) {
            console.error("❌ Failed to list buckets:", bucketError);
        } else {
            console.log("✅ Buckets found:", buckets.map(b => `${b.id} (Public: ${b.public})`));

            const targetBucket = buckets.find(b => b.id === 'campaign-media');
            if (!targetBucket) {
                console.error("❌ CRITICAL: 'campaign-media' bucket NOT found!");
            } else {
                console.log("✅ 'campaign-media' bucket exists.");
            }
        }

        // 2. Test Upload
        console.log("☁️ Testing Upload to 'campaign-media'...");
        const testFileName = `test-${Date.now()}.txt`;
        const { data: uploadData, error: uploadError } = await supabase.storage
            .from('campaign-media')
            .upload(testFileName, 'Hello World', {
                contentType: 'text/plain',
                upsert: true
            });

        if (uploadError) {
            console.error("❌ Upload Test Failed:", uploadError);
        } else {
            console.log("✅ Upload Test Success:", uploadData);

            // 3. Get Public URL
            const { data: { publicUrl } } = supabase.storage
                .from('campaign-media')
                .getPublicUrl(testFileName);
            console.log("🔗 Public URL:", publicUrl);
        }

    } catch (e) {
        console.error("🔥 Unexpected Execution Error:", e);
    }
}

testSupabase();
