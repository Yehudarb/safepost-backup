console.log("[Background] Service Worker Loaded");

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
async function checkJobs() {
    if (isScanning) return;
    isScanning = true;
    try {
        const res = await fetch('http://localhost:3001/api/jobs/next');
        if (!res.ok) return;

        const data = await res.json();
        const job = data.job || (data.id ? data : null);
        if (!job) return;

        console.log("[Background] 🔥 New Job Found:", job.id);

        const targetUrl = job.group_url || job.url;
        if (!targetUrl) {
            console.error("No URL found in job", job);
            return;
        }

        const tab = await chrome.tabs.create({ url: targetUrl, active: true });

        chrome.tabs.onUpdated.addListener(function listener(tabId, info) {
            if (tabId === tab.id && info.status === 'complete') {
                chrome.tabs.onUpdated.removeListener(listener);
                setTimeout(() => {
                    chrome.tabs.sendMessage(tabId, { action: 'EXECUTE_POST', job: job });
                }, 4000); // Wait for page to stabilize
            }
        });

    } catch (err) {
        console.error("Poll Error:", err);
    } finally {
        isScanning = false;
    }
}

// 3. Message Listener — handles reports from content.js
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'REPORT_STATUS') {
        fetch('http://localhost:3001/api/tasks/update-status', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(request.payload)
        }).catch(err => console.error('[BG] Status update error:', err));
        return false; // Fire and forget
    }

    if (request.action === 'SYNC_GROUPS') {
        fetch('http://localhost:3001/api/groups/sync', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ groups: request.groups })
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
