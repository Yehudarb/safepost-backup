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

    function findAuthor(root) {
        const selectors = [
            'h2 a[href]', 'h3 a[href]', 'strong a[href]',
            '[role="heading"] a[href]', 'a[aria-label][href]',
        ];
        for (const selector of selectors) {
            for (const anchor of root.querySelectorAll(selector)) {
                if (!belongsToArticle(anchor, root)) continue;
                const name = semanticText(anchor);
                const url = normalizeFacebookUrl(anchor.getAttribute('href'));
                if (!name || !url) continue;
                const parsed = new URL(url);
                if (/^\/(groups|posts|permalink|watch|reel|photo|events)(\/|$)/i.test(parsed.pathname)) continue;
                return { name, url, strategy: selector };
            }
        }
        return { name: null, url: null, strategy: 'none' };
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

        const isTruncated = hasExactLabel(root, [
            'See more', '\u05e8\u05d0\u05d4 \u05e2\u05d5\u05d3', '\u05d4\u05e6\u05d2 \u05e2\u05d5\u05d3',
        ]);
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
        parsePostArticle,
        observationKey,
    });
    global.SafePostEngagementPostParser = api;
    try { if (typeof module !== 'undefined' && module.exports) module.exports = api; } catch {}
})(typeof globalThis !== 'undefined' ? globalThis : this);
