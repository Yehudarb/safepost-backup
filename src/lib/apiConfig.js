// Central resolver for the backend API base URL.
// Priority: VITE_API_URL env var -> known production host -> local fallback.

export const BACKEND_URL = (() => {
    if (import.meta.env.VITE_API_URL) {
        return import.meta.env.VITE_API_URL.replace(/\/+$/, '');
    }

    if (typeof window === 'undefined') {
        return 'http://localhost:3001';
    }

    const host = window.location.hostname;
    const isLocalHost = ['localhost', '127.0.0.1', '0.0.0.0'].includes(host);
    const isPrivateHost =
        /^10\./.test(host) ||
        /^192\.168\./.test(host) ||
        /^172\.(1[6-9]|2\d|3[01])\./.test(host);

    if (host === 'safepost-backup.vercel.app') {
        return 'https://safepost-backup.onrender.com';
    }
    if (isLocalHost) {
        return 'http://localhost:3001';
    }
    if (isPrivateHost) {
        return `${window.location.protocol}//${host}:3001`;
    }

    return 'https://safepost-backup.onrender.com';
})();

export const API_BASE = `${BACKEND_URL}/api`;
