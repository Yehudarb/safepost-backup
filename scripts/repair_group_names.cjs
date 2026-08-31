// Repair "קבוצה {id}" placeholder names in-place. When the group's id is a
// vanity slug (e.g. "roxascity.gadgets.marketplace") we can derive a readable
// name from it without waiting for the user to re-scan Facebook.
// Pure-numeric ids have no slug to derive from — those rows stay as-is until
// the extension re-syncs with v8.9 and picks up the real name.
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const PLACEHOLDER = /^קבוצה \d+$/; // matches "קבוצה 691184237672539" etc.

const prettifySlug = (gid) => {
    if (!gid || /^\d+$/.test(gid)) return null;
    return gid
        .replace(/[._-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .split(' ')
        .map(w => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');
};

(async () => {
    const { data: rows } = await supabase
        .from('groups')
        .select('id, name, facebook_user, workspace_id');

    if (!rows) { console.error('No rows.'); process.exit(1); }

    const placeholders = rows.filter(g => PLACEHOLDER.test(g.name || ''));
    const slugFixable  = placeholders.filter(g => prettifySlug(g.id));
    const numericStuck = placeholders.length - slugFixable.length;

    console.log(`Total rows: ${rows.length}`);
    console.log(`Placeholder-named ("קבוצה N"): ${placeholders.length}`);
    console.log(`  ├─ Repairable from slug NOW: ${slugFixable.length}`);
    console.log(`  └─ Numeric id (needs re-sync w/ v8.9): ${numericStuck}`);

    let fixed = 0;
    for (const g of slugFixable) {
        const newName = prettifySlug(g.id);
        const { error } = await supabase
            .from('groups')
            .update({ name: newName })
            .eq('workspace_id', g.workspace_id)
            .eq('facebook_user', g.facebook_user)
            .eq('id', g.id);
        if (error) { console.error(`Failed to update ${g.id}:`, error.message); continue; }
        fixed++;
    }
    console.log(`\nUpdated ${fixed} rows with slug-derived names.`);
    if (numericStuck > 0) {
        console.log(`\n${numericStuck} numeric-id rows still show placeholder names.`);
        console.log(`Reload the extension (v8.9) and run "סנכרון קבוצות" to replace those with real names.`);
    }
})();
