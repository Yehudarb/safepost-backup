/**
 * Phase 37 - Engagement Phase 2A matching: Hebrew normalisation, the matcher,
 * and comment deduplication.
 *
 * All three modules under test are pure, so this suite needs no server, no
 * database and no network. That is the point of putting the relevance logic
 * there: the behaviour a user actually judges the product on is pinned by
 * fixtures rather than exercised through a live Facebook scan.
 */
const {
    normalizeText, tokenize, expandToken, expandTerm,
    flexibleIncludes, normalizedIncludes, MIN_STEM_LENGTH,
} = require('../server/lib/hebrewNormalize.cjs');
const {
    matchText, matchCandidates, buildExcerpt, RELEVANCE, EXCERPT_LIMIT,
} = require('../server/lib/engagementMatcher.cjs');
const {
    extractCommentId, canonicalizeCommentUrl, buildCommentDedupKey, truncateCommentText,
} = require('../server/lib/engagementCommentDedup.cjs');

let passed = 0;
let failed = 0;
function assert(name, condition, detail = '') {
    if (condition) {
        passed++;
        console.log(`  OK ${name}`);
    } else {
        failed++;
        console.log(`  FAIL ${name}${detail ? ` - ${detail}` : ''}`);
    }
}

const WS_A = '11111111-1111-4111-8111-111111111111';
const WS_B = '22222222-2222-4222-8222-222222222222';

function run() {
    console.log('\nPhase 37 - Engagement 2A matching\n');

    console.log('A. Hebrew normalisation');
    {
        assert('nikud is stripped', normalizeText('חַשְׁמַלַּאי') === 'חשמלאי', normalizeText('חַשְׁמַלַּאי'));
        assert('final letters fold', normalizeText('חשמלאים') === 'חשמלאים'.replace('ם', 'מ'));
        assert('punctuation becomes a gap', normalizeText('חשמלאי?') === 'חשמלאי');
        assert('geresh is removed', normalizeText("צה׳ל") === 'צהל');
        assert('whitespace collapses', normalizeText('  מחפש   חשמלאי  ') === 'מחפש חשמלאי');
        assert('latin lowercases', normalizeText('Electrician') === 'electrician');
        assert('empty input is safe', normalizeText('') === '' && normalizeText(null) === '');
        assert('tokenize splits on spaces', tokenize('מחפש חשמלאי טוב').length === 3);
        assert('tokenize of empty is empty', tokenize('').length === 0);
    }

    console.log('\nB. Affix expansion, and the guard that makes it safe');
    {
        const forms = expandToken('לחשמלאים');
        assert('prefix ל is stripped', forms.has('חשמלאים'.replace('ם', 'מ')), [...forms].join(','));
        assert('the singular חשמלאי is reachable from לחשמלאים', forms.has('חשמלאי'), [...forms].join(','));
        assert('the original form is always kept', forms.has('לחשמלאים'.replace('ם', 'מ')));

        // The guard. Without it מים (water) collapses to ים (sea).
        assert(`מים does not reduce to ים (min stem ${MIN_STEM_LENGTH})`,
            !expandToken('מים').has('ים'), [...expandToken('מים')].join(','));

        // A 4-letter word like שלום DOES yield a spurious 3-letter form (לומ),
        // because the guard is on length, not on vocabulary. That is accepted:
        // expansion is additive, so the real form always survives and no match
        // can be lost. Raising the guard to 4 would remove the noise but would
        // also stop בבית reaching בית, which is a strip worth having.
        assert('שלום still keeps its own form', expandToken('שלום').has(normalizeText('שלום')),
            [...expandToken('שלום')].join(','));
        assert('a spurious form cannot cost a real match',
            flexibleIncludes('שלום לכולם', 'שלום'));
        assert('the useful short strip still works', expandToken('בבית').has('בית'),
            [...expandToken('בבית')].join(','));
        assert('non-Hebrew tokens are not expanded', expandToken('solar').size === 1);
        assert('expandTerm covers every token', expandTerm('מחפש חשמלאי').has('חשמלאי'));
    }

    console.log('\nC. The four worked examples');
    {
        const watch = { matchMode: 'flexible', queryText: 'מחפש חשמלאי', keywords: ['חשמלאי'] };
        const cases = [
            ['מישהו מכיר חשמלאי טוב?', true, 'exact token'],
            ['המלצה לחשמלאי באזור ירושלים', true, 'prefix ל'],
            ['מחפשים חשמלאים לעבודת שיפוץ', true, 'suffix + final fold'],
            ['צריך בעל מקצוע לתיקון קצר', false, 'no shared token - needs semantics'],
        ];
        for (const [text, expected, why] of cases) {
            const result = matchText(text, watch);
            assert(`${expected ? 'matches' : 'does NOT match'}: "${text.slice(0, 34)}…" (${why})`,
                result.matched === expected, `got matched=${result.matched}`);
        }
    }

    console.log('\nD. Match modes and relevance');
    {
        const watch = {
            matchMode: 'flexible',
            exactPhrases: ['מחפש חשמלאי'],
            keywords: ['חשמלאי', 'המלצה'],
        };
        const exact = matchText('שלום, מחפש חשמלאי באזור', watch);
        assert('exact phrase wins', exact.relevance === RELEVANCE.EXACT && exact.matchMode === 'exact');
        assert('exact reports the phrase', exact.matchedPhrase === 'מחפש חשמלאי');

        const strong = matchText('אני צריך המלצה טובה על חשמלאי מקצועי באזור המרכז בבקשה', watch);
        assert('two keywords in a long source are strong',
            strong.relevance === RELEVANCE.STRONG, strong.relevance);
        assert('strong lists both terms', strong.matchedTerms.length === 2);

        const possible = matchText('חשמלאי', watch);
        assert('one keyword is only possible', possible.relevance === RELEVANCE.POSSIBLE);

        const short = matchText('המלצה על חשמלאי?', watch);
        assert('a short comment cannot reach strong on keywords alone',
            short.relevance === RELEVANCE.POSSIBLE, short.relevance);

        const exactMode = matchText('חשמלאי מעולה', { matchMode: 'exact', exactPhrases: ['מחפש חשמלאי'] });
        assert('exact mode ignores keyword overlap', exactMode.matched === false);
    }

    console.log('\nE. Exclusions, determinism, and no fake precision');
    {
        const watch = { matchMode: 'flexible', keywords: ['חשמלאי'], excludeTerms: ['דרושים'] };
        assert('an excluded term suppresses the match',
            matchText('דרושים חשמלאי לעבודה', watch).matched === false);
        assert('without the excluded term it matches',
            matchText('מחפש חשמלאי לעבודה', watch).matched === true);

        const a = matchText('מחפש חשמלאי', { matchMode: 'flexible', keywords: ['חשמלאי'] });
        const b = matchText('מחפש חשמלאי', { matchMode: 'flexible', keywords: ['חשמלאי'] });
        assert('identical input yields identical output', JSON.stringify(a) === JSON.stringify(b));
        assert('relevance is a category, never a number',
            typeof a.relevance === 'string' && !/\d/.test(a.relevance));
        assert('a reason is always present on a match', typeof a.matchReason === 'string' && a.matchReason.length > 0);
        assert('empty text never matches', matchText('', { keywords: ['חשמלאי'] }).matched === false);
        assert('a watch with nothing to match on never matches',
            matchText('מחפש חשמלאי', { matchMode: 'flexible' }).matched === false);
    }

    console.log('\nF. Excerpts');
    {
        const long = 'א'.repeat(400) + ' מחפש חשמלאי דחוף ' + 'ב'.repeat(400);
        const excerpt = buildExcerpt(long, 'מחפש חשמלאי');
        assert('a long excerpt is capped', excerpt.length <= EXCERPT_LIMIT + 2, String(excerpt.length));
        assert('the excerpt is centred on the match', excerpt.includes('מחפש חשמלאי'));
        assert('a short text is returned whole', buildExcerpt('מחפש חשמלאי', 'חשמלאי') === 'מחפש חשמלאי');
    }

    console.log('\nG. Comment dedup - the collision that must not happen');
    {
        assert('comment_id is extracted', extractCommentId('https://www.facebook.com/groups/1/posts/2/?comment_id=98765') === '98765');
        assert('reply_comment_id wins when both are present',
            extractCommentId('https://www.facebook.com/x?comment_id=111111&reply_comment_id=222222') === '222222');
        assert('no id yields null', extractCommentId('https://www.facebook.com/groups/1/posts/2/') === null);
        assert('canonical url drops tracking',
            canonicalizeCommentUrl('https://www.facebook.com/groups/1/posts/2/?comment_id=55555&__cft__=x')
            === 'https://www.facebook.com/groups/1/posts/2?comment_id=55555');

        const byId = buildCommentDedupKey({ workspaceId: WS_A, commentId: '12345', parentDedupKey: 'fb:1' });
        assert('a stable id is preferred', byId.key === 'fbc:12345' && byId.strategy === 'facebook_comment_id');

        // The core guard: same words, same post, two different people.
        const authorA = buildCommentDedupKey({
            workspaceId: WS_A, parentDedupKey: 'fb:100', authorName: 'Dana Levi', commentText: 'גם אני מחפש',
        });
        const authorB = buildCommentDedupKey({
            workspaceId: WS_A, parentDedupKey: 'fb:100', authorName: 'Yossi Cohen', commentText: 'גם אני מחפש',
        });
        assert('two authors writing "גם אני מחפש" stay two rows', authorA.key !== authorB.key);

        // Same words, same author, different posts.
        const postOne = buildCommentDedupKey({
            workspaceId: WS_A, parentDedupKey: 'fb:100', authorName: 'Dana Levi', commentText: 'גם אני מחפש',
        });
        const postTwo = buildCommentDedupKey({
            workspaceId: WS_A, parentDedupKey: 'fb:200', authorName: 'Dana Levi', commentText: 'גם אני מחפש',
        });
        assert('the same person under two posts stays two rows', postOne.key !== postTwo.key);

        // Same everything = the same comment seen twice.
        assert('the same comment discovered twice collapses to one key',
            postOne.key === authorA.key);

        // Workspaces never share a key.
        const inB = buildCommentDedupKey({
            workspaceId: WS_B, parentDedupKey: 'fb:100', authorName: 'Dana Levi', commentText: 'גם אני מחפש',
        });
        assert('the same content in two workspaces yields different keys', authorA.key !== inB.key);
        assert('the fallback is labelled', authorA.strategy === 'comment_content_hash');
        assert('comment text is truncated for storage',
            truncateCommentText('x'.repeat(900)).length === 600);
    }

    console.log('\nH. Candidate batches');
    {
        const watch = { matchMode: 'flexible', keywords: ['חשמלאי'] };
        const candidates = [
            { sourceType: 'post', text: 'מי מכיר חשמלאי?' },
            { sourceType: 'comment', text: 'גם אני צריך חשמלאי דחוף' },
            { sourceType: 'comment', text: 'מזל טוב!' },
        ];
        const matches = matchCandidates(candidates, watch);
        assert('only matching candidates are returned', matches.length === 2, String(matches.length));
        assert('unmatched content is dropped, not scored',
            !matches.some(m => m.candidate.text === 'מזל טוב!'));
        assert('the candidate travels with its verdict',
            matches[0].candidate.sourceType === 'post' && matches[0].verdict.matched === true);
        assert('a non-array input is safe', matchCandidates(null, watch).length === 0);
    }

    console.log(`\nPhase 37: ${passed} passed, ${failed} failed\n`);
    if (failed > 0) process.exit(1);
}

run();
