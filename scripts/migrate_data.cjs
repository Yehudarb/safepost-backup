const sqlite3 = require('sqlite3').verbose();
const { createClient } = require('@supabase/supabase-js');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY; // Use Service Role Key for full access if possible, or Anon if policies allow

if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error("❌ Missing SUPABASE_URL or SUPABASE_KEY in .env");
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const dbPath = path.join(__dirname, '../database.sqlite');
const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY);

const migrateGroups = () => {
    return new Promise((resolve, reject) => {
        db.all("SELECT * FROM groups", async (err, rows) => {
            if (err) return reject(err);
            if (rows.length === 0) return resolve(0);

            console.log(`📦 Found ${rows.length} groups to migrate...`);

            // Map to Supabase schema (timestamps might need format tweak if not ISO)
            const payload = rows.map(r => ({
                id: r.id,
                name: r.name,
                url: r.url,
                type: r.type,
                last_posted: r.last_posted ? new Date(r.last_posted) : null
            }));

            const { error } = await supabase.from('groups').upsert(payload);

            if (error) reject(error);
            else resolve(rows.length);
        });
    });
};

const migratePosts = () => {
    return new Promise((resolve, reject) => {
        db.all("SELECT * FROM posts", async (err, rows) => {
            if (err) return reject(err);
            if (rows.length === 0) return resolve(0);

            console.log(`📝 Found ${rows.length} posts to migrate...`);

            // Map keys
            const payload = rows.map(r => ({
                // id: r.id, // Let Supabase generate new IDs to match Identity, OR force if needed. 
                // Since SQLite IDs are sequential integers and Supabase is BigInt Identity, we can try to preserve them 
                // BUT if we insert explicit IDs, we might need to adjust the sequence later.
                // For simplicity, let's DROP the ID and let Supabase generate new ones. 
                // This means the Dashboard UI will get new IDs after refresh.
                group_id: r.group_id,
                content: r.content,
                media_url: r.media_url,
                status: r.status,
                scheduled_time: r.scheduled_time ? new Date(r.scheduled_time) : null,
                created_at: r.created_at ? new Date(r.created_at) : new Date()
            }));

            const { error } = await supabase.from('posts').insert(payload);

            if (error) reject(error);
            else resolve(rows.length);
        });
    });
};

async function run() {
    try {
        console.log("🚀 Starting Migration...");
        const groupsCount = await migrateGroups();
        console.log(`✅ Migrated ${groupsCount} groups.`);

        const postsCount = await migratePosts();
        console.log(`✅ Migrated ${postsCount} posts.`);

        console.log("🎉 Migration Complete!");
    } catch (e) {
        console.error("❌ Migration Failed:", e);
    } finally {
        db.close();
    }
}

run();
