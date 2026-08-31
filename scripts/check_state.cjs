// Snapshot of what's actually in the DB right now — queue state + a sample of
// group names — so we can see WHY tasks are stuck and whether names are clean.
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

(async () => {
    // --- Queue / posts state ---
    const { data: posts } = await supabase
        .from('posts')
        .select('id, status, group_id, scheduled_time, failure_reason, facebook_user, workspace_id, created_at')
        .order('created_at', { ascending: false })
        .limit(30);

    const byStatus = new Map();
    (posts || []).forEach(p => byStatus.set(p.status, (byStatus.get(p.status) || 0) + 1));

    console.log('=== POSTS / QUEUE ===');
    console.log(`Recent posts fetched: ${posts?.length || 0}`);
    console.log('By status:', Object.fromEntries(byStatus));

    console.log('\nMost recent 5 tasks:');
    (posts || []).slice(0, 5).forEach(p => {
        console.log(`  #${p.id} [${p.status}] group_id=${p.group_id} fbUser="${p.facebook_user || ''}" scheduled=${p.scheduled_time} ${p.failure_reason ? '⚠ ' + p.failure_reason : ''}`);
    });

    // --- Group names sample ---
    const { data: groups } = await supabase
        .from('groups')
        .select('id, name, url, facebook_user')
        .order('name', { ascending: true })
        .limit(40);

    console.log('\n=== GROUPS (sample of 40) ===');
    let nameless = 0, placeholder = 0;
    (groups || []).forEach(g => {
        if (!g.name) nameless++;
        else if (/^קבוצה \d+$/.test(g.name) || /^Group \d+$/i.test(g.name)) placeholder++;
    });
    console.log(`Blank names: ${nameless}, placeholder-named ("קבוצה N"): ${placeholder}`);
    (groups || []).slice(0, 15).forEach(g => {
        console.log(`  [${g.id.slice(0, 20)}] "${g.name}"  <${g.url}>`);
    });
})();
