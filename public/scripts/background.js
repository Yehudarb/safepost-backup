console.log("[Background] Service Worker Loaded");

const API_BASE = 'https://safepost-backup.onrender.com';

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
    }
});

// Poll immediately on startup too
setTimeout(checkJobs, 500);

let isScanning = false;
let activeTabId = null;        // Tab currently running a job
let activeJobTimeout = null;   // Safety timeout to prevent infinite stuck state

// If a tab is closed externally (user closed it), release the lock
chrome.tabs.onRemoved.addListener((tabId) => {
    if (tabId === activeTabId) {
        console.log("[Background] Active tab closed externally — releasing job lock");
        activeTabId = null;
        if (activeJobTimeout) { clearTimeout(activeJobTimeout); activeJobTimeout = null; }
    }
});

async function checkJobs() {
    if (isScanning) return;
    if (activeTabId !== null) return; // Job already running — wait for it to finish

    isScanning = true;
    try {
        console.log("[Background] 🔄 Checking for new jobs...");
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

        console.log("[Background] 🔥 New Job Found:", job.id, "Group:", job.group_url);

        const targetUrl = job.group_url || job.url;
        if (!targetUrl) {
            console.error("[Background] ❌ No URL found in job", job);
            return;
        }

        console.log("[Background] 📱 Creating tab with URL:", targetUrl);
        const tab = await chrome.tabs.create({ url: targetUrl, active: true });
        activeTabId = tab.id;
        console.log("[Background] ✅ Tab created, ID:", tab.id);

        // Safety valve: if no REPORT_STATUS within 120s, release the lock
        activeJobTimeout = setTimeout(() => {
            console.warn("[Background] ⚠️ Job timeout — releasing lock for job:", job.id, "Tab:", activeTabId);
            if (activeTabId) {
                console.log("[Background] 🗑️ Closing tab", activeTabId);
                chrome.tabs.remove(activeTabId).catch((err) => {
                    console.error("[Background] Failed to close tab:", err);
                });
                activeTabId = null;
            }
            activeJobTimeout = null;
        }, 120000);

        chrome.tabs.onUpdated.addListener(function listener(tabId, info) {
            if (tabId === tab.id && info.status === 'complete') {
                console.log("[Background] 📄 Tab loaded (status=complete), ID:", tabId);
                chrome.tabs.onUpdated.removeListener(listener);
                console.log("[Background] ⏳ Waiting 4s for page to stabilize before sending EXECUTE_POST...");
                setTimeout(() => {
                    console.log("[Background] 📤 Sending EXECUTE_POST message to tab", tabId, "for job", job.id);
                    try {
                        chrome.tabs.sendMessage(tabId, { action: 'EXECUTE_POST', job: job }, (response) => {
                            if (chrome.runtime.lastError) {
                                console.error("[Background] ❌ sendMessage failed:", chrome.runtime.lastError.message);
                                // Content script not ready — report FAILED and release lock
                                console.log("[Background] 🔴 Reporting FAILED to server...");
                                fetch(`${API_BASE}/api/tasks/update-status`, {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ taskId: job.id, status: 'FAILED', failure_reason: `Content script unavailable: ${chrome.runtime.lastError.message}` })
                                }).catch((err) => {
                                    console.error("[Background] Failed to report to server:", err);
                                });
                                releaseJobLock();
                            } else {
                                console.log("[Background] ✅ sendMessage succeeded, waiting for content script response...");
                            }
                        });
                    } catch (err) {
                        console.error("[Background] ❌ sendMessage threw error:", err.message);
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

// 3. Message Listener — handles reports from content.js
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'REPORT_STATUS') {
        const status = request.payload?.status;
        const taskId = request.payload?.taskId;
        const failureReason = request.payload?.failure_reason;

        console.log(`[Background] 📨 REPORT_STATUS received: Task #${taskId}, Status: ${status}, Reason: ${failureReason || 'N/A'}`);

        // When job finishes (any terminal state), close the tab and release the lock
        if (status === 'SUCCESS' || status === 'FAILED') {
            console.log(`[Background] ✅ Job done (${status}, #${taskId}) — releasing lock`);
            releaseJobLock();
        }

        console.log(`[Background] 🔄 Sending status update to server for task #${taskId}...`);
        fetch(`${API_BASE}/api/tasks/update-status`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(request.payload)
        }).then(res => {
            if (res.ok) {
                console.log(`[Background] ✅ Server received status update for task #${taskId}`);
            } else {
                console.error(`[Background] ❌ Server returned ${res.status} for task #${taskId}`);
            }
        }).catch(err => {
            console.error('[Background] ❌ Status update error:', err);
            // Even if server update fails, still release the lock to avoid deadlock
            if (status === 'SUCCESS' || status === 'FAILED') {
                console.log(`[Background] 🔒 Lock released anyway to prevent deadlock`);
                releaseJobLock();
            }
        });
        return false;
    }

    if (request.action === 'SYNC_GROUPS') {
        fetch(`${API_BASE}/api/groups/sync`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                groups: request.groups,
                facebook_user: request.facebook_user || null
            })
        })
        .then(async (res) => {
            const body = await res.json();
            // Avoid prototype pollution by not spreading user-provided objects
            sendResponse(body.success ? { success: true } : { success: false, error: String(body.error || 'Server error') });
        })
        .catch(err => sendResponse({ success: false, error: err.toString() }));
        return true; // Keep channel open for async response
    }

    return false;
});
