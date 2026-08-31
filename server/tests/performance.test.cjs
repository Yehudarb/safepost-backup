const { supabase } = require('../supabaseClient.cjs');

const SUPABASE_URL = process.env.SUPABASE_URL || '';
if (SUPABASE_URL.includes('namyhsldzufeoycleqxf')) {
    console.error('❌ REFUSING: SUPABASE_URL points at the PRODUCTION project.');
    process.exit(3);
}

async function benchmarkQueries() {
    console.log('⚡ Performance Benchmarks\n');

    const tests = [
        {
            name: 'Fetch workspace',
            fn: async () => {
                const { data } = await supabase.from('workspaces').select('id').limit(1);
                return data;
            }
        },
        {
            name: 'Fetch 100 groups',
            fn: async () => {
                const { data } = await supabase.from('groups').select('*').limit(100);
                return data;
            }
        },
        {
            name: 'Fetch queue posts',
            fn: async () => {
                const { data } = await supabase
                    .from('posts')
                    .select('*')
                    .in('status', ['PENDING', 'SENT', 'PROCESSING'])
                    .limit(50);
                return data;
            }
        },
        {
            name: 'Analytics query',
            fn: async () => {
                const { data } = await supabase
                    .from('posts')
                    .select('status, created_at')
                    .gte('created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString());
                return data;
            }
        }
    ];

    for (const test of tests) {
        const start = Date.now();
        const result = await test.fn();
        const duration = Date.now() - start;
        const resultCount = Array.isArray(result) ? result.length : (result ? 1 : 0);
        const status = duration < 500 ? '✅' : duration < 1000 ? '⚠️' : '❌';
        console.log(`${status} ${test.name}: ${duration}ms (${resultCount} rows)`);
    }

    console.log('\n✅ Benchmark complete');
}

benchmarkQueries().catch(e => {
    console.error('Benchmark error:', e.message);
    process.exit(1);
});
