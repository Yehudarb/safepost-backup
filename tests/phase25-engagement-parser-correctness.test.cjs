/**
 * Phase 25 - top-level Engagement parser correctness and scanner reliability.
 */
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { JSDOM } = require('jsdom');

const GROUP = Object.freeze({
    id: 'phase25-group',
    name: 'Phase 25 Group',
    url: 'https://www.facebook.com/groups/phase25-group/',
});

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

function fixture(inner) {
    const dom = new JSDOM(`<main><div role="feed"><div role="article" id="parent">${inner}</div></div></main>`, {
        url: GROUP.url,
    });
    dom.window.scrollBy = () => {};
    return {
        dom,
        parent: dom.window.document.querySelector('#parent'),
        nested: () => Array.from(dom.window.document.querySelectorAll('#parent [role="article"]')),
    };
}

function parentFields({ author = 'Parent Author', text = 'Parent post', id = '123456' } = {}) {
    return `
        <h2><a href="/parent.author">${author}</a></h2>
        <div data-ad-preview="message">${text}</div>
        ${id ? `<a href="/groups/phase25-group/posts/${id}">1h</a>` : ''}
    `;
}

function comment({ id = '777777', author = 'Comment Author', text = 'Comment text', extra = '' } = {}) {
    return `<div role="article" class="generated-comment-class">
        <h3><a href="/comment.author">${author}</a></h3>
        <div data-ad-preview="message">${text}</div>
        ${id ? `<a href="/groups/phase25-group/posts/${id}">2m</a>` : ''}
        ${extra}
    </div>`;
}

(async () => {
    await import(`${pathToFileURL(path.join(__dirname, '../safe_post_extension/engagement/navigation.js')).href}?phase25-nav`);
    await import(`${pathToFileURL(path.join(__dirname, '../safe_post_extension/engagement/postParser.js')).href}?phase25-parser`);
    await import(`${pathToFileURL(path.join(__dirname, '../safe_post_extension/engagement/scanner.js')).href}?phase25-scanner`);

    const parser = global.SafePostEngagementPostParser;
    const scannerApi = global.SafePostEngagementScanner;
    const navigation = global.SafePostEngagementNavigation;

    console.log('Phase 25 Engagement parser correctness\n');

    console.log(' A. semantic top-level article ownership');
    {
        const f = fixture(`${parentFields()}${comment()}`);
        const parent = parser.parsePostArticle(f.parent);
        const nested = parser.parsePostArticle(f.nested()[0]);
        assert('top-level post containing one comment parses only the parent',
            parent?.facebookPostId === '123456' && nested === null);
        assert('nested article exposes a stable parser diagnostic',
            parser.getArticleSkipReason(f.nested()[0]) === 'nested_article');
    }
    {
        const f = fixture(`${parentFields()}${comment({ id: '700001' })}${comment({ id: '700002' })}`);
        const parsed = [f.parent, ...f.nested()].map(root => parser.parsePostArticle(root)).filter(Boolean);
        assert('top-level post containing two comments produces one post',
            parsed.length === 1 && parsed[0].facebookPostId === '123456');
    }
    {
        const f = fixture(`${comment({ author: 'Wrong Comment Author' })}${parentFields({ author: 'Correct Post Author' })}`);
        const parent = parser.parsePostArticle(f.parent);
        assert('comment author cannot replace the post author',
            parent?.authorName === 'Correct Post Author' && !parent.authorName.includes('Comment'));
    }

    console.log('\n B. permalink and post identity scope');
    {
        const f = fixture(`${comment({ id: '777777' })}${parentFields({ id: '123456' })}`);
        const parent = parser.parsePostArticle(f.parent);
        assert('nested /posts link cannot replace the parent post identity',
            parent?.facebookPostId === '123456' && parent.facebookPostUrl.includes('/posts/123456'));
    }
    {
        const f = fixture(`${parentFields({ id: null })}${comment({
            id: null,
            extra: '<a href="/groups/phase25-group/?story_fbid=888888&id=42">comment story</a>',
        })}`);
        const parent = parser.parsePostArticle(f.parent);
        assert('nested story_fbid is ignored for parent identity',
            parent?.facebookPostId === null && parent.facebookPostUrl === null);
    }
    {
        const f = fixture(`${parentFields({ id: null })}${comment({
            id: null,
            extra: '<a href="/groups/phase25-group/permalink/999999/">comment permalink</a>',
        })}`);
        const parent = parser.parsePostArticle(f.parent);
        assert('nested permalink is ignored for parent identity',
            parent?.facebookPostId === null && parent.facebookPostUrl === null);
    }
    {
        const f = fixture(`${comment({ id: '654321' })}${parentFields({ id: null })}`);
        const parent = parser.parsePostArticle(f.parent);
        assert('comment-only identity leaves the parent ID and URL null',
            parent?.facebookPostId === null && parent.facebookPostUrl === null);
    }
    {
        const identity = parser.extractPostIdentity('/groups/phase25-group/?comment_id=12345');
        assert('group ID and comment_id are never promoted to post identity',
            identity.id === null && identity.url === null);
    }

    console.log('\n C. nested replies, shared content and languages');
    {
        const reply = comment({
            id: '800001',
            extra: comment({ id: '800002', author: 'Reply Author', text: 'Nested reply' }),
        });
        const f = fixture(`${parentFields()}${reply}`);
        assert('comment and nested reply both remain non-posts',
            f.nested().length === 2 && f.nested().every(root => parser.parsePostArticle(root) === null));
    }
    {
        const shared = `<div role="article" aria-label="Shared attachment">
            <h3><a href="/shared.author">Shared Author</a></h3>
            <div data-ad-preview="message">Shared post body</div>
            <a href="/groups/phase25-group/posts/900001">shared permalink</a>
        </div>`;
        const f = fixture(`${parentFields()}${shared}`);
        assert('article-like shared content is not a separate discovered post',
            parser.parsePostArticle(f.parent)?.facebookPostId === '123456' &&
            parser.parsePostArticle(f.nested()[0]) === null);
    }
    {
        const hebrewParent = parentFields({
            author: '&#x5DB;&#x5D5;&#x5EA;&#x5D1; &#x5E8;&#x5D0;&#x5E9;&#x5D9;',
            text: '&#x5E4;&#x5D5;&#x5E1;&#x5D8; &#x5E8;&#x5D0;&#x5E9;&#x5D9; &#x5D1;&#x5E2;&#x5D1;&#x5E8;&#x5D9;&#x5EA;',
        });
        const hebrewComment = comment({
            author: '&#x5DB;&#x5D5;&#x5EA;&#x5D1; &#x5EA;&#x5D2;&#x5D5;&#x5D1;&#x5D4;',
            text: '&#x5EA;&#x5D2;&#x5D5;&#x5D1;&#x5D4; &#x5D1;&#x5E2;&#x5D1;&#x5E8;&#x5D9;&#x5EA;',
        });
        const f = fixture(`${hebrewComment}${hebrewParent}`);
        const parent = parser.parsePostArticle(f.parent);
        assert('Hebrew parent remains isolated from Hebrew comments',
            parent?.authorName === '\u05db\u05d5\u05ea\u05d1 \u05e8\u05d0\u05e9\u05d9' &&
            parent.postText === '\u05e4\u05d5\u05e1\u05d8 \u05e8\u05d0\u05e9\u05d9 \u05d1\u05e2\u05d1\u05e8\u05d9\u05ea');
    }
    {
        const f = fixture(`${comment({ text: 'English comment' })}${parentFields({ text: 'English parent post' })}`);
        const parent = parser.parsePostArticle(f.parent);
        assert('English parent remains isolated from English comments', parent?.postText === 'English parent post');
    }

    console.log('\n D. scanner filtering and reliability');
    {
        const f = fixture(`${parentFields()}${comment()}${comment({ id: '777778' })}`);
        const batches = [];
        const scanner = scannerApi.createReadOnlyScanner({
            document: f.dom.window.document,
            window: f.dom.window,
            parser,
            navigation,
            detectFacebookState: () => ({ ok: true }),
            sendBatch: async posts => batches.push(posts),
        });
        const result = await scanner.scanGroup({ group: GROUP, maxScrollAttempts: 0 });
        assert('scanner broad article discovery submits only the top-level post',
            result.success && result.postsFound === 1 && batches.flat().length === 1 &&
            batches[0][0].facebookPostId === '123456');
    }
    {
        const f = fixture(parentFields());
        const attempts = [];
        const stored = [];
        const scanner = scannerApi.createReadOnlyScanner({
            document: f.dom.window.document,
            window: f.dom.window,
            parser,
            navigation,
            detectFacebookState: () => ({ ok: true }),
            retrySleep: async () => {},
            sendBatch: async posts => {
                attempts.push(posts.map(post => post.facebookPostId));
                if (attempts.length === 1) throw new Error('transient upload failure');
                stored.push(...posts);
            },
        });
        const result = await scanner.scanGroup({ group: GROUP, batchSize: 1, maxScrollAttempts: 0 });
        assert('failed batch stays pending and is retried with the same observation',
            result.success && attempts.length === 2 && attempts[0][0] === attempts[1][0]);
        assert('successful retry stores the observation once',
            stored.length === 1 && stored[0].facebookPostId === '123456');
    }
    {
        const f = fixture(parentFields());
        const batches = [];
        let stateChecks = 0;
        let scrolls = 0;
        f.dom.window.scrollBy = () => { scrolls++; };
        const scanner = scannerApi.createReadOnlyScanner({
            document: f.dom.window.document,
            window: f.dom.window,
            parser,
            navigation,
            detectFacebookState: () => {
                stateChecks++;
                return stateChecks >= 3
                    ? { ok: false, errorCode: 'CHECKPOINT_REQUIRED' }
                    : { ok: true };
            },
            sleep: async () => {},
            sendBatch: async posts => batches.push(posts),
        });
        const result = await scanner.scanGroup({ group: GROUP, batchSize: 5, maxScrollAttempts: 5 });
        assert('checkpoint appearing mid-scroll stops with the security error',
            !result.success && result.errorCode === 'CHECKPOINT_REQUIRED');
        assert('mid-scroll checkpoint stops additional scrolling and preserves the safe pending batch',
            scrolls === 1 && batches.flat().length === 1);
    }

    console.log('\n E. maintenance wiring');
    {
        const serverSource = fs.readFileSync(path.join(__dirname, '../server/index.cjs'), 'utf8');
        const maintenance = serverSource.slice(serverSource.indexOf('const QUEUE_SWEEP_MS'));
        assert('expired Engagement locks use the existing queue maintenance timer',
            maintenance.includes("sweepExpiredScanLocks().catch") &&
            (serverSource.match(/const QUEUE_SWEEP_MS/g) || []).length === 1);
    }

    console.log(`\n${passed} passed, ${failed} failed`);
    process.exitCode = failed ? 1 : 0;
})().catch(error => {
    console.error('Test run error:', error);
    process.exitCode = 2;
});
