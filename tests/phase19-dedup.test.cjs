/**
 * Phase 19 — engagement deduplication (pure unit tests, no database).
 *
 * The dedup key decides whether a discovered post is new or already known. Get
 * it too loose and two different posts merge, silently losing an opportunity;
 * get it unstable and the same post is stored again on every scan. Both failures
 * are quiet, so they are pinned here rather than left to integration coverage.
 */
const {
    MAX_POST_TEXT,
    normalizeText,
    normalizeAuthor,
    truncatePostText,
    extractPostId,
    canonicalizeUrl,
    dayBucket,
    buildDedupKey,
} = require('../server/lib/engagementDedup.cjs');

let passed = 0;
let failed = 0;
const assert = (name, condition, detail = '') => {
    if (condition) { passed++; console.log(`  OK ${name}`); }
    else { failed++; console.log(`  FAIL ${name}${detail ? '  — ' + detail : ''}`); }
};

const WS_A = '11111111-1111-4111-8111-111111111111';
const WS_B = '22222222-2222-4222-8222-222222222222';

console.log('Phase 19 dedup\n');

console.log(' A. text normalisation');
assert('collapses whitespace runs', normalizeText('a   b\n\tc') === 'a b c', normalizeText('a   b\n\tc'));
assert('strips zero-width characters', normalizeText('a​b‍c') === 'abc', normalizeText('a​b‍c'));
assert('strips the BOM', normalizeText('﻿abc') === 'abc', normalizeText('﻿abc'));
assert('converts non-breaking space', normalizeText('a b') === 'a b', normalizeText('a b'));
assert('trims the ends', normalizeText('  hello  ') === 'hello');
assert('leaves ordinary letters alone', normalizeText('sassafras') === 'sassafras', normalizeText('sassafras'));
assert('handles Hebrew unchanged', normalizeText('  שלום  עולם ') === 'שלום עולם', normalizeText('  שלום  עולם '));
assert('non-string returns empty', normalizeText(null) === '' && normalizeText(undefined) === '' && normalizeText(42) === '');
assert('author is lowercased', normalizeAuthor('  Yossi   COHEN ') === 'yossi cohen', normalizeAuthor('  Yossi   COHEN '));

console.log('\n B. text retention limit');
const short = truncatePostText('hello');
assert('short text is untouched and unflagged', short.text === 'hello' && short.truncated === false);
const long = truncatePostText('x'.repeat(MAX_POST_TEXT + 500));
assert('long text is cut to the limit', long.text.length === MAX_POST_TEXT, `${long.text.length}`);
assert('long text is flagged truncated', long.truncated === true);
const exact = truncatePostText('y'.repeat(MAX_POST_TEXT));
assert('text exactly at the limit is not flagged', exact.text.length === MAX_POST_TEXT && exact.truncated === false);
assert('non-string becomes empty, not an error', truncatePostText(null).text === '' && truncatePostText(undefined).truncated === false);

console.log('\n C. post id extraction');
assert('/posts/<id>', extractPostId('https://www.facebook.com/groups/123/posts/456/') === '456');
assert('/permalink/<id>', extractPostId('https://www.facebook.com/groups/123/permalink/789/') === '789');
assert('story_fbid query', extractPostId('https://www.facebook.com/story.php?story_fbid=999&id=1') === '999');
assert('fbid query', extractPostId('https://www.facebook.com/photo.php?fbid=555') === '555');
assert('/videos/<id>', extractPostId('https://www.facebook.com/groups/1/videos/321') === '321');
assert('pfbid token is accepted', extractPostId('https://www.facebook.com/groups/1/posts/pfbid0abcXYZ123') === 'pfbid0abcXYZ123');
assert('pfbid wins over a numeric group id', extractPostId('https://www.facebook.com/groups/999/posts/pfbid0zz') === 'pfbid0zz');
assert('bare group URL yields no id', extractPostId('https://www.facebook.com/groups/12345') === null);
assert('non-string yields null', extractPostId(null) === null && extractPostId(undefined) === null);

console.log('\n D. URL canonicalisation');
assert('strips all query parameters',
    canonicalizeUrl('https://www.facebook.com/groups/1/posts/2?__cft__[0]=abc&__tn__=R&ref=x') === 'https://www.facebook.com/groups/1/posts/2',
    canonicalizeUrl('https://www.facebook.com/groups/1/posts/2?__cft__[0]=abc&__tn__=R&ref=x'));
assert('strips the fragment',
    canonicalizeUrl('https://www.facebook.com/groups/1/posts/2#comment') === 'https://www.facebook.com/groups/1/posts/2');
assert('strips the trailing slash',
    canonicalizeUrl('https://www.facebook.com/groups/1/posts/2/') === 'https://www.facebook.com/groups/1/posts/2');
assert('collapses duplicate slashes',
    canonicalizeUrl('https://www.facebook.com/groups//1//posts/2') === 'https://www.facebook.com/groups/1/posts/2',
    canonicalizeUrl('https://www.facebook.com/groups//1//posts/2'));
assert('rewrites m.facebook.com to www',
    canonicalizeUrl('https://m.facebook.com/groups/1/posts/2') === 'https://www.facebook.com/groups/1/posts/2');
assert('rewrites mbasic.facebook.com to www',
    canonicalizeUrl('https://mbasic.facebook.com/groups/1/posts/2') === 'https://www.facebook.com/groups/1/posts/2');
assert('upgrades http to https for facebook',
    canonicalizeUrl('http://www.facebook.com/groups/1/posts/2') === 'https://www.facebook.com/groups/1/posts/2');
assert('a non-facebook host is NOT rewritten to facebook',
    canonicalizeUrl('https://evil.example.com/groups/1/posts/2') === 'https://evil.example.com/groups/1/posts/2',
    canonicalizeUrl('https://evil.example.com/groups/1/posts/2'));
assert('javascript: URL is rejected', canonicalizeUrl('javascript:alert(1)') === null);
assert('data: URL is rejected', canonicalizeUrl('data:text/html,<b>x</b>') === null);
assert('empty / non-string is rejected', canonicalizeUrl('') === null && canonicalizeUrl(null) === null);
assert('two renders of the same post canonicalise identically',
    canonicalizeUrl('https://www.facebook.com/groups/1/posts/2/?__cft__=A&comment_id=7')
    === canonicalizeUrl('https://m.facebook.com/groups/1/posts/2?__tn__=B'));

console.log('\n E. day bucket');
assert('ISO string to day', dayBucket('2026-09-03T14:22:31.000Z') === '2026-09-03');
assert('Date object to day', dayBucket(new Date('2026-09-03T01:00:00Z')) === '2026-09-03');
assert('null is empty', dayBucket(null) === '' && dayBucket(undefined) === '');
assert('unparseable is empty, not a crash', dayBucket('not-a-date') === '');
assert('same day, different times, same bucket',
    dayBucket('2026-09-03T00:00:01Z') === dayBucket('2026-09-03T23:59:59Z'));

console.log('\n F. key precedence');
const byId = buildDedupKey({
    workspaceId: WS_A, facebookPostId: '777',
    facebookPostUrl: 'https://www.facebook.com/groups/1/posts/888',
    facebookGroupId: 'g1', authorName: 'A', postText: 'text',
});
assert('an explicit post id beats the URL', byId.key === 'fb:777' && byId.strategy === 'facebook_post_id', byId.key);

const byUrlId = buildDedupKey({
    workspaceId: WS_A, facebookPostUrl: 'https://www.facebook.com/groups/1/posts/888',
    facebookGroupId: 'g1', authorName: 'A', postText: 'text',
});
assert('an id derived from the URL beats canonicalisation', byUrlId.key === 'fb:888', byUrlId.key);

const byUrl = buildDedupKey({
    workspaceId: WS_A, facebookPostUrl: 'https://www.facebook.com/groups/1/some-slug',
    facebookGroupId: 'g1', authorName: 'A', postText: 'text',
});
assert('a URL with no id falls back to canonical URL',
    byUrl.key === 'url:https://www.facebook.com/groups/1/some-slug' && byUrl.strategy === 'canonical_url', byUrl.key);

const byHash = buildDedupKey({
    workspaceId: WS_A, facebookGroupId: 'g1', authorName: 'A', postText: 'text', postedAt: '2026-09-03T10:00:00Z',
});
assert('no id and no URL falls back to a hash',
    byHash.key.startsWith('hash:') && byHash.strategy === 'content_hash', byHash.key);
assert('the hash is a full sha256', byHash.key.length === 'hash:'.length + 64);

console.log('\n G. hash stability and separation');
const base = { workspaceId: WS_A, facebookGroupId: 'g1', authorName: 'Yossi Cohen', postText: 'Looking for a plumber', postedAt: '2026-09-03T10:00:00Z' };
assert('same input twice gives the same key',
    buildDedupKey(base).key === buildDedupKey({ ...base }).key);
assert('whitespace differences do not change the key',
    buildDedupKey(base).key === buildDedupKey({ ...base, postText: '  Looking   for a\nplumber ' }).key);
assert('author case does not change the key',
    buildDedupKey(base).key === buildDedupKey({ ...base, authorName: 'YOSSI COHEN' }).key);
assert('same day, different time gives the same key',
    buildDedupKey(base).key === buildDedupKey({ ...base, postedAt: '2026-09-03T23:00:00Z' }).key);
assert('a different day gives a different key',
    buildDedupKey(base).key !== buildDedupKey({ ...base, postedAt: '2026-09-04T10:00:00Z' }).key);
assert('a different workspace gives a different key',
    buildDedupKey(base).key !== buildDedupKey({ ...base, workspaceId: WS_B }).key);
assert('a different group gives a different key',
    buildDedupKey(base).key !== buildDedupKey({ ...base, facebookGroupId: 'g2' }).key);
assert('different text gives a different key',
    buildDedupKey(base).key !== buildDedupKey({ ...base, postText: 'Looking for an electrician' }).key);

// The NUL separator exists to stop field boundaries shifting without changing
// the concatenation. Without it, ("ab","c") and ("a","bc") would hash the same.
assert('field boundaries cannot be shifted into a collision',
    buildDedupKey({ ...base, facebookGroupId: 'ab', authorName: 'c' }).key
    !== buildDedupKey({ ...base, facebookGroupId: 'a', authorName: 'bc' }).key);

console.log('\n H. defensive inputs');
assert('an empty argument object does not throw', typeof buildDedupKey({}).key === 'string');
assert('no argument at all does not throw', typeof buildDedupKey().key === 'string');
assert('a whitespace-only post id is ignored, not used as a key',
    buildDedupKey({ ...base, facebookPostId: '   ' }).key.startsWith('hash:'));

console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
