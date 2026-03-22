console.log("[Background] Service Worker v5.0 Fixed");

// 1. Alarm Setup
chrome.runtime.onInstalled.addListener(() => setupAlarm());
chrome.runtime.onStartup.addListener(() => setupAlarm());

function setupAlarm() {
    chrome.alarms.create('jobPoller', { periodInMinutes: 0.1 });
}

// 2. Alarm Listener
chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === 'jobPoller') {
        await checkJobs();
    }
});

const BASE_URL = "https://safepost-backup.onrender.com";

// 3. SSE Connection for Real-Time Dispatch
let sseConnection = null;

function connectSSE() {
    if (sseConnection) sseConnection.close();
    console.log("[Background] Connecting to Server-Sent Events...");
    
    try {
        sseConnection = new EventSource(`${BASE_URL}/api/stream/jobs`);
        
        sseConnection.onmessage = async (event) => {
            const data = JSON.parse(event.data);
            console.log("[Background] Received SSE:", data.type);
            
            if (data.type === 'new_job') {
                if (Date.now() < throttleUntil) {
                    console.log("[Background] Received new_job via SSE but currently throttled. Ignoring.");
                    return;
                }
                const job = data.job;
                const memory = await chrome.storage.local.get(['lastJobId']);
                if (memory.lastJobId === job.id) return;

                console.log("[Background] Dispatching New Job:", job.id);
                await chrome.storage.local.set({ lastJobId: job.id });

                const tab = await chrome.tabs.create({ url: job.group_url, active: true });

                chrome.tabs.onUpdated.addListener(function listener(tabId, info) {
                    if (tabId === tab.id && info.status === 'complete') {
                        chrome.tabs.onUpdated.removeListener(listener);
                        setTimeout(() => {
                            chrome.tabs.sendMessage(tabId, { action: 'EXECUTE_POST', job: job });
                        }, 5000);
                    }
                });
            } else if (data.type === 'sync_groups') {
                // If dashboard requested sync
                console.log("[Background] Server requested groups sync.");
                // We'd need a way to tell the content script to sync.
                // Or just ignore since manual button exists.
            }
        };

        sseConnection.onerror = () => {
            console.warn("[Background] SSE Error. Reconnecting in 5s...");
            sseConnection.close();
            sseConnection = null;
            setTimeout(connectSSE, 5000);
        };
    } catch (err) {
        console.error("[Background] SSE init error:", err);
        setTimeout(connectSSE, 5000);
    }
}

connectSSE();

let nextPollAllowedAt = 0;
let consecutiveFails = 0;
let isThrottled = false;
let throttleUntil = 0;

// Maintain legacy checkJobs just in case, but rely primarily on SSE.
async function checkJobs() {
    if (Date.now() < nextPollAllowedAt || Date.now() < throttleUntil) return;

    try {
        const memory = await chrome.storage.local.get(['lastJobId']);
        const excludeId = memory.lastJobId || '';
        
        const res = await fetch(`${BASE_URL}/api/jobs/next?exclude=${excludeId}`);
        if (!res.ok) throw new Error("Status " + res.status);
        
        consecutiveFails = 0; // Reset backoff on success

        const data = await res.json();
        if (!data || !data.job) return;

        const job = data.job;
        if (memory.lastJobId === job.id) return;

        console.log("[Background] Polled New Job:", job.id);
        await chrome.storage.local.set({ lastJobId: job.id });

        const tab = await chrome.tabs.create({ url: job.group_url, active: true });

        chrome.tabs.onUpdated.addListener(function listener(tabId, info) {
            if (tabId === tab.id && info.status === 'complete') {
                chrome.tabs.onUpdated.removeListener(listener);
                setTimeout(() => {
                    chrome.tabs.sendMessage(tabId, { action: 'EXECUTE_POST', job: job });
                }, 5000);
            }
        });
    } catch (err) {
        // Silent retry with exponential backoff
        consecutiveFails++;
        const backoff = Math.min(60000, 5000 * Math.pow(2, Math.min(consecutiveFails, 6))); // Max 60 seconds
        nextPollAllowedAt = Date.now() + backoff;
    }
}

// 3.5 Heartbeat Logic
async function sendHeartbeat() {
    if (Date.now() < nextPollAllowedAt) return; // Share backoff with job poller

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
            })
        });
        if (!res.ok) throw new Error("Status " + res.status);
        consecutiveFails = 0;
    } catch (e) { 
        // Silent retry with exponential backoff
        consecutiveFails++;
        const backoff = Math.min(60000, 5000 * Math.pow(2, Math.min(consecutiveFails, 6)));
        nextPollAllowedAt = Date.now() + backoff;
    }
}
// Trigger heartbeat on alarm too
chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'jobPoller') sendHeartbeat();
});

// 4. Relay Listener (Nuclear & Robust)
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "SYNC_GROUPS") {
        console.log(`background: Syncing groups to ${BASE_URL}...`);

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
                    console.log("✅ Sync Successful:", data);
                    sendResponse({ success: true, serverData: data });
                } catch (e) {
                    console.error("❌ Sync JSON Error. Response was likely HTML:", rawBody.substring(0, 200));
                    sendResponse({ success: false, error: "Server returned HTML. Ensure Port 3001 is active." });
                }
            })
            .catch(err => {
                console.error("❌ Sync Network Error:", err);
                sendResponse({ success: false, error: err.toString() });
            });

        return true;
    }

    if (request.action === "REPORT_STATUS") {
        console.log(`background: Reporting status to ${BASE_URL}...`);
        
        if (request.payload && (request.payload.status === 'SUCCESS' || request.payload.status === 'COMPLETED')) {
            const delay = Math.floor(Math.random() * (180000 - 120000 + 1)) + 120000; // 2 to 3 minutes in ms
            throttleUntil = Date.now() + delay;
            isThrottled = true;
            console.log(`[Throttling] Worker paused for ${delay / 1000} seconds to mimic human behavior.`);
            setTimeout(() => {
                isThrottled = false;
                console.log("[Throttling] Worker resumed. Ready for next job.");
            }, delay);
        }

        fetch(`${BASE_URL}/api/tasks/update-status`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(request.payload)
        })
            .then(async (res) => {
                const rawBody = await res.text();
                try {
                    const data = JSON.parse(rawBody);
                    if (!res.ok) throw new Error(data.error || `Server Status ${res.status}`);
                    console.log("✅ Status Relay Success:", data);
                    sendResponse({ success: true, serverData: data });
                } catch (e) {
                    // Suppress excessive error logging for JSON parse failures
                    sendResponse({ success: false, error: "Server response error." });
                }
            })
            .catch(err => {
                // Graceful fallback for network disconnects
                sendResponse({ success: false, error: err.toString() });
            });

        return true;
    }
    return true; // Keep channel open for other messages
});

// 5. EXTERNAL DASHBOARD LISTENER (CRITICAL FIX)
chrome.runtime.onMessageExternal.addListener((request, sender, sendResponse) => {
    console.log("[Background] External Message Received:", request);

    if (request.action === "START_AUTOMATION") {
        console.log("[Background] 'START_AUTOMATION' Triggered from Dashboard");

        // 1. Create Facebook Tab
        chrome.tabs.create({ url: "https://www.facebook.com/groups/feed/" }, (tab) => {
            console.log("[Background] Created Tab:", tab.id);

            // 2. Wait for Load
            const listener = (tabId, info) => {
                if (tabId === tab.id && info.status === 'complete') {
                    chrome.tabs.onUpdated.removeListener(listener);
                    console.log("[Background] Tab Loaded. Injecting/Signaling...");

                    // 3. Signal Content Script
                    setTimeout(() => {
                        chrome.tabs.sendMessage(tabId, {
                            action: 'EXECUTE_POST',
                            job: request.postData || { id: 'MANUAL', content: 'Test Post' }
                        }, (res) => {
                            if (chrome.runtime.lastError) console.error("Injection Error:", chrome.runtime.lastError);
                            else console.log("Signal Response:", res);
                        });
                    }, 5000); // 5s Delay to ensure FB Framework loads
                }
            };
            chrome.tabs.onUpdated.addListener(listener);
        });

        sendResponse({ success: true, status: "STARTED" });
    }
    return true;
});
