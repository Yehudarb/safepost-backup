import React, { useState, useEffect, useCallback } from 'react';
import { MonitorSmartphone, RefreshCw, Trash2, Ban, KeyRound, X, Copy, Check, Pencil } from 'lucide-react';

const REL = (ts) => {
    if (!ts) return 'never';
    const s = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
    if (s < 60) return `${s}s ago`;
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    return `${Math.floor(s / 86400)}d ago`;
};

const StatusPill = ({ status, revoked }) => {
    const map = revoked
        ? { c: 'text-rose-400 bg-rose-500/10 border-rose-500/20', t: 'Revoked' }
        : status === 'online' ? { c: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20', t: 'Online' }
        : status === 'busy' ? { c: 'text-amber-400 bg-amber-500/10 border-amber-500/20', t: 'Busy' }
        : { c: 'text-gray-400 bg-gray-500/10 border-gray-500/20', t: 'Offline' };
    return <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-bold uppercase tracking-wider ${map.c}`}>
        <span className="w-1.5 h-1.5 rounded-full bg-current" />{map.t}
    </span>;
};

// Extension pairing / worker management. `api` is the ApiService class.
export default function WorkersPanel({ api, onClose }) {
    const [workers, setWorkers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [code, setCode] = useState(null);     // { code, expires_at }
    const [copied, setCopied] = useState(false);
    const [err, setErr] = useState('');
    const [now, setNow] = useState(Date.now());

    const load = useCallback(async () => {
        setLoading(true); setErr('');
        try { const r = await api.getWorkers(); setWorkers(r.workers || []); }
        catch (e) { setErr(e.message); }
        finally { setLoading(false); }
    }, [api]);

    useEffect(() => { load(); }, [load]);
    useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);

    const genCode = async () => {
        setErr(''); setCopied(false);
        try { setCode(await api.createPairingCode()); }
        catch (e) { setErr(e.message); }
    };
    const copyCode = async () => { try { await navigator.clipboard.writeText(code.code); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch {} };
    const act = async (fn) => { try { await fn(); load(); } catch (e) { setErr(e.message); } };
    const rename = async (w) => {
        const name = prompt('Worker name:', w.worker_name);
        if (name && name.trim()) act(() => api.renameWorker(w.id, name.trim()));
    };

    const codeSecondsLeft = code ? Math.max(0, Math.round((new Date(code.expires_at).getTime() - now) / 1000)) : 0;

    return (
        <div className="fixed inset-0 z-[150] bg-black/80 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-300">
            <div className="bg-[#161b22] border border-[#30363d] w-full max-w-3xl max-h-[90vh] rounded-2xl shadow-2xl flex flex-col overflow-hidden">
                {/* header */}
                <div className="p-6 border-b border-[#30363d] flex justify-between items-center bg-[#1c2128]">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-blue-500/10 rounded-lg border border-blue-500/20">
                            <MonitorSmartphone className="w-5 h-5 text-blue-400" />
                        </div>
                        <div>
                            <h2 className="text-xl font-bold text-white">Paired Devices</h2>
                            <p className="text-[10px] text-gray-500 uppercase tracking-widest font-black">Chrome extensions linked to this workspace</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <button onClick={load} className="p-2 rounded-full hover:bg-[#21262d] text-gray-400 hover:text-white transition-colors" title="Refresh">
                            <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
                        </button>
                        <button onClick={onClose} aria-label="Close" className="p-2 rounded-full hover:bg-[#21262d] text-gray-400 hover:text-white transition-colors">
                            <X className="w-5 h-5" />
                        </button>
                    </div>
                </div>

                <div className="p-6 overflow-y-auto bg-[#0d1117] space-y-5">
                    {/* pairing code generator */}
                    <div className="bg-[#161b22] border border-[#30363d] rounded-xl p-4">
                        <div className="flex items-center justify-between gap-3">
                            <div className="flex items-center gap-2 text-sm text-gray-300 font-semibold">
                                <KeyRound className="w-4 h-4 text-blue-400" /> Pair a new device
                            </div>
                            <button onClick={genCode} className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold rounded-lg transition">
                                Generate pairing code
                            </button>
                        </div>
                        {code && (
                            <div className="mt-3 flex items-center gap-3">
                                <code className="px-4 py-2 rounded-lg bg-[#0d1117] border border-blue-500/30 text-2xl font-mono font-black tracking-[0.3em] text-blue-300">{code.code}</code>
                                <button onClick={copyCode} className="p-2 rounded-lg bg-[#21262d] hover:bg-[#30363d] text-gray-300" title="Copy">
                                    {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                                </button>
                                <span className={`text-xs ${codeSecondsLeft > 0 ? 'text-gray-400' : 'text-rose-400'}`}>
                                    {codeSecondsLeft > 0 ? `expires in ${Math.floor(codeSecondsLeft / 60)}:${String(codeSecondsLeft % 60).padStart(2, '0')}` : 'expired'}
                                </span>
                            </div>
                        )}
                        <p className="mt-2 text-[11px] text-gray-500">Enter this code in the extension popup → “Pair with SafePost”. Single-use, expires in 10 minutes.</p>
                    </div>

                    {err && <p className="text-xs text-rose-400">{err}</p>}

                    {/* worker list */}
                    {loading ? (
                        <p className="text-sm text-gray-500 text-center py-8">Loading…</p>
                    ) : workers.length === 0 ? (
                        <div className="text-center py-10 text-gray-500">
                            <MonitorSmartphone className="w-10 h-10 mx-auto opacity-30 mb-3" />
                            <p className="text-sm">No paired devices yet.</p>
                            <p className="text-xs mt-1">Generate a code above and enter it in your Chrome extension.</p>
                        </div>
                    ) : (
                        <div className="space-y-2">
                            {workers.map((w) => (
                                <div key={w.id} className={`flex items-center justify-between p-3 rounded-xl border ${w.revoked_at ? 'border-rose-500/20 bg-rose-500/5 opacity-70' : 'border-[#30363d] bg-[#161b22]'}`}>
                                    <div className="min-w-0">
                                        <div className="flex items-center gap-2">
                                            <span className="text-sm font-bold text-white truncate">{w.worker_name}</span>
                                            <StatusPill status={w.status} revoked={!!w.revoked_at} />
                                        </div>
                                        <div className="text-[11px] text-gray-500 mt-0.5">
                                            Last seen {REL(w.last_seen_at)}
                                            {w.extension_version ? ` · ext ${w.extension_version}` : ''}
                                            {w.browser_version ? ` · ${w.browser_version}` : ''}
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-1 shrink-0">
                                        <button onClick={() => rename(w)} className="p-2 rounded-lg text-gray-400 hover:text-white hover:bg-[#21262d]" title="Rename"><Pencil className="w-4 h-4" /></button>
                                        {!w.revoked_at && (
                                            <button onClick={() => act(() => api.revokeWorker(w.id))} className="p-2 rounded-lg text-amber-400 hover:bg-amber-500/10" title="Revoke access"><Ban className="w-4 h-4" /></button>
                                        )}
                                        <button onClick={() => act(() => api.removeWorker(w.id))} className="p-2 rounded-lg text-rose-400 hover:bg-rose-500/10" title="Remove"><Trash2 className="w-4 h-4" /></button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
