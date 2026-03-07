console.log("[Background] Service Worker v7.8 — Persistent Poll");

const API_PORT = 3001;
const BASE_URL = `http://localhost:${API_PORT}`;

// 1. Alarm Setup — MV3 service workers die after ~30s; alarm is the wakeup mechanism
function setupAlarm() {
    chrome.alarms.get('jobPoller', (existing) => {
        if (!existing) {
            chrome.alarms.create('jobPoller', { periodInMinutes: 1 });
            console.log("[Background] Alarm created (1 min period)");
        } else {
            console.log(`[Background] Alarm active, next fire: ${new Date(existing.scheduledTime).toLocaleTimeString()}`);
        }
    });
}

setupAlarm();

// Poll IMMEDIATELY on every service worker start
setTimeout(() => {
    console.log("[Background] Startup immediate poll...");
    checkJobs();
    sendHeartbeat();
}, 500);

chrome.runtime.onInstalled.addListener(() => {
    chrome.alarms.clear('jobPoller', () => setupAlarm());
    checkJobs();
    sendHeartbeat();
});
chrome.runtime.onStartup.addListener(() => { setupAlarm(); checkJobs(); sendHeartbeat(); });

// 2. Alarm Listener
chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === 'jobPoller') {
        console.log(`[Background] Alarm fired at ${new Date().toLocaleTimeString()}`);
        checkJobs();
        sendHeartbeat();
    }
});

// 0. Auto-Reload Watchdog
let lastServerContact = Date.now();
const WATCHDOG_LIMIT = 120000; // 2 Minutes

function recordContact() {
    lastServerContact = Date.now();
}

function checkWatchdog() {
    if (Date.now() - lastServerContact > WATCHDOG_LIMIT) {
        console.error(`[Watchdog] No contact from server for ${WATCHDOG_LIMIT / 1000}s. Reloading...`);
        chrome.runtime.reload();
    }
}

// SSE Real-Time Listener
let sseSource = null;

function connectSSE() {
    if (sseSource) { sseSource.close(); sseSource = null; }
    try {
        sseSource = new EventSource(`${BASE_URL}/api/stream/jobs`);
        sseSource.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                if (data.type === 'connected') { recordContact(); }
                else if (data.type === 'job_available') { recordContact(); checkJobs(); }
                else if (data.type === 'sync_groups') {
                    console.log("[Background] sync_groups received via SSE — starting scan...");
                    recordContact();
                    scanAndSyncGroups().then(result => {
                        console.log("[Background] SSE-triggered sync result:", result);
                    });
                }
            } catch (e) { console.error("[SSE] Parse Error:", e); }
        };
        sseSource.onerror = () => {
            sseSource.close(); sseSource = null;
            setTimeout(connectSSE, 30000);
        };
    } catch (e) {
        console.error("[Background] SSE Setup Failed:", e);
        setTimeout(connectSSE, 30000);
    }
}

connectSSE();

// 3. Main Polling Logic
let isScanning = false;
async function checkJobs() {
    if (isScanning) return;
    isScanning = true;
    try {
        if (await checkSafetyCooldown()) return;

        const res = await fetch(`${BASE_URL}/api/jobs/next`);
        if (res.ok) recordContact();
        if (!res.ok) return;
        const data = await res.json();
        if (!data || !data.job) return;

        const job = data.job;
        const memory = await chrome.storage.local.get(['lastJobId']);
        if (memory.lastJobId === job.id) return;

        console.log("[Background] New Job:", job.id);
        await chrome.storage.local.set({ lastJobId: job.id });

        const tab = await chrome.tabs.create({ url: job.group_url, active: true });

        chrome.tabs.onUpdated.addListener(function listener(tabId, info) {
            if (tabId === tab.id && info.status === 'complete') {
                chrome.tabs.onUpdated.removeListener(listener);
                setTimeout(() => {
                    try {
                        chrome.tabs.sendMessage(tabId, { action: 'EXECUTE_POST', job: job }, (response) => {
                            if (chrome.runtime.lastError) {
                                console.warn("[Background] Msg Error (Ignored):", chrome.runtime.lastError.message);
                            }
                        });
                    } catch (e) {
                        console.error("[Background] SendMessage Exception:", e);
                    }

                    const cooldownSeconds = Math.floor(Math.random() * (720 - 180 + 1)) + 180;
                    chrome.storage.local.set({
                        last_post_timestamp: Date.now(),
                        cooldown_until: Date.now() + (cooldownSeconds * 1000)
                    });
                    console.log(`[SAFETY] Cooldown active for ${cooldownSeconds}s`);
                }, 5000);
            }
        });
    } catch (err) {
        console.error("Poll Error:", err);
    } finally {
        isScanning = false;
    }
}

// Safety Cooldown Check (3-Minute Delay)
async function checkSafetyCooldown() {
    const { last_post_timestamp } = await chrome.storage.local.get('last_post_timestamp');
    if (!last_post_timestamp) return false;

    const timeSince = Date.now() - last_post_timestamp;
    const MIN_DELAY = 180000; // 3 Minutes

    if (timeSince < MIN_DELAY) {
        const remaining = Math.ceil((MIN_DELAY - timeSince) / 1000);
        console.log(`Cooldown Active: ${remaining}s remaining.`);
        return true;
    }
    return false;
}

// 4. Unified Message Listener
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'JOB_COMPLETE' || request.action === 'CLOSE_TAB') {
        const missionId = request.missionId || "Unknown";
        (async () => {
            try {
                const res = await fetch(`${BASE_URL}/api/tasks/${missionId}/status`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ status: 'SUCCESS', completed_at: new Date().toISOString() })
                });
                if (!res.ok) console.error('[BG] DB Update Failed:', res.status);
            } catch (err) { console.error("[BG] Sync Network Error:", err); }
            if (sender.tab && sender.tab.id) {
                setTimeout(() => chrome.tabs.remove(sender.tab.id).catch(() => {}), 1000);
            }
            sendResponse({ success: true });
        })();
        return true;
    }

    if (request.action === 'MISSION_FAILED') {
        const missionId = request.missionId || "Unknown";
        (async () => {
            try {
                await fetch(`${BASE_URL}/api/tasks/${missionId}/status`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ status: 'FAILED', error: request.reason || 'Unknown Error', completed_at: new Date().toISOString() })
                });
            } catch (err) { console.error("[BG] Sync Error:", err); }
            if (sender.tab && sender.tab.id) {
                setTimeout(() => chrome.tabs.remove(sender.tab.id).catch(() => {}), 2000);
            }
            sendResponse({ success: true });
        })();
        return true;
    }

    if (request.action === "SYNC_GROUPS") {
        fetch(`${BASE_URL}/api/groups/sync`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ groups: request.groups })
        })
            .then(async (res) => {
                const rawBody = await res.text();
                try {
                    const data = JSON.parse(rawBody);
                    if (!res.ok) throw new Error(data.error || `Server Status ${res.status}`);
                    sendResponse({ success: true, serverData: data });
                } catch (e) {
                    sendResponse({ success: false, error: "Server Error (HTML/Invalid JSON)" });
                }
            })
            .catch(err => sendResponse({ success: false, error: err.toString() }));
        return true;
    }

    if (request.action === "REPORT_STATUS") {
        fetch(`${BASE_URL}/api/tasks/update-status`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(request.payload)
        }).catch(err => console.error("Status Network Error:", err));
        return false;
    }

    if (request.action === "GET_COOKIES") {
        chrome.cookies.getAll({ domain: "facebook.com" }, (cookies) => {
            sendResponse({ success: true, cookies: cookies });
        });
        return true;
    }

    return false;
});

// Heartbeat Logic
async function scanAndSyncGroups() {
    console.log("[Background] scanAndSyncGroups via www.facebook.com/groups/joins/");
    const reportFail = (error) => fetch(`${BASE_URL}/api/groups/sync-failed`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error })
    }).catch(() => {});

    return new Promise((resolve) => {
        let tabId = null;
        let done = false;
        const finish = (r) => { if (!done) { done = true; resolve(r); } };

        const timeout = setTimeout(() => {
            if (tabId) chrome.tabs.remove(tabId).catch(() => {});
            reportFail("Timed out after 90s");
            finish({ success: false, error: "Timed out after 90s" });
        }, 90000);

        chrome.tabs.create({ url: "https://www.facebook.com/groups/joins/?nav_source=tab", active: false }, (tab) => {
            tabId = tab.id;
            const listener = (id, info) => {
                if (id !== tabId || info.status !== 'complete') return;
                chrome.tabs.onUpdated.removeListener(listener);

                setTimeout(async () => {
                    try {
                        const tabInfo = await chrome.tabs.get(tabId);
                        if (tabInfo.url.includes('/login') || tabInfo.url.includes('/checkpoint')) {
                            chrome.tabs.remove(tabId).catch(() => {});
                            clearTimeout(timeout);
                            finish({ success: false, error: "Not logged in to Facebook." });
                            return;
                        }

                        const results = await chrome.scripting.executeScript({
                            target: { tabId },
                            func: () => new Promise(resolveAll => {
                                const skipIds = new Set(['feed', 'discover', 'joins', 'bookmarks',
                                    'create', 'memberof', 'work', 'updates', 'you', 'events',
                                    'nearby', 'search', 'requests', 'invited', 'suggested']);
                                const seen = new Set();
                                const groups = [];

                                // Robust name extractor — filters out pure numeric strings
                                const getName = (el) => {
                                    const isValid = (s) => s && s.length > 1 && !/^\d+$/.test(s)
                                        && !s.includes('·') && !/^\d+[KkMm]/.test(s);

                                    // 1. aria-label on the link itself
                                    const aria = el.getAttribute('aria-label');
                                    if (isValid(aria)) return aria.trim();

                                    // 2. First valid text in child spans/strongs
                                    for (const c of el.querySelectorAll('span, strong')) {
                                        const t = c.textContent?.trim();
                                        if (isValid(t)) return t;
                                    }

                                    // 3. img alt
                                    const alt = el.querySelector('img')?.alt?.trim();
                                    if (isValid(alt)) return alt;

                                    // 4. Direct link text
                                    const text = (el.textContent || '').trim().split('\n')[0].trim();
                                    if (isValid(text)) return text;

                                    return '';
                                };

                                const extract = () => {
                                    document.querySelectorAll('a[href*="/groups/"]').forEach(el => {
                                        const url = (el.href || '').split('?')[0];
                                        const match = url.match(/facebook\.com\/groups\/([a-zA-Z0-9._-]+)/);
                                        if (!match) return;
                                        const gid = match[1];
                                        if (skipIds.has(gid.toLowerCase()) || seen.has(gid)) return;
                                        const name = getName(el);
                                        if (!name) return;
                                        seen.add(gid);
                                        groups.push({ id: gid, name, url: url.endsWith('/') ? url : url + '/' });
                                    });
                                };

                                // Scroll until no new groups load
                                const MAX = 50, WAIT = 1200;
                                let scrolls = 0, lastCount = 0, stable = 0;
                                const tick = () => {
                                    window.scrollTo(0, document.body.scrollHeight);
                                    document.querySelectorAll('[role="main"],[role="feed"],[role="navigation"]')
                                        .forEach(el => { try { el.scrollTop = el.scrollHeight; } catch {} });
                                    scrolls++;
                                    setTimeout(() => {
                                        extract();
                                        const cur = groups.length;
                                        if (cur === lastCount) { stable++; } else { stable = 0; }
                                        lastCount = cur;
                                        if (stable >= 3 || scrolls >= MAX) { resolveAll(groups); return; }
                                        tick();
                                    }, WAIT);
                                };
                                extract(); // grab what's already loaded
                                tick();
                            })
                        });

                        chrome.tabs.remove(tabId).catch(() => {});
                        const groups = results?.[0]?.result || [];
                        console.log(`[Background] joins scan: found ${groups.length} groups`);

                        if (groups.length === 0) {
                            clearTimeout(timeout);
                            reportFail("No groups found on /groups/joins/");
                            finish({ success: false, error: "No groups found." });
                            return;
                        }

                        const syncRes = await fetch(`${BASE_URL}/api/groups/sync`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ groups })
                        });
                        const syncData = await syncRes.json();
                        clearTimeout(timeout);

                        if (!syncRes.ok || syncData.error) {
                            reportFail(syncData.error || `Server ${syncRes.status}`);
                            finish({ success: false, error: syncData.error });
                            return;
                        }
                        finish({ success: true, synced: groups.length, added: syncData.added || 0 });

                    } catch (e) {
                        if (tabId) chrome.tabs.remove(tabId).catch(() => {});
                        clearTimeout(timeout);
                        reportFail(e.message);
                        finish({ success: false, error: e.message });
                    }
                }, 4000);
            };
            chrome.tabs.onUpdated.addListener(listener);
        });
    });
}

async function sendHeartbeat() {
    try {
        const manifest = chrome.runtime.getManifest();
        const res = await fetch(`${BASE_URL}/api/worker/heartbeat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                extension_id: chrome.runtime.id,
                manifest_version: manifest.version,
                origin_folder: 'safe_post_extension',
                current_url: 'background'
            }),
            mode: 'cors'
        });
        if (res.ok) {
            recordContact();
            const data = await res.json();
            if (data.sync_needed) {
                console.log("[Background] sync_needed received from server, starting group scan...");
                scanAndSyncGroups().then(result => {
                    console.log("[Background] Server-triggered sync result:", result);
                });
            }
        }
    } catch (e) { console.error("Heartbeat failed:", e); }
}

chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'jobPoller') {
        sendHeartbeat();
        checkWatchdog();
    }
});

// 5. EXTERNAL DASHBOARD LISTENER
chrome.runtime.onMessageExternal.addListener((request, sender, sendResponse) => {
    console.log("[Background] External Message Received:", request);

    if (request.action === "START_AUTOMATION") {
        let targetUrl = "https://www.facebook.com/groups/feed/";

        const groupList = request.postData?.group_ids || request.postData?.groups;
        if (groupList && groupList.length > 0) {
            const firstGroup = groupList[0];
            if (typeof firstGroup === 'object' && firstGroup !== null) {
                if (firstGroup.url) targetUrl = firstGroup.url;
                else if (firstGroup.id) targetUrl = `https://www.facebook.com/groups/${firstGroup.id}/`;
                else if (firstGroup.fb_id) targetUrl = `https://www.facebook.com/groups/${firstGroup.fb_id}/`;
            } else if (typeof firstGroup === 'string') {
                targetUrl = `https://www.facebook.com/groups/${firstGroup}/`;
            }
        }

        chrome.tabs.create({ url: targetUrl }, (tab) => {
            const listener = (tabId, info) => {
                if (tabId === tab.id && info.status === 'complete') {
                    chrome.tabs.onUpdated.removeListener(listener);
                    function trySendMessage(attemptsLeft) {
                        chrome.tabs.get(tabId, (targetTab) => {
                            if (chrome.runtime.lastError || !targetTab) return;
                            chrome.tabs.sendMessage(tabId, {
                                action: 'EXECUTE_POST',
                                job: request.postData || { id: 'MANUAL', content: 'Test Post' }
                            }, (res) => {
                                if (chrome.runtime.lastError && attemptsLeft > 0) {
                                    setTimeout(() => trySendMessage(attemptsLeft - 1), 3000);
                                }
                            });
                        });
                    }
                    setTimeout(() => trySendMessage(3), 5000);
                }
            };
            chrome.tabs.onUpdated.addListener(listener);
        });

        sendResponse({ success: true, status: "STARTED" });
    }

    if (request.action === "GET_COOKIES") {
        chrome.cookies.getAll({ domain: "facebook.com" }, (cookies) => {
            if (chrome.runtime.lastError) {
                sendResponse({ success: false, error: chrome.runtime.lastError.message });
            } else {
                sendResponse({ success: true, cookies: cookies || [] });
            }
        });
        return true;
    }

    if (request.action === "SCAN_AND_SYNC_GROUPS") {
        console.log("[Background] SCAN_AND_SYNC_GROUPS received from Dashboard");
        scanAndSyncGroups().then(result => sendResponse(result));
        return true;
    }

    return true;
});
