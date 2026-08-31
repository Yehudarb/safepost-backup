// Verify migration 0008 landed: attempt an upsert that RELIES on the composite
// unique key. Success = migration ran. 42P10 = still not applied.
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

(async () => {
    // Pick any real workspace so the row satisfies the NOT NULL FK.
    const { data: ws } = await supabase.from('workspaces').select('id').limit(1).maybeSingle();
    if (!ws) { console.error('No workspace found to test against.'); process.exit(1); }

    const testRow = {
        id: '__migration_smoke_test__',
        name: 'DELETE ME',
        url: 'https://example.com/test',
        workspace_id: ws.id,
        facebook_user: '__smoke__',
    };

    const { error } = await supabase
        .from('groups')
        .upsert([testRow], { onConflict: 'workspace_id,facebook_user,id' });

    if (error) {
        console.log('❌ Migration NOT applied. Error:', error.code, '-', error.message);
        process.exit(2);
    }

    console.log('✅ Composite key present — migration IS applied.');

    // Clean up the smoke-test row.
    await supabase.from('groups').delete()
        .eq('id', '__migration_smoke_test__')
        .eq('facebook_user', '__smoke__');
})();
