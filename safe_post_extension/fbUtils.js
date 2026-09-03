/**
 * SafePost — Facebook detection & interaction utilities (Phase 7).
 *
 * Language-independent (Hebrew + English), LAYERED detection with diagnostics.
 * Every finder returns { element, strategy, attempted[], found } so failures are
 * debuggable. Pure DOM functions accept a `root` (defaults to document) so they
 * are unit-testable (jsdom) without a live browser.
 *
 * Loaded as a content script BEFORE content.js; also exports via module.exports
 * for tests. Never reads cookies or session tokens.
 */
(function (global) {
    'use strict';

    // ---- vocabulary (Hebrew + English) ----
    const WORDS = {
        post: ['post', 'publish', 'share', 'פרסם', 'פרסמי', 'פרסום', 'שתף', 'שיתוף'],
        write: ['write something', 'create a post', "what's on your mind", 'כתוב משהו', 'כתבו משהו', 'מה עובר לך', 'צור פוסט'],
        media: ['photo', 'video', 'photo/video', 'media', 'תמונה', 'וידאו', 'תמונה/וידאו', 'מדיה'],
        login: ['log in', 'login', 'log into facebook', 'התחבר', 'התחברות', 'כניסה'],
        checkpoint: ['checkpoint', 'confirm your identity', 'we need to confirm', 'אימות', 'אשר את זהותך', 'נדרש אימות'],
        captcha: ['captcha', 'security check', 'i am not a robot', 'אני לא רובוט', 'בדיקת אבטחה'],
    };

    const STAGES = [
        'OPENING_PAGE', 'WAITING_FOR_PAGE', 'OPENING_COMPOSER', 'FILLING_CONTENT',
        'UPLOADING_MEDIA', 'WAITING_FOR_MEDIA', 'READY_TO_PUBLISH', 'PUBLISHING', 'VERIFYING',
    ];

    // ---- primitives ----
    const norm = (s) => (s == null ? '' : String(s)).trim().toLowerCase();
    function matchesAny(text, words) {
        const t = norm(text);
        return !!t && words.some((w) => t.includes(norm(w)));
    }
    function accessibleText(el) {
        if (!el) return '';
        const label = el.getAttribute && el.getAttribute('aria-label');
        return norm(label || (el.textContent || ''));
    }
    function isVisible(el) {
        if (!el) return false;
        if (el.hidden) return false;
        if (el.getAttribute && el.getAttribute('aria-hidden') === 'true') return false;
        const style = (el.getAttribute && el.getAttribute('style')) || '';
        if (/display\s*:\s*none/i.test(style) || /visibility\s*:\s*hidden/i.test(style)) return false;
        return true;
    }
    // State detection must ignore hidden help/accessibility/template text. Keep
    // this separate from the historical selector helper above so publishing
    // element selection semantics do not change in this phase.
    function isStructurallyVisible(el) {
        for (let current = el; current && current.nodeType === 1; current = current.parentElement) {
            if (current.hidden) return false;
            if (current.getAttribute && current.getAttribute('aria-hidden') === 'true') return false;
            const style = (current.getAttribute && current.getAttribute('style')) || '';
            if (/display\s*:\s*none/i.test(style) || /visibility\s*:\s*hidden/i.test(style)) return false;
        }
        return Boolean(el);
    }

    function stateDiagnostic(state, strategy, matchedSignal, extra = {}) {
        return { state, strategy, matchedSignal, signal: strategy, ...extra };
    }

    // Elements whose text is Facebook's own chrome rather than somebody's post.
    // Scanning ONLY these would miss a real interstitial: Facebook renders
    // security screens in plain divs at least as often as in a dialog or a
    // heading, and an allowlist of ARIA roles let those through as "ok" — which
    // for the publish path means retrying against a security screen.
    //
    // Scanning the whole document is the other failure: `body.textContent`
    // concatenates <script>, <style> and hidden nodes, which is what produced the
    // captcha-text false positive. So the rule is neither "any text" nor "these
    // roles" — it is VISIBLE text that is not user-generated content.
    const NON_TEXT_TAGS = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT', 'SVG', 'IFRAME']);
    // A post or comment quoting "security check" is ordinary content, not a
    // challenge. Facebook marks both with role=article inside role=feed.
    const USER_CONTENT_SELECTOR = '[role="article"], [role="feed"], [role="textbox"], [contenteditable="true"]';

    function isUserGeneratedContent(el) {
        return Boolean(el && el.closest && el.closest(USER_CONTENT_SELECTOR));
    }

    // Leaf-ish visible elements: a node whose own text is short enough to be a
    // label rather than a page dump. Walking leaves keeps the per-node text small
    // without needing to read the whole body.
    function visibleSecuritySurfaces(root) {
        if (!root.querySelectorAll) return [];
        const surfaces = [];
        const candidates = root.querySelectorAll(
            'div, span, p, h1, h2, h3, li, td, label, strong, b, a, button, ' +
            '[role="dialog"], [role="alert"], [role="status"], [role="heading"], ' +
            'form[action*="captcha" i], form[action*="checkpoint" i]'
        );
        for (const el of candidates) {
            if (NON_TEXT_TAGS.has(el.tagName)) continue;
            if (!isStructurallyVisible(el)) continue;
            if (isUserGeneratedContent(el)) continue;
            surfaces.push(el);
            // Bounded: a security interstitial announces itself near the top of
            // the page, and this keeps a large feed from being walked in full.
            if (surfaces.length >= 400) break;
        }
        return surfaces;
    }
    function isEnabled(el) {
        if (!el) return false;
        if (el.disabled) return false;
        if (el.getAttribute && el.getAttribute('aria-disabled') === 'true') return false;
        return true;
    }
    function diag(element, strategy, attempted) {
        return { element: element || null, strategy: element ? strategy : 'none', attempted: attempted.slice(), found: !!element };
    }
    const buttons = (root) => Array.from((root || document).querySelectorAll('[role="button"], button, [type="submit"]'));

    // ---- layered finders ----
    // Prefer the composer inside an open dialog; fall back to page-level.
    function findPostComposer(root) {
        root = root || document;
        const attempted = [];
        const scopes = [root.querySelector && root.querySelector('[role="dialog"]'), root].filter(Boolean);
        for (const scope of scopes) {
            attempted.push('contenteditable[aria-label~write]');
            const editables = Array.from(scope.querySelectorAll('[contenteditable="true"], [role="textbox"]'));
            for (const e of editables) {
                const label = norm(e.getAttribute && e.getAttribute('aria-label'));
                if (label && matchesAny(label, WORDS.write) && isVisible(e)) return diag(e, 'aria-label', attempted);
            }
            attempted.push('contenteditable[role=textbox]');
            const tb = editables.find((e) => isVisible(e) && (e.getAttribute('role') === 'textbox' || e.getAttribute('contenteditable') === 'true'));
            if (tb) return diag(tb, 'contenteditable', attempted);
        }
        return diag(null, 'none', attempted);
    }
    // The editable area to type into (same element as composer in FB, exposed separately).
    function findEditableArea(root) {
        const c = findPostComposer(root);
        return c.found ? c : diag((root || document).querySelector('[contenteditable="true"]'), 'contenteditable-fallback', ['[contenteditable=true]']);
    }
    function findMediaButton(root) {
        root = root || document;
        const attempted = ['role=button[aria-label~media]'];
        for (const b of buttons(root)) {
            const label = norm(b.getAttribute && b.getAttribute('aria-label'));
            if (label && matchesAny(label, WORDS.media) && isVisible(b) && isEnabled(b)) return diag(b, 'aria-label', attempted);
        }
        attempted.push('button-text~media');
        for (const b of buttons(root)) {
            if (matchesAny(accessibleText(b), WORDS.media) && isVisible(b) && isEnabled(b)) return diag(b, 'text', attempted);
        }
        return diag(null, 'none', attempted);
    }
    function findFileInput(root) {
        root = root || document;
        const attempted = ['input[type=file][accept~image]'];
        const inputs = Array.from(root.querySelectorAll('input[type="file"]'));
        const img = inputs.find((i) => /image|video/i.test(i.getAttribute('accept') || ''));
        if (img) return diag(img, 'accept', attempted);
        attempted.push('input[type=file]');
        if (inputs[0]) return diag(inputs[0], 'first-file-input', attempted);
        return diag(null, 'none', attempted);
    }
    function findPublishButton(root) {
        root = root || document;
        const attempted = [];
        const scope = (root.querySelector && root.querySelector('[role="dialog"]')) || root;
        const btns = buttons(scope);
        attempted.push('dialog button[aria-label~post]');
        for (const b of btns) {
            const label = norm(b.getAttribute && b.getAttribute('aria-label'));
            if (label && matchesAny(label, WORDS.post) && isVisible(b) && isEnabled(b)) return diag(b, 'aria-label', attempted);
        }
        attempted.push('dialog button-text~post');
        for (const b of btns) {
            if (matchesAny(accessibleText(b), WORDS.post) && isVisible(b) && isEnabled(b)) return diag(b, 'text', attempted);
        }
        attempted.push('dialog button[type=submit]');
        const submit = btns.find((b) => (b.getAttribute && b.getAttribute('type') === 'submit') && isVisible(b) && isEnabled(b));
        if (submit) return diag(submit, 'submit', attempted);
        return diag(null, 'none', attempted);
    }

    // ---- state detection → maps to Phase 6 error codes ----
    function detectLoginState(root) {
        root = root || document;
        const url = (root.location && root.location.href) || '';
        if (/facebook\.com\/(?:login|login\.php)(?:[/?#]|$)/i.test(url)) {
            return { loggedIn: false, ...stateDiagnostic('logged_out', 'login_url', 'facebook_login_path') };
        }
        if (root.querySelector) {
            const password = Array.from(root.querySelectorAll('input[name="pass"], input[type="password"]'))
                .find(isStructurallyVisible);
            if (password) {
                return { loggedIn: false, ...stateDiagnostic('logged_out', 'visible_password_input', 'facebook_password_control') };
            }
            const loginForm = Array.from(root.querySelectorAll('form[action*="login" i]'))
                .find(isStructurallyVisible);
            if (loginForm) {
                return { loggedIn: false, ...stateDiagnostic('logged_out', 'visible_login_form', 'facebook_login_form') };
            }
        }
        return { loggedIn: true, ...stateDiagnostic('authenticated', 'no_login_challenge', 'none') };
    }
    function detectCaptcha(root) {
        root = root || document;
        const url = (root.location && root.location.href) || '';
        if (/facebook\.com\/[^?#]*captcha(?:[/?#]|$)/i.test(url)) {
            return { captcha: true, ...stateDiagnostic('captcha', 'captcha_url', 'facebook_captcha_path') };
        }
        if (root.querySelectorAll) {
            const providerFrames = Array.from(root.querySelectorAll('iframe')).filter(isStructurallyVisible);
            for (const frame of providerFrames) {
                const src = norm(frame.getAttribute('src'));
                if (/recaptcha|hcaptcha|arkoselabs|captcha-delivery|\/captcha(?:[/?#]|$)/i.test(src)) {
                    return { captcha: true, ...stateDiagnostic('captcha', 'visible_challenge_iframe', 'known_captcha_provider') };
                }
            }

            const challengeContainer = Array.from(root.querySelectorAll([
                '[data-testid*="captcha" i]', '[data-captcha]',
                '[id*="captcha" i]', '[class*="captcha" i]',
            ].join(','))).find(isStructurallyVisible);
            if (challengeContainer) {
                return { captcha: true, ...stateDiagnostic('captcha', 'visible_challenge_container', 'captcha_container_attribute') };
            }

            const challengeControl = Array.from(root.querySelectorAll([
                'input[name*="captcha" i]', 'input[id*="captcha" i]',
                'input[aria-label*="captcha" i]', 'textarea[name="g-recaptcha-response"]',
            ].join(','))).find(isStructurallyVisible);
            if (challengeControl) {
                return { captcha: true, ...stateDiagnostic('captcha', 'visible_challenge_control', 'captcha_input_control') };
            }
        }

        for (const surface of visibleSecuritySurfaces(root)) {
            const text = norm(surface.textContent || surface.getAttribute?.('aria-label'));
            if (!text || text.length > 300) continue;
            // "Security check" as Facebook's own challenge heading. Requiring it
            // to be paired with "complete" meant a real interstitial reading only
            // "Security check" was classified ok.
            //
            // It must LEAD the label, not merely appear in it: "Security check"
            // and "Security check required" are the screen, while "Learn about
            // security checks" is a help link and must not block anything.
            const startsWith = phrase => text === phrase || text.startsWith(phrase + ' ');
            const standaloneSecurityCheck =
                startsWith('security check') || startsWith('\u05d1\u05d3\u05d9\u05e7\u05ea \u05d0\u05d1\u05d8\u05d7\u05d4');
            const strongPhrase = text.includes('i am not a robot') ||
                text.includes('\u05d0\u05e0\u05d9 \u05dc\u05d0 \u05e8\u05d5\u05d1\u05d5\u05d8') ||
                text.includes('\u05d4\u05e9\u05dc\u05dd \u05d0\u05ea \u05d1\u05d3\u05d9\u05e7\u05ea \u05d4\u05d0\u05d1\u05d8\u05d7\u05d4') ||
                text === 'captcha' ||
                standaloneSecurityCheck ||
                (text.includes('complete') && text.includes('security check')) ||
                (text.includes('enter') && (text.includes('characters you see') || text.includes('code shown')));
            if (strongPhrase) {
                return { captcha: true, ...stateDiagnostic('captcha', 'visible_challenge_text', 'high_confidence_security_phrase') };
            }
        }
        return { captcha: false, ...stateDiagnostic('captcha', 'no_structural_captcha', 'none') };
    }
    function detectCheckpoint(root) {
        root = root || document;
        const url = (root.location && root.location.href) || '';
        if (/facebook\.com\/checkpoint(?:[/?#]|$)/i.test(url)) {
            return { checkpoint: true, ...stateDiagnostic('checkpoint', 'checkpoint_url', 'facebook_checkpoint_path') };
        }
        for (const surface of visibleSecuritySurfaces(root)) {
            const text = norm(surface.textContent || surface.getAttribute?.('aria-label'));
            if (!text || text.length > 300) continue;
            // "checkpoint" in a short label is Facebook's own wording for the
            // screen. Bounded by length so it reads a UI label rather than a
            // sentence, and user content is already excluded upstream.
            const checkpointLabel = text.length <= 60 && text.includes('checkpoint');
            // Explicit identity-challenge phrases only. Deliberately no clever
            // word combinations: a heuristic here would reintroduce exactly the
            // class of false positive that stopped the first live QA.
            if (checkpointLabel ||
                text.includes('confirm your identity') || text.includes('verify your identity') ||
                text.includes("we need to confirm it's you") ||
                text.includes('we need to confirm its you') ||
                text.includes('\u05d0\u05e9\u05e8 \u05d0\u05ea \u05d6\u05d4\u05d5\u05ea\u05da') || text.includes('\u05d0\u05de\u05ea \u05d0\u05ea \u05d6\u05d4\u05d5\u05ea\u05da') ||
                text.includes('\u05e0\u05d3\u05e8\u05e9 \u05d0\u05d9\u05de\u05d5\u05ea') || text.includes('\u05e2\u05dc\u05d9\u05e0\u05d5 \u05dc\u05d5\u05d5\u05d3\u05d0 \u05e9\u05d6\u05d4 \u05d0\u05ea\u05d4')) {
                return { checkpoint: true, ...stateDiagnostic('checkpoint', 'visible_checkpoint_text', 'identity_confirmation_phrase') };
            }
        }
        return { checkpoint: false, ...stateDiagnostic('checkpoint', 'no_structural_checkpoint', 'none') };
    }

    function detectAccountRestriction(root) {
        root = root || document;
        for (const surface of visibleSecuritySurfaces(root)) {
            const text = norm(surface.textContent || surface.getAttribute?.('aria-label'));
            if (!text || text.length > 300) continue;
            if (text.includes('your account is restricted') || text.includes('account restricted') ||
                text.includes('your account has been suspended') ||
                text.includes('\u05d4\u05d7\u05e9\u05d1\u05d5\u05df \u05e9\u05dc\u05da \u05de\u05d5\u05d2\u05d1\u05dc')) {
                return { restricted: true, ...stateDiagnostic('account_restricted', 'visible_restriction_text', 'account_restriction_phrase') };
            }
        }
        return { restricted: false, ...stateDiagnostic('account_restricted', 'no_structural_restriction', 'none') };
    }
    // Aggregate → a single error code when the page isn't postable.
    // This is deliberately narrower than post-submit moderation detection. A
    // historical "pending approval" count on a group page does not prove that the
    // current account cannot compose a new post.
    const PREFLIGHT_POSTING_BLOCKS = [
        "you can't post in this group",
        'you cannot post in this group',
        "you're not allowed to post in this group",
        'you are not allowed to post in this group',
        "you don't have permission to post",
        'you do not have permission to post',
        'you are temporarily blocked from posting',
        'your account is restricted from posting',
        "you can't create posts in this group",
        '\u05d0\u05d9\u05df \u05dc\u05da \u05d0\u05e4\u05e9\u05e8\u05d5\u05ea \u05dc\u05e4\u05e8\u05e1\u05dd \u05d1\u05e7\u05d5\u05d1\u05e6\u05d4 \u05d6\u05d5',
        '\u05d0\u05d9\u05df \u05dc\u05da \u05d0\u05e4\u05e9\u05e8\u05d5\u05ea \u05dc\u05e4\u05e8\u05e1\u05dd \u05d1\u05e7\u05d5\u05d1\u05e6\u05d4 \u05d4\u05d6\u05d5',
        '\u05d0\u05d9\u05e0\u05da \u05d9\u05db\u05d5\u05dc \u05dc\u05e4\u05e8\u05e1\u05dd \u05d1\u05e7\u05d5\u05d1\u05e6\u05d4 \u05d6\u05d5',
        '\u05d0\u05d9\u05df \u05dc\u05da \u05d4\u05e8\u05e9\u05d0\u05d4 \u05dc\u05e4\u05e8\u05e1\u05dd \u05d1\u05e7\u05d5\u05d1\u05e6\u05d4 \u05d6\u05d5',
        '\u05d4\u05d7\u05e9\u05d1\u05d5\u05df \u05e9\u05dc\u05da \u05de\u05d5\u05d2\u05d1\u05dc \u05de\u05e4\u05e8\u05e1\u05d5\u05dd',
    ];

    function detectPreflightPostingBlock(root) {
        root = root || document;
        const elements = Array.from(root.querySelectorAll('div, span, [role="alert"], [role="dialog"], [role="status"]'));
        for (const element of elements) {
            if (!isVisible(element)) continue;
            const text = norm(element.textContent || element.getAttribute('aria-label'));
            if (!text || text.length > 300) continue;
            const phrase = PREFLIGHT_POSTING_BLOCKS.find((candidate) => text.includes(norm(candidate)));
            if (phrase) return { blocked: true, signal: 'explicit-posting-block', text, phrase };
        }
        return { blocked: false, signal: 'none', text: null, phrase: null };
    }

    function detectFacebookState(root) {
        root = root || document;
        const login = detectLoginState(root);
        if (!login.loggedIn) return { ok: false, errorCode: 'FACEBOOK_LOGGED_OUT', state: login.state, strategy: login.strategy, matchedSignal: login.matchedSignal, detail: login };
        const cap = detectCaptcha(root);
        if (cap.captcha) return { ok: false, errorCode: 'CAPTCHA_REQUIRED', state: cap.state, strategy: cap.strategy, matchedSignal: cap.matchedSignal, detail: cap };
        const chk = detectCheckpoint(root);
        if (chk.checkpoint) return { ok: false, errorCode: 'CHECKPOINT_REQUIRED', state: chk.state, strategy: chk.strategy, matchedSignal: chk.matchedSignal, detail: chk };
        const restriction = detectAccountRestriction(root);
        if (restriction.restricted) return { ok: false, errorCode: 'ACCOUNT_RESTRICTED', state: restriction.state, strategy: restriction.strategy, matchedSignal: restriction.matchedSignal, detail: restriction };
        return { ok: true, state: 'authenticated', strategy: 'no_security_challenge', matchedSignal: 'none' };
    }

    // ---- waits (async; used in the live extension) ----
    function waitForElement(finder, opts) {
        opts = opts || {};
        const timeout = opts.timeout || 15000;
        const interval = opts.interval || 300;
        const root = opts.root;
        const start = Date.now();
        return new Promise((resolve) => {
            const tick = () => {
                const r = finder(root);
                if (r && r.found) return resolve(r);
                if (Date.now() - start >= timeout) return resolve(r || { found: false, strategy: 'timeout', attempted: [] });
                setTimeout(tick, interval);
            };
            tick();
        });
    }
    function waitForEnabledElement(finder, opts) {
        opts = opts || {};
        const timeout = opts.timeout || 15000;
        const interval = opts.interval || 300;
        const root = opts.root;
        const start = Date.now();
        return new Promise((resolve) => {
            const tick = () => {
                const r = finder(root);
                if (r && r.found && isEnabled(r.element)) return resolve(r);
                if (Date.now() - start >= timeout) return resolve(r || { found: false, strategy: 'timeout', attempted: [] });
                setTimeout(tick, interval);
            };
            tick();
        });
    }

    // ---- diagnostics record ----
    function buildDiagnostics(base) {
        base = base || {};
        return {
            job_id: base.job_id || null,
            worker_id: base.worker_id || null,
            extension_version: base.extension_version || null,
            current_url: base.current_url || null,
            group_url: base.group_url || null,
            page_title: base.page_title || null,
            current_stage: base.current_stage || null,
            selector_strategy: base.selector_strategy || null,
            selectors_attempted: base.selectors_attempted || [],
            element_found: base.element_found === true,
            elapsed_time: base.elapsed_time || null,
            error_code: base.error_code || null,
            error_message: base.error_message || null,
            timestamp: new Date().toISOString(),
        };
    }

    // ---------------------------------------------------------------------
    // DRY RUN SAFETY
    //
    // Sentinel returned by the publish path when a final submission was blocked.
    // It is a distinct value (not true/false) so a caller can never mistake a
    // blocked publish for a successful one.
    const DRY_RUN_BLOCKED = 'DRY_RUN_BLOCKED';

    // Pure decision function — kept here (rather than in content.js) so it is
    // unit-testable without a browser.
    //
    //   • An explicit stored boolean always wins, in either direction.
    //   • Unset falls back to the ENVIRONMENT: an install pointed at a local
    //     backend is a QA/dev install and defaults to BLOCKED. An install
    //     pointed at a remote backend is a real user and keeps publishing, so
    //     shipping this does not silently disable production.
    //   • Anything unreadable or malformed is treated as dry run. A setting we
    //     cannot evaluate must never be the reason a real post goes out.
    function resolveDryRun(settings) {
        if (!settings || typeof settings !== 'object') return true;
        if (typeof settings.dryRunMode === 'boolean') return settings.dryRunMode;
        const base = typeof settings.apiUrl === 'string' ? settings.apiUrl : '';
        if (!base) return false; // unset apiUrl means the production default URL
        return /localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]/i.test(base);
    }

    const api = {
        WORDS, STAGES, DRY_RUN_BLOCKED,
        matchesAny, isVisible, isEnabled, accessibleText,
        findPostComposer, findEditableArea, findMediaButton, findFileInput, findPublishButton,
        detectLoginState, detectCaptcha, detectCheckpoint, detectAccountRestriction,
        detectPreflightPostingBlock, detectFacebookState,
        waitForElement, waitForEnabledElement, buildDiagnostics, resolveDryRun,
    };

    // Browser content script + Node tests both read the global; CommonJS also
    // gets module.exports when applicable (harmless no-op under ESM).
    if (global) global.SafePostFB = api;
    try { if (typeof module !== 'undefined' && module.exports) module.exports = api; } catch (e) { /* ESM */ }
})(typeof globalThis !== 'undefined' ? globalThis : this);
