console.log("[Background] Service Worker v9.0 — Multi-anchor name extraction (LOCAL DEV)");

// Load extension storage utility
importScripts('extensionStorage.js');

const API_PORT = 3001;
// Default backend URL — production, so a fresh install works with zero setup.
// Overridden at runtime by the value saved in the extension settings popup
// (chrome.storage.local 'apiUrl'), e.g. to http://localhost:3001 for local
// dev. Kept as a mutable `let` so all `${BASE_URL}` call sites pick up the
// configured value without changing their (already async) call signatures.
const DEFAULT_BASE_URL = 'https://safepost-backup.onrender.com';
let BASE_URL = DEFAULT_BASE_URL;

// Boot from the saved API URL when present so the extension stays aligned with
// the dashboard/backend environment currently in use.
(async () => {
    try {
        const saved = await ExtStorage.getApiUrl();
        BASE_URL = saved || DEFAULT_BASE_URL;
        console.log('[Background] Using API URL:', BASE_URL);
    } catch (e) {
        console.warn('[Background] Could not read saved API URL, using default.', e);
    }
})();

// Live-update BASE_URL when the user changes it in the settings popup.
chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.apiUrl) {
        BASE_URL = changes.apiUrl.newValue || DEFAULT_BASE_URL;
        console.log('[Background] API URL updated to:', BASE_URL);
    }
});

// Pairing (Phase 5): when paired, this worker uses workspace-scoped endpoints
// with its device token; when not paired, it falls back to the legacy global
// endpoints so existing installs keep working.
async function getPairing() {
    const { pairedWorkerId, deviceToken } = await chrome.storage.local.get(['pairedWorkerId', 'deviceToken']);
    return (pairedWorkerId && deviceToken) ? { workerId: pairedWorkerId, token: deviceToken } : null;
}
function workerHeaders(p) {
    return { 'x-worker-id': p.workerId, 'x-device-token': p.token };
}

// Attach worker credentials to the LEGACY (non-paired) endpoints too whenever
// this install happens to be paired. The server accepts them there optionally
// today, so this is a no-op for behaviour — but it is what lets the operator
// turn WORKER_AUTH_ENFORCED on later without the extension losing access.
// Returns plain headers when unpaired, exactly as before.
// The shared key set in the settings popup, used when this install is not
// paired. Either credential satisfies the server.
async function getExtensionKey() {
    const { extensionKey } = await chrome.storage.local.get('extensionKey');
    return extensionKey || null;
}

async function authedHeaders(extra = {}) {
    const pairing = await getPairing();
    if (pairing) return { ...extra, ...workerHeaders(pairing) };
    const key = await getExtensionKey();
    return key ? { ...extra, 'x-extension-key': key } : { ...extra };
}

// Same idea for EventSource, which cannot send headers — see the note on
// readWorkerCredentials in server/middleware/worker.cjs.
async function authedStreamUrl(url) {
    const sep = url.includes('?') ? '&' : '?';
    const pairing = await getPairing();
    if (pairing) {
        return `${url}${sep}worker_id=${encodeURIComponent(pairing.workerId)}&device_token=${encodeURIComponent(pairing.token)}`;
    }
    const key = await getExtensionKey();
    return key ? `${url}${sep}extension_key=${encodeURIComponent(key)}` : url;
}

async function persistFacebookUser(facebook_user, facebook_user_id = null) {
    const clean = typeof facebook_user === 'string' ? facebook_user.trim() : '';
    const cleanId = typeof facebook_user_id === 'string' ? facebook_user_id.trim() : '';
    if (!clean) return null;
    try {
        // Don't blindly null out a previously known account id when this particular
        // caller didn't have one to give us — that stale-but-still-correct id is what
        // detectCurrentFacebookUser() later uses to validate a cached name belongs to
        // the account that's ACTUALLY active, so wiping it defeats that safety check.
        const existing = cleanId ? null : await chrome.storage.local.get('safepost_currentUserId');
        const finalId = cleanId || existing?.safepost_currentUserId || null;
        await chrome.storage.local.set({
            fb_session: clean,
            safepost_currentUser: clean,
            safepost_detectedFacebookUser: clean,
            safepost_currentUserId: finalId
        });
    } catch (e) {
        console.warn('[Background] Failed to persist facebook user:', e);
    }
    return { facebook_user: clean, facebook_user_id: cleanId || null };
}

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

// 2. Alarm Listener — the single handler for 'jobPoller'.
// There used to be a second onAlarm listener further down this file that also
// ran sendHeartbeat(), so every tick fired two concurrent heartbeats. Keep all
// tick work here so it stays visible in one place.
chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === 'jobPoller') {
        console.log(`[Background] Alarm fired at ${new Date().toLocaleTimeString()}`);
        checkJobs();
        sendHeartbeat();
        checkWatchdog();
    }
});

// 0. Auto-Reload Watchdog
let lastServerContact = Date.now();
const WATCHDOG_LIMIT = 120000; // 2 Minutes

function recordContact() {
    lastServerContact = Date.now();
}

// The watchdog used to call chrome.runtime.reload() here. That was harmful:
//
//   • Reloading the extension cannot make an unreachable server reachable, so
//     with the backend down it looped — reload, poll, fail, reload — every 2min.
//   • The reload tears down the service worker while checkJobs()/sendHeartbeat()
//     still have promises in flight. Chrome rejects those with "No SW", which is
//     exactly the `Poll Error: No SW` / `Heartbeat failed: No SW` noise.
//   • Worse, it invalidates the context of content scripts already injected into
//     open Facebook tabs. A post being published at that moment is orphaned
//     mid-flow and never reports SUCCESS/FAILED, leaving the task stuck until the
//     server's handshake timeout sweeps it.
//
// What actually goes stale is the SSE stream, so reconnect that instead. It is
// cheap, safe while a job is running, and fixes the real failure mode.
function checkWatchdog() {
    if (Date.now() - lastServerContact <= WATCHDOG_LIMIT) return;
    console.warn(`[Watchdog] No contact from server for ${WATCHDOG_LIMIT / 1000}s. Reconnecting SSE (not reloading).`);
    // Give the next window a full grace period so we reconnect at most once per
    // WATCHDOG_LIMIT rather than on every alarm tick while the server is down.
    lastServerContact = Date.now();
    // connectSSE is async (it reads the pairing from storage), so failures
    // surface as a rejected promise rather than a synchronous throw.
    Promise.resolve(connectSSE()).catch(e => console.warn('[Watchdog] SSE reconnect failed:', e?.message || e));
}

// SSE Real-Time Listener
let sseSource = null;

async function connectSSE() {
    if (sseSource) { sseSource.close(); sseSource = null; }
    try {
        sseSource = new EventSource(await authedStreamUrl(`${BASE_URL}/api/stream/jobs`));
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

        // Paired workers claim ONLY their own workspace's jobs; unpaired workers
        // use the legacy global endpoint. Both return { job } (or { job: null }).
        const pairing = await getPairing();
        const res = pairing
            ? await fetch(`${BASE_URL}/api/workers/${pairing.workerId}/jobs/claim`, { method: 'POST', headers: workerHeaders(pairing) })
            : await fetch(`${BASE_URL}/api/jobs/next`);
        // Any HTTP response proves the server is reachable — record contact before
        // checking res.ok. Gating this on res.ok meant a 429 (we rate-limit at
        // 500/min) or a transient 500 counted as "server dead", which drove the
        // watchdog. With a reload on the other end that was self-reinforcing:
        // rate-limited → reload → immediate poll on startup → rate-limited again.
        recordContact();
        if (!res.ok) return;
        const data = await res.json();
        if (!data || !data.job) return;

        const job = data.job;
        const lastJobId = await ExtStorage.getLastJobId();
        if (lastJobId === job.id) {
            // If we've seen this job before but it's STILL being returned as 'SENT',
            // it means we picked it up but couldn't move it to 'PROCESSING' or it's stuck.
            // We'll clear the lastJobId to allow one retry, or let the server heartbeat handle it.
            console.warn("[Background] Job already seen but still SENT. Clearing lastJobId to allow retry/bypass:", job.id);
            await ExtStorage.clearLastJobId();
            return;
        }

        console.log("[Background] New Job:", job.id);
        await ExtStorage.setLastJobId(job.id);

        try {
            const tab = await chrome.tabs.create({ url: job.group_url, active: true });
            
            // Safety: If tab doesn't finish loading in 60s, cleanup
            const loadTimeout = setTimeout(() => {
                chrome.tabs.onUpdated.removeListener(listener);
                console.error("[Background] Tab load TIMEOUT for job:", job.id);
                ExtStorage.clearLastJobId(); // Allow retry since we failed
            }, 60000);

            function listener(tabId, info) {
                if (tabId === tab.id && info.status === 'complete') {
                    clearTimeout(loadTimeout);
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
                        (async () => {
                            await ExtStorage.setCooldown(cooldownSeconds * 1000);
                            console.log(`[SAFETY] Cooldown active for ${cooldownSeconds}s`);
                        })();
                    }, 5000);
                }
            }
            chrome.tabs.onUpdated.addListener(listener);

        } catch (tabErr) {
            console.error("[Background] Tab Creation Failed:", tabErr);
            await ExtStorage.clearLastJobId(); // Allow retry
        }

    } catch (err) {
        console.error("Poll Error:", err);
    } finally {
        isScanning = false;
    }
}

// Safety Cooldown Check (3-Minute Delay)
async function checkSafetyCooldown() {
    const last_post_timestamp = await ExtStorage.getCooldownTimestamp();
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
        console.log(`[BG] Received ${request.action} for tab ${sender.tab?.id}`);

        (async () => {
            if (request.action === 'JOB_COMPLETE') {
                try {
                    const res = await fetch(`${BASE_URL}/api/tasks/${missionId}/status`, {
                        method: 'PATCH',
                        headers: await authedHeaders({ 'Content-Type': 'application/json' }),
                        body: JSON.stringify({ status: 'SUCCESS', completed_at: new Date().toISOString() })
                    });
                    if (!res.ok) console.error('[BG] DB Update Failed:', res.status);
                } catch (err) { console.error("[BG] Sync Network Error:", err); }
            }

            // Close tab with better error handling and logging
            if (request.action === 'CLOSE_TAB' && sender.tab && sender.tab.id) {
                try {
                    console.log(`[BG] 🔴 Closing tab ${sender.tab.id}...`);
                    await chrome.tabs.remove(sender.tab.id);
                    console.log(`[BG] ✅ Tab ${sender.tab.id} closed successfully`);
                } catch (err) {
                    console.error(`[BG] Failed to close tab ${sender.tab.id}:`, err.message);
                }
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
                    headers: await authedHeaders({ 'Content-Type': 'application/json' }),
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
        persistFacebookUser(request.facebook_user || null, request.facebook_user_id || null);
        // async IIFE: authedHeaders reads the pairing from storage, but this
        // listener must stay sync so the `return true` below still keeps the
        // sendResponse channel open (MV3 closes it if the listener returns a
        // promise instead).
        (async () => {
            try {
                const res = await fetch(`${BASE_URL}/api/groups/sync`, {
                    method: 'POST',
                    headers: await authedHeaders({ 'Content-Type': 'application/json' }),
                    body: JSON.stringify({
                        groups: request.groups,
                        facebook_user: request.facebook_user || null,
                        facebook_user_id: request.facebook_user_id || null
                    })
                });
                const rawBody = await res.text();
                try {
                    const data = JSON.parse(rawBody);
                    if (!res.ok) throw new Error(data.error || `Server Status ${res.status}`);
                    sendResponse({ success: true, serverData: data });
                } catch {
                    sendResponse({ success: false, error: "Server Error (HTML/Invalid JSON)" });
                }
            } catch (err) {
                sendResponse({ success: false, error: err.toString() });
            }
        })();
        return true;
    }

    if (request.action === 'SET_FACEBOOK_USER' || request.action === 'SYNC_FACEBOOK_USER') {
        console.log('[Background] Received message:', request.action, 'with facebook_user:', request.facebook_user, 'and facebook_user_id:', request.facebook_user_id);
        persistFacebookUser(request.facebook_user || null, request.facebook_user_id || null)
            .then(async (profile) => {
                console.log('[Background] persistFacebookUser returned:', profile);
                if (profile?.facebook_user) {
                    console.log('[Background] Sending POST /api/profile/sync with profile:', profile);
                    await fetch(`${BASE_URL}/api/profile/sync`, {
                        method: 'POST',
                        headers: await authedHeaders({ 'Content-Type': 'application/json' }),
                        body: JSON.stringify({
                            facebook_user: profile.facebook_user,
                            facebook_user_id: profile.facebook_user_id,
                            source: 'extension_background',
                            detected_at: new Date().toISOString()
                        })
                    }).then(r => {
                        console.log('[Background] /api/profile/sync response status:', r.status);
                        return r.json();
                    }).catch((err) => {
                        console.warn('[Background] /api/profile/sync error:', err.message);
                    });
                } else {
                    console.warn('[Background] User is null, skipping sync');
                }
                sendResponse({ success: true, ...(profile || {}), facebook_user: profile?.facebook_user || null, facebook_user_id: profile?.facebook_user_id || null });
            })
            .catch((err) => {
                console.error('[Background] Error in SET_FACEBOOK_USER handler:', err);
                sendResponse({ success: false, error: err.toString() });
            });
        return true;
    }

    if (request.action === "REPORT_STATUS") {
        // async IIFE for the same reason as SYNC_GROUPS above.
        (async () => {
            try {
                await fetch(`${BASE_URL}/api/tasks/${request.payload.taskId}/status`, {
                    method: 'PATCH',
                    headers: await authedHeaders({ 'Content-Type': 'application/json' }),
                    body: JSON.stringify(request.payload)
                });
            } catch (err) {
                console.error("Status Network Error:", err);
            } finally {
                sendResponse({ ok: true });
            }
        })();
        return true;
    }

    // (A "GET_COOKIES" handler used to live here, returning every facebook.com
    // cookie — session cookies included — to the caller. Nothing called it, so
    // it was pure attack surface, and it contradicted the rule that Facebook
    // credentials never leave the browser. Removed, along with the "cookies"
    // manifest permission it required.)

    return false;
});

// Guard against overlapping scans: SSE reconnects / repeated triggers must never open
// a second scrape tab while one is already running.
let isGroupScanning = false;

// Heartbeat Logic
// Ask content.js (which runs on facebook.com) to tell us the current user.
// This is more reliable than detecting in a newly-opened tab, since content.js
// has already seen the page and can access stored data.
async function getFacebookUserFromContent() {
    try {
        const tabs = await chrome.tabs.query({ url: 'https://www.facebook.com/*' });
        if (!tabs.length) return { name: null, id: null };

        return new Promise((resolve) => {
            chrome.tabs.sendMessage(tabs[0].id, { action: 'GET_FACEBOOK_USER' }, (response) => {
                if (chrome.runtime.lastError) {
                    console.warn('[Background] Failed to get user from content:', chrome.runtime.lastError.message);
                    resolve({ name: null, id: null });
                } else {
                    resolve({ name: response?.facebook_user || null, id: response?.facebook_user_id || null });
                }
            });
        });
    } catch (e) {
        console.warn('[Background] Error querying FB user from content:', e.message);
        return { name: null, id: null };
    }
}

async function scanAndSyncGroups() {
    if (isGroupScanning) {
        console.warn("[Background] scanAndSyncGroups skipped — a scan is already running");
        return { success: false, error: "already-running" };
    }
    isGroupScanning = true;
    console.log("[Background] scanAndSyncGroups v9.0 (multi-anchor + upgrade) via www.facebook.com/groups/joins/");

    // Get the current user from content.js BEFORE opening the new tab
    const fbProfileFromContent = await getFacebookUserFromContent();
    console.log('[Background] FB user from content.js:', fbProfileFromContent.name || '(none)');

    const reportFail = async (error) => fetch(`${BASE_URL}/api/groups/sync-failed`, {
        method: 'POST', headers: await authedHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ error })
    }).catch(() => {});

    return new Promise((resolve) => {
        let tabId = null;
        let done = false;
        const finish = (r) => { if (!done) { done = true; isGroupScanning = false; resolve(r); } };

        const timeout = setTimeout(() => {
            if (tabId) chrome.tabs.remove(tabId).catch(() => {});
            reportFail("Timed out after 6 minutes");
            finish({ success: false, error: "Timed out after 6 minutes" });
        }, 360000);

        // active:true so the user can watch the live status panel during the scrape.
        chrome.tabs.create({ url: "https://www.facebook.com/groups/joins/?nav_source=tab", active: true }, (tab) => {
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
                            args: [fbProfileFromContent],
                            func: (fbProfileFromContent) => new Promise(resolveAll => {
                                // Store the user from content.js so it's available during detection
                                window.__fbUserFromContent = fbProfileFromContent?.name || null;
                                window.__fbUserIdFromContent = fbProfileFromContent?.id || null;
                                // --- Live status panel, rendered inside this tab so the user sees
                                // the scrape working: running count, scroll progress, elapsed time. ---
                                const panel = (() => {
                                    const style = document.createElement('style');
                                    style.textContent = '@keyframes sps-spin{to{transform:rotate(360deg)}}@keyframes sps-fade{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}';
                                    (document.head || document.documentElement).appendChild(style);
                                    const el = document.createElement('div');
                                    el.id = 'safepost-scan-panel';
                                    el.dir = 'rtl';
                                    el.style.cssText = 'position:fixed;bottom:20px;right:20px;z-index:2147483647;width:280px;background:#fff;color:#0b1c30;border:1px solid #e5e7eb;border-radius:16px;box-shadow:0 12px 34px rgba(0,0,0,.22);font-family:Segoe UI,Arial,sans-serif;overflow:hidden;animation:sps-fade .2s ease-out;';
                                    el.innerHTML = '<div style="background:linear-gradient(135deg,#007bff,#0056d6);color:#fff;padding:12px 14px;display:flex;align-items:center;gap:10px;"><div id="sps-spin" style="width:18px;height:18px;border:2.5px solid rgba(255,255,255,.4);border-top-color:#fff;border-radius:50%;animation:sps-spin .8s linear infinite;flex:0 0 auto;"></div><div style="font-weight:700;font-size:13px;">SafePost — סנכרון קבוצות</div></div><div style="padding:14px;"><div style="display:flex;align-items:baseline;gap:6px;margin-bottom:8px;"><span id="sps-count" style="font-size:30px;font-weight:800;color:#007bff;line-height:1;font-variant-numeric:tabular-nums;">0</span><span style="font-size:12px;color:#6b7280;">קבוצות נמצאו</span></div><div id="sps-status" style="font-size:12px;color:#374151;margin-bottom:11px;">גולל וטוען קבוצות...</div><div style="height:6px;background:#eef1fe;border-radius:99px;overflow:hidden;margin-bottom:11px;"><div id="sps-bar" style="height:100%;width:12%;background:#007bff;border-radius:99px;transition:width .3s ease;"></div></div><div style="display:flex;justify-content:space-between;font-size:11px;color:#6b7280;"><span>זמן שחלף</span><span id="sps-timer" style="font-variant-numeric:tabular-nums;font-weight:600;">00:00</span></div></div>';
                                    (document.body || document.documentElement).appendChild(el);
                                    const t0 = Date.now();
                                    const fmt = (ms) => { const s = Math.floor(ms / 1000); return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); };
                                    const q = (id) => el.querySelector(id);
                                    const timer = setInterval(() => { const t = q('#sps-timer'); if (t) t.textContent = fmt(Date.now() - t0); }, 500);
                                    return {
                                        update(count, pct, target) {
                                            q('#sps-count').textContent = count;
                                            if (typeof pct === 'number') {
                                                q('#sps-bar').style.width = Math.max(8, Math.min(96, pct)) + '%';
                                                q('#sps-status').textContent = target
                                                    ? ('נאספו ' + count + ' מתוך ' + target + ' (' + Math.round(pct) + '%)')
                                                    : ('גולל וטוען קבוצות... ' + Math.round(pct) + '%');
                                            }
                                        },
                                        finish(count, ok, target) {
                                            clearInterval(timer);
                                            q('#sps-spin').style.animation = 'none';
                                            const bar = q('#sps-bar'); bar.style.width = '100%'; bar.style.background = ok ? '#10b981' : '#ef4444';
                                            q('#sps-count').style.color = ok ? '#10b981' : '#ef4444';
                                            q('#sps-status').innerHTML = ok
                                                ? '<span style="color:#10b981;font-weight:700;">✓ הסתיים — ' + count + (target ? ' / ' + target : '') + ' קבוצות נשלחו</span>'
                                                : '<span style="color:#ef4444;font-weight:700;">✕ לא נמצאו קבוצות</span>';
                                        }
                                    };
                                })();

                                const skipIds = new Set(['feed', 'discover', 'joins', 'bookmarks',
                                    'create', 'memberof', 'work', 'updates', 'you', 'events',
                                    'nearby', 'search', 'requests', 'invited', 'suggested']);
                                const seen = new Set();
                                const groups = [];

                                // Robust name extractor — filters out pure numeric strings.
                                // FB frequently renders the group anchor as JUST the avatar with the
                                // real name in a SIBLING element of the same card, so if nothing valid
                                // is found inside the anchor itself we walk out to the enclosing card
                                // (role=listitem / article / li) and search there too.
                                const getName = (el) => {
                                    const isValid = (s) => s && s.length > 1 && !/^\d+$/.test(s)
                                        && !s.includes('·') && !/^\d+[KkMm]/.test(s);
                                    const first = (raw) => (raw || '').trim().split('\n')[0].trim();

                                    // 1. aria-label on the anchor.
                                    const aria = el.getAttribute('aria-label');
                                    if (isValid(aria)) return aria.trim();

                                    // 2. Text inside spans/strongs of the anchor.
                                    for (const c of el.querySelectorAll('span, strong')) {
                                        const t = first(c.textContent);
                                        if (isValid(t)) return t;
                                    }

                                    // 3. img alt (often set to the group name).
                                    const alt = el.querySelector('img')?.alt?.trim();
                                    if (isValid(alt)) return alt;

                                    // 4. Direct anchor text.
                                    const anchorText = first(el.textContent);
                                    if (isValid(anchorText)) return anchorText;

                                    // 5. Widen the search to the enclosing card and beyond. FB's group
                                    //    row isn't always a role=listitem — it can be a plain <div> — so
                                    //    instead of assuming a specific ancestor tag we walk up a bounded
                                    //    number of parents and try each level.
                                    let node = el.parentElement;
                                    for (let depth = 0; depth < 6 && node; depth++, node = node.parentElement) {
                                        const nodeAria = node.getAttribute?.('aria-label');
                                        if (isValid(nodeAria)) return nodeAria.trim();

                                        // Prefer directional-text spans and headings — that's how FB
                                        // renders user-generated names (Hebrew group titles, etc).
                                        const priority = node.querySelectorAll?.(
                                            'span[dir="auto"], strong, h2, h3, [role="heading"]'
                                        ) || [];
                                        for (const c of priority) {
                                            const t = first(c.textContent);
                                            if (isValid(t)) return t;
                                        }
                                    }

                                    return '';
                                };

                                // Human-readable fallback derived from a vanity slug URL like
                                // "/groups/roxascity.gadgets.marketplace/" → "Roxascity Gadgets Marketplace".
                                // Numeric ids (e.g. "691184237672539") have no readable name to derive from,
                                // so we return '' and let the caller show a placeholder for those.
                                const nameFromSlug = (gid) => {
                                    if (!gid || /^\d+$/.test(gid)) return '';
                                    return gid
                                        .replace(/[._-]+/g, ' ')
                                        .replace(/\s+/g, ' ')
                                        .trim()
                                        .split(' ')
                                        .map(w => w.charAt(0).toUpperCase() + w.slice(1))
                                        .join(' ');
                                };

                                // Collapse the same group appearing under different ids (a card links
                                // to the group both by numeric id and by vanity slug) by also deduping
                                // on the normalized group name.
                                const seenNames = new Set();
                                const norm = (s) => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();

                                // A membership row never offers "Join"; a Suggested/Discover card does.
                                // Kept as a secondary signal, but the primary defense against runaway
                                // growth is the position-based cutoff below.
                                const isSuggestionCard = (el) => {
                                    const card = el.closest('[role="listitem"], [role="article"], li') || el.parentElement;
                                    if (!card) return false;
                                    const t = norm(card.textContent);
                                    return /\bjoin\b/.test(t) || t.includes('הצטרף') || t.includes('הצטרפי') ||
                                           t.includes('הצטרפות') || t.includes('מוצע') || t.includes('suggested');
                                };

                                // THE REAL FIX: after your actual joined groups, Facebook keeps loading an
                                // effectively endless "Suggested groups" feed as you scroll — that's why the
                                // count grows by a steady batch (~20) forever instead of stopping. A per-card
                                // "Join" button check is unreliable (wording varies), so instead we find the
                                // section heading that marks where suggestions begin and treat its vertical
                                // position as a hard ceiling: nothing at or below it is ever counted, no
                                // matter how many more scroll ticks happen.
                                const SUGGESTION_HEADING_RE = /(suggested|discover more|more groups|groups you may like|קבוצות מומלצות|קבוצות מוצעות|מוצע לך|גלה קבוצות|קבוצות נוספות|אולי יעניין אותך)/i;
                                let suggestionCutoffY = Infinity;

                                // AUTHORITATIVE TARGET: Facebook prints the real joined-groups count in
                                // the page heading, e.g. "כל הקבוצות שהצטרפת אליהן (512)" /
                                // "Groups you've joined (512)". We scroll until we've collected that many
                                // real groups, then stop — this is far more reliable than guessing where
                                // the endless "suggested groups" feed begins.
                                let targetCount = 0;
                                const JOINED_PHRASE_RE = /(שהצטרפת אליה[ןם]|קבוצות שהצטרפת|groups you'?ve joined|joined groups|your groups|all groups you)/i;
                                const PAREN_NUM_RE = /\((\d[\d,]{0,5})\)/;
                                const readTargetCount = () => {
                                    if (targetCount) return targetCount;
                                    // Facebook often splits the heading text ("...שהצטרפת אליהן") and the
                                    // count ("(512)") into SEPARATE spans, so a single-element regex misses
                                    // it. Strategy: (1) try single element; (2) find the element holding the
                                    // "joined" phrase and look for "(N)" in it or its parent chain.
                                    const nodes = document.querySelectorAll('h1, h2, h3, h4, [role="heading"], span, div, a');
                                    // Pass 1 — phrase + "(N)" inside the same element's text.
                                    for (const n of nodes) {
                                        const t = (n.textContent || '').trim();
                                        if (!t || t.length > 160) continue;
                                        if (JOINED_PHRASE_RE.test(t)) {
                                            const m = t.match(PAREN_NUM_RE);
                                            if (m) { targetCount = parseInt(m[1].replace(/,/g, ''), 10); return targetCount; }
                                        }
                                    }
                                    // Pass 2 — phrase and "(N)" in separate spans: locate the phrase element,
                                    // then walk up to 3 ancestors and scan their combined text for "(N)".
                                    for (const n of nodes) {
                                        const t = (n.textContent || '').trim();
                                        if (!t || t.length > 60) continue;
                                        if (!JOINED_PHRASE_RE.test(t)) continue;
                                        let p = n;
                                        for (let depth = 0; depth < 4 && p; depth++) {
                                            const pt = (p.textContent || '');
                                            if (pt.length < 200) {
                                                const m = pt.match(PAREN_NUM_RE);
                                                if (m) {
                                                    const val = parseInt(m[1].replace(/,/g, ''), 10);
                                                    if (val > 0 && val < 100000) { targetCount = val; return targetCount; }
                                                }
                                            }
                                            p = p.parentElement;
                                        }
                                    }
                                    return targetCount;
                                };
                                readTargetCount();
                                const refreshSuggestionCutoff = () => {
                                    if (suggestionCutoffY !== Infinity) return; // already locked in
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
                                    // When we know the real count from the heading, the count-based stop
                                    // handles suggestions — never let the fragile heading heuristic drop
                                    // a legitimate joined group.
                                    if (targetCount > 0) return false;
                                    if (suggestionCutoffY === Infinity) return false;
                                    const rect = el.getBoundingClientRect();
                                    return (rect.top + window.scrollY) >= suggestionCutoffY;
                                };

                                // The user's joined groups live in the main column — scope there to drop
                                // the left-nav shortcuts and any right-rail suggestions, but fall back to
                                // the whole document if the list isn't inside <main>.
                                // Diagnostic counters — logged once at the end so we can see EXACTLY
                                // which filter stage is over/under-matching instead of guessing.
                                const stats = { rawLinks: 0, rootMatch: 0, skipped: 0, dupeId: 0, noName: 0, dupeName: 0, suggestion: 0, belowCutoff: 0, kept: 0 };

                                const extract = () => {
                                    refreshSuggestionCutoff();
                                    const main = document.querySelector('[role="main"]');
                                    let links = main ? main.querySelectorAll('a[href*="/groups/"]') : null;
                                    if (!links || !links.length) links = document.querySelectorAll('a[href*="/groups/"]');
                                    stats.rawLinks = Math.max(stats.rawLinks, links.length);

                                    // BUCKET anchors by group id. FB renders each membership row with
                                    // multiple links pointing at the same /groups/{id}/: the avatar link
                                    // (image only, no visible text) AND the title link (name text). If we
                                    // process anchors linearly and add gid to `seen` on first sight, the
                                    // avatar wins and we never try the title anchor — every group ends up
                                    // with a placeholder name. Bucketing lets us try ALL anchors per id.
                                    const anchorsById = new Map();
                                    links.forEach(el => {
                                        const url = (el.href || '').split('?')[0];
                                        const match = url.match(/facebook\.com\/groups\/([a-zA-Z0-9._-]+)\/?$/);
                                        if (!match) return;
                                        stats.rootMatch++;
                                        const gid = match[1];
                                        if (skipIds.has(gid.toLowerCase())) { stats.skipped++; return; }
                                        if (isBelowCutoff(el)) { stats.belowCutoff++; return; }
                                        if (!anchorsById.has(gid)) anchorsById.set(gid, { url, anchors: [] });
                                        anchorsById.get(gid).anchors.push(el);
                                    });

                                    for (const [gid, { url, anchors }] of anchorsById) {
                                        // Try every anchor for this group; the title link wins over the
                                        // avatar link because it actually contains readable text.
                                        let name = '';
                                        for (const el of anchors) {
                                            const n = getName(el);
                                            if (n) { name = n; break; }
                                        }
                                        const finalUrl = url.endsWith('/') ? url : url + '/';

                                        if (seen.has(gid)) {
                                            // Row already exists — if we now have a REAL name but the
                                            // stored one is still a placeholder, upgrade it in-place so
                                            // later scroll ticks can rescue an initially-bad extraction.
                                            if (name) {
                                                const existing = groups.find(g => g.id === gid);
                                                if (existing && /^קבוצה /.test(existing.name)) existing.name = name;
                                            }
                                            stats.dupeId++;
                                            continue;
                                        }

                                        // When there is NO reliable heading count we still need the
                                        // defensive filters to avoid runaway growth on the endless
                                        // "suggested groups" feed. With a target count they only cause
                                        // under-counting, so we drop them.
                                        if (targetCount === 0) {
                                            const nkey = norm(name);
                                            if (name && seenNames.has(nkey)) { stats.dupeName++; continue; }
                                            if (anchors.every(el => isSuggestionCard(el))) { stats.suggestion++; continue; }
                                        }

                                        // Keep the row even when the name couldn't be read — a valid
                                        // /groups/{id}/ root link is a real membership. Prefer a slug-
                                        // derived name over a naked id placeholder.
                                        if (!name) {
                                            name = nameFromSlug(gid) || ('קבוצה ' + gid);
                                            stats.noName++;
                                        }

                                        seen.add(gid);
                                        const nkey = norm(name);
                                        if (nkey) seenNames.add(nkey);
                                        stats.kept++;
                                        groups.push({ id: gid, name, url: finalUrl });
                                    }
                                };

                                // Safety net: the heading-based cutoff is a heuristic and can misfire (wrong
                                // heading matched, or the real list happens to sit below it in an unexpected
                                // layout). If it ever excludes EVERY real group despite links being present,
                                // that's worse than under-filtering — disable it for the rest of this run and
                                // re-extract, so a bad heuristic never zeroes out legitimate results.
                                const extractWithSafety = () => {
                                    extract();
                                    if (suggestionCutoffY !== Infinity && stats.kept === 0 && stats.rootMatch > 0 && stats.belowCutoff > 0) {
                                        console.warn('[SafePost] suggestion cutoff excluded ALL groups — disabling it for this run and re-extracting', stats);
                                        suggestionCutoffY = Infinity;
                                        extract();
                                    }
                                };

                                // INCREMENTAL scroll: Facebook's joined-groups list is virtualized — rows
                                // above the viewport are unmounted from the DOM as you scroll. Jumping
                                // straight to the bottom skips the middle rows before we ever read them.
                                // Instead we step down by ~60% of the viewport (40% overlap), extracting
                                // after every step so each row is captured while it's still mounted.
                                const MAX = 500, WAIT = 550;
                                const step = () => Math.max(400, Math.floor(window.innerHeight * 0.6));
                                let scrolls = 0, lastCount = 0, stable = 0, atBottomStreak = 0;
                                const scrollPct = () => {
                                    const h = document.body.scrollHeight || 1;
                                    return Math.min(96, ((window.scrollY + window.innerHeight) / h) * 100);
                                };
                                const tick = () => {
                                    const s = step();
                                    window.scrollBy(0, s);
                                    document.querySelectorAll('[role="main"],[role="feed"],[role="navigation"]')
                                        .forEach(el => { try { el.scrollTop += s; } catch {} });
                                    scrolls++;
                                    setTimeout(() => {
                                        extractWithSafety();
                                        readTargetCount(); // heading may render late — keep trying to read it
                                        const cur = groups.length;
                                        const pct = targetCount > 0 ? (cur / targetCount) * 100 : scrollPct();
                                        panel.update(cur, pct, targetCount || 0);
                                        if (cur === lastCount) { stable++; } else { stable = 0; }
                                        lastCount = cur;

                                        // Physically at the very bottom right now?
                                        const atBottom = (window.innerHeight + window.scrollY) >= (document.body.scrollHeight - 6);
                                        if (atBottom) { atBottomStreak++; } else { atBottomStreak = 0; }

                                        // PRIMARY stop: collected every real joined group the heading advertised.
                                        const reachedTarget = targetCount > 0 && cur >= targetCount;

                                        // A few groups may be unnamed/filtered → plateau just short of target.
                                        const nearTargetStalled = targetCount > 0 && cur >= targetCount * 0.9 && stable >= 16;

                                        // No count in heading: only stop once we're truly at the bottom AND the
                                        // list stopped growing for several ticks (so lazy-load can't be mid-batch).
                                        const noTargetDone = targetCount === 0 && atBottomStreak >= 5 && stable >= 8;
                                        const wellPastCutoff = targetCount === 0 && suggestionCutoffY !== Infinity &&
                                            (window.scrollY + window.innerHeight) > suggestionCutoffY + 900;

                                        if (reachedTarget || nearTargetStalled || noTargetDone || wellPastCutoff || scrolls >= MAX) {
                                            panel.finish(cur, cur > 0, targetCount || 0);
                                            console.log('%c[SafePost DEBUG] group count breakdown', 'color:#007bff;font-weight:bold', { ...stats, targetCount, collected: cur, scrolls });
                                            console.log('[SafePost DEBUG] final group names:', groups.map(g => g.name));
                                            // Keep the finished panel visible briefly before the tab closes.
                                            // Return both groups AND the FB user they belong to
                                            setTimeout(() => resolveAll({ groups, facebook_user, facebook_user_id }), 2200);
                                            return;
                                        }
                                        tick();
                                    }, WAIT);
                                };
                                // Detect the currently logged-in Facebook user so groups are tagged correctly.
                                // Prefer the user detected by content.js (already on facebook.com), but fall back
                                // to detecting from the script if needed (in case content.js failed to reach us).
                                const detectFBUserInTab = () => {
                                    const m = document.cookie.match(/(?:^|;\s*)c_user=(\d+)/);
                                    const userId = m ? m[1] : null;

                                    const scripts = Array.from(document.querySelectorAll('script'));
                                    for (const s of scripts) {
                                        const t = s.textContent;
                                        if (!t || !t.includes('CurrentUserInitialData')) continue;
                                        const idx = t.indexOf('CurrentUserInitialData');
                                        const slice = t.slice(idx, idx + 3000);

                                        if (userId) {
                                            const idMatch = slice.match(/"USER_ID"\s*:\s*"(\d+)"/);
                                            if (idMatch && idMatch[1] !== userId) continue;
                                        }

                                        const nameMatch = slice.match(/"NAME"\s*:\s*"([^"]+)"/);
                                        if (nameMatch && nameMatch[1]) return { name: nameMatch[1], id: userId };
                                    }
                                    return null;
                                };
                                // Use the user from content.js if available (passed via window.__fbUserFromContent);
                                // otherwise detect it fresh in this tab.
                                const detectedInTab = detectFBUserInTab();
                                const facebook_user = window.__fbUserFromContent || detectedInTab?.name || null;
                                const facebook_user_id = window.__fbUserIdFromContent || detectedInTab?.id || null;
                                console.log('[SafePost] Final FB user for sync:', facebook_user || '(none)');

                                extractWithSafety(); // grab what's already loaded
                                panel.update(groups.length, 5);
                                tick();
                            })
                        });

                        chrome.tabs.remove(tabId).catch(() => {});
                        const result = results?.[0]?.result || {};
                        const groups = result.groups || [];
                        const facebook_user = result.facebook_user || null;
                        const facebook_user_id = result.facebook_user_id || null;
                        console.log(`[Background] joins scan: found ${groups.length} groups (user: ${facebook_user || 'none'})`);

                        if (groups.length === 0) {
                            clearTimeout(timeout);
                            reportFail("No groups found on /groups/joins/");
                            finish({ success: false, error: "No groups found." });
                            return;
                        }

                        const syncRes = await fetch(`${BASE_URL}/api/groups/sync`, {
                            method: 'POST',
                            headers: await authedHeaders({ 'Content-Type': 'application/json' }),
                            body: JSON.stringify({ groups, facebook_user, facebook_user_id })
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
        // Paired workers report presence via their workspace-scoped worker
        // endpoint (device token); unpaired workers use the legacy heartbeat.
        const pairing = await getPairing();
        const res = pairing
            ? await fetch(`${BASE_URL}/api/workers/${pairing.workerId}/heartbeat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...workerHeaders(pairing) },
                body: JSON.stringify({
                    status: 'online',
                    extension_version: manifest.version,
                    browser_version: (navigator.userAgent.match(/Chrome\/[\d.]+/) || ['Chrome'])[0],
                }),
                mode: 'cors'
            })
            : await fetch(`${BASE_URL}/api/worker/heartbeat`, {
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
        // As in checkJobs: a response of any status means the server answered.
        recordContact();
        if (res.ok) {
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

// (heartbeat + watchdog now run in the single 'jobPoller' listener near the top)

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

    // A second "GET_COOKIES" handler used to live here. This listener is
    // onMessageExternal, so it was reachable from any page in the manifest's
    // externally_connectable list — meaning a web page could ask the extension
    // for the user's full Facebook session cookies. Nothing ever called it.
    // Removed; see the matching note in the onMessage listener above.

    if (request.action === "SCAN_AND_SYNC_GROUPS") {
        console.log("[Background] SCAN_AND_SYNC_GROUPS received from Dashboard");
        scanAndSyncGroups().then(result => sendResponse(result));
        return true;
    }

    return false;
});
