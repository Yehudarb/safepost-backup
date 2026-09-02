/**
 * Phase 18 - Identifier validation.
 *
 * Malformed identifiers used to reach PostgREST, which answered with a type
 * error that some routes forwarded verbatim: a 500 carrying the column type and
 * the offending value. Unit coverage pins the validator; HTTP coverage proves
 * the malformed value never reaches the database, that valid ids still work,
 * and that workspace isolation is unchanged. No production project is permitted.
 */
const { createClient } = require('@supabase/supabase-js');
const {
    normalizeDbId,
    normalizeDbIdList,
    isValidDbId,
    isValidUuid,
    normalizeDbIdOrUuid,
} = require('../server/lib/ids.cjs');

const { SUPABASE_URL, SUPABASE_SERVICE_KEY, SUPABASE_ANON_KEY, API_URL = 'http://localhost:3001' } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !SUPABASE_ANON_KEY) {
    console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_KEY / SUPABASE_ANON_KEY.');
    process.exit(2);
}
if ((SUPABASE_URL || '').includes('hfpsdzfggugoerythnug')) {
    console.error('REFUSING: SUPABASE_URL points at the production project.');
    process.exit(3);
}

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
let passed = 0;
let failed = 0;
const assert = (name, condition, detail = '') => {
    if (condition) { passed++; console.log(`  OK ${name}`); }
    else { failed++; console.log(`  FAIL ${name}${detail ? '  — ' + detail : ''}`); }
};

// Anything that would betray the database if it reached the client.
const DB_LEAK = /invalid input syntax|bigint|uuid|postgres|PGRST|relation |column |syntax error|22P02/i;
const leaks = body => DB_LEAK.test(JSON.stringify(body || {}));

const MALFORMED = [
    'not-a-number', '', null, undefined, -1, 0, 1.5, '1,2', '1)or(', 'not.is.null',
    '*', '1.eq.1', '  7  ', '7abc', 'abc7', '1e3', '0x10', '007', [], {}, true, NaN, Infinity,
];

const tag = `p18_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

async function makeUser(label) {
    const email = `${tag}_${label}@example.com`;
    const password = `Passw0rd!${label}aA1`;
    const { data: created, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (error) throw new Error(`createUser ${label}: ${error.message}`);
    const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } });
    const { data: session, error: signInError } = await anon.auth.signInWithPassword({ email, password });
    if (signInError) throw new Error(`signIn ${label}: ${signInError.message}`);
    const token = session.session.access_token;
    const provision = await fetch(`${API_URL}/api/queue`, { headers: { Authorization: `Bearer ${token}`, Connection: 'close' } });
    if (!provision.ok) throw new Error(`provision ${label}: HTTP ${provision.status}`);
    const { data: m } = await admin.from('workspace_members').select('workspace_id').eq('user_id', created.user.id).limit(1);
    return { userId: created.user.id, token, workspaceId: m[0].workspace_id };
}

const req = async (user, method, path, body) => {
    const response = await fetch(`${API_URL}${path}`, {
        method,
        headers: {
            Authorization: `Bearer ${user.token}`,
            'x-workspace-id': user.workspaceId,
            'Content-Type': 'application/json',
            Connection: 'close',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, body: await response.json().catch(() => null) };
};

async function seedPost(workspaceId, marker) {
    const { data, error } = await admin.from('posts').insert({
        workspace_id: workspaceId, group_id: `${marker}_g`, content: `${marker}_c`,
        status: 'FAILED', app_source: marker, attempt_count: 1, max_attempts: 3,
    }).select('id').single();
    if (error) throw new Error(`seed post: ${error.message}`);
    return data.id;
}

(async () => {
    console.log('Phase 18 identifier validation\n');

    console.log(' A. validator unit rules');
    for (const value of MALFORMED) {
        assert(`rejects ${JSON.stringify(value) ?? String(value)}`, normalizeDbId(value) === null);
    }
    assert('accepts a small positive integer as a number', normalizeDbId(7) === '7');
    assert('accepts a positive integer as a string', normalizeDbId('2257') === '2257');
    assert('preserves ids beyond Number.MAX_SAFE_INTEGER as strings',
        normalizeDbId('9223372036854775807') === '9223372036854775807');
    assert('rejects an unsafe integer supplied as a number', normalizeDbId(9223372036854775807) === null);
    assert('isValidDbId agrees with normalizeDbId', isValidDbId('5') === true && isValidDbId('5x') === false);

    assert('list rejects a non-array', normalizeDbIdList('all').ok === false);
    assert('list rejects an empty array', normalizeDbIdList([]).ok === false);
    assert('list rejects a mixed valid/invalid array', normalizeDbIdList(['1', 'x', '3']).ok === false);
    assert('list rejects when any element is malformed syntax', normalizeDbIdList([1, 'not.is.null']).ok === false);
    assert('list accepts an all-valid array', normalizeDbIdList([1, '2', 3]).ids.join(',') === '1,2,3');
    assert('list enforces the max', normalizeDbIdList([1, 2, 3], { max: 2 }).reason === 'too_many');

    assert('uuid check accepts a real uuid', isValidUuid('1463a919-3577-459c-b32a-b765a4497080'));
    assert('uuid check rejects a numeric id', isValidUuid('7') === false);
    assert('uuid check rejects malformed uuids', isValidUuid('not-a-uuid') === false && isValidUuid('') === false);
    // group_sets.id is bigint in production and uuid in QA.
    assert('dual check accepts both legitimate id shapes',
        normalizeDbIdOrUuid('42') === '42' &&
        normalizeDbIdOrUuid('1463a919-3577-459c-b32a-b765a4497080') === '1463a919-3577-459c-b32a-b765a4497080');
    assert('dual check still rejects malformed values',
        MALFORMED.every(v => normalizeDbIdOrUuid(v) === null || normalizeDbIdOrUuid(v) === undefined));

    console.log('\n B. malformed ids over HTTP never reach the database');
    const owner = await makeUser('owner');
    const outsider = await makeUser('outsider');
    try {
        const probes = ['not-a-number', '1)or(', 'not.is.null', '*', '1.eq.1', '1,2', '-1', '1.5'];
        for (const bad of probes) {
            const encoded = encodeURIComponent(bad);
            const results = await Promise.all([
                req(owner, 'DELETE', `/api/tasks/${encoded}`),
                req(owner, 'PATCH', `/api/tasks/${encoded}`, { status: 'PENDING' }),
                req(owner, 'POST', `/api/tasks/${encoded}/cancel`, {}),
                req(owner, 'DELETE', `/api/templates/${encoded}`),
                req(owner, 'DELETE', `/api/group-sets/${encoded}`),
            ]);
            assert(`"${bad}" is rejected with 400 on every numeric-id route`,
                results.every(r => r.status === 400), results.map(r => r.status).join(','));
            assert(`"${bad}" responses never contain database internals`,
                results.every(r => !leaks(r.body)));
        }

        const bulkBad = await req(owner, 'POST', '/api/tasks/bulk-delete', { ids: ['1', 'not-a-number'] });
        assert('bulk delete rejects a mixed valid/invalid array', bulkBad.status === 400, `HTTP ${bulkBad.status}`);
        assert('bulk delete rejection leaks nothing', !leaks(bulkBad.body));

        console.log('\n C. a rejected batch changes nothing');
        const survivors = await Promise.all([seedPost(owner.workspaceId, `${tag}_s1`), seedPost(owner.workspaceId, `${tag}_s2`)]);
        const mixed = await req(owner, 'POST', '/api/tasks/bulk-delete', { ids: [survivors[0], 'not.is.null', survivors[1]] });
        assert('mixed batch containing real ids is refused', mixed.status === 400);
        const { count: stillThere } = await admin.from('posts').select('id', { count: 'exact', head: true }).in('id', survivors);
        assert('no row from the refused batch was deleted', stillThere === 2, `${stillThere}/2 remain`);

        console.log('\n D. valid ids still work');
        const deletable = await seedPost(owner.workspaceId, `${tag}_d`);
        const okDelete = await req(owner, 'DELETE', `/api/tasks/${deletable}`);
        assert('valid numeric id deletes the task', okDelete.status === 200, `HTTP ${okDelete.status}`);
        const { count: gone } = await admin.from('posts').select('id', { count: 'exact', head: true }).eq('id', deletable);
        assert('the row is actually gone', gone === 0);

        const bulkOk = await Promise.all([seedPost(owner.workspaceId, `${tag}_b1`), seedPost(owner.workspaceId, `${tag}_b2`)]);
        const okBulk = await req(owner, 'POST', '/api/tasks/bulk-delete', { ids: bulkOk });
        assert('valid bulk delete still succeeds', okBulk.status === 200 && okBulk.body?.deleted_count === 2,
            `HTTP ${okBulk.status} deleted=${okBulk.body?.deleted_count}`);

        // These two routes previously guarded a bigint column with a uuid-shaped
        // regexp, so every real id was rejected and the rows were undeletable.
        const { data: tpl } = await admin.from('post_templates')
            .insert({ name: `${tag}_tpl`, content: 'x', workspace_id: owner.workspaceId }).select('id').single();
        const tplDelete = await req(owner, 'DELETE', `/api/templates/${tpl.id}`);
        assert('a real template id can now be deleted', tplDelete.status === 200, `HTTP ${tplDelete.status} for id=${tpl.id}`);
        const { count: tplGone } = await admin.from('post_templates').select('id', { count: 'exact', head: true }).eq('id', tpl.id);
        assert('the template row is gone', tplGone === 0);

        const { data: gs } = await admin.from('group_sets')
            .insert({ name: `${tag}_gs`, group_ids: [], workspace_id: owner.workspaceId }).select('id').single();
        const gsDelete = await req(owner, 'DELETE', `/api/group-sets/${gs.id}`);
        assert('a real group-set id can now be deleted', gsDelete.status === 200, `HTTP ${gsDelete.status} for id=${gs.id}`);

        console.log('\n E. workspace isolation is unchanged');
        const foreign = await seedPost(outsider.workspaceId, `${tag}_f`);
        const crossDelete = await req(owner, 'DELETE', `/api/tasks/${foreign}`);
        const { count: foreignAlive } = await admin.from('posts').select('id', { count: 'exact', head: true }).eq('id', foreign);
        assert('a valid id from another workspace is not deleted', foreignAlive === 1, `HTTP ${crossDelete.status}`);
        const crossBulk = await req(owner, 'POST', '/api/tasks/bulk-delete', { ids: [foreign] });
        assert('bulk delete cannot reach another workspace',
            crossBulk.status === 200 && crossBulk.body?.deleted_count === 0);
        const { count: stillForeign } = await admin.from('posts').select('id', { count: 'exact', head: true }).eq('id', foreign);
        assert('the other workspace still has its row', stillForeign === 1);

        console.log('\n F. uuid routes take the uuid check, not the numeric one');
        for (const bad of ['not-a-uuid', '7', '1)or(', '']) {
            const encoded = encodeURIComponent(bad) || 'x';
            const r = await req(owner, 'DELETE', `/api/workers/${encoded}`);
            assert(`worker route rejects "${bad}" with 400`, r.status === 400, `HTTP ${r.status}`);
            assert(`worker route rejection leaks nothing for "${bad}"`, !leaks(r.body));
        }
        const wellFormedForeign = await req(owner, 'DELETE', '/api/workers/1463a919-3577-459c-b32a-b765a4497080');
        assert('a well-formed uuid that is not the caller\'s worker still returns 403',
            wellFormedForeign.status === 403, `HTTP ${wellFormedForeign.status}`);
    } finally {
        for (const u of [owner, outsider]) {
            await admin.from('system_logs').delete().eq('workspace_id', u.workspaceId);
            await admin.from('posts').delete().eq('workspace_id', u.workspaceId);
            await admin.from('post_templates').delete().eq('workspace_id', u.workspaceId);
            await admin.from('group_sets').delete().eq('workspace_id', u.workspaceId);
            await admin.from('workspace_members').delete().eq('workspace_id', u.workspaceId);
            await admin.from('workspaces').delete().eq('id', u.workspaceId);
            await admin.auth.admin.deleteUser(u.userId);
        }
        console.log('\n  fixtures cleaned');
    }

    console.log(`\n${passed} passed, ${failed} failed`);
    process.exitCode = failed ? 1 : 0;
})().catch(error => {
    console.error('Test run error:', error.message);
    process.exitCode = 2;
});
