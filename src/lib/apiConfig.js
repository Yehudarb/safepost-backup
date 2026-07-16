// Central resolver for the backend API base URL.
// Priority: VITE_API_URL env var → known production host → dev fallback.
// Keep this in sync with the resolver in App.jsx (single source of truth for
// non-socket callers such as panels/components).

export const BACKEND_URL = (() => {
    if (import.meta.env.VITE_API_URL) {
        return import.meta.env.VITE_API_URL;
    }
    if (typeof window !== 'undefined' && window.location.hostname === 'safepost-backup.vercel.app') {
        return 'https://safepost-backup.onrender.com';
    }
    // Fallback (production backend) — preserves prior behavior when no env is set.
    return 'https://safepost-backup.onrender.com';
})();

export const API_BASE = `${BACKEND_URL}/api`;
