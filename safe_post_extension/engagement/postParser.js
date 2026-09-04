(function initSafePostEngagementPostParser(global) {
    'use strict';

    const POST_URL_PATTERNS = [
        { name: 'posts-path', pattern: /\/posts\/([^/?#]+)/i },
        { name: 'permalink-path', pattern: /\/permalink\/([^/?#]+)/i },
    ];

    function cleanText(value) {
        return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
    }

    function normalizeFacebookUrl(value) {
        if (typeof value !== 'string' || !value.trim()) return null;
        try {
            const parsed = new URL(value, 'https://www.facebook.com');
            if (parsed.protocol !== 'https:' || !/(^|\.)facebook\.com$/i.test(parsed.hostname)) return null;
            parsed.hostname = 'www.facebook.com';
            return parsed.href;
        } catch {
            return null;
        }
    }

    function extractPostIdentity(value) {
        const url = normalizeFacebookUrl(value);
        if (!url) return { id: null, url: null, strategy: 'none' };
        const parsed = new URL(url);
        for (const candidate of POST_URL_PATTERNS) {
            const match = parsed.pathname.match(candidate.pattern);
            if (match?.[1]) return { id: decodeURIComponent(match[1]), url, strategy: candidate.name };
        }
        const storyId = parsed.searchParams.get('story_fbid');
        if (storyId) return { id: storyId, url, strategy: 'story-fbid' };
        return { id: null, url: null, strategy: 'none' };
    }

    function semanticText(element) {
        return cleanText(element?.getAttribute?.('aria-label') || element?.textContent || '');
    }

    function belongsToArticle(element, root) {
        return Boolean(element && root && element.closest?.('[role="article"]') === root);
    }

    function getArticleSkipReason(root) {
        if (!root || root.getAttribute?.('role') !== 'article' || typeof root.querySelectorAll !== 'function') {
            return 'invalid_article';
        }
        return root.parentElement?.closest?.('[role="article"]') ? 'nested_article' : null;
    }

    function hasExactLabel(root, labels) {
        const normalized = new Set(labels.map(label => label.toLowerCase()));
        return Array.from(root.querySelectorAll('[aria-label], span, a'))
            .filter(element => belongsToArticle(element, root))
            .some(element => normalized.has(semanticText(element).toLowerCase()));
    }

    function findPermalink(root) {
        const anchors = Array.from(root.querySelectorAll('a[href]'))
            .filter(anchor => belongsToArticle(anchor, root));
        for (const anchor of anchors) {
            const identity = extractPostIdentity(anchor.getAttribute('href'));
            if (identity.id) return { ...identity, anchor };
        }
        return { id: null, url: null, strategy: 'none', anchor: null };
    }

    // Facebook appends a secondary action to some avatar/author aria-labels, e.g.
    // "<name>, הצגת סטורי". The comma-separated tail is UI, never part of a name.
    const AUTHOR_UI_SUFFIXES = [
        'הצגת סטורי', 'הצג סטורי', 'הצגת הסטורי',
        'view story', 'show story',
        'פעיל עכשיו', 'active now',
    ];

    // Labels that describe an action ABOUT a post rather than naming its author.
    // They frequently embed the author's name, so an unguarded match would store
    // a menu label as the author.
    const AUTHOR_REJECT_PATTERNS = [
        /^פעולות עבור/i,
        /^אפשרויות נוספות/i,
        /^actions for/i,
        /^more options/i,
        /^נראה על ידי/i,
        /^seen by/i,
        /^מעקב אחר/i,
        /^follow\b/i,
        /^הפרופיל של/i,
    ];

    function stripAuthorUiSuffix(name) {
        let out = String(name || '');
        for (const suffix of AUTHOR_UI_SUFFIXES) {
            const escaped = suffix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            out = out.replace(new RegExp(`[,\\u060C]\\s*${escaped}\\s*$`, 'i'), '');
        }
        return cleanText(out);
    }

    // A profile URL that identifies a person, including the group-scoped member
    // links Facebook uses inside a group feed (/groups/<gid>/user/<uid>/). Those
    // were previously rejected wholesale by a /groups/ guard, which is why author
    // extraction returned null for almost every row in Live QA #2.
    function authorProfileUrl(href) {
        const url = normalizeFacebookUrl(href);
        if (!url) return null;
        const parsed = new URL(url);
        const path = parsed.pathname;
        if (/^\/groups\/[^/]+\/user\/\d+\/?$/i.test(path)) return url;
        if (/^\/profile\.php$/i.test(path) && /^\d+$/.test(parsed.searchParams.get('id') || '')) return url;
        if (/^\/(groups|posts|permalink|watch|reel|reels|photo|photos|events|media|pages|marketplace|hashtag|story\.php|stories)(\/|$)/i.test(path)) {
            return null;
        }
        if (/^\/[^/]+\/?$/.test(path)) return url;
        return null;
    }

    function authorCandidateName(anchor, preferAria) {
        const raw = preferAria
            ? (anchor.getAttribute?.('aria-label') || anchor.textContent || '')
            : (anchor.textContent || anchor.getAttribute?.('aria-label') || '');
        const name = stripAuthorUiSuffix(cleanText(raw));
        if (!name || name.length > 80) return null;
        if (AUTHOR_REJECT_PATTERNS.some(pattern => pattern.test(name))) return null;
        return name;
    }

    function findAuthor(root) {
        // Header-scoped anchors first, read from their own text, because that is
        // the post byline. The aria-label sweep is last: it is the broadest and
        // the most likely to pick up a decorated avatar label.
        const strategies = [
            ['h2 a[href]', false], ['h3 a[href]', false], ['strong a[href]', false],
            ['[role="heading"] a[href]', false],
            ['a[href]', false],
            ['a[aria-label][href]', true],
        ];
        for (const [selector, preferAria] of strategies) {
            for (const anchor of root.querySelectorAll(selector)) {
                if (!belongsToArticle(anchor, root)) continue;
                const url = authorProfileUrl(anchor.getAttribute('href'));
                if (!url) continue;
                const name = authorCandidateName(anchor, preferAria);
                if (!name) continue;
                return { name, url, strategy: selector };
            }
        }
        return { name: null, url: null, strategy: 'none' };
    }

    // "See more" is an affordance, not a word. Live QA #2 stored three rows whose
    // visible text ended in the collapsed-text control "עוד" while is_truncated
    // was false, because the old check demanded a full label like "הצג עוד" and
    // Facebook renders a bare "עוד" button.
    //
    // The discriminator is therefore the element, not the string: an exact label
    // match on something that is actually a control (an interactive role, or an
    // explicitly aria-labelled element). Ordinary prose containing the word "עוד"
    // is neither, so it stays false. Nothing here clicks or mutates the DOM.
    const SEE_MORE_LABELS = [
        'see more', 'see more…', 'see more...', 'more',
        'עוד', 'עוד…', 'עוד...', 'ראה עוד', 'ראי עוד', 'הצג עוד', 'הצגת עוד',
    ];

    function isInteractiveAffordance(element) {
        if (!element) return false;
        const role = element.getAttribute?.('role');
        if (role === 'button' || role === 'link') return true;
        if (typeof element.tagName === 'string' && element.tagName.toUpperCase() === 'BUTTON') return true;
        return element.hasAttribute?.('tabindex') === true;
    }

    function hasSeeMoreAffordance(root) {
        const wanted = new Set(SEE_MORE_LABELS.map(label => label.toLowerCase()));
        return Array.from(root.querySelectorAll('[role="button"], [role="link"], button, [tabindex], [aria-label]'))
            .filter(element => belongsToArticle(element, root))
            .some(element => {
                const labelled = element.hasAttribute?.('aria-label') === true;
                if (!labelled && !isInteractiveAffordance(element)) return false;
                return wanted.has(semanticText(element).toLowerCase());
            });
    }

    function findPostText(root) {
        const strategies = [
            ['data-ad-preview-message', '[data-ad-preview="message"]'],
            ['data-testid-post-message', '[data-testid="post_message"]'],
            ['visible-dir-auto', '[dir="auto"]'],
        ];
        for (const [strategy, selector] of strategies) {
            const candidates = Array.from(root.querySelectorAll(selector))
                .filter(element => belongsToArticle(element, root))
                .filter(element => !element.closest('[role="button"], [role="textbox"], form'))
                .map(element => ({ element, text: cleanText(element.textContent) }))
                .filter(candidate => candidate.text.length > 0)
                .sort((a, b) => b.text.length - a.text.length);
            if (candidates[0]) return { ...candidates[0], strategy };
        }
        return { element: null, text: '', strategy: 'none' };
    }

    function findTimestamp(root, permalinkAnchor) {
        const time = Array.from(root.querySelectorAll('time'))
            .find(element => belongsToArticle(element, root));
        if (time) {
            const raw = semanticText(time) || null;
            const datetime = time.getAttribute('datetime');
            if (datetime && !Number.isNaN(new Date(datetime).getTime())) {
                return { postedAt: new Date(datetime).toISOString(), postedAtRaw: raw, strategy: 'time-datetime' };
            }
            if (raw) return { postedAt: null, postedAtRaw: raw, strategy: 'time-label' };
        }
        if (permalinkAnchor) {
            const raw = cleanText(
                permalinkAnchor.getAttribute('aria-label') ||
                permalinkAnchor.getAttribute('title') ||
                permalinkAnchor.textContent
            );
            if (raw) return { postedAt: null, postedAtRaw: raw, strategy: 'permalink-label' };
        }
        return { postedAt: null, postedAtRaw: null, strategy: 'none' };
    }

    function parsePostArticle(root) {
        if (getArticleSkipReason(root)) return null;
        if (hasExactLabel(root, ['Sponsored', 'Promoted', '\u05de\u05de\u05d5\u05de\u05df'])) return null;
        if (hasExactLabel(root, ['Suggested for you', 'Suggested post', '\u05de\u05d5\u05de\u05dc\u05e5 \u05e2\u05d1\u05d5\u05e8\u05da'])) return null;

        const permalink = findPermalink(root);
        const author = findAuthor(root);
        const text = findPostText(root);
        const timestamp = findTimestamp(root, permalink.anchor);
        if (!permalink.id && !text.text && !author.name && !timestamp.postedAtRaw) return null;

        const isTruncated = hasSeeMoreAffordance(root);
        const pinned = hasExactLabel(root, ['Pinned post', 'Pinned', '\u05e4\u05d5\u05e1\u05d8 \u05e0\u05e2\u05d5\u05e5']);
        return {
            facebookPostId: permalink.id,
            facebookPostUrl: permalink.url,
            authorName: author.name,
            authorProfileUrl: author.url,
            postText: text.text,
            postedAt: timestamp.postedAt,
            postedAtRaw: timestamp.postedAtRaw,
            isTruncated,
            rawMetadata: {
                postIdentityStrategy: permalink.strategy,
                authorStrategy: author.strategy,
                textStrategy: text.strategy,
                timestampStrategy: timestamp.strategy,
                articleScope: 'top-level',
                pinned,
            },
        };
    }

    function observationKey(post) {
        if (post?.facebookPostId) return `id:${post.facebookPostId}`;
        if (post?.facebookPostUrl) return `url:${post.facebookPostUrl}`;
        return `visible:${cleanText(post?.authorName).toLowerCase()}|${cleanText(post?.postText)}|${cleanText(post?.postedAt || post?.postedAtRaw)}`;
    }

    const api = Object.freeze({
        cleanText,
        normalizeFacebookUrl,
        extractPostIdentity,
        belongsToArticle,
        getArticleSkipReason,
        stripAuthorUiSuffix,
        authorProfileUrl,
        hasSeeMoreAffordance,
        parsePostArticle,
        observationKey,
    });
    global.SafePostEngagementPostParser = api;
    try { if (typeof module !== 'undefined' && module.exports) module.exports = api; } catch {}
})(typeof globalThis !== 'undefined' ? globalThis : this);
