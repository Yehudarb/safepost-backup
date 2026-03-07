export const BridgeService = {
    listeners: [],
    isExtension: !!(window.chrome && chrome.runtime && chrome.runtime.id),

    initialized: false,

    init() {
        if (this.initialized) return;
        this.initialized = true;

        if (this.isExtension) {
            // Extension Mode: Listen to Runtime Messages
            chrome.runtime.onMessage.addListener((msg) => {
                // Background sends actions like QUEUE_UPDATE directly
                // We wrap them as EXTENSION_EVENT to match App.jsx expectation
                this.notifyListeners('EXTENSION_EVENT', msg);
            });
        } else {
            // Web Mode: Listen to Window Messages (via bridge.js)
            window.addEventListener('message', (event) => {
                if (event.source !== window) return;
                const { target, type, data } = event.data;
                if (target === 'DASHBOARD_APP') {
                    this.notifyListeners(type, data);
                }
            });
        }

        // Handshake / Initial Fetch
        setTimeout(() => {
            this.sendMessage('GET_STATUS');
        }, 500);
    },

    sendMessage(action, payload = null) {
        if (this.isExtension) {
            // Extension Mode: Send directly to Background
            try {
                chrome.runtime.sendMessage({ action, payload });
            } catch (e) {
                console.error("Extension send failed:", e);
            }
        } else {
            // Web Mode: Send to bridge.js
            window.postMessage({
                target: 'EXTENSION_BG',
                action,
                payload
            }, '*');
        }
    },

    onMessage(callback) {
        this.listeners.push(callback);
        return () => {
            this.listeners = this.listeners.filter(l => l !== callback);
        };
    },

    notifyListeners(type, data) {
        this.listeners.forEach(cb => cb(type, data));
    }
};
