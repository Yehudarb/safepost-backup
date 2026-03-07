
// Bridge Script
// Injected into the Dashboard Website (localhost / production domain)
// Relays messages between the Web UI and the Extension Background

console.log("[FB Suite] Bridge Loaded.");

// 1. Notify Website that Extension is present
window.postMessage({ type: 'EXTENSION_READY', version: '2.1.1' }, '*');

// 2. Listen for commands from Website (Protocol V2)
window.addEventListener('message', async (event) => {
    // Security check: only accept from same window
    if (event.source !== window) return;

    // Filter for our protocol
    if (event.data.target !== 'EXTENSION_BG') return;

    const { action, payload } = event.data;

    console.log(`[Bridge] Forwarding: ${action}`, payload);

    // Forward to Background
    try {
        chrome.runtime.sendMessage({
            action: action,
            payload: payload
        });
    } catch (e) {
        console.error("[Bridge] Failed to send to background:", e);
    }
});

// 3. Listen for Background Events -> Forward to Website (Protocol V2)
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {

    // Convert Background Events to Dashboard Events
    let type = 'EXTENSION_EVENT';
    let data = {};

    // Pass through all events as-is (Protocol V2)
    data = msg;

    // Adapt legacy LOG_UPDATE if needed, but V2 sends objects.
    if (msg.action === 'LOG_UPDATE' && msg.log) {
        data = { action: 'LOG_UPDATE', entry: msg.log };
    }

    window.postMessage({
        target: 'DASHBOARD_APP',
        type: type,
        data: data
    }, '*');
});
