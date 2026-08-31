// One-shot check: how many groups are in Supabase right now, broken down by
// facebook_user. Answers "did anything actually save?" without opening the
// Supabase dashboard.
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

(async () => {
    const { data, error, count } = await supabase
        .from('groups')
        .select('facebook_user, id', { count: 'exact' });

    if (error) { console.error('QUERY ERROR:', error); process.exit(1); }

    console.log(`Total groups in DB: ${count}`);

    const byUser = new Map();
    (data || []).forEach(g => {
        const key = g.facebook_user || '(null/empty)';
        byUser.set(key, (byUser.get(key) || 0) + 1);
    });

    console.log('\nBreakdown by facebook_user:');
    if (byUser.size === 0) {
        console.log('  (no rows)');
    } else {
        for (const [user, n] of byUser) {
            console.log(`  ${user}: ${n}`);
        }
    }
})();
