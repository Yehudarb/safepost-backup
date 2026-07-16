/**
 * ExtensionStorage Helper
 * Provides clean API for chrome.storage.local operations
 * Used in background.js to manage job state and cooldowns
 */

const ExtStorage = {
    /**
     * Get the ID of the last processed job
     * @returns {Promise<string|null>}
     */
    getLastJobId: async () => {
        const result = await chrome.storage.local.get(['lastJobId']);
        return result.lastJobId || null;
    },

    /**
     * Set the ID of the last processed job
     * @param {string} id
     * @returns {Promise<void>}
     */
    setLastJobId: (id) => {
        return chrome.storage.local.set({ lastJobId: id });
    },

    /**
     * Clear the last job ID (allows processing new jobs)
     * @returns {Promise<void>}
     */
    clearLastJobId: () => {
        return chrome.storage.local.remove('lastJobId');
    },

    /**
     * Set cooldown period after posting
     * @param {number} durationMs - cooldown duration in milliseconds
     * @returns {Promise<void>}
     */
    setCooldown: (durationMs) => {
        const now = Date.now();
        return chrome.storage.local.set({
            last_post_timestamp: now,
            cooldown_until: now + durationMs
        });
    },

    /**
     * Get cooldown start timestamp
     * @returns {Promise<number|null>}
     */
    getCooldownTimestamp: async () => {
        const result = await chrome.storage.local.get('last_post_timestamp');
        return result.last_post_timestamp || null;
    },

    /**
     * Clear all stored state (for testing/reset)
     * @returns {Promise<void>}
     */
    clearAll: () => {
        return chrome.storage.local.remove(['lastJobId', 'last_post_timestamp', 'cooldown_until']);
    },

    /**
     * Get the configured API server URL (set via the extension settings popup).
     * Returns null when unset, so callers fall back to the built-in default.
     * @returns {Promise<string|null>}
     */
    getApiUrl: async () => {
        const result = await chrome.storage.local.get('apiUrl');
        return result.apiUrl || null;
    },

    /**
     * Set the API server URL.
     * @param {string} url
     * @returns {Promise<void>}
     */
    setApiUrl: (url) => {
        return chrome.storage.local.set({ apiUrl: url });
    },

    /**
     * Get a stable worker identity, generating and persisting one on first use.
     * @returns {Promise<string>}
     */
    getWorkerId: async () => {
        const result = await chrome.storage.local.get('workerId');
        if (result.workerId) return result.workerId;
        const id = 'worker-' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
        await chrome.storage.local.set({ workerId: id });
        return id;
    }
};
