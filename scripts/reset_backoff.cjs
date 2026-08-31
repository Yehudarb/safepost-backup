// Clear the long 180s+ backoff that already-stuck tasks accrued under the old
// aggressive retry policy. Anything currently PENDING gets its attempt counter
// zeroed and its scheduled_time pulled back to now so the dispatcher picks it up
// on the next tick instead of waiting out the old delay.
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

(async () => {
    const now = new Date().toISOString();

    const { data: pending } = await supabase
        .from('posts')
        .select('id, scheduled_time, attempt_count, group_id')
        .eq('status', 'PENDING')
        .eq('app_source', 'backup');

    if (!pending || pending.length === 0) { console.log('No pending tasks to reset.'); return; }

    console.log(`Resetting ${pending.length} PENDING task(s):`);
    pending.forEach(p => console.log(`  #${p.id} [${p.group_id}] attempt_count=${p.attempt_count || 0} scheduled=${p.scheduled_time}`));

    const { error } = await supabase
        .from('posts')
        .update({ attempt_count: 0, scheduled_time: now })
        .eq('status', 'PENDING')
        .eq('app_source', 'backup');
    if (error) { console.error('Reset failed:', error); process.exit(1); }
    console.log(`\nAll ${pending.length} tasks reset — dispatcher will pick them up within seconds.`);
})();
