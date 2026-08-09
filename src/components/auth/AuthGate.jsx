import React from 'react';
import { Loader2 } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import AuthScreen from './AuthScreen';

// Gates the app behind authentication — but ONLY when auth is configured.
// If VITE_SUPABASE_* env vars are absent, the app renders as before (open),
// so deploying without configuring auth cannot lock users out. Enabling auth
// is an explicit act of setting the env vars.
export default function AuthGate({ children }) {
    const { isConfigured, loading, session } = useAuth();

    if (!isConfigured) return children;         // auth disabled → preserve open behavior

    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-[#0d1117]">
                <Loader2 className="w-6 h-6 text-blue-400 animate-spin" />
            </div>
        );
    }

    if (!session) return <AuthScreen />;

    return children;
}
