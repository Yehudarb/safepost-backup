/**
 * Phase 26 — Facebook state detection confidence, and the Engagement identity guard.
 *
 * The first controlled live QA aborted with CAPTCHA_REQUIRED / captcha-text on a
 * group that was reachable seconds earlier. The old detector matched
 * `document.body.textContent` — which concatenates <script> and hidden text —
 * against the bare substring "captcha". Any page whose bundled JavaScript
 * mentions the word blocked the scan.
 *
 * These tests pin both directions: an ordinary page must stay OK no matter where
 * the word appears, and a genuine challenge must still stop the scan. Detection
 * is only useful if BOTH hold; loosening it without the second half would be
 * worse than the false positive.
 */
const path = require('path');
const { pathToFileURL } = require('url');
const { JSDOM } = require('jsdom');

let passed = 0;
let failed = 0;
const assert = (name, condition, detail = '') => {
    if (condition) { passed++; console.log(`  OK ${name}`); }
    else { failed++; console.log(`  FAIL ${name}${detail ? '  — ' + detail : ''}`); }
};

// A normal, logged-in group page. Every fixture below injects its extra content
// into this shell so the only variable is the thing under test.
const groupPage = (extra = '', url = 'https://www.facebook.com/groups/group-qa-1/') => {
    const dom = new JSDOM(`<body>
        <div role="main">
          <div role="feed">
            <div role="article"><div dir="auto">An ordinary group post</div></div>
          </div>
        </div>
        ${extra}
    </body>`, { url });
    return dom.window.document;
};

(async () => {
    await import(`${pathToFileURL(path.join(__dirname, '../safe_post_extension/fbUtils.js')).href}?phase26`);
    await import(`${pathToFileURL(path.join(__dirname, '../safe_post_extension/engagement/identity.js')).href}?phase26`);
    const FB = global.SafePostFB;
    const Identity = global.SafePostEngagementIdentity;

    console.log('Phase 26 Facebook state confidence and identity guard\n');

    console.log(' A. the word "captcha" on an ordinary page must NOT block a scan');
    {
        const cases = [
            ['hidden DOM node containing captcha',
                '<div style="display:none">captcha</div>'],
            ['aria-hidden node containing captcha',
                '<div aria-hidden="true"><span>security check</span></div>'],
            ['a post whose text mentions captcha',
                '<div role="article"><div dir="auto">The signup form kept showing me a captcha, so annoying</div></div>'],
            ['a comment mentioning CAPTCHA in Hebrew',
                '<div role="article"><div dir="auto">האתר ביקש ממני בדיקת אבטחה ולא הצלחתי</div></div>'],
            ['generic security wording in body copy',
                '<div dir="auto">Security tips: review your account security settings regularly</div>'],
            ['accessibility help text mentioning verification',
                '<div class="sr-only">Verification help is available in the Help Centre</div>'],
            ['inline script text containing challenge words',
                '<script>window.__cfg={captcha:true,challenge:"recaptcha",security_check:1};</script>'],
            ['style block containing challenge words',
                '<style>.captcha-container{display:none}.security-check{color:red}</style>'],
            ['a hidden recaptcha iframe left in the DOM',
                '<iframe src="https://www.google.com/recaptcha/api2/anchor" style="display:none"></iframe>'],
            ['a link whose label mentions security checks',
                '<a href="/help/security">Learn about security checks</a>'],
        ];
        for (const [name, extra] of cases) {
            const state = FB.detectFacebookState(groupPage(extra));
            assert(name, state.ok === true,
                `errorCode=${state.errorCode} strategy=${state.strategy} signal=${state.matchedSignal}`);
        }
    }

    console.log('\n B. a genuine challenge must still stop the scan');
    {
        const blocking = [
            ['visible reCAPTCHA iframe', 'CAPTCHA_REQUIRED',
                '<iframe src="https://www.google.com/recaptcha/api2/anchor"></iframe>'],
            ['visible hCaptcha iframe', 'CAPTCHA_REQUIRED',
                '<iframe src="https://hcaptcha.com/captcha/v1/frame"></iframe>'],
            ['visible arkoselabs challenge frame', 'CAPTCHA_REQUIRED',
                '<iframe src="https://client-api.arkoselabs.com/v2/enforcement"></iframe>'],
            ['visible challenge container by data-testid', 'CAPTCHA_REQUIRED',
                '<div data-testid="captcha_dialog"><span>Please complete this step</span></div>'],
            ['visible captcha response control', 'CAPTCHA_REQUIRED',
                '<textarea name="g-recaptcha-response"></textarea>'],
            ['visible "I am not a robot" challenge text', 'CAPTCHA_REQUIRED',
                '<div role="dialog"><h2>I am not a robot</h2></div>'],
            ['Hebrew robot-challenge heading', 'CAPTCHA_REQUIRED',
                '<div role="dialog"><h2>אני לא רובוט</h2></div>'],
            ['visible restriction notice', 'ACCOUNT_RESTRICTED',
                '<div role="alert">Your account is restricted from some features</div>'],
        ];
        for (const [name, expected, extra] of blocking) {
            const state = FB.detectFacebookState(groupPage(extra));
            assert(name, state.ok === false && state.errorCode === expected,
                `ok=${state.ok} errorCode=${state.errorCode}`);
        }

        const captchaUrl = FB.detectFacebookState(
            groupPage('', 'https://www.facebook.com/checkpoint/captcha/'));
        assert('a captcha URL blocks even with a clean DOM',
            captchaUrl.ok === false && captchaUrl.errorCode === 'CAPTCHA_REQUIRED', captchaUrl.errorCode);

        const checkpoint = FB.detectFacebookState(
            groupPage('', 'https://www.facebook.com/checkpoint/1234/'));
        assert('checkpoint detection is unchanged',
            checkpoint.ok === false && checkpoint.errorCode === 'CHECKPOINT_REQUIRED', checkpoint.errorCode);

        const loginUrl = FB.detectFacebookState(
            groupPage('', 'https://www.facebook.com/login/'));
        assert('logged-out by URL is unchanged',
            loginUrl.ok === false && loginUrl.errorCode === 'FACEBOOK_LOGGED_OUT', loginUrl.errorCode);

        const passwordForm = FB.detectFacebookState(
            groupPage('<form action="/login"><input type="password" name="pass"></form>'));
        assert('a visible password form still means logged out',
            passwordForm.ok === false && passwordForm.errorCode === 'FACEBOOK_LOGGED_OUT', passwordForm.errorCode);
    }

    console.log('\n C. diagnostics are specific and carry no page content');
    {
        const state = FB.detectFacebookState(
            groupPage('<iframe src="https://www.google.com/recaptcha/api2/anchor"></iframe>'));
        assert('a blocking result names its strategy',
            typeof state.strategy === 'string' && state.strategy.length > 0, state.strategy);
        assert('a blocking result names the matched signal',
            typeof state.matchedSignal === 'string' && state.matchedSignal.length > 0, state.matchedSignal);
        assert('the iframe strategy is reported precisely',
            state.strategy === 'visible_challenge_iframe' &&
            state.matchedSignal === 'known_captcha_provider',
            `${state.strategy}/${state.matchedSignal}`);

        // Diagnostics travel into logs and scan status, so they must not carry
        // page text, post bodies or anything resembling a credential.
        const serialized = JSON.stringify(state);
        assert('diagnostics contain no page text',
            !serialized.includes('An ordinary group post'), serialized.slice(0, 160));
        assert('diagnostics contain no raw URL or token-like material',
            !/recaptcha\/api2|c_user|token|cookie/i.test(serialized), serialized.slice(0, 160));

        const ok = FB.detectFacebookState(groupPage());
        assert('a clean page reports an explicit ok strategy',
            ok.ok === true && ok.strategy === 'no_security_challenge' && ok.matchedSignal === 'none',
            `${ok.strategy}/${ok.matchedSignal}`);
    }

    console.log('\n D. identity comparison uses stable ids only');
    {
        const match = Identity.evaluateFacebookIdentity({
            expectedId: '100000000000001', expectedName: 'Smart Choice gadgets',
            currentId: '100000000000001', currentName: 'Yehuda Arbely',
            currentStrategy: 'active_facebook_tab_c_user',
        });
        assert('same account id matches even when the display names differ',
            match.ok === true, JSON.stringify(match));
        assert('the matching result records which strategy proved it',
            match.strategy === 'active_facebook_tab_id_match', match.strategy);

        const mismatch = Identity.evaluateFacebookIdentity({
            expectedId: '100000000000001', expectedName: 'Dataset Account',
            currentId: '100000000000002', currentName: 'Someone Else',
        });
        assert('a different account id is a reliable mismatch',
            mismatch.ok === false && mismatch.errorCode === 'FACEBOOK_IDENTITY_MISMATCH', mismatch.errorCode);
        assert('the mismatch message is user-actionable',
            /does not match the account used to sync these groups/i.test(mismatch.message || ''), mismatch.message);
        assert('mismatch diagnostics name the strategy',
            mismatch.strategy === 'stable_facebook_user_id_mismatch', mismatch.strategy);

        // Names alone must never decide. A Page label and the personal account
        // that administers it are legitimately different strings.
        const pageVsProfile = Identity.evaluateFacebookIdentity({
            expectedId: '100000000000001', expectedName: 'Smart Choice gadgets',
            currentId: '100000000000001', currentName: 'Yehuda Arbely',
        });
        assert('a Page label vs the personal account name is NOT rejected',
            pageVsProfile.ok === true, JSON.stringify(pageVsProfile));

        const sameNameDifferentId = Identity.evaluateFacebookIdentity({
            expectedId: '100000000000001', expectedName: 'Same Name',
            currentId: '100000000000009', currentName: 'Same Name',
        });
        assert('an identical display name does not rescue a different id',
            sameNameDifferentId.ok === false &&
            sameNameDifferentId.errorCode === 'FACEBOOK_IDENTITY_MISMATCH');
    }

    console.log('\n E. unverifiable identity is distinct from a mismatch');
    {
        const noDataset = Identity.evaluateFacebookIdentity({
            expectedId: null, expectedName: 'Legacy dataset',
            currentId: '100000000000001', currentName: 'Yehuda Arbely',
        });
        assert('a dataset with no stable id is UNVERIFIED, not MISMATCH',
            noDataset.ok === false && noDataset.errorCode === 'FACEBOOK_IDENTITY_UNVERIFIED', noDataset.errorCode);
        assert('the unverified message tells the user to re-sync',
            /sync the groups again/i.test(noDataset.message || ''), noDataset.message);

        const noCurrent = Identity.evaluateFacebookIdentity({
            expectedId: '100000000000001', currentId: null,
        });
        assert('an unreadable current account is UNVERIFIED, not MISMATCH',
            noCurrent.ok === false && noCurrent.errorCode === 'FACEBOOK_IDENTITY_UNVERIFIED', noCurrent.errorCode);

        for (const bad of ['', '   ', 'abc', '12', '1'.repeat(31), 'c_user=1', null, undefined, 0, {}]) {
            assert(`malformed id ${JSON.stringify(bad)} is not accepted as stable`,
                Identity.normalizeFacebookUserId(bad) === null);
        }
        assert('a plain numeric id is accepted', Identity.normalizeFacebookUserId('100000000000001') === '100000000000001');
        assert('a numeric id given as a number is accepted', Identity.normalizeFacebookUserId(100000000000001) === '100000000000001');

        const reason = Identity.safeIdentityFailureReason(noDataset);
        assert('the failure reason carries strategy and signal only',
            /^strategy=[a-z_]+;signal=[a-z_]+$/.test(reason), reason);
        assert('the failure reason leaks no account name or id',
            !/Yehuda|Legacy|1000000/.test(reason), reason);
    }

    console.log(`\n${passed} passed, ${failed} failed`);
    process.exitCode = failed ? 1 : 0;
})().catch(error => {
    console.error('Test run error:', error);
    process.exitCode = 2;
});
