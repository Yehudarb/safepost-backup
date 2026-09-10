// Central resolver for the backend API base URL.
// Deployed builds must be explicit. This prevents a QA build with a missing
// variable from silently falling through to the production backend.

export const BACKEND_URL = (() => {
    if (import.meta.env.VITE_API_URL) {
        return import.meta.env.VITE_API_URL.replace(/\/+$/, '');
    }

    const host = typeof window === 'undefined' ? 'localhost' : window.location.hostname;
    const isLocalHost = ['localhost', '127.0.0.1', '0.0.0.0'].includes(host);
    const isPrivateHost =
        /^10\./.test(host) ||
        /^192\.168\./.test(host) ||
        /^172\.(1[6-9]|2\d|3[01])\./.test(host);

    if (isLocalHost) {
        return 'http://localhost:3001';
    }
    if (isPrivateHost) {
        return `${window.location.protocol}//${host}:3001`;
    }

    throw new Error('VITE_API_URL is required for deployed SafePost builds.');
})();

export const API_BASE = `${BACKEND_URL}/api`;
