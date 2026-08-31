/**
 * Phase 14 - pre-flight moderation safety.
 *
 * A historical pending-approval indicator must not prevent a new post from
 * opening its composer. Post-submit moderation and unverified outcomes remain
 * terminal and are covered here without touching Facebook.
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
require('../safe_post_extension/fbUtils.js');
const fb = globalThis.SafePostFB;

const contentPath = path.join(__dirname, '..', 'safe_post_extension', 'content.js');
const content = fs.readFileSync(contentPath, 'utf8');

let passed = 0;
let failed = 0;
function assert(name, condition) {
    if (condition) {
        passed++;
        console.log(`  OK ${name}`);
    } else {
        failed++;
        console.log(`  FAIL ${name}`);
    }
}

function documentFor(html) {
    return new JSDOM(html, { url: 'https://www.facebook.com/groups/123' }).window.document;
}

function loadVerifyPublishOutcome(detectAdminApprovalBanner, findPostPermalink, document) {
    const start = content.indexOf('async function verifyPublishOutcome(job) {');
    const end = content.indexOf('\nasync function findPostPermalink()', start);
    if (start < 0 || end < 0) throw new Error('verifyPublishOutcome function not found');
    const source = content.slice(start, end);
    return new Function('sleep', 'detectAdminApprovalBanner', 'findPostPermalink', 'document', 'logRemote',
        `${source}\nreturn verifyPublishOutcome;`)(
        () => Promise.resolve(), detectAdminApprovalBanner, findPostPermalink, document, () => {}
    );
}

(async () => {
    console.log('Phase 14 pre-flight moderation safety\n');

    const oldPendingWithComposer = documentFor(`
        <div role="button">What's on your mind?</div>
        <a href="/groups/123/my_pending_content/">1 post pending approval</a>
    `);
    const oldPending = fb.detectPreflightPostingBlock(oldPendingWithComposer);
    assert('old pending approval plus a composer does not block pre-flight', oldPending.blocked === false);

    const genericPending = documentFor('<div role="status">1 post pending approval</div>');
    assert('generic pending count does not block pre-flight', fb.detectPreflightPostingBlock(genericPending).blocked === false);

    const explicitBlock = documentFor('<div role="alert">You cannot post in this group</div>');
    assert('explicit posting block is detected for pre-flight cancellation',
        fb.detectPreflightPostingBlock(explicitBlock).blocked === true);

    const explicitHebrewBlock = documentFor('<div role="alert">\u05d0\u05d9\u05df \u05dc\u05da \u05d0\u05e4\u05e9\u05e8\u05d5\u05ea \u05dc\u05e4\u05e8\u05e1\u05dd \u05d1\u05e7\u05d5\u05d1\u05e6\u05d4 \u05d6\u05d5</div>');
    assert('explicit Hebrew posting block is detected for pre-flight cancellation',
        fb.detectPreflightPostingBlock(explicitHebrewBlock).blocked === true);

    assert('content script only cancels a pre-flight block when no composer trigger is available',
        /const approved = preflight\.blocked && !preflightTrigger;/.test(content));

    const pendingOutcome = loadVerifyPublishOutcome(
        () => true,
        async () => null,
        { body: { innerText: '' } }
    );
    const pending = await pendingOutcome({ content: 'phase14 unique content' });
    assert('new moderation detected after submit remains pending approval', pending.outcome === 'PENDING_APPROVAL');

    const unverifiedOutcome = loadVerifyPublishOutcome(
        () => false,
        async () => null,
        { body: { innerText: '' } }
    );
    const unverified = await unverifiedOutcome({ content: 'phase14 unique content' });
    assert('unverified submission is not treated as success', unverified.outcome === 'UNVERIFIED');
    assert('unverified outcome remains terminal in the content script',
        /error_code:\s*'PUBLISH_UNVERIFIED'/.test(content) && /status:\s*'FAILED'/.test(content));

    console.log(`\n${passed} passed, ${failed} failed`);
    process.exitCode = failed ? 1 : 0;
})().catch((error) => {
    console.error('Test run error:', error.message);
    process.exitCode = 2;
});
