console.log("[Bridge] Zero-Config Bridge Loaded (v3.0.0)");

const inject = () => {
    // 1. Light the Beacon (Signal Injection) with Heartbeat
    if (!document.getElementById('safepost-bridge-signal')) {
        const lighthouse = document.createElement('div');
        lighthouse.id = "safepost-bridge-signal";
        lighthouse.style.display = "none";
        lighthouse.dataset.version = chrome.runtime.getManifest().version;
        lighthouse.dataset.lastPulse = Date.now();
        document.documentElement.appendChild(lighthouse);
        console.log("[Bridge] Lighthouse Signal Injected");

        // Heartbeat Pulse
        setInterval(() => {
            if (document.documentElement.contains(lighthouse)) {
                lighthouse.dataset.lastPulse = Date.now();
            }
        }, 2000);
    }

    // 2. Visual Confirmation (Green Badge)
    if (!document.getElementById('safepost-badge')) {
        const badge = document.createElement('div');
        badge.id = 'safepost-badge';
        badge.innerText = "🔌 EXTENSION READY (v3.0)";
        badge.style.cssText = `
            position: fixed;
            bottom: 20px;
            right: 20px;
            background-color: #10b981;
            color: white;
            padding: 8px 12px;
            border-radius: 6px;
            font-family: sans-serif;
            font-weight: bold;
            font-size: 12px;
            z-index: 2147483647;
            pointer-events: none;
            box-shadow: 0 4px 6px rgba(0,0,0,0.1);
            border: 1px solid rgba(255,255,255,0.3);
        `;
        document.body.appendChild(badge);
    }
};

if (document.body) {
    inject();
} else {
    window.addEventListener('DOMContentLoaded', inject);
}

// 3. Main Communication Hub
// Frontend (React) -> Content Script (Proxy) -> Background
window.addEventListener("SAFEPOST_REQ", async (event) => {
    const { action, payload } = event.detail;
    console.log(`[Bridge Proxy] Received Request: ${action}`);

    try {
        let response = null;

        if (action === "CHECK_CACHE") {
            // DIRECT READ - No Background Trip Needed!
            const data = await chrome.storage.local.get(['fb_session', 'safepost_currentUser', 'safepost_detectedFacebookUser', 'safepost_currentUserId', 'cached_groups']);
            response = {
                success: true,
                user: data.fb_session || data.safepost_currentUser || data.safepost_detectedFacebookUser || null,
                userId: data.safepost_currentUserId || null,
                groups: data.cached_groups || [],
                cached: true
            };
        } else {
            // Forward to Background
            response = await chrome.runtime.sendMessage({ action, ...payload });
        }

        // Send Response Back to Frontend
        window.dispatchEvent(new CustomEvent("SAFEPOST_RES", {
            detail: { action, response }
        }));

    } catch (e) {
        console.error("[Bridge Proxy] Error:", e);
        // Handle "Receiving end does not exist" gracefully
        if (e.message.includes("Receiving end")) {
            console.warn("Background sleeping. Retrying...");
        }

        window.dispatchEvent(new CustomEvent("SAFEPOST_RES", {
            detail: { action, error: e.message, success: false }
        }));
    }
});
