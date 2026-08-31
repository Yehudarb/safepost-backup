const { supabase } = require('../supabaseClient.cjs');

const SUPABASE_URL = process.env.SUPABASE_URL || '';
if (SUPABASE_URL.includes('namyhsldzufeoycleqxf')) {
    console.error('❌ REFUSING: SUPABASE_URL points at the PRODUCTION project.');
    process.exit(3);
}

async function testGroupSync() {
    console.log('🔍 Testing Group Sync Integration\n');

    try {
        // 1. Get workspace
        const { data: workspaces, error: wsErr } = await supabase
            .from('workspaces')
            .select('id, name')
            .eq('is_demo', false)
            .limit(1);

        if (wsErr) throw new Error(`Workspace fetch failed: ${wsErr.message}`);
        if (!workspaces?.length) throw new Error('No workspace found');

        const workspaceId = workspaces[0].id;
        console.log(`✅ Workspace found: ${workspaces[0].name}`);

        // 2. Simulate group sync
        const testGroups = [
            { id: 'test-group-1', name: 'Test Group 1', url: 'https://fb.com/groups/test1/' },
            { id: 'test-group-2', name: 'Test Group 2', url: 'https://fb.com/groups/test2/' }
        ];

        const syncData = testGroups.map(g => ({
            id: g.id,
            name: g.name,
            url: g.url,
            workspace_id: workspaceId,
            facebook_user: 'test-user'
        }));

        const { error: upsertErr } = await supabase
            .from('groups')
            .upsert(syncData);

        if (upsertErr) throw new Error(`Upsert failed: ${upsertErr.message}`);
        console.log(`✅ Synced ${testGroups.length} groups`);

        // 3. Verify sync
        const { data: synced, error: verifyErr } = await supabase
            .from('groups')
            .select('id, name')
            .in('id', ['test-group-1', 'test-group-2'])
            .eq('workspace_id', workspaceId);

        if (verifyErr) throw new Error(`Verify failed: ${verifyErr.message}`);
        if (synced.length !== 2) throw new Error(`Expected 2 groups, got ${synced.length}`);
        console.log(`✅ Verified ${synced.length} groups in DB`);

        // 4. Composite key: the SAME group id must coexist per facebook_user.
        // This is what `onConflict: 'workspace_id,facebook_user,id'` guarantees —
        // dropping it collapses every account onto one row and silently destroys
        // multi-account support.
        const { error: otherUserErr } = await supabase.from('groups').upsert([{
            id: 'test-group-1', name: 'Test Group 1', url: 'https://fb.com/groups/test1/',
            workspace_id: workspaceId, facebook_user: 'test-user-2'
        }], { onConflict: 'workspace_id,facebook_user,id' });
        if (otherUserErr) throw new Error(`Composite-key upsert failed: ${otherUserErr.message}`);

        const { data: bothUsers } = await supabase
            .from('groups').select('facebook_user')
            .eq('id', 'test-group-1').eq('workspace_id', workspaceId);
        if (bothUsers.length !== 2) throw new Error(`Composite key broken: expected 2 rows for the same group id, got ${bothUsers.length}`);
        console.log(`✅ Composite key holds ${bothUsers.length} rows for the same group id`);

        // 5. Clean up
        await supabase
            .from('groups')
            .delete()
            .in('id', ['test-group-1', 'test-group-2'])
            .eq('workspace_id', workspaceId);
        console.log(`✅ Cleanup complete`);

        console.log('\n✅ All sync tests passed!');
        return true;
    } catch (e) {
        console.error(`❌ Sync test failed: ${e.message}`);
        return false;
    }
}

testGroupSync().then(success => process.exit(success ? 0 : 1));
