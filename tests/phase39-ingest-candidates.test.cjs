/**
 * Phase 39 (unit) - candidate construction, the scan ceiling, and watch
 * applicability.
 *
 * These are the parts of the ingest pipeline that decide WHAT gets stored and
 * WHICH watches see it, and they are pure: buildCandidateRows() and
 * watchApplies() take plain objects and return plain objects. Testing them here
 * means the ceiling, the counters, the parent linkage and the post/comment split
 * are pinned without a database.
 *
 * The end-to-end path (HTTP -> buffer -> matcher -> opportunity) is covered by
 * tests/phase39-engagement-ingest.test.cjs, which needs migration 0015 applied.
 */
const {
    buildCandidateRows,
    watchApplies,
    MAX_COMMENT_CANDIDATES_PER_SCAN,
    PARENT_EXCERPT_LIMIT,
} = require('../server/services/engagementIngest.service.cjs');

let passed = 0;
let failed = 0;
function assert(name, condition, detail = '') {
    if (condition) { passed++; console.log(`  OK ${name}`); }
    else { failed++; console.log(`  FAIL ${name}${detail ? ` - ${detail}` : ''}`); }
}

const WS = '11111111-1111-4111-8111-111111111111';
const SCAN = '22222222-2222-4222-8222-222222222222';
const GROUP = 'g-100';

const post = (over = {}) => ({
    facebook_group_id: GROUP,
    facebook_post_id: '5000000001',
    facebook_post_url: `https://www.facebook.com/groups/${GROUP}/posts/5000000001/`,
    author_name: 'Post Author',
    post_text: 'מי מכיר חשמלאי טוב?',
    comments: [],
    ...over,
});

const build = (posts, budget = MAX_COMMENT_CANDIDATES_PER_SCAN) =>
    buildCandidateRows({ workspaceId: WS, scanId: SCAN, posts, commentBudget: budget });

function run() {
    console.log('\nPhase 39 (unit) - candidate construction\n');

    console.log('A. Posts and comments become distinct candidates');
    {
        const { rows, counters } = build([post({
            comments: [
                { comment_id: '900000001', comment_text: 'גם אני מחפש חשמלאי', author_name: 'Dana' },
                { comment_text: 'מזל טוב', author_name: 'Yossi' },
            ],
            replies_skipped: 3,
        })]);

        assert('one post and two comments', rows.length === 3, String(rows.length));
        assert('the post row is source_type=post', rows[0].source_type === 'post');
        assert('comment rows are source_type=comment',
            rows.slice(1).every(r => r.source_type === 'comment'));
        assert('every row carries the workspace', rows.every(r => r.workspace_id === WS));
        assert('every row carries the scan', rows.every(r => r.scan_task_id === SCAN));
        assert('the post has no parent', rows[0].parent_dedup_key === null);
        assert('comments point at the post key',
            rows.slice(1).every(r => r.parent_dedup_key === rows[0].dedup_key));
        assert('post and comment keys differ', rows[0].dedup_key !== rows[1].dedup_key);
        assert('a stable comment id is preserved', rows[1].source_id === '900000001');
        assert('a comment without an id still stores', rows[2].source_id === null);

        assert('posts_seen counted', counters.posts_seen === 1);
        assert('visible_comments_seen counted', counters.visible_comments_seen === 2);
        assert('comments_with_stable_id counted', counters.comments_with_stable_id === 1);
        assert('replies_skipped carried through', counters.replies_skipped === 3);
    }

    console.log('\nB. The 250-comment scan ceiling');
    {
        assert('the ceiling constant is 250', MAX_COMMENT_CANDIDATES_PER_SCAN === 250);
        const many = Array.from({ length: 60 }, (_, p) => post({
            facebook_post_id: `600000${p}`,
            facebook_post_url: `https://www.facebook.com/groups/${GROUP}/posts/600000${p}/`,
            comments: Array.from({ length: 5 }, (_, c) => ({
                comment_id: `70000${p}${c}`, comment_text: `חשמלאי ${p}-${c}`, author_name: `A${p}${c}`,
            })),
        }));
        const { rows, counters } = build(many);
        const comments = rows.filter(r => r.source_type === 'comment');

        assert('comment candidates stop at the ceiling',
            comments.length === MAX_COMMENT_CANDIDATES_PER_SCAN, String(comments.length));
        assert('every comment beyond the ceiling was seen but dropped',
            counters.visible_comments_seen === 300 && counters.comments_dropped_over_ceiling === 50,
            `${counters.visible_comments_seen}/${counters.comments_dropped_over_ceiling}`);
        // Exceeding the ceiling is a coverage outcome, not an error: posts keep
        // flowing so a busy scan still returns its top-level results.
        assert('posts are unaffected by the comment ceiling',
            rows.filter(r => r.source_type === 'post').length === 60);
    }
    {
        // A second batch cannot restart the allowance; the caller passes what is
        // left, and zero means take no more comments.
        const { rows } = build([post({
            comments: [{ comment_id: '900000009', comment_text: 'חשמלאי', author_name: 'X' }],
        })], 0);
        assert('a zero budget takes no comments',
            rows.filter(r => r.source_type === 'comment').length === 0);
        assert('a zero budget still takes the post',
            rows.filter(r => r.source_type === 'post').length === 1);
    }

    console.log('\nC. Deduplication inside one batch');
    {
        const { rows } = build([post({
            comments: [
                { comment_id: '900000001', comment_text: 'גם אני מחפש', author_name: 'Dana' },
                { comment_id: '900000001', comment_text: 'גם אני מחפש', author_name: 'Dana' },
            ],
        })]);
        assert('the same comment twice collapses to one',
            rows.filter(r => r.source_type === 'comment').length === 1);
    }
    {
        // The collision that must not happen: identical short text, same post,
        // two different people.
        const { rows } = build([post({
            comments: [
                { comment_text: 'גם אני מחפש', author_name: 'Author One' },
                { comment_text: 'גם אני מחפש', author_name: 'Author Two' },
            ],
        })]);
        assert('two authors with identical text stay two candidates',
            rows.filter(r => r.source_type === 'comment').length === 2);
    }
    {
        const { rows } = build([post(), post()]);
        assert('the same post twice collapses to one',
            rows.filter(r => r.source_type === 'post').length === 1);
    }

    console.log('\nD. Bounds and degenerate input');
    {
        const longPost = 'א'.repeat(600);
        const { rows } = build([post({
            post_text: longPost,
            comments: [{ comment_text: 'ב'.repeat(900), author_name: 'Long' }],
        })]);
        const comment = rows.find(r => r.source_type === 'comment');
        assert('comment content is truncated to 600', comment.content.length === 600, String(comment.content.length));
        assert('parent excerpt is bounded',
            (comment.__parentExcerpt || '').length <= PARENT_EXCERPT_LIMIT + 1,
            String((comment.__parentExcerpt || '').length));

        assert('a post with no group is dropped',
            build([post({ facebook_group_id: '' })]).rows.length === 0);
        assert('an empty comment is dropped',
            build([post({ comments: [{ comment_text: '', author_name: '' }] })])
                .rows.filter(r => r.source_type === 'comment').length === 0);
        assert('a non-array input is safe', build(null).rows.length === 0);
        assert('a post with no comments array is safe',
            build([post({ comments: undefined })]).rows.length === 1);
    }

    console.log('\nE. Watch applicability');
    {
        const comment = { source_type: 'comment', facebook_group_id: GROUP };
        const postCandidate = { source_type: 'post', facebook_group_id: GROUP };
        const base = { enabled: true, include_posts: true, include_comments: true, selected_group_ids: [] };

        assert('a disabled watch never applies', !watchApplies({ ...base, enabled: false }, postCandidate));
        assert('include_posts=false excludes posts',
            !watchApplies({ ...base, include_posts: false }, postCandidate));
        assert('include_comments=false excludes comments',
            !watchApplies({ ...base, include_comments: false }, comment));
        assert('an empty group list means every group', watchApplies(base, postCandidate));
        assert('a matching group applies',
            watchApplies({ ...base, selected_group_ids: [GROUP] }, postCandidate));
        assert('a non-matching group does not',
            !watchApplies({ ...base, selected_group_ids: ['other'] }, postCandidate));
        assert('group ids compare as strings',
            watchApplies({ ...base, selected_group_ids: [123] }, { source_type: 'post', facebook_group_id: '123' }));
        assert('a null watch never applies', !watchApplies(null, postCandidate));
    }

    console.log('\nF. Dormant comments — nothing unrequested is built');
    {
        const withComments = [post({
            comments: [
                { comment_id: '900000001', comment_text: 'גם אני מחפש חשמלאי', author_name: 'Dana' },
                { comment_text: 'מזל טוב', author_name: 'Yossi' },
            ],
            replies_skipped: 2,
        })];

        // Phase 2A default: no enabled watch wants comments.
        const off = buildCandidateRows({
            workspaceId: WS, scanId: SCAN, posts: withComments,
            commentBudget: MAX_COMMENT_CANDIDATES_PER_SCAN, collectComments: false,
        });
        assert('the post is still built', off.rows.filter(r => r.source_type === 'post').length === 1);
        assert('NO comment row is built', off.rows.filter(r => r.source_type === 'comment').length === 0);
        assert('what the extension saw is still counted',
            off.counters.visible_comments_seen === 2, String(off.counters.visible_comments_seen));
        assert('skipped comments are attributed to "no watch", not the ceiling',
            off.counters.comments_skipped_no_watch === 2 && off.counters.comments_dropped_over_ceiling === 0,
            `${off.counters.comments_skipped_no_watch}/${off.counters.comments_dropped_over_ceiling}`);
        assert('replies_skipped still reported', off.counters.replies_skipped === 2);

        // THE PRIVACY ASSERTION. Not "no comment rows" — no comment CONTENT, in
        // any field of anything about to be written.
        const serialised = JSON.stringify(off.rows);
        assert('no comment text reaches the rows at all',
            !serialised.includes('גם אני מחפש חשמלאי') && !serialised.includes('מזל טוב'), serialised.slice(0, 200));
        assert('no comment author reaches the rows',
            !serialised.includes('Dana') && !serialised.includes('Yossi'));
        assert('no comment id reaches the rows', !serialised.includes('900000001'));

        // And when a watch does want them, behaviour is exactly as designed.
        const on = buildCandidateRows({
            workspaceId: WS, scanId: SCAN, posts: withComments,
            commentBudget: MAX_COMMENT_CANDIDATES_PER_SCAN, collectComments: true,
        });
        assert('comments ARE built when a watch wants them',
            on.rows.filter(r => r.source_type === 'comment').length === 2);
        assert('nothing is attributed to "no watch" when enabled',
            on.counters.comments_skipped_no_watch === 0);
        assert('stable ids still counted when enabled', on.counters.comments_with_stable_id === 1);
        assert('the ceiling still applies when enabled', on.counters.comments_taken === 2);

        // Default stays permissive so an existing caller is unaffected; the
        // gating decision belongs to ingestCandidates, which reads the watches.
        const dflt = buildCandidateRows({
            workspaceId: WS, scanId: SCAN, posts: withComments,
            commentBudget: MAX_COMMENT_CANDIDATES_PER_SCAN,
        });
        assert('collectComments defaults to true',
            dflt.rows.filter(r => r.source_type === 'comment').length === 2);
    }

    console.log('\nG. The gate reads intent, and reads it per workspace');
    {
        const fs = require('fs');
        const path = require('path');
        const source = fs.readFileSync(
            path.join(__dirname, '../server/services/engagementIngest.service.cjs'), 'utf8');

        // Ordering is the control: consulting intent after the rows exist would
        // mean writing a comment and only then discovering nobody wanted it.
        const watchRead = source.indexOf("from('engagement_watches')");
        const build = source.indexOf('buildCandidateRows({\r\n') >= 0
            ? source.indexOf('buildCandidateRows({\r\n')
            : source.indexOf('buildCandidateRows({\n');
        const write = source.indexOf('upsert(persistable');
        assert('watches are read before candidates are built',
            watchRead > 0 && build > watchRead, `watches@${watchRead} build@${build}`);
        assert('candidates are built before they are written',
            build > 0 && write > build, `build@${build} write@${write}`);
        assert('wantsComments is derived from enabled watches',
            /wantsComments\s*=\s*enabled\.some\(w => w\.include_comments === true\)/.test(source));
        assert('the watch query is workspace-scoped',
            /from\('engagement_watches'\)[\s\S]{0,400}?\.eq\('workspace_id', workspaceId\)/.test(source),
            'one tenant enabling comments must not retain another tenant\'s');
        assert('only enabled watches count toward intent',
            /from\('engagement_watches'\)[\s\S]{0,400}?\.eq\('enabled', true\)/.test(source));
        // Posts are deliberately NOT gated — see the rationale in the service.
        assert('post building is not gated on a watch',
            !/collectPosts|wantsPosts\s*\?/.test(source));
    }

    console.log(`\nPhase 39 (unit): ${passed} passed, ${failed} failed\n`);
    if (failed > 0) process.exit(1);
}

run();
