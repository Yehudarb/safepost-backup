(function initSafePostEngagementScanner(global) {
    'use strict';

    const DEFAULT_BATCH_SIZE = 5;
    const DEFAULT_MAX_SCROLL_ATTEMPTS = 8;
    const DEFAULT_MAX_STAGNANT_SCROLLS = 3;
    const DEFAULT_SCROLL_DELAY_MS = 800;

    function createReadOnlyScanner(options = {}) {
        const documentRef = options.document || global.document;
        const windowRef = options.window || global.window;
        const parser = options.parser || global.SafePostEngagementPostParser;
        const navigation = options.navigation || global.SafePostEngagementNavigation;
        const detectFacebookState = options.detectFacebookState ||
            (root => global.SafePostFB?.detectFacebookState(root) || { ok: false, errorCode: 'PARSER_NO_STRATEGY_MATCHED' });
        const sleep = options.sleep || (ms => new Promise(resolve => setTimeout(resolve, ms)));
        const sendBatch = options.sendBatch || (async () => ({ ok: true }));
        const onProgress = options.onProgress || (() => {});

        async function scanGroup({
            group,
            limit = 10,
            batchSize = DEFAULT_BATCH_SIZE,
            maxScrollAttempts = DEFAULT_MAX_SCROLL_ATTEMPTS,
            maxStagnantScrolls = DEFAULT_MAX_STAGNANT_SCROLLS,
            scrollDelayMs = DEFAULT_SCROLL_DELAY_MS,
            signal,
        }) {
            const boundedLimit = Math.max(1, Math.min(10, Number(limit) || 10));
            const state = navigation.classifyGroupPage({
                expectedUrl: group.url,
                currentUrl: windowRef.location.href,
                facebookState: detectFacebookState(documentRef),
                bodyText: documentRef.body?.textContent || '',
            });
            if (!state.ok) return { success: false, errorCode: state.errorCode, postsFound: 0, scrollAttempts: 0 };

            const observed = new Set();
            const pending = [];
            let postsFound = 0;
            let scrollAttempts = 0;
            let stagnantScrolls = 0;

            const flush = async () => {
                if (!pending.length) return;
                const batch = pending.splice(0, pending.length);
                await sendBatch(batch);
            };

            while (!signal?.aborted) {
                const before = postsFound;
                const articles = Array.from(documentRef.querySelectorAll(
                    'main [role="article"], [role="feed"] [role="article"]'
                ));
                for (const article of articles) {
                    if (signal?.aborted || postsFound >= boundedLimit) break;
                    const post = parser.parsePostArticle(article);
                    if (!post) continue;
                    const key = parser.observationKey(post);
                    if (observed.has(key)) continue;
                    observed.add(key);
                    pending.push(post);
                    postsFound++;
                    onProgress({ postsFound, scrollAttempts });
                    if (pending.length >= batchSize) await flush();
                }

                if (postsFound >= boundedLimit) break;
                stagnantScrolls = postsFound === before ? stagnantScrolls + 1 : 0;
                if (scrollAttempts >= maxScrollAttempts || stagnantScrolls >= maxStagnantScrolls) break;
                windowRef.scrollBy({ top: Math.max(400, Math.floor(windowRef.innerHeight * 0.75)), behavior: 'auto' });
                scrollAttempts++;
                await sleep(scrollDelayMs);
            }

            await flush();
            if (signal?.aborted) {
                return { success: false, aborted: true, errorCode: 'SCAN_PREEMPTED_BY_PUBLISH', postsFound, scrollAttempts };
            }
            if (postsFound === 0) {
                return { success: false, errorCode: 'NO_POSTS_FOUND', postsFound, scrollAttempts };
            }
            return { success: true, postsFound, scrollAttempts };
        }

        return Object.freeze({ scanGroup });
    }

    const api = Object.freeze({
        DEFAULT_BATCH_SIZE,
        DEFAULT_MAX_SCROLL_ATTEMPTS,
        DEFAULT_MAX_STAGNANT_SCROLLS,
        DEFAULT_SCROLL_DELAY_MS,
        createReadOnlyScanner,
    });
    global.SafePostEngagementScanner = api;

    if (global.document && global.chrome?.runtime?.onMessage && !global.__safePostEngagementScannerInstalled) {
        global.__safePostEngagementScannerInstalled = true;
        let controller = null;
        global.chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
            if (request?.action === 'ABORT_ENGAGEMENT_SCAN') {
                if (controller) controller.abort();
                sendResponse({ ok: true, aborted: Boolean(controller) });
                return false;
            }
            if (request?.action !== 'START_ENGAGEMENT_SCAN') return false;
            if (controller) {
                sendResponse({ success: false, errorCode: 'ENGAGEMENT_SCAN_ALREADY_RUNNING' });
                return false;
            }

            controller = new AbortController();
            const scanner = createReadOnlyScanner({
                sendBatch: posts => new Promise((resolve, reject) => {
                    global.chrome.runtime.sendMessage({
                        action: 'ENGAGEMENT_SCAN_BATCH',
                        scanId: request.scanId,
                        group: request.group,
                        posts,
                    }, response => {
                        if (global.chrome.runtime.lastError) return reject(new Error(global.chrome.runtime.lastError.message));
                        if (!response?.ok) return reject(new Error(response?.error || 'Engagement batch rejected.'));
                        resolve(response);
                    });
                }),
                onProgress: progress => {
                    global.chrome.runtime.sendMessage({
                        action: 'ENGAGEMENT_SCAN_PROGRESS',
                        scanId: request.scanId,
                        progress,
                    }, () => void global.chrome.runtime.lastError);
                },
            });
            scanner.scanGroup({
                group: request.group,
                limit: request.limit,
                signal: controller.signal,
            }).then(sendResponse).catch(error => {
                sendResponse({
                    success: false,
                    errorCode: error?.errorCode || 'TEMPORARY_SERVER_ERROR',
                    error: error?.message || String(error),
                });
            }).finally(() => { controller = null; });
            return true;
        });
    }

    try { if (typeof module !== 'undefined' && module.exports) module.exports = api; } catch {}
})(typeof globalThis !== 'undefined' ? globalThis : this);
