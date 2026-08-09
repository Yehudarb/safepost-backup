// Bridge between the auth layer and the (static, non-React) ApiService.
// Lets ApiService attach the current access token + active workspace to every
// request without importing React context.
import { supabase } from './supabaseClient';

const WORKSPACE_KEY = 'safepost.activeWorkspaceId';

let activeWorkspaceId = (typeof localStorage !== 'undefined' && localStorage.getItem(WORKSPACE_KEY)) || null;

export function getActiveWorkspaceId() {
    return activeWorkspaceId;
}

export function setActiveWorkspaceId(id) {
    activeWorkspaceId = id || null;
    try {
        if (id) localStorage.setItem(WORKSPACE_KEY, id);
        else localStorage.removeItem(WORKSPACE_KEY);
    } catch { /* ignore storage errors */ }
}

// Current access token (or null). Safe to call when auth is unconfigured.
export async function getAccessToken() {
    if (!supabase) return null;
    const { data } = await supabase.auth.getSession();
    return data?.session?.access_token || null;
}

// Auth headers for API requests. Only includes what's available.
export async function getAuthHeaders() {
    const headers = {};
    const token = await getAccessToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;
    if (activeWorkspaceId) headers['x-workspace-id'] = activeWorkspaceId;
    return headers;
}
