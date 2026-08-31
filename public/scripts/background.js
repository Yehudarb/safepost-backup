console.log("[Background] Service Worker Loaded");

const DEFAULT_API_BASE = 'http://localhost:3001';
let API_BASE = DEFAULT_API_BASE;

async function loadApiBase() {
    try {
        const { apiUrl } = await chrome.storage.local.get('apiUrl');
        const clean = typeof apiUrl === 'string' ? apiUrl.trim().replace(/\/+$/, '') : '';
        API_BASE = clean || DEFAULT_API_BASE;
    } catch (e) {
        console.warn('[Background] Failed to load apiUrl, using default localhost backend:', e);
        API_BASE = DEFAULT_API_BASE;
    }
}

chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.apiUrl) {
        const next = typeof changes.apiUrl.newValue === 'string'
            ? changes.apiUrl.newValue.trim().replace(/\/+$/, '')
            : '';
        API_BASE = next || DEFAULT_API_BASE;
    }
});

// 1. Setup Alarm
chrome.runtime.onInstalled.addListener(() => setupAlarm());
chrome.runtime.onStartup.addListener(() => setupAlarm());

function setupAlarm() {
    chrome.alarms.create('jobPoller', { periodInMinutes: 0.1 });
}

// 2. Alarm Listener
chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === 'jobPoller') {
        await checkJobs();
        await checkPendingGroupSync();
    }
});

// Poll immediately on startup too
loadApiBase().finally(() => {
    setTimeout(() => {
        checkJobs();
        checkPendingGroupSync();
        connectSyncStream();
    }, 500);
});

let isScanning = false;
let activeTabId = null;        // Tab currently running a job
let activeJobTimeout = null;   // Safety timeout to prevent infinite stuck state
let syncGroupsInProgress = false;
let syncSseSource = null;
let syncSseReconnectTimer = null;

const GROUPS_SYNC_URL = 'https://www.facebook.com/groups/joins/?nav_source=tab';
const GROUPS_SYNC_TIMEOUT_MS = 90000;
const GROUPS_SYNC_DELAY_MS = 4000;

async function persistFacebookUser(facebook_user, facebook_user_id = null) {
    const clean = typeof facebook_user === 'string' ? facebook_user.trim() : '';
    const cleanId = typeof facebook_user_id === 'string' ? facebook_user_id.trim() : '';
    if (!clean) return null;
    try {
        await chrome.storage.local.set({
            fb_session: clean,
            safepost_currentUser: clean,
            safepost_detectedFacebookUser: clean,
            safepost_currentUserId: cleanId || null
        });
    } catch (e) {
        console.warn('[Background] Failed to persist facebook user:', e);
    }
    return { facebook_user: clean, facebook_user_id: cleanId || null };
}

async function getStoredFacebookUser() {
    try {
        const data = await chrome.storage.local.get(['fb_session', 'safepost_currentUser', 'safepost_detectedFacebookUser', 'safepost_currentUserId']);
        return {
            facebook_user: data.fb_session || data.safepost_currentUser || data.safepost_detectedFacebookUser || null,
            facebook_user_id: data.safepost_currentUserId || null
        };
    } catch (e) {
        console.warn('[Background] Failed to read stored facebook user:', e);
        return null;
    }
}

async function reportGroupSyncFailure(error) {
    try {
        await fetch(`${API_BASE}/api/groups/sync-failed`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: String(error || 'Unknown sync error') })
        });
    } catch (_) {
        // best effort
    }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function getTabInfo(tabId) {
    try {
        return await chrome.tabs.get(tabId);
    } catch (_) {
        return null;
    }
}

async function waitForFacebookTabReady(tabId, timeoutMs = 20000) {
    const start = Date.now();
    let lastInfo = null;

    while (Date.now() - start < timeoutMs) {
        const info = await getTabInfo(tabId);
        if (!info) throw new Error('Facebook sync tab was closed.');

        lastInfo = info;
        const url = info.url || '';

        if (url.includes('/login') || url.includes('/checkpoint')) {
            throw new Error('Not logged in to Facebook.');
        }

        if (info.status === 'complete' && /facebook\.com/i.test(url)) {
            await sleep(1200);
            return info;
        }

        await sleep(500);
    }

    const url = lastInfo?.url ? ` Current URL: ${lastInfo.url}` : '';
    throw new Error(`Facebook groups page did not finish loading.${url}`);
}

async function executeGroupScrape(tabId, attempt = 1) {
    try {
        await waitForFacebookTabReady(tabId);
        const results = await chrome.scripting.executeScript({
            target: { tabId },
            func: () => {
                return new Promise((resolveAll) => {
                    const skipIds = new Set([
                        'feed', 'discover', 'joins', 'bookmarks', 'create', 'memberof',
                        'work', 'updates', 'you', 'events', 'nearby', 'search',
                        'requests', 'invited', 'suggested'
                    ]);
                    const seen = new Set();
                    const seenNames = new Set();
                    const groups = [];
                    const norm = (s) => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();

                    const getName = (el) => {
                        const isValid = (s) => s && s.length > 1 && !/^\d+$/.test(s)
                            && !s.includes('·') && !/^\d+[KkMm]/.test(s);
                        const aria = el.getAttribute('aria-label');
                        if (isValid(aria)) return aria.trim();
                        for (const c of el.querySelectorAll('span, strong')) {
                            const t = c.textContent?.trim();
                            if (isValid(t)) return t;
                        }
                        const alt = el.querySelector('img')?.alt?.trim();
                        if (isValid(alt)) return alt;
                        const text = (el.textContent || '').trim().split('\n')[0].trim();
                        if (isValid(text)) return text;
                        return '';
                    };

                    const isSuggestionCard = (el) => {
                        const card = el.closest('[role="listitem"], [role="article"], li') || el.parentElement;
                        if (!card) return false;
                        const t = norm(card.textContent);
                        return /\bjoin\b/.test(t) || t.includes('הצטרף') || t.includes('הצטרפי') ||
                            t.includes('הצטרפות') || t.includes('מוצע') || t.includes('suggested');
                    };

                    const SUGGESTION_HEADING_RE = /(suggested|discover more|more groups|groups you may like|קבוצות מומלצות|קבוצות מוצעות|מוצע לך|גלה קבוצות|קבוצות נוספות|אולי יעניין אותך)/i;
                    let suggestionCutoffY = Infinity;
                    const stats = { rawLinks: 0, rootMatch: 0, skipped: 0, dupeId: 0, noName: 0, dupeName: 0, suggestion: 0, belowCutoff: 0, kept: 0 };

                    const refreshSuggestionCutoff = () => {
                        if (suggestionCutoffY !== Infinity) return;
                        const heads = document.querySelectorAll('h1, h2, h3, [role="heading"]');
                        for (const h of heads) {
                            const t = (h.textContent || '').trim();
                            if (t && SUGGESTION_HEADING_RE.test(t)) {
                                const rect = h.getBoundingClientRect();
                                suggestionCutoffY = rect.top + window.scrollY;
                                console.log('[SafePost DEBUG] suggestion cutoff locked at y=' + suggestionCutoffY + ' (heading: "' + t + '")');
                                break;
                            }
                        }
                    };

                    const isBelowCutoff = (el) => {
                        if (suggestionCutoffY === Infinity) return false;
                        const rect = el.getBoundingClientRect();
                        return (rect.top + window.scrollY) >= suggestionCutoffY;
                    };

                    const extract = () => {
                        refreshSuggestionCutoff();
                        const main = document.querySelector('[role="main"]');
                        let links = main ? main.querySelectorAll('a[href*="/groups/"]') : null;
                        if (!links || !links.length) links = document.querySelectorAll('a[href*="/groups/"]');
                        stats.rawLinks = Math.max(stats.rawLinks, links.length);

                        links.forEach((el) => {
                            const url = (el.href || '').split('?')[0];
                            const match = url.match(/facebook\.com\/groups\/([a-zA-Z0-9._-]+)\/?$/);
                            if (!match) return;
                            stats.rootMatch++;
                            const gid = match[1];
                            if (skipIds.has(gid.toLowerCase())) { stats.skipped++; return; }
                            if (seen.has(gid)) { stats.dupeId++; return; }
                            if (isBelowCutoff(el)) { stats.belowCutoff++; return; }
                            const name = getName(el);
                            if (!name) { stats.noName++; return; }
                            const nkey = norm(name);
                            if (seenNames.has(nkey)) { stats.dupeName++; return; }
                            if (isSuggestionCard(el)) { stats.suggestion++; return; }
                            seen.add(gid);
                            seenNames.add(nkey);
                            stats.kept++;
                            groups.push({ id: gid, name, url: url.endsWith('/') ? url : `${url}/` });
                        });
                    };

                    const extractWithSafety = () => {
                        extract();
                        if (suggestionCutoffY !== Infinity && stats.kept === 0 && stats.rootMatch > 0 && stats.belowCutoff > 0) {
                            console.warn('[SafePost] suggestion cutoff excluded ALL groups, disabling it for this run', stats);
                            suggestionCutoffY = Infinity;
                            extract();
                        }
                    };

                    const MAX = 220;
                    const WAIT = 1400;
                    let scrolls = 0;
                    let lastCount = 0;
                    let stable = 0;

                    const tick = () => {
                        window.scrollTo(0, document.body.scrollHeight);
                        document.querySelectorAll('[role="main"],[role="feed"],[role="navigation"]').forEach((el) => {
                            try { el.scrollTop = el.scrollHeight; } catch (_) {}
                        });
                        scrolls += 1;
                        setTimeout(() => {
                            extractWithSafety();
                            const currentCount = groups.length;
                            if (currentCount === lastCount) {
                                stable += 1;
                            } else {
                                stable = 0;
                            }
                            lastCount = currentCount;

                            const wellPastCutoff = suggestionCutoffY !== Infinity &&
                                (window.scrollY + window.innerHeight) > suggestionCutoffY + 900;

                            if (stable >= 5 || scrolls >= MAX || wellPastCutoff) {
                                console.log('%c[SafePost DEBUG] group count breakdown', 'color:#007bff;font-weight:bold', stats);
                                console.log('[SafePost DEBUG] final group names:', groups.map((g) => g.name));
                                resolveAll(groups);
                                return;
                            }
                            tick();
                        }, WAIT);
                    };

                    extractWithSafety();
                    tick();
                });
            }
        });
        return Array.isArray(results) ? (results[0]?.result || []) : [];
    } catch (err) {
        const msg = String(err?.message || err);
        const retryable = msg.includes('Frame with ID 0 was removed') ||
            msg.includes('Cannot access contents of url') ||
            msg.includes('Extension context invalidated') ||
            msg.includes('Facebook groups page did not finish loading') ||
            msg.includes('The tab was closed') ||
            msg.includes('Receiving end does not exist');
        if (retryable && attempt < 5) {
            await sleep(1500 * attempt);
            return executeGroupScrape(tabId, attempt + 1);
        }
        throw err;
    }
}

function connectSyncStream() {
    if (syncSseReconnectTimer) {
        clearTimeout(syncSseReconnectTimer);
        syncSseReconnectTimer = null;
    }

    if (syncSseSource) {
        try { syncSseSource.close(); } catch (_) {}
        syncSseSource = null;
    }

    try {
        syncSseSource = new EventSource(`${API_BASE}/api/stream/jobs`);
        syncSseSource.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                if (data.type === 'connected') {
                    console.log('[Background] SSE connected');
                } else if (data.type === 'job_available') {
                    checkJobs();
                } else if (data.type === 'sync_groups') {
                    console.log('[Background] sync_groups received via SSE');
                    scanAndSyncGroups('sse').then((result) => {
                        console.log('[Background] SSE sync result:', result);
                    });
                }
            } catch (e) {
                console.error('[Background] SSE parse error:', e);
            }
        };
        syncSseSource.onerror = () => {
            try { syncSseSource.close(); } catch (_) {}
            syncSseSource = null;
            syncSseReconnectTimer = setTimeout(connectSyncStream, 30000);
        };
    } catch (e) {
        console.warn('[Background] SSE unavailable, will retry:', e);
        syncSseReconnectTimer = setTimeout(connectSyncStream, 30000);
    }
}

async function checkPendingGroupSync() {
    try {
        const res = await fetch(`${API_BASE}/api/groups/pending-sync`);
        if (!res.ok) return;
        const data = await res.json().catch(() => ({}));
        if (data.sync_needed) {
            console.log('[Background] Pending sync flag detected, starting scan');
            scanAndSyncGroups('poll').then((result) => {
                console.log('[Background] Poll sync result:', result);
            });
        }
    } catch (e) {
        console.warn('[Background] Pending sync check failed:', e);
    }
}

// If a tab is closed externally (user closed it), release the lock
chrome.tabs.onRemoved.addListener((tabId) => {
    if (tabId === activeTabId) {
        console.log("[Background] Active tab closed externally ג€” releasing job lock");
        activeTabId = null;
        if (activeJobTimeout) { clearTimeout(activeJobTimeout); activeJobTimeout = null; }
    }
});

async function checkJobs() {
    if (isScanning) return;
    if (activeTabId !== null) return; // Job already running ג€” wait for it to finish

    isScanning = true;
    try {
        console.log("[Background] נ”„ Checking for new jobs...");
        const res = await fetch(`${API_BASE}/api/jobs/next`);
        if (!res.ok) {
            console.warn("[Background] Failed to fetch jobs:", res.status);
            return;
        }

        const data = await res.json();
        const job = data.job || (data.id ? data : null);
        if (!job) {
            console.log("[Background] No jobs in queue");
            return;
        }

        console.log("[Background] נ”¥ New Job Found:", job.id, "Group:", job.group_url);

        const targetUrl = job.group_url || job.url;
        if (!targetUrl) {
            console.error("[Background] ג No URL found in job", job);
            return;
        }

        console.log("[Background] נ“± Creating tab with URL:", targetUrl);
        const tab = await chrome.tabs.create({ url: targetUrl, active: true });
        activeTabId = tab.id;
        console.log("[Background] ג… Tab created, ID:", tab.id);

        // Safety valve: if no REPORT_STATUS within 120s, release the lock
        activeJobTimeout = setTimeout(() => {
            console.warn("[Background] ג ן¸ Job timeout ג€” releasing lock for job:", job.id, "Tab:", activeTabId);
            if (activeTabId) {
                console.log("[Background] נ—‘ן¸ Closing tab", activeTabId);
                chrome.tabs.remove(activeTabId).catch((err) => {
                    console.error("[Background] Failed to close tab:", err);
                });
                activeTabId = null;
            }
            activeJobTimeout = null;
        }, 120000);

        chrome.tabs.onUpdated.addListener(function listener(tabId, info) {
            if (tabId === tab.id && info.status === 'complete') {
                console.log("[Background] נ“„ Tab loaded (status=complete), ID:", tabId);
                chrome.tabs.onUpdated.removeListener(listener);
                console.log("[Background] ג³ Waiting 4s for page to stabilize before sending EXECUTE_POST...");
                setTimeout(() => {
                    console.log("[Background] נ“₪ Sending EXECUTE_POST message to tab", tabId, "for job", job.id);
                    try {
                        chrome.tabs.sendMessage(tabId, { action: 'EXECUTE_POST', job: job }, (response) => {
                            if (chrome.runtime.lastError) {
                                console.error("[Background] ג sendMessage failed:", chrome.runtime.lastError.message);
                                // Content script not ready ג€” report FAILED and release lock
                                console.log("[Background] נ”´ Reporting FAILED to server...");
                                fetch(`${API_BASE}/api/tasks/update-status`, {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ taskId: job.id, status: 'FAILED', failure_reason: `Content script unavailable: ${chrome.runtime.lastError.message}` })
                                }).catch((err) => {
                                    console.error("[Background] Failed to report to server:", err);
                                });
                                releaseJobLock();
                            } else {
                                console.log("[Background] ג… sendMessage succeeded, waiting for content script response...");
                            }
                        });
                    } catch (err) {
                        console.error("[Background] ג sendMessage threw error:", err.message);
                        fetch(`${API_BASE}/api/tasks/update-status`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ taskId: job.id, status: 'FAILED', failure_reason: `sendMessage error: ${err.message}` })
                        }).catch(() => {});
                        releaseJobLock();
                    }
                }, 4000); // Wait for page to stabilize
            }
        });

    } catch (err) {
        console.error("Poll Error:", err);
    } finally {
        isScanning = false;
    }
}

function releaseJobLock() {
    if (activeTabId !== null) {
        chrome.tabs.remove(activeTabId).catch(() => {});
        activeTabId = null;
    }
    if (activeJobTimeout) { clearTimeout(activeJobTimeout); activeJobTimeout = null; }
}

// 3. Message Listener ג€” handles reports from content.js
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'REPORT_STATUS') {
        const status = request.payload?.status;
        const taskId = request.payload?.taskId;
        const failureReason = request.payload?.failure_reason;

        console.log(`[Background] נ“¨ REPORT_STATUS received: Task #${taskId}, Status: ${status}, Reason: ${failureReason || 'N/A'}`);

        // When job finishes (any terminal state), close the tab and release the lock
        if (status === 'SUCCESS' || status === 'FAILED') {
            console.log(`[Background] ג… Job done (${status}, #${taskId}) ג€” releasing lock`);
            releaseJobLock();
        }

        console.log(`[Background] נ”„ Sending status update to server for task #${taskId}...`);
        fetch(`${API_BASE}/api/tasks/update-status`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(request.payload)
        }).then(res => {
            if (res.ok) {
                console.log(`[Background] ג… Server received status update for task #${taskId}`);
            } else {
                console.error(`[Background] ג Server returned ${res.status} for task #${taskId}`);
            }
        }).catch(err => {
            console.error('[Background] ג Status update error:', err);
            // Even if server update fails, still release the lock to avoid deadlock
            if (status === 'SUCCESS' || status === 'FAILED') {
                console.log(`[Background] נ”’ Lock released anyway to prevent deadlock`);
                releaseJobLock();
            }
        });
        return false;
    }

    if (request.action === 'SYNC_GROUPS') {
        persistFacebookUser(request.facebook_user || null, request.facebook_user_id || null);
        fetch(`${API_BASE}/api/groups/sync`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                groups: request.groups,
                facebook_user: request.facebook_user || null,
                facebook_user_id: request.facebook_user_id || null
            })
        })
        .then(async (res) => {
            const body = await res.json();
            if (res.ok && body.success) {
                try {
                    await chrome.storage.local.set({
                        cached_groups: Array.isArray(request.groups) ? request.groups : [],
                        safepost_lastGroupSyncAt: new Date().toISOString()
                    });
                } catch (e) {
                    console.warn('[Background] Failed to cache manual sync groups:', e);
                }
            }
            // Avoid prototype pollution by not spreading user-provided objects
            sendResponse(body.success ? { success: true } : { success: false, error: String(body.error || 'Server error') });
        })
        .catch(err => sendResponse({ success: false, error: err.toString() }));
        return true; // Keep channel open for async response
    }

    if (request.action === 'SET_FACEBOOK_USER' || request.action === 'SYNC_FACEBOOK_USER') {
        persistFacebookUser(request.facebook_user || null, request.facebook_user_id || null)
            .then(async (profile) => {
                if (profile?.facebook_user) {
                    await fetch(`${API_BASE}/api/profile/sync`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            facebook_user: profile.facebook_user,
                            facebook_user_id: profile.facebook_user_id,
                            source: 'extension_background',
                            detected_at: new Date().toISOString()
                        })
                    }).catch(() => {});
                }
                sendResponse({ success: true, ...(profile || {}), facebook_user: profile?.facebook_user || null, facebook_user_id: profile?.facebook_user_id || null });
            })
            .catch((err) => sendResponse({ success: false, error: err.toString() }));
        return true;
    }

    if (request.action === 'SCAN_AND_SYNC_GROUPS') {
        scanAndSyncGroups('message')
            .then((result) => sendResponse(result))
            .catch((err) => sendResponse({ success: false, error: err.toString() }));
        return true;
    }

    return false;
});

async function scanAndSyncGroups(triggerSource = 'manual') {
    if (syncGroupsInProgress) {
        return { success: false, error: 'Group sync is already running' };
    }

    syncGroupsInProgress = true;
    let tabId = null;
    let timeoutId = null;
    let resolved = false;

    const finish = (payload) => {
        if (resolved) return;
        resolved = true;
        return payload;
    };

    const cleanup = async (listener) => {
        if (timeoutId) {
            clearTimeout(timeoutId);
            timeoutId = null;
        }
        if (listener) {
            try { chrome.tabs.onUpdated.removeListener(listener); } catch (_) {}
        }
        if (tabId !== null) {
            try { await chrome.tabs.remove(tabId); } catch (_) {}
            tabId = null;
        }
    };

    try {
        const profile = await getStoredFacebookUser();
        const facebook_user = profile?.facebook_user || null;
        const facebook_user_id = profile?.facebook_user_id || null;
        const tab = await chrome.tabs.create({ url: GROUPS_SYNC_URL, active: false });
        tabId = tab?.id ?? null;

        if (tabId === null) {
            return finish({ success: false, error: 'Failed to open Facebook groups page' });
        }

        return await new Promise((resolve) => {
            const listener = (updatedTabId, info) => {
                if (updatedTabId !== tabId || info.status !== 'complete') return;
                chrome.tabs.onUpdated.removeListener(listener);

                timeoutId = setTimeout(async () => {
                    try {
                        const tabInfo = await chrome.tabs.get(tabId);
                        const currentUrl = tabInfo?.url || '';
                        if (currentUrl.includes('/login') || currentUrl.includes('/checkpoint')) {
                            await reportGroupSyncFailure('Not logged in to Facebook.');
                            await cleanup();
                            resolve(finish({ success: false, error: 'Not logged in to Facebook.' }));
                            return;
                        }

                        /*
                        const results = await chrome.scripting.executeScript({
                            target: { tabId },
                            func: () => {
                                return new Promise((resolveAll) => {
                                    const skipIds = new Set([
                                        'feed', 'discover', 'joins', 'bookmarks', 'create', 'memberof',
                                        'work', 'updates', 'you', 'events', 'nearby', 'search',
                                        'requests', 'invited', 'suggested'
                                    ]);
                                    const seen = new Set();
                                    const groups = [];

                                    const getName = (el) => {
                        const isValid = (s) => s && s.length > 1 && !/^\d+$/.test(s) && !/^\d+[KkMm]/.test(s);
                                        const aria = el.getAttribute('aria-label');
                                        if (isValid(aria)) return aria.trim();
                                        for (const c of el.querySelectorAll('span, strong')) {
                                            const t = c.textContent?.trim();
                                            if (isValid(t)) return t;
                                        }
                                        const alt = el.querySelector('img')?.alt?.trim();
                                        if (isValid(alt)) return alt;
                                        const text = (el.textContent || '').trim().split('\n')[0].trim();
                                        if (isValid(text)) return text;
                                        return '';
                                    };

                                    const extract = () => {
                                        document.querySelectorAll('a[href*="/groups/"]').forEach((el) => {
                                            const url = (el.href || '').split('?')[0];
                                            const match = url.match(/facebook\.com\/groups\/([a-zA-Z0-9._-]+)/);
                                            if (!match) return;
                                            const gid = match[1];
                                            if (skipIds.has(gid.toLowerCase()) || seen.has(gid)) return;
                                            const name = getName(el);
                                            if (!name) return;
                                            seen.add(gid);
                                            groups.push({ id: gid, name, url: url.endsWith('/') ? url : `${url}/` });
                                        });
                                    };

                                    const MAX = 50;
                                    const WAIT = 1200;
                                    let scrolls = 0;
                                    let lastCount = 0;
                                    let stable = 0;

                                    const tick = () => {
                                        window.scrollTo(0, document.body.scrollHeight);
                                        document.querySelectorAll('[role="main"],[role="feed"],[role="navigation"]').forEach((el) => {
                                            try { el.scrollTop = el.scrollHeight; } catch (_) {}
                                        });
                                        scrolls += 1;
                                        setTimeout(() => {
                                            extract();
                                            const currentCount = groups.length;
                                            if (currentCount === lastCount) {
                                                stable += 1;
                                            } else {
                                                stable = 0;
                                            }
                                            lastCount = currentCount;
                                            if (stable >= 3 || scrolls >= MAX) {
                                                resolveAll(groups);
                                                return;
                                            }
                                            tick();
                                        }, WAIT);
                                    };

                                    extract();
                                    tick();
                                });
                            }
                        });

                        */
                        const groups = await executeGroupScrape(tabId);
                        if (!groups.length) {
                            await reportGroupSyncFailure('No groups found on /groups/joins/');
                            await cleanup();
                            resolve(finish({ success: false, error: 'No groups found.' }));
                            return;
                        }

                        const syncRes = await fetch(`${API_BASE}/api/groups/sync`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                groups,
                                facebook_user: facebook_user || null,
                                facebook_user_id: facebook_user_id || null,
                                source: triggerSource
                            })
                        });
                        const syncData = await syncRes.json().catch(() => ({}));

                        if (!syncRes.ok || syncData.error) {
                            throw new Error(syncData.error || `Server ${syncRes.status}`);
                        }

                        try {
                            await chrome.storage.local.set({
                                cached_groups: groups,
                                safepost_lastGroupSyncAt: new Date().toISOString()
                            });
                        } catch (e) {
                            console.warn('[Background] Failed to cache synced groups:', e);
                        }

                        await cleanup();
                        resolve(finish({
                            success: true,
                            synced: groups.length,
                            added: syncData.added || groups.length,
                            facebook_user: facebook_user || null,
                            facebook_user_id: facebook_user_id || null,
                            trigger: triggerSource
                        }));
                    } catch (err) {
                        await reportGroupSyncFailure(err.message || String(err));
                        await cleanup();
                        resolve(finish({ success: false, error: err.message || String(err) }));
                    }
                }, GROUPS_SYNC_DELAY_MS);
            };

            chrome.tabs.onUpdated.addListener(listener);
            chrome.tabs.get(tabId, (tabInfo) => {
                if (chrome.runtime.lastError || !tabInfo) return;
                if (tabInfo.status === 'complete') {
                    listener(tabId, { status: 'complete' });
                }
            });

            timeoutId = setTimeout(async () => {
                await reportGroupSyncFailure(`Timed out after ${GROUPS_SYNC_TIMEOUT_MS / 1000}s`);
                await cleanup(listener);
                resolve(finish({ success: false, error: `Timed out after ${GROUPS_SYNC_TIMEOUT_MS / 1000}s` }));
            }, GROUPS_SYNC_TIMEOUT_MS);
        });
    } catch (err) {
        await reportGroupSyncFailure(err.message || String(err));
        return finish({ success: false, error: err.message || String(err) });
    } finally {
        syncGroupsInProgress = false;
    }
}
