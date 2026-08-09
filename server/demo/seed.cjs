// Phase 4 — Demo workspace synthetic data.
//
// Seeds/reset a demo workspace with FICTIONAL data only: no real Facebook group
// URLs, no owner records, no real media, no real worker ids. Demo posts use
// app_source='demo' so the worker (jobs/next filters app_source='backup') can
// never claim or publish them.

const { supabase } = require('../supabaseClient.cjs');

const DEMO_SOURCE = 'demo';

function demoGroups(wsId, ownerId) {
    return [
        { id: `demo-grp-marketing`, name: 'Demo · Marketing Tips', url: 'https://example.com/groups/demo-marketing', workspace_id: wsId, created_by: ownerId },
        { id: `demo-grp-local`, name: 'Demo · Local Community', url: 'https://example.com/groups/demo-local', workspace_id: wsId, created_by: ownerId },
        { id: `demo-grp-deals`, name: 'Demo · Daily Deals', url: 'https://example.com/groups/demo-deals', workspace_id: wsId, created_by: ownerId },
    ];
}

function demoTemplates(wsId, ownerId) {
    return [
        { name: 'Demo · Welcome post', content: 'שלום לכולם! ברוכים הבאים 👋 (demo)', app_source: DEMO_SOURCE, workspace_id: wsId, created_by: ownerId },
        { name: 'Demo · Weekend sale', content: 'מבצע סוף שבוע — פרטים בפנים 🛍️ (demo)', app_source: DEMO_SOURCE, workspace_id: wsId, created_by: ownerId },
    ];
}

function demoPosts(wsId, ownerId) {
    const now = Date.now();
    const iso = (offsetMs) => new Date(now + offsetMs).toISOString();
    return [
        { group_id: 'demo-grp-marketing', content: 'טיפ שיווקי להיום ✨ (demo)', status: 'SUCCESS',   scheduled_time: iso(-3 * 3600e3), ended_at: iso(-3 * 3600e3 + 60e3), app_source: DEMO_SOURCE, workspace_id: wsId, created_by: ownerId },
        { group_id: 'demo-grp-local',     content: 'אירוע קהילתי מקומי 📅 (demo)', status: 'SUCCESS',   scheduled_time: iso(-2 * 3600e3), ended_at: iso(-2 * 3600e3 + 60e3), app_source: DEMO_SOURCE, workspace_id: wsId, created_by: ownerId },
        { group_id: 'demo-grp-deals',     content: 'דיל מיוחד להיום 🛒 (demo)',    status: 'FAILED',    scheduled_time: iso(-1 * 3600e3), failure_reason: 'Demo: simulated failure', app_source: DEMO_SOURCE, workspace_id: wsId, created_by: ownerId },
        { group_id: 'demo-grp-marketing', content: 'פוסט מתוזמן להמשך היום ⏰ (demo)', status: 'PENDING', scheduled_time: iso(2 * 3600e3), app_source: DEMO_SOURCE, workspace_id: wsId, created_by: ownerId },
        { group_id: 'demo-grp-local',     content: 'פוסט מתוזמן למחר 🌅 (demo)',    status: 'PENDING',  scheduled_time: iso(26 * 3600e3), app_source: DEMO_SOURCE, workspace_id: wsId, created_by: ownerId },
    ];
}

function demoLogs(wsId) {
    return [
        { log_level: 'info',  source: 'demo', message: 'Demo · task published successfully', workspace_id: wsId },
        { log_level: 'error', source: 'demo', message: 'Demo · simulated publish failure', workspace_id: wsId },
        { log_level: 'info',  source: 'demo', message: 'Demo · worker heartbeat (simulated)', workspace_id: wsId },
    ];
}

// Remove everything in the demo workspace (scoped — never touches other data).
async function clearDemoWorkspace(wsId) {
    await supabase.from('posts').delete().eq('workspace_id', wsId);
    await supabase.from('post_templates').delete().eq('workspace_id', wsId);
    await supabase.from('group_sets').delete().eq('workspace_id', wsId);
    await supabase.from('system_logs').delete().eq('workspace_id', wsId);
    await supabase.from('groups').delete().eq('workspace_id', wsId);
}

async function seedDemoWorkspace(wsId, ownerId) {
    // Groups first (posts reference group ids).
    await supabase.from('groups').upsert(demoGroups(wsId, ownerId), { onConflict: 'id' });
    await supabase.from('post_templates').insert(demoTemplates(wsId, ownerId));
    await supabase.from('posts').insert(demoPosts(wsId, ownerId));
    await supabase.from('system_logs').insert(demoLogs(wsId));
}

async function resetDemoWorkspace(wsId, ownerId) {
    await clearDemoWorkspace(wsId);
    await seedDemoWorkspace(wsId, ownerId);
}

module.exports = { DEMO_SOURCE, seedDemoWorkspace, resetDemoWorkspace, clearDemoWorkspace };
