console.log("[SafePost] Background Service Worker Running");

// Listener for Content Script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'SYNC_GROUPS') {
        console.log("[Background] Received Sync Request", message.data.groups.length);

        syncWithServer(message.data.groups)
            .then(res => sendResponse(res))
            .catch(err => sendResponse({ success: false, error: err.message }));

        return true; // Keep channel open for async response
    }

    if (message.action === 'SCAN_GROUPS') {
        // Triggered from Dashboard Bridge if implemented
        sendResponse({ success: true, message: "Scan Command Received" });
        return true;
    }

    if (message.action === 'REPORT_STATUS') {
        console.log("[Background] Status Report:", message.payload);
        sendResponse({ success: true });
        return true;
    }
});

// The Proxy Function
async function syncWithServer(groups) {
    try {
        const response = await fetch('http://localhost:3001/api/groups/sync', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ groups })
        });

        if (!response.ok) {
            throw new Error(`Server Error: ${response.status}`);
        }

        const data = await response.json();

        // Cache successful sync for dashboard hydration
        chrome.storage.local.set({
            cached_groups: groups,
            last_sync: Date.now()
        });

        return { success: true, added: data.added };
    } catch (e) {
        console.error("[Background] Sync Failed", e);
        throw e;
    }
}
