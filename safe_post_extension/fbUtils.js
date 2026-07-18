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
        if (root.querySelector && (root.querySelector('input[name="pass"], input[type="password"]'))) return { loggedIn: false, signal: 'password-field' };
        const bodyText = norm(root.body && root.body.textContent);
        if (bodyText && matchesAny(bodyText, WORDS.login) && !(root.querySelector && root.querySelector('[role="feed"], [role="main"]'))) {
            return { loggedIn: false, signal: 'login-text' };
        }
        return { loggedIn: true, signal: 'ok' };
    }
    function detectCaptcha(root) {
        root = root || document;
        if (root.querySelector && root.querySelector('iframe[src*="recaptcha"], [data-testid*="captcha"]')) return { captcha: true, signal: 'recaptcha' };
        const t = norm(root.body && root.body.textContent);
        if (matchesAny(t, WORDS.captcha)) return { captcha: true, signal: 'captcha-text' };
        return { captcha: false };
    }
    function detectCheckpoint(root) {
        root = root || document;
        const url = (root.location && root.location.href) || '';
        if (/checkpoint/i.test(url)) return { checkpoint: true, signal: 'url' };
        const t = norm(root.body && root.body.textContent);
        if (matchesAny(t, WORDS.checkpoint)) return { checkpoint: true, signal: 'checkpoint-text' };
        return { checkpoint: false };
    }
    // Aggregate → a single error code when the page isn't postable.
    function detectFacebookState(root) {
        root = root || document;
        const login = detectLoginState(root);
        if (!login.loggedIn) return { ok: false, errorCode: 'FACEBOOK_LOGGED_OUT', detail: login };
        const cap = detectCaptcha(root);
        if (cap.captcha) return { ok: false, errorCode: 'CAPTCHA_REQUIRED', detail: cap };
        const chk = detectCheckpoint(root);
        if (chk.checkpoint) return { ok: false, errorCode: 'CHECKPOINT_REQUIRED', detail: chk };
        return { ok: true };
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

    const api = {
        WORDS, STAGES,
        matchesAny, isVisible, isEnabled, accessibleText,
        findPostComposer, findEditableArea, findMediaButton, findFileInput, findPublishButton,
        detectLoginState, detectCaptcha, detectCheckpoint, detectFacebookState,
        waitForElement, waitForEnabledElement, buildDiagnostics,
    };

    // Browser content script + Node tests both read the global; CommonJS also
    // gets module.exports when applicable (harmless no-op under ESM).
    if (global) global.SafePostFB = api;
    try { if (typeof module !== 'undefined' && module.exports) module.exports = api; } catch (e) { /* ESM */ }
})(typeof globalThis !== 'undefined' ? globalThis : this);
