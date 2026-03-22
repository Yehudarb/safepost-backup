const { supabase } = require('./server/supabaseClient.cjs');
const axios = require('axios');

const BASE_URL = 'http://localhost:3001';

async function verifyFixes() {
    console.log("🔍 Starting Verification...");

    // 1. Create a dummy group and post
    const groupId = 'test-group-' + Date.now();
    await supabase.from('groups').insert([{ id: groupId, name: 'Test Group', url: 'https://fb.com/' + groupId }]);
    
    const { data: post, error: postErr } = await supabase.from('posts').insert([{
        group_id: groupId,
        content: 'Test content',
        status: 'PENDING',
        app_source: 'backup'
    }]).select().single();

    if (postErr) throw postErr;
    console.log(`✅ Created test post ${post.id} linked to group ${groupId}`);

    // 2. Trigger Sync via API (replaces my newly created group but SHOULD NOT wipe group_id in post)
    console.log("🔄 Triggering Group Sync...");
    try {
        await axios.post(`${BASE_URL}/api/groups/sync`, {
            groups: [{ id: groupId, name: 'Test Group Updated', url: 'https://fb.com/' + groupId }]
        });
        console.log("✅ Sync request finished.");
    } catch (e) {
        console.error("❌ Sync request failed. Is the server running?", e.message);
        return;
    }

    // 3. Verify post still has group_id
    const { data: updatedPost } = await supabase.from('posts').select('group_id').eq('id', post.id).single();
    if (updatedPost.group_id === groupId) {
        console.log("🎯 SUCCESS: Post maintained its group_id after sync!");
    } else {
        console.error("❌ FAILURE: Post group_id was wiped (became " + updatedPost.group_id + ")");
    }

    // 4. Verify Failure Reason payload
    console.log("📝 Verifying Failure Reason payload...");
    const testReason = "Test failure reason " + Date.now();
    await axios.patch(`${BASE_URL}/api/tasks/${post.id}/status`, {
        status: 'FAILED',
        failure_reason: testReason
    });

    const { data: failedPost } = await supabase.from('posts').select('failure_reason').eq('id', post.id).single();
    if (failedPost.failure_reason === testReason) {
        console.log("🎯 SUCCESS: Failure reason was correctly captured!");
    } else {
        console.error("❌ FAILURE: Failure reason was not captured (remained " + failedPost.failure_reason + ")");
    }

    // Cleanup
    await supabase.from('posts').delete().eq('id', post.id);
    await supabase.from('groups').delete().eq('id', groupId);
    console.log("🧹 Cleanup done.");
}

verifyFixes().catch(console.error);
