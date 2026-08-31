import React from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import AuthScreen from './AuthScreen';

export default function AuthGate({ children }) {
    const { isConfigured, isAuthRequired, authConfigError, loading, session } = useAuth();

    if (authConfigError) {
        return (
            <main className="min-h-screen flex items-center justify-center bg-[#0d1117] p-4">
                <div className="w-full max-w-md bg-[#161b22] border border-rose-500/30 rounded-2xl p-8 shadow-2xl text-center">
                    <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl border border-rose-500/30 bg-rose-500/10">
                        <AlertTriangle className="h-6 w-6 text-rose-400" />
                    </div>
                    <h1 className="text-xl font-bold text-white">Authentication Configuration Required</h1>
                    <p className="mt-3 text-sm leading-6 text-gray-300">{authConfigError}</p>
                </div>
            </main>
        );
    }

    if (!isConfigured && !isAuthRequired) return children;

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
