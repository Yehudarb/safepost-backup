/**
 * Phase 7 — Facebook detection utilities tests (jsdom, no browser needed).
 *
 * Run: node tests/phase7-detection.test.cjs
 * (jsdom is a dev-only dep: `npm install jsdom --no-save`)
 */
const { JSDOM } = require('jsdom');
// fbUtils.js is an ESM-context file (package "type":"module") that self-registers
// on globalThis; requiring it runs the IIFE, then we read the global namespace.
require('../safe_post_extension/fbUtils.js');
const fb = globalThis.SafePostFB;

let passed = 0, failed = 0;
const assert = (n, c) => { c ? (passed++, console.log(`  ✅ ${n}`)) : (failed++, console.log(`  ❌ ${n}`)); };
const doc = (html, url = 'https://www.facebook.com/groups/123') => new JSDOM(html, { url }).window.document;

console.log('Phase 7 detection tests\n');

// --- publish button (English) ---
{
    const d = doc(`<div role="dialog"><button aria-label="Comment">Comment</button><div role="button" aria-label="Post">Post</div></div>`);
    const r = fb.findPublishButton(d);
    assert('finds English "Post" publish button', r.found && r.element.getAttribute('aria-label') === 'Post');
    assert('records the strategy used', r.strategy === 'aria-label' && r.attempted.length >= 1);
}
// --- publish button (Hebrew) ---
{
    const d = doc(`<div role="dialog"><div role="button" aria-label="פרסם">פרסם</div></div>`);
    const r = fb.findPublishButton(d);
    assert('finds Hebrew "פרסם" publish button', r.found && r.element.getAttribute('aria-label') === 'פרסם');
}
// --- disabled publish is skipped in favor of enabled ---
{
    const d = doc(`<div role="dialog"><button aria-label="Post" disabled>Post</button><div role="button" aria-label="Post">Post</div></div>`);
    const r = fb.findPublishButton(d);
    assert('skips disabled publish button, picks enabled one', r.found && !r.element.disabled);
}
// --- composer (Hebrew aria-label) ---
{
    const d = doc(`<div role="dialog"><div contenteditable="true" aria-label="כתוב משהו"></div></div>`);
    const r = fb.findPostComposer(d);
    assert('finds Hebrew composer via aria-label', r.found && r.strategy === 'aria-label');
}
// --- media button ---
{
    const d = doc(`<div><div role="button" aria-label="Photo/video">Photo/video</div></div>`);
    const r = fb.findMediaButton(d);
    assert('finds "Photo/video" media button', r.found);
}
// --- file input ---
{
    const d = doc(`<div><input type="file" accept="image/*,video/*"></div>`);
    const r = fb.findFileInput(d);
    assert('finds image/video file input', r.found && r.strategy === 'accept');
}
// --- login state: logged out (password field) ---
{
    const d = doc(`<body><form><input type="password" name="pass"></form></body>`);
    const s = fb.detectLoginState(d);
    assert('detects logged-out via password field', s.loggedIn === false);
}
// --- captcha ---
{
    const d = doc(`<body><iframe src="https://www.google.com/recaptcha/api2"></iframe></body>`);
    assert('detects captcha (recaptcha iframe)', fb.detectCaptcha(d).captcha === true);
}
// --- checkpoint via url ---
{
    const d = doc(`<body>ok</body>`, 'https://www.facebook.com/checkpoint/?next');
    assert('detects checkpoint via URL', fb.detectCheckpoint(d).checkpoint === true);
}
// --- aggregate state → error code ---
{
    const d = doc(`<body><form><input type="password" name="pass"></form></body>`);
    assert('aggregate maps logged-out → FACEBOOK_LOGGED_OUT', fb.detectFacebookState(d).errorCode === 'FACEBOOK_LOGGED_OUT');
    const ok = doc(`<div role="feed"></div>`);
    assert('aggregate ok on a normal page', fb.detectFacebookState(ok).ok === true);
}
// --- diagnostics record shape ---
{
    const rec = fb.buildDiagnostics({ job_id: 1, current_stage: 'PUBLISHING', selectors_attempted: ['a', 'b'], element_found: true });
    assert('diagnostics record has required fields', rec.job_id === 1 && rec.current_stage === 'PUBLISHING' && rec.selectors_attempted.length === 2 && !!rec.timestamp);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
