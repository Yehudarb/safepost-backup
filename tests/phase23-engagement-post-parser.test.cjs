/**
 * Phase 23 - pure Engagement Facebook post parser fixtures.
 */
const path = require('path');
const { pathToFileURL } = require('url');
const { JSDOM } = require('jsdom');

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

function article(inner) {
    const dom = new JSDOM(`<main><div role="article">${inner}</div></main>`, {
        url: 'https://www.facebook.com/groups/test/',
    });
    return dom.window.document.querySelector('[role="article"]');
}

(async () => {
    await import(`${pathToFileURL(path.join(__dirname, '../safe_post_extension/engagement/postParser.js')).href}?phase23`);
    const parser = global.SafePostEngagementPostParser;

    console.log('Phase 23 Engagement post parser\n');

    const hebrew = parser.parsePostArticle(article(`
        <h2><a href="/profile.php?id=11">&#x5D9;&#x5D4;&#x5D5;&#x5D3;&#x5D4; &#x5D9;&#x5E9;&#x5E8;&#x5D0;&#x5DC;&#x5D9;</a></h2>
        <div data-ad-preview="message">&#x5DE;&#x5D7;&#x5E4;&#x5E9; &#x5D4;&#x5DE;&#x5DC;&#x5E6;&#x5D4; &#x5DC;&#x5D1;&#x5E2;&#x5DC; &#x5DE;&#x5E7;&#x5E6;&#x5D5;&#x5E2; &#x5D0;&#x5DE;&#x5D9;&#x5DF;</div>
        <a href="/groups/test/posts/7001">&#x5E9;&#x5E2;&#x5EA;&#x5D9;&#x5D9;&#x5DD;</a>
    `));
    assert('Hebrew post text is preserved',
        hebrew?.postText === '\u05de\u05d7\u05e4\u05e9 \u05d4\u05de\u05dc\u05e6\u05d4 \u05dc\u05d1\u05e2\u05dc \u05de\u05e7\u05e6\u05d5\u05e2 \u05d0\u05de\u05d9\u05df');
    assert('Hebrew author is extracted without inference',
        hebrew?.authorName === '\u05d9\u05d4\u05d5\u05d3\u05d4 \u05d9\u05e9\u05e8\u05d0\u05dc\u05d9');

    const english = parser.parsePostArticle(article(`
        <h3><a href="/john.smith">John Smith</a></h3>
        <div data-testid="post_message">Looking for a local electrician</div>
        <a href="/groups/test/posts/7002">1h</a>
    `));
    assert('English post is extracted', english?.postText === 'Looking for a local electrician');

    const absoluteTime = parser.parsePostArticle(article(`
        <div data-ad-preview="message">Timed post</div>
        <time datetime="2026-09-03T10:15:00Z">September 3</time>
        <a href="/groups/test/posts/7003">permalink</a>
    `));
    assert('time datetime becomes an absolute postedAt',
        absoluteTime?.postedAt === '2026-09-03T10:15:00.000Z' &&
        absoluteTime.rawMetadata.timestampStrategy === 'time-datetime');

    const relativeTime = parser.parsePostArticle(article(`
        <div data-ad-preview="message">Relative timestamp</div>
        <time>&#x5DC;&#x5E4;&#x5E0;&#x5D9; &#x5E9;&#x5E2;&#x5EA;&#x5D9;&#x5D9;&#x5DD;</time>
        <a href="/groups/test/posts/7004">permalink</a>
    `));
    assert('visible timestamp stays raw without fabrication',
        relativeTime?.postedAt === null &&
        relativeTime.postedAtRaw === '\u05dc\u05e4\u05e0\u05d9 \u05e9\u05e2\u05ea\u05d9\u05d9\u05dd');

    const truncated = parser.parsePostArticle(article(`
        <div data-ad-preview="message">Visible portion only</div>
        <span aria-label="See more">See more</span>
        <a href="/groups/test/posts/7005">1h</a>
    `));
    assert('truncated visible post is marked without clicking See more', truncated?.isTruncated === true);

    const postsPath = parser.parsePostArticle(article(`
        <div data-ad-preview="message">Posts path</div>
        <a href="https://www.facebook.com/groups/test/posts/7006?ref=share">link</a>
    `));
    assert('/posts/<id> is extracted',
        postsPath?.facebookPostId === '7006' && postsPath.rawMetadata.postIdentityStrategy === 'posts-path');

    const permalinkPath = parser.parsePostArticle(article(`
        <div data-ad-preview="message">Permalink path</div>
        <a href="/groups/test/permalink/7007/">link</a>
    `));
    assert('/permalink/<id> is extracted',
        permalinkPath?.facebookPostId === '7007' &&
        permalinkPath.rawMetadata.postIdentityStrategy === 'permalink-path');
    assert('canonical Facebook permalink anchor is retained',
        permalinkPath?.facebookPostUrl?.includes('/groups/test/permalink/7007/'));

    const story = parser.parsePostArticle(article(`
        <div data-ad-preview="message">Story query</div>
        <a href="/groups/test/?story_fbid=7008&id=44">link</a>
    `));
    assert('story_fbid URL is extracted',
        story?.facebookPostId === '7008' && story.rawMetadata.postIdentityStrategy === 'story-fbid');

    const noAuthor = parser.parsePostArticle(article(`
        <div data-ad-preview="message">Anonymous visible post</div>
        <a href="/groups/test/posts/7009">1h</a>
    `));
    assert('missing author remains null', noAuthor?.authorName === null && noAuthor.authorProfileUrl === null);

    const pinned = parser.parsePostArticle(article(`
        <span aria-label="Pinned post">Pinned post</span>
        <div data-ad-preview="message">Important announcement</div>
        <a href="/groups/test/posts/7010">1h</a>
    `));
    assert('pinned post is retained and marked', pinned?.rawMetadata.pinned === true);

    const sponsored = parser.parsePostArticle(article(`
        <span>Sponsored</span><div data-ad-preview="message">Advertisement</div>
        <a href="/groups/test/posts/7011">1h</a>
    `));
    assert('sponsored content is skipped', sponsored === null);

    const suggested = parser.parsePostArticle(article(`
        <span>Suggested for you</span><div data-ad-preview="message">Suggested widget</div>
        <a href="/groups/test/posts/7012">1h</a>
    `));
    assert('suggested content is skipped', suggested === null);

    assert('malformed article is skipped', parser.parsePostArticle(article('<div></div>')) === null);
    assert('non-article root is skipped',
        parser.parsePostArticle(new JSDOM('<div>not an article</div>').window.document.body.firstElementChild) === null);

    const duplicateA = parser.parsePostArticle(article(`
        <div data-ad-preview="message">Same observation</div><a href="/groups/test/posts/7013">1h</a>
    `));
    const duplicateB = parser.parsePostArticle(article(`
        <div data-ad-preview="message">Same observation rendered again</div><a href="/groups/test/posts/7013">1h</a>
    `));
    assert('duplicate DOM observations share the same local observation key',
        parser.observationKey(duplicateA) === parser.observationKey(duplicateB));

    console.log(`\n${passed} passed, ${failed} failed`);
    process.exitCode = failed ? 1 : 0;
})().catch(error => {
    console.error('Test run error:', error);
    process.exitCode = 2;
});
