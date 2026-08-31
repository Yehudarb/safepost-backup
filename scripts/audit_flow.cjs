// Deep audit of the dispatch pipeline: any orphaned SENT tasks, PROCESSING
// stragglers, unreachable groups, or bad status transitions.
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

(async () => {
    const { data: all } = await supabase
        .from('posts')
        .select('id, status, group_id, facebook_user, workspace_id, scheduled_time, attempt_count, failure_reason, created_at, ended_at')
        .in('app_source', ['backup', 'demo'])
        .order('created_at', { ascending: false })
        .limit(50);

    console.log(`\n=== ALL RECENT TASKS (${all?.length || 0}) ===`);
    const byStatus = {};
    (all || []).forEach(p => { byStatus[p.status] = (byStatus[p.status] || 0) + 1; });
    console.log('By status:', byStatus);

    console.log('\n--- Active / potentially-stuck ---');
    (all || []).filter(p => ['SENT', 'PROCESSING', 'PENDING'].includes(p.status)).forEach(p => {
        const ageSec = Math.round((Date.now() - new Date(p.created_at).getTime()) / 1000);
        const dueSec = Math.round((Date.now() - new Date(p.scheduled_time).getTime()) / 1000);
        console.log(`  #${p.id} [${p.status}] group=${p.group_id} attempt=${p.attempt_count || 0} age=${ageSec}s due=${dueSec}s (${dueSec > 0 ? 'past due' : 'future'})`);
    });

    // Check for group_id → groups row existence (a task with no matching group
    // row can never be dispatched because the worker needs the URL).
    console.log('\n--- Group-row lookup for active tasks ---');
    const activeIds = (all || []).filter(p => ['PENDING', 'SENT', 'PROCESSING'].includes(p.status));
    for (const p of activeIds) {
        if (!p.group_id) { console.log(`  #${p.id} → NO group_id set`); continue; }
        const { data: gs } = await supabase.from('groups')
            .select('id, name, url, facebook_user')
            .eq('id', p.group_id);
        if (!gs || gs.length === 0) {
            console.log(`  #${p.id} → group_id="${p.group_id}" NOT FOUND in groups`);
        } else {
            const forThisUser = gs.find(g => g.facebook_user === (p.facebook_user || ''));
            const match = forThisUser ? '✓ matches user' : '✗ exists but under different user(s): ' + gs.map(g => g.facebook_user).join(', ');
            console.log(`  #${p.id} → "${(forThisUser || gs[0]).name}" ${match}`);
        }
    }
})();
