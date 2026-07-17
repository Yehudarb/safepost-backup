/**
 * Phase 4 — One-time demo account + workspace setup (run against the DEV project).
 *
 * Creates the demo user, flags its workspace as a demo workspace, and seeds it
 * with synthetic data. Idempotent-ish: re-running resets the demo data.
 *
 * Env required:
 *   SUPABASE_URL, SUPABASE_SERVICE_KEY   (dev project)
 *   DEMO_EMAIL, DEMO_PASSWORD            (the shared demo login)
 *
 * Run:  node scripts/setup-demo.cjs
 */
const { createClient } = require('@supabase/supabase-js');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const { SUPABASE_URL, SUPABASE_SERVICE_KEY, DEMO_EMAIL, DEMO_PASSWORD } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !DEMO_EMAIL || !DEMO_PASSWORD) {
    console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_KEY / DEMO_EMAIL / DEMO_PASSWORD.');
    process.exit(2);
}

// The seed module imports ../server/supabaseClient which reads the same env.
const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const { resetDemoWorkspace } = require('../server/demo/seed.cjs');

(async () => {
    // 1. Ensure the demo user exists.
    let userId;
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
        email: DEMO_EMAIL, password: DEMO_PASSWORD, email_confirm: true,
    });
    if (createErr && !/already/i.test(createErr.message)) throw createErr;
    if (created?.user) {
        userId = created.user.id;
    } else {
        // Already exists — look it up.
        const { data: list } = await admin.auth.admin.listUsers();
        userId = list.users.find(u => u.email === DEMO_EMAIL)?.id;
    }
    if (!userId) throw new Error('Could not resolve demo user id.');
    console.log('Demo user:', DEMO_EMAIL, userId);

    // 2. Find the user's workspace and flag it as demo.
    const { data: mem } = await admin.from('workspace_members').select('workspace_id').eq('user_id', userId).limit(1);
    const wsId = mem?.[0]?.workspace_id;
    if (!wsId) throw new Error('Demo user has no workspace (is the signup trigger installed?).');

    await admin.from('workspaces').update({ name: 'Demo Workspace', is_demo: true }).eq('id', wsId);
    console.log('Demo workspace flagged:', wsId);

    // 3. Seed synthetic data.
    await resetDemoWorkspace(wsId, userId);
    console.log('✅ Demo workspace seeded. Log in with the demo credentials to explore.');
    process.exit(0);
})().catch(err => { console.error('setup-demo failed:', err.message); process.exit(1); });
