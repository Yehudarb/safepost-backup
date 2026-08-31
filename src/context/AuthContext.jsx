import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { supabase, isSupabaseConfigured, isAuthRequired, authConfigError } from '@/lib/supabaseClient';
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
            .select('role, workspaces ( id, name, is_personal, is_demo )')
            .eq('user_id', uid);
        if (error) { console.error('[auth] load workspaces failed', error); return; }
        const list = (data || [])
            .filter(r => r.workspaces)
            .map(r => ({ id: r.workspaces.id, name: r.workspaces.name, isPersonal: r.workspaces.is_personal, isDemo: r.workspaces.is_demo === true, role: r.role }));
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

    const demoEmail = import.meta.env.VITE_DEMO_EMAIL;
    const demoPassword = import.meta.env.VITE_DEMO_PASSWORD;
    const demoEnabled = Boolean(demoEmail && demoPassword);
    const isDemoWorkspace = workspaces.some(w => w.id === activeWorkspace && w.isDemo);
    const missingConfigResult = async () => ({ error: new Error(authConfigError || 'Authentication is not configured.') });

    const value = {
        isConfigured: isSupabaseConfigured,
        isAuthRequired,
        authConfigError,
        loading,
        session,
        user: session?.user || null,
        workspaces,
        activeWorkspace,
        selectWorkspace,
        demoEnabled,
        isDemoWorkspace,
        signInDemo: () => supabase ? supabase.auth.signInWithPassword({ email: demoEmail, password: demoPassword }) : missingConfigResult(),
        signIn: (email, password) => supabase ? supabase.auth.signInWithPassword({ email, password }) : missingConfigResult(),
        signUp: (email, password, fullName) =>
            supabase ? supabase.auth.signUp({ email, password, options: { data: { full_name: fullName } } }) : missingConfigResult(),
        signOut: () => supabase ? supabase.auth.signOut() : Promise.resolve(),
        resetPassword: (email) =>
            supabase ? supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin }) : missingConfigResult(),
    };

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
    const ctx = useContext(AuthContext);
    if (!ctx) throw new Error('useAuth must be used within AuthProvider');
    return ctx;
}
