import React, { useState } from 'react';
import { FlaskConical, RotateCcw, LogOut } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { API_BASE } from '@/lib/apiConfig';
import { getAuthHeaders } from '@/lib/session';

// Visible banner shown whenever the active workspace is a demo workspace.
// "Demo Mode — no real posts will be published".
export default function DemoBanner() {
    const { isDemoWorkspace, signOut } = useAuth();
    const [busy, setBusy] = useState(false);
    const [msg, setMsg] = useState('');

    if (!isDemoWorkspace) return null;

    const reset = async () => {
        setBusy(true); setMsg('');
        try {
            const res = await fetch(`${API_BASE}/demo/reset`, { method: 'POST', headers: await getAuthHeaders() });
            const json = await res.json().catch(() => ({}));
            setMsg(res.ok ? 'Demo data reset.' : (json.error || 'Reset failed.'));
        } catch {
            setMsg('Reset failed.');
        } finally {
            setBusy(false);
            setTimeout(() => setMsg(''), 4000);
        }
    };

    return (
        <div
            role="status"
            className="fixed top-0 inset-x-0 z-[300] flex items-center justify-center gap-3 px-4 py-2 bg-amber-500 text-amber-950 text-sm font-semibold shadow-md"
        >
            <FlaskConical className="w-4 h-4" />
            <span>Demo Mode — no real posts will be published</span>
            {msg && <span className="hidden sm:inline text-amber-900/80 font-normal">· {msg}</span>}
            <div className="ml-2 flex items-center gap-2">
                <button
                    onClick={reset} disabled={busy}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-amber-900/15 hover:bg-amber-900/25 disabled:opacity-50 text-xs font-bold"
                >
                    <RotateCcw className={`w-3 h-3 ${busy ? 'animate-spin' : ''}`} /> Reset demo
                </button>
                <button
                    onClick={() => signOut()}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-amber-900/15 hover:bg-amber-900/25 text-xs font-bold"
                >
                    <LogOut className="w-3 h-3" /> Exit
                </button>
            </div>
        </div>
    );
}
