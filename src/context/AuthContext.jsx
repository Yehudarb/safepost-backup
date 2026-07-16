import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { supabase, isSupabaseConfigured } from '@/lib/supabaseClient';
import { setActiveWorkspaceId, getActiveWorkspaceId } from '@/lib/session';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
    const [session, setSession] = useState(null);
    const [loading, setLoading] = useState(true);
    const [workspaces, setWorkspaces] = useState([]);
    const [activeWorkspace, setActiveWorkspace] = useState(getActiveWorkspaceId());

    // Load the memberships the signed-in user belongs to (RLS-scoped).
    const loadWorkspaces = useCallback(async (uid) => {
        if (!supabase || !uid) { setWorkspaces([]); return; }
        const { data, error } = await supabase
            .from('workspace_members')
            .select('role, workspaces ( id, name, is_personal )')
            .eq('user_id', uid);
        if (error) { console.error('[auth] load workspaces failed', error); return; }
        const list = (data || [])
            .filter(r => r.workspaces)
            .map(r => ({ id: r.workspaces.id, name: r.workspaces.name, isPersonal: r.workspaces.is_personal, role: r.role }));
        setWorkspaces(list);
        // Pick a default active workspace if none selected or the stored one is gone.
        const current = getActiveWorkspaceId();
        const stillValid = current && list.some(w => w.id === current);
        const next = stillValid ? current : (list[0]?.id || null);
        setActiveWorkspaceId(next);
        setActiveWorkspace(next);
    }, []);

    useEffect(() => {
        if (!isSupabaseConfigured) { setLoading(false); return; }
        supabase.auth.getSession().then(({ data }) => {
            setSession(data.session);
            if (data.session?.user) loadWorkspaces(data.session.user.id);
            setLoading(false);
        });
        const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
            setSession(s);
            if (s?.user) loadWorkspaces(s.user.id);
            else { setWorkspaces([]); setActiveWorkspaceId(null); setActiveWorkspace(null); }
            // Let the realtime socket re-handshake with the new token.
            if (typeof window !== 'undefined') window.dispatchEvent(new Event('safepost:auth-changed'));
        });
        return () => sub.subscription.unsubscribe();
    }, [loadWorkspaces]);

    const selectWorkspace = useCallback((id) => {
        setActiveWorkspaceId(id);
        setActiveWorkspace(id);
        if (typeof window !== 'undefined') window.dispatchEvent(new Event('safepost:auth-changed'));
    }, []);

    const value = {
        isConfigured: isSupabaseConfigured,
        loading,
        session,
        user: session?.user || null,
        workspaces,
        activeWorkspace,
        selectWorkspace,
        signIn: (email, password) => supabase.auth.signInWithPassword({ email, password }),
        signUp: (email, password, fullName) =>
            supabase.auth.signUp({ email, password, options: { data: { full_name: fullName } } }),
        signOut: () => supabase.auth.signOut(),
        resetPassword: (email) =>
            supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin }),
    };

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
    const ctx = useContext(AuthContext);
    if (!ctx) throw new Error('useAuth must be used within AuthProvider');
    return ctx;
}
