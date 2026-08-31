// Show the groups whose name looks REAL (not the placeholder). Tells us
// which cases the extension actually managed to extract.
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const PLACEHOLDER = /^קבוצה \d+$/;

(async () => {
    const { data: rows } = await supabase
        .from('groups')
        .select('id, name')
        .order('name');

    const real = (rows || []).filter(g => !PLACEHOLDER.test(g.name || ''));
    console.log(`Real-named groups: ${real.length} / ${rows.length}`);
    real.forEach(g => console.log(`  [${g.id}]  "${g.name}"`));
})();
