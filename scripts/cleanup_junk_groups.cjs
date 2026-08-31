// Remove the legacy rows whose facebook_user was stored as a JSON blob
// instead of a plain name. The next per-user sync will re-create them with
// the correct facebook_user attribution.
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

(async () => {
    const { data: before } = await supabase.from('groups').select('id, facebook_user');
    const junk = (before || []).filter(g => (g.facebook_user || '').startsWith('{"facebook_user":'));
    console.log(`Found ${junk.length} legacy JSON-blob rows out of ${before?.length ?? 0} total.`);

    if (junk.length === 0) { console.log('Nothing to clean.'); return; }

    // Group by exact facebook_user value so we can .in() on ids for each junk cohort.
    const buckets = new Map();
    junk.forEach(g => {
        if (!buckets.has(g.facebook_user)) buckets.set(g.facebook_user, []);
        buckets.get(g.facebook_user).push(g.id);
    });

    for (const [fbUser, ids] of buckets) {
        const { error } = await supabase.from('groups').delete()
            .eq('facebook_user', fbUser)
            .in('id', ids);
        if (error) { console.error('Delete failed for cohort:', fbUser, error); process.exit(1); }
        console.log(`  Deleted ${ids.length} rows attributed to malformed user "${fbUser.slice(0, 60)}..."`);
    }

    const { count } = await supabase.from('groups').select('id', { count: 'exact', head: true });
    console.log(`Done. Groups table now holds ${count} rows.`);
})();
