import React, { useState } from 'react';
import { Shield, Loader2 } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';

// Login / Register / Reset in one screen. Shown when no session exists.
export default function AuthScreen() {
    const { isConfigured, signIn, signUp, resetPassword } = useAuth();
    const [mode, setMode] = useState('login'); // 'login' | 'register' | 'reset'
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [fullName, setFullName] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');

    const friendly = (msg) => {
        if (!msg) return 'Something went wrong. Please try again.';
        if (/invalid login/i.test(msg)) return 'Incorrect email or password.';
        if (/already registered/i.test(msg)) return 'That email is already registered.';
        if (/rate limit/i.test(msg)) return 'Too many attempts — please wait a moment.';
        return msg;
    };

    const submit = async (e) => {
        e.preventDefault();
        setError(''); setNotice(''); setBusy(true);
        try {
            if (mode === 'login') {
                const { error } = await signIn(email, password);
                if (error) throw error;
            } else if (mode === 'register') {
                const { data, error } = await signUp(email, password, fullName);
                if (error) throw error;
                if (!data.session) setNotice('Account created. Check your email to confirm, then sign in.');
            } else {
                const { error } = await resetPassword(email);
                if (error) throw error;
                setNotice('If that email exists, a reset link is on its way.');
            }
        } catch (err) {
            setError(friendly(err.message));
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center bg-[#0d1117] p-4">
            <div className="w-full max-w-sm bg-[#161b22] border border-[#30363d] rounded-2xl p-8 shadow-2xl">
                <div className="flex flex-col items-center mb-6">
                    <div className="p-3 bg-blue-500/10 rounded-xl border border-blue-500/20 mb-3">
                        <Shield className="w-6 h-6 text-blue-400" />
                    </div>
                    <h1 className="text-xl font-bold text-white">SafePost</h1>
                    <p className="text-xs text-gray-500 mt-1">
                        {mode === 'login' && 'Sign in to your workspace'}
                        {mode === 'register' && 'Create your account'}
                        {mode === 'reset' && 'Reset your password'}
                    </p>
                </div>

                {!isConfigured && (
                    <div className="mb-4 text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg p-3">
                        Authentication is not configured. Set <code>VITE_SUPABASE_URL</code> and
                        <code> VITE_SUPABASE_ANON_KEY</code>.
                    </div>
                )}

                <form onSubmit={submit} className="space-y-3">
                    {mode === 'register' && (
                        <input
                            type="text" placeholder="Full name" value={fullName}
                            onChange={e => setFullName(e.target.value)}
                            className="w-full px-3 py-2 text-sm bg-[#0d1117] border border-[#30363d] rounded-lg text-white placeholder-gray-600 focus:border-blue-500 focus:outline-none"
                        />
                    )}
                    <input
                        type="email" required placeholder="Email" value={email}
                        onChange={e => setEmail(e.target.value)} autoComplete="email"
                        className="w-full px-3 py-2 text-sm bg-[#0d1117] border border-[#30363d] rounded-lg text-white placeholder-gray-600 focus:border-blue-500 focus:outline-none"
                    />
                    {mode !== 'reset' && (
                        <input
                            type="password" required placeholder="Password" value={password}
                            onChange={e => setPassword(e.target.value)}
                            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                            className="w-full px-3 py-2 text-sm bg-[#0d1117] border border-[#30363d] rounded-lg text-white placeholder-gray-600 focus:border-blue-500 focus:outline-none"
                        />
                    )}

                    {error && <p className="text-xs text-rose-400">{error}</p>}
                    {notice && <p className="text-xs text-emerald-400">{notice}</p>}

                    <button
                        type="submit" disabled={busy || !isConfigured}
                        className="w-full py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-semibold rounded-lg transition flex items-center justify-center gap-2"
                    >
                        {busy && <Loader2 className="w-4 h-4 animate-spin" />}
                        {mode === 'login' && 'Sign in'}
                        {mode === 'register' && 'Create account'}
                        {mode === 'reset' && 'Send reset link'}
                    </button>
                </form>

                <div className="mt-5 flex flex-col gap-2 text-center text-xs text-gray-500">
                    {mode === 'login' && (
                        <>
                            <button onClick={() => { setMode('reset'); setError(''); setNotice(''); }} className="hover:text-blue-400">Forgot password?</button>
                            <span>No account? <button onClick={() => { setMode('register'); setError(''); setNotice(''); }} className="text-blue-400 hover:underline">Register</button></span>
                        </>
                    )}
                    {mode !== 'login' && (
                        <button onClick={() => { setMode('login'); setError(''); setNotice(''); }} className="hover:text-blue-400">← Back to sign in</button>
                    )}
                </div>
            </div>
        </div>
    );
}
