/**
 * Phase 39 - Engagement 2A ingest, end to end, across two tenants.
 *
 * Exercises the real pipeline through real HTTP against a running server:
 *   /scans/:id/posts -> candidate buffer -> matcher -> opportunity
 *
 * The isolation half is the point. Every assertion about workspace A is paired
 * with one proving workspace B saw nothing, because the failure this guards
 * against is silent: a leak produces plausible-looking results in the wrong
 * tenant and nothing errors.
 *
 * Requires a server with ENGAGEMENT_ENABLED=true. Refuses to run against
 * production, like every other phase suite.
 */
const { createClient } = require('@supabase/supabase-js');

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

const tag = `p39_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

// The same words in both tenants. If dedup or scoping is wrong anywhere, these
// collide and one workspace loses a lead.
const SHARED_COMMENT = 'גם אני מחפש חשמלאי דחוף';
const SHARED_POST = 'מי מכיר חשמלאי טוב באזור?';

async function makeTenant(label) {
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
    const { data: members } = await admin.from('workspace_members').select('workspace_id').eq('user_id', created.user.id).limit(1);
    const workspaceId = members[0].workspace_id;

    const codeRes = await fetch(`${API_URL}/api/workers/pairing-code`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'x-workspace-id': workspaceId, 'Content-Type': 'application/json', Connection: 'close' },
    });
    const { code } = await codeRes.json();
    const pairRes = await fetch(`${API_URL}/api/workers/pair`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Connection: 'close' },
        body: JSON.stringify({ code, worker_name: `${label} worker`, extension_version: '9.6' }),
    });
    const pair = await pairRes.json();

    const groupId = `${tag}_${label}_group`;
    await admin.from('groups').insert({
        id: groupId, name: `${label} group`,
        url: `https://www.facebook.com/groups/${groupId}`,
        workspace_id: workspaceId, facebook_user: '',
    });
    await admin.from('workspaces').update({ engagement_enabled: true }).eq('id', workspaceId);

    return { label, userId: created.user.id, token, workspaceId, groupId, workerId: pair.worker_id, deviceToken: pair.device_token };
}

const dash = async (t, method, path, body) => {
    const res = await fetch(`${API_URL}/api/engagement${path}`, {
        method,
        headers: {
            Authorization: `Bearer ${t.token}`, 'x-workspace-id': t.workspaceId,
            'Content-Type': 'application/json', Connection: 'close',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: await res.json().catch(() => null) };
};

const worker = async (t, method, path, body) => {
    const res = await fetch(`${API_URL}/api/engagement${path}`, {
        method,
        headers: {
            'x-worker-id': t.workerId, 'x-device-token': t.deviceToken,
            'Content-Type': 'application/json', Connection: 'close',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: await res.json().catch(() => null) };
};

/** Creates a scan, claims it as the worker, and returns its id + claim generation. */
async function runnableScan(t, name) {
    const created = await dash(t, 'POST', '/scans', {
        name, group_ids: [t.groupId], max_groups: 1, max_posts_per_group: 5,
    });
    if (created.status !== 201 && created.status !== 200) throw new Error(`create scan: HTTP ${created.status}`);
    const claim = await worker(t, 'POST', '/scans/claim', {});
    const scan = claim.body?.scan;
    if (!scan) throw new Error(`claim returned no scan: HTTP ${claim.status}`);
    return { id: scan.id, claimStartedAt: scan.claimed_at };
}

function batch(groupId, { postText = SHARED_POST, postId = '5000000001', comments = [] } = {}) {
    return {
        facebook_group_id: groupId,
        facebook_group_name: 'Test group',
        facebook_post_id: postId,
        facebook_post_url: `https://www.facebook.com/groups/${groupId}/posts/${postId}/`,
        author_name: 'Post Author',
        post_text: postText,
        replies_skipped: 2,
        comments,
    };
}

async function run() {
    console.log('\nPhase 39 - Engagement 2A ingest and tenant isolation\n');
    const A = await makeTenant('a');
    const B = await makeTenant('b');
    const cleanup = [];

    try {
        console.log('A. Watches are workspace-scoped');
        const watchA = (await dash(A, 'POST', '/watches', {
            name: 'Electricians', query_text: 'מחפש חשמלאי',
            keywords: ['חשמלאי'], match_mode: 'flexible',
            include_posts: true, include_comments: true,
        })).body?.watch;
        const watchB = (await dash(B, 'POST', '/watches', {
            name: 'Electricians B', query_text: 'מחפש חשמלאי',
            keywords: ['חשמלאי'], match_mode: 'flexible',
            include_posts: true, include_comments: true,
        })).body?.watch;
        assert('A created a watch', Boolean(watchA?.id));
        assert('B created a watch', Boolean(watchB?.id));
        assert('A lists only its own watch',
            (await dash(A, 'GET', '/watches')).body.watches.every(w => w.id !== watchB.id));
        assert('B cannot read A\'s watch by id',
            (await dash(B, 'PATCH', `/watches/${watchA.id}`, { name: 'hijack' })).status === 404);
        assert('B cannot delete A\'s watch',
            (await dash(B, 'DELETE', `/watches/${watchA.id}`)).status === 404);
        assert('B cannot preview A\'s watch',
            (await dash(B, 'POST', `/watches/${watchA.id}/preview`)).status === 404);

        console.log('\nB. Ingest populates candidates and promotes matches');
        const scanA = await runnableScan(A, 'scan A');
        const uploadA = await worker(A, 'POST', `/scans/${scanA.id}/posts`, {
            claim_started_at: scanA.claimStartedAt,
            posts: [batch(A.groupId, {
                comments: [
                    { comment_id: '900000001', comment_text: SHARED_COMMENT, author_name: 'Dana' },
                    { comment_text: 'מזל טוב!', author_name: 'Yossi' },
                ],
            })],
        });
        assert('Phase 1 ingest still succeeds', uploadA.status === 200 && uploadA.body?.success === true);
        assert('Phase 1 response keeps its four fields',
            ['received', 'stored', 'duplicates', 'total_for_scan'].every(k => k in uploadA.body));
        assert('discovery block is additive', Boolean(uploadA.body?.discovery));
        assert('candidates were buffered', uploadA.body.discovery.candidates >= 3, JSON.stringify(uploadA.body.discovery));
        assert('opportunities were promoted', uploadA.body.discovery.opportunities >= 2, JSON.stringify(uploadA.body.discovery));
        assert('coverage is always declared partial', uploadA.body.discovery.partial_comment_coverage === true);

        const oppsA = (await dash(A, 'GET', '/opportunities')).body.opportunities;
        assert('A sees its opportunities', oppsA.length >= 2, String(oppsA.length));
        assert('both a post and a comment matched',
            oppsA.some(o => o.source_type === 'post') && oppsA.some(o => o.source_type === 'comment'));
        const commentOpp = oppsA.find(o => o.source_type === 'comment');
        assert('a comment opportunity carries a match reason', Boolean(commentOpp?.match_reason));
        assert('a comment opportunity carries parent context', Boolean(commentOpp?.parent_excerpt));
        assert('a comment opportunity links to its parent', Boolean(commentOpp?.parent_dedup_key));
        assert('relevance is a category', ['exact', 'strong', 'possible'].includes(commentOpp?.relevance));
        assert('no author_profile_url is stored', !('author_profile_url' in (commentOpp || {})));

        console.log('\nC. Unmatched content is buffered but never promoted');
        const { data: bufferedA } = await admin.from('engagement_scan_candidates')
            .select('content, source_type').eq('workspace_id', A.workspaceId);
        assert('the unmatched comment IS buffered',
            bufferedA.some(c => c.content === 'מזל טוב!'));
        assert('the unmatched comment is NOT an opportunity',
            !oppsA.some(o => (o.excerpt || '').includes('מזל טוב')));
        const { data: allBuffered } = await admin.from('engagement_scan_candidates')
            .select('expires_at').eq('workspace_id', A.workspaceId).limit(1);
        assert('candidates carry an expiry', Boolean(allBuffered?.[0]?.expires_at));

        console.log('\nD. Dedup: replay, repeat scans, and cross-tenant identity');
        const replay = await worker(A, 'POST', `/scans/${scanA.id}/posts`, {
            claim_started_at: scanA.claimStartedAt,
            posts: [batch(A.groupId, {
                comments: [{ comment_id: '900000001', comment_text: SHARED_COMMENT, author_name: 'Dana' }],
            })],
        });
        assert('an identical replay is accepted', replay.status === 200);
        const oppsAfterReplay = (await dash(A, 'GET', '/opportunities')).body.opportunities;
        assert('a replay creates no duplicate opportunities',
            oppsAfterReplay.length === oppsA.length, `${oppsA.length} -> ${oppsAfterReplay.length}`);

        // Two different people, identical short text, same post.
        const twoAuthors = await worker(A, 'POST', `/scans/${scanA.id}/posts`, {
            claim_started_at: scanA.claimStartedAt,
            posts: [batch(A.groupId, {
                comments: [
                    { comment_text: SHARED_COMMENT, author_name: 'Author One' },
                    { comment_text: SHARED_COMMENT, author_name: 'Author Two' },
                ],
            })],
        });
        assert('identical text from two authors is accepted', twoAuthors.status === 200);
        const { data: authorRows } = await admin.from('engagement_scan_candidates')
            .select('author_name').eq('workspace_id', A.workspaceId).eq('source_type', 'comment');
        const names = new Set((authorRows || []).map(r => r.author_name));
        assert('two different authors stay two candidates',
            names.has('Author One') && names.has('Author Two'), [...names].join(','));

        console.log('\nE. Two-tenant isolation of identical content');
        // Captured here rather than earlier: section D legitimately added rows to
        // A, so a baseline taken before it would report A's own uploads as a leak
        // from B. The invariant is "B's scan adds nothing to A", not "A never
        // changes".
        const aBeforeB = (await dash(A, 'GET', '/opportunities')).body.opportunities.length;
        const scanB = await runnableScan(B, 'scan B');
        const uploadB = await worker(B, 'POST', `/scans/${scanB.id}/posts`, {
            claim_started_at: scanB.claimStartedAt,
            posts: [batch(B.groupId, {
                postId: '5000000001', // the SAME Facebook post id as A
                comments: [{ comment_id: '900000001', comment_text: SHARED_COMMENT, author_name: 'Dana' }],
            })],
        });
        assert('B ingests the identical content successfully', uploadB.status === 200);
        assert('B gets its own opportunities', uploadB.body.discovery.opportunities >= 2,
            JSON.stringify(uploadB.body.discovery));

        const oppsB = (await dash(B, 'GET', '/opportunities')).body.opportunities;
        assert('B sees only its own rows',
            oppsB.every(o => o.workspace_id === B.workspaceId) && oppsB.length >= 2);
        assert('A did not gain rows from B\'s scan',
            (await dash(A, 'GET', '/opportunities')).body.opportunities.length === aBeforeB);
        assert('the same Facebook post id does not collide across workspaces',
            oppsA.some(o => o.source_id === '5000000001') && oppsB.some(o => o.source_id === '5000000001'));

        const { data: aCand } = await admin.from('engagement_scan_candidates')
            .select('workspace_id').eq('scan_task_id', scanA.id);
        assert('A\'s candidates all belong to A',
            (aCand || []).every(c => c.workspace_id === A.workspaceId));
        const { data: bCand } = await admin.from('engagement_scan_candidates')
            .select('workspace_id').eq('scan_task_id', scanB.id);
        assert('B\'s candidates all belong to B',
            (bCand || []).every(c => c.workspace_id === B.workspaceId));

        console.log('\nF. Preview reads only its own tenant');
        const previewA = await dash(A, 'POST', `/watches/${watchA.id}/preview`);
        assert('A preview succeeds', previewA.status === 200);
        assert('A preview finds matches', previewA.body.matched > 0, JSON.stringify(previewA.body.matched));
        assert('A preview examined only A\'s buffer',
            previewA.body.examined <= (aCand || []).length, `${previewA.body.examined} vs ${(aCand || []).length}`);
        assert('preview returns a reason and relevance',
            previewA.body.matches.every(m => m.match_reason && m.relevance));
        assert('preview declares partial coverage', previewA.body.partial_comment_coverage === true);

        const beforeCount = (await dash(A, 'GET', '/opportunities')).body.opportunities.length;
        await dash(A, 'POST', `/watches/${watchA.id}/preview`);
        assert('preview mutates nothing',
            (await dash(A, 'GET', '/opportunities')).body.opportunities.length === beforeCount);

        console.log('\nG. Coverage counters');
        const { data: scanRow } = await admin.from('engagement_scan_tasks')
            .select('posts_seen, visible_comments_seen, comments_matched, comments_with_stable_id, replies_skipped, partial_comment_coverage')
            .eq('id', scanA.id).maybeSingle();
        assert('posts_seen counted', scanRow.posts_seen > 0, String(scanRow.posts_seen));
        assert('visible_comments_seen counted', scanRow.visible_comments_seen > 0, String(scanRow.visible_comments_seen));
        assert('comments_with_stable_id counted', scanRow.comments_with_stable_id > 0, String(scanRow.comments_with_stable_id));
        assert('replies_skipped counted', scanRow.replies_skipped > 0, String(scanRow.replies_skipped));
        assert('partial_comment_coverage is true', scanRow.partial_comment_coverage === true);

        console.log('\nG2. Dormant comments — A wants them, B does not');
        {
            // A's watch was created with include_comments: true, so A's comments
            // are buffered. B gets a posts-only watch, which is the Phase 2A
            // default shape now that the measurement ruled comments out.
            const postsOnly = (await dash(B, 'POST', '/watches', {
                name: 'Posts only', query_text: 'מחפש חשמלאי',
                keywords: ['חשמלאי'], match_mode: 'flexible',
                include_posts: true, include_comments: false,
            })).body?.watch;
            assert('B created a posts-only watch',
                Boolean(postsOnly?.id) && postsOnly.include_comments === false);

            // Disable B's original comment-enabled watch so nothing in B wants them.
            await dash(B, 'PATCH', `/watches/${watchB.id}`, { enabled: false });

            const scanB2 = await runnableScan(B, 'scan B posts-only');
            const upload = await worker(B, 'POST', `/scans/${scanB2.id}/posts`, {
                claim_started_at: scanB2.claimStartedAt,
                posts: [batch(B.groupId, {
                    postId: '5000000777',
                    comments: [
                        { comment_id: '900007771', comment_text: SHARED_COMMENT, author_name: 'Should Not Persist' },
                        { comment_text: 'גם אני צריך חשמלאי', author_name: 'Also Not Persisted' },
                    ],
                })],
            });
            assert('a posts-only scan still succeeds', upload.status === 200);

            const { data: b2 } = await admin.from('engagement_scan_candidates')
                .select('source_type, content, author_name').eq('scan_task_id', scanB2.id);
            assert('the post IS buffered',
                (b2 || []).some(c => c.source_type === 'post'));
            assert('NO comment candidate was written',
                (b2 || []).every(c => c.source_type !== 'comment'),
                JSON.stringify((b2 || []).map(c => c.source_type)));

            // The privacy assertion, at the storage layer rather than in memory.
            const stored = JSON.stringify(b2 || []);
            assert('no comment text reached persistent storage',
                !stored.includes(SHARED_COMMENT) && !stored.includes('גם אני צריך חשמלאי'));
            assert('no comment author reached persistent storage',
                !stored.includes('Should Not Persist') && !stored.includes('Also Not Persisted'));

            const { data: b2opps } = await admin.from('engagement_opportunities')
                .select('source_type').eq('scan_task_id', scanB2.id);
            assert('a post opportunity was still promoted',
                (b2opps || []).some(o => o.source_type === 'post'));
            assert('NO comment opportunity was promoted',
                (b2opps || []).every(o => o.source_type !== 'comment'));

            // B turning comments off must not have disturbed A.
            const { count: aComments } = await admin.from('engagement_scan_candidates')
                .select('id', { count: 'exact', head: true })
                .eq('workspace_id', A.workspaceId).eq('source_type', 'comment');
            assert('A still has its comment candidates — the gate is per workspace',
                (aComments || 0) > 0, String(aComments));
        }

        console.log('\nH. Retention sweep');
        const { sweepExpiredCandidates } = require('../server/services/engagementRetention.service.cjs');
        await admin.from('engagement_scan_candidates')
            .update({ expires_at: new Date(Date.now() - 60000).toISOString() })
            .eq('workspace_id', A.workspaceId);
        const swept = await sweepExpiredCandidates();
        assert('the sweep deletes expired candidates', swept.deleted > 0, JSON.stringify(swept));
        const { count: remainingA } = await admin.from('engagement_scan_candidates')
            .select('id', { count: 'exact', head: true }).eq('workspace_id', A.workspaceId);
        assert('A\'s expired candidates are gone', (remainingA || 0) === 0, String(remainingA));
        const { count: remainingB } = await admin.from('engagement_scan_candidates')
            .select('id', { count: 'exact', head: true }).eq('workspace_id', B.workspaceId);
        assert('B\'s unexpired candidates survive', (remainingB || 0) > 0, String(remainingB));
        assert('opportunities survive the sweep',
            (await dash(A, 'GET', '/opportunities')).body.opportunities.length === beforeCount);

        cleanup.push(A, B);
    } finally {
        for (const t of [A, B]) {
            await admin.from('engagement_opportunities').delete().eq('workspace_id', t.workspaceId);
            await admin.from('engagement_scan_candidates').delete().eq('workspace_id', t.workspaceId);
            await admin.from('engagement_watches').delete().eq('workspace_id', t.workspaceId);
            await admin.from('engagement_discovered_posts').delete().eq('workspace_id', t.workspaceId);
            await admin.from('engagement_scan_tasks').delete().eq('workspace_id', t.workspaceId);
            await admin.from('groups').delete().eq('workspace_id', t.workspaceId);
            await admin.auth.admin.deleteUser(t.userId).catch(() => {});
        }
        console.log('  fixtures cleaned');
    }

    console.log(`\nPhase 39: ${passed} passed, ${failed} failed\n`);
    process.exit(failed > 0 ? 1 : 0);
}

run().catch(error => { console.error('Test run error:', error.message); process.exit(1); });
