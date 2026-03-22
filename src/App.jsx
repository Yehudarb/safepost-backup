import React, { useState, useEffect, useCallback } from 'react';
import {
    Layers, Calendar as CalendarIcon, Shield, CheckCircle,
    AlertTriangle, RefreshCw, Send, CheckSquare, Square, XCircle,
    Edit3, Trash2, Save, X, Sun, Moon, Paperclip, Clock,
    FolderPlus, Folder, Search, Ban, Zap, StopCircle,
    Sparkles, Info, Smile, Scissors, AlignLeft, Languages, Hash, Megaphone,
    GripVertical
} from 'lucide-react';
import { Calendar } from '@/components/ui/calendar-bento';
import { io } from 'socket.io-client';
import TaskTimer from '@/components/TaskTimer';

const BACKEND_URL = import.meta.env.DEV
    ? "http://localhost:3001"
    : "https://safepost-backup.onrender.com";
const API_BASE = `${BACKEND_URL}/api`;
const socket = io(BACKEND_URL);

// --- API SERVICE LAYER ---
class ApiService {
    static async request(endpoint, options = {}) {
        const url = `${API_BASE}${endpoint}`;
        const headers = { 'Content-Type': 'application/json', ...options.headers };
        try {
            const res = await fetch(url, { ...options, headers });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.error || `HTTP ${res.status}`);
            }
            return await res.json();
        } catch (error) {
            console.error(`API Error [${endpoint}]:`, error);
            throw error;
        }
    }

    static getGroups()                       { return this.request('/groups'); }
    static getQueue()                        { return this.request('/queue'); }
    static getSystemStatus()                 { return this.request('/system/status'); }
    static getGroupSets()                    { return this.request('/group-sets'); }
    static createPosts(data)                 { return this.request('/posts', { method: 'POST', body: JSON.stringify(data) }); }
    static deleteTask(id)                    { return this.request(`/tasks/${id}`, { method: 'DELETE' }); }
    static bulkDelete(ids)                   { return this.request('/tasks/bulk-delete', { method: 'POST', body: JSON.stringify({ ids }) }); }
    static updateTask(id, data)              { return this.request(`/tasks/${id}`, { method: 'PATCH', body: JSON.stringify(data) }); }
    static cancelTask(id)                    { return this.request(`/tasks/${id}/cancel`, { method: 'POST' }); }
    static cancelAllPending()                { return this.request('/tasks/cancel-all-pending', { method: 'POST' }); }
    static stopWorker()                      { return this.request('/worker/stop', { method: 'POST' }); }
    static resumeWorker()                    { return this.request('/worker/resume', { method: 'POST' }); }
    static saveGroupSet(name, group_ids)     { return this.request('/group-sets', { method: 'POST', body: JSON.stringify({ name, group_ids }) }); }
    static deleteGroupSet(id)               { return this.request(`/group-sets/${id}`, { method: 'DELETE' }); }
    static getTemplates()                   { return this.request('/templates'); }
    static saveTemplate(data)               { return this.request('/templates', { method: 'POST', body: JSON.stringify(data) }); }
    static deleteTemplate(id)               { return this.request(`/templates/${id}`, { method: 'DELETE' }); }
    static async uploadFile(file) {
        const formData = new FormData();
        formData.append('file', file);
        const res = await fetch(`${API_BASE}/upload`, { method: 'POST', body: formData });
        if (!res.ok) throw new Error(`Upload Failed: ${res.status}`);
        return await res.json();
    }
    static generateAiContent(prompt, history = []) { return this.request('/ai/generate', { method: 'POST', body: JSON.stringify({ prompt, history }) }); }
    static getAnalytics()                           { return this.request('/analytics'); }
}

// ---------------------------------------------------------------------------
// COUNTDOWN TIMER
// ---------------------------------------------------------------------------
function CountdownTimer({ queue, fetchAllData }) {
    const [timeLeft, setTimeLeft] = useState(null);
    const [activeTask, setActiveTask] = useState(null);

    useEffect(() => {
        const current = queue.find(q => ['SENT', 'PROCESSING'].includes(q.status));
        const nextPending = [...queue]
            .filter(q => q.status === 'PENDING')
            .sort((a, b) => new Date(a.scheduled_time) - new Date(b.scheduled_time))[0];

        setActiveTask(current || nextPending || null);
    }, [queue]);

    useEffect(() => {
        if (!activeTask || ['SENT', 'PROCESSING', 'SUCCESS', 'FAILED'].includes(activeTask.status)) {
            setTimeLeft(null);
            return;
        }

        let iv;
        const tick = () => {
            const diff = new Date(activeTask.scheduled_time) - new Date();
            setTimeLeft(Math.max(0, diff));
            if (diff <= 0) {
                clearInterval(iv);
                fetchAllData(true);
            }
        };

        tick();
        iv = setInterval(tick, 1000);
        return () => clearInterval(iv);
    }, [activeTask, fetchAllData]);

    if (!activeTask) return null;

    if (activeTask.status === 'SENT') {
        return (
            <div className="flex items-center gap-2 px-3 py-1.5 bg-sky-500/10 border border-sky-500/30 text-sky-400 rounded-lg animate-pulse">
                <RefreshCw size={14} className="animate-spin" />
                <span className="text-[10px] font-black uppercase tracking-widest">Handshake with Worker...</span>
            </div>
        );
    }

    if (activeTask.status === 'PROCESSING') {
        return (
            <div className="flex items-center gap-2 px-3 py-1.5 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 rounded-lg">
                <div className="w-2 h-2 bg-emerald-500 rounded-full animate-ping" />
                <span className="text-[10px] font-black uppercase tracking-widest">Publishing Now</span>
            </div>
        );
    }

    if (timeLeft === null) return null;

    const s = Math.floor(timeLeft / 1000);
    const mm = String(Math.floor(s / 60)).padStart(2, '0');
    const ss = String(s % 60).padStart(2, '0');

    return (
        <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border font-mono font-bold transition-all shadow-lg ${
            s < 30 ? 'bg-rose-500/20 border-rose-500/40 text-rose-400 animate-pulse' : 'bg-indigo-500/10 border-indigo-500/30 text-indigo-400'
        }`}>
            <Clock size={14} />
            <span className="text-[10px] opacity-70 uppercase font-black">Next Post</span>
            <span className="text-sm tracking-tighter">{mm}:{ss}</span>
        </div>
    );
}

// ---------------------------------------------------------------------------
// SAVE FOLDER MODAL
// ---------------------------------------------------------------------------
function SaveFolderModal({ selectedGroups, groups, onSave, onClose }) {
    const [name, setName] = useState('');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

    const submit = async () => {
        if (!name.trim()) return;
        setSaving(true);
        setError('');
        try {
            await onSave(name.trim());
        } catch (e) {
            setError(e.message || 'Save failed');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[200] flex items-center justify-center p-4">
            <div className="bg-white dark:bg-[#161b22] border border-gray-200 dark:border-[#30363d] w-full max-w-sm rounded-xl shadow-2xl overflow-hidden">
                <div className="p-4 border-b border-gray-200 dark:border-[#30363d] flex justify-between items-center bg-gray-50 dark:bg-[#1c2128]">
                    <h2 className="text-gray-900 dark:text-white font-bold text-sm flex items-center gap-2">
                        <FolderPlus size={16} className="text-blue-400" /> Save as Folder
                    </h2>
                    <button onClick={onClose} aria-label="סגור" className="text-gray-400 hover:text-gray-900 dark:hover:text-white transition"><X size={18} /></button>
                </div>
                <div className="p-4 space-y-4">
                    <div>
                        <label className="text-xs font-bold text-gray-500 uppercase tracking-widest block mb-1.5">Folder Name</label>
                        <input autoFocus
                            className="w-full bg-gray-50 dark:bg-[#0d1117] border border-gray-200 dark:border-[#30363d] rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 outline-none"
                            placeholder='e.g. "Real Estate Groups"'
                            value={name} onChange={e => setName(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && submit()} />
                    </div>
                    <div className="bg-gray-50 dark:bg-[#0d1117] border border-gray-200 dark:border-[#30363d] rounded-lg p-3">
                        <p className="text-xs text-gray-500 uppercase tracking-widest mb-2">Saving {selectedGroups.length} groups</p>
                        <div className="space-y-1 max-h-32 overflow-y-auto">
                            {selectedGroups.slice(0, 8).map(id => {
                                const g = groups.find(x => x.id === id);
                                return g ? <div key={id} className="text-xs text-gray-400 truncate" dir="rtl">{g.name}</div> : null;
                            })}
                            {selectedGroups.length > 8 && <div className="text-[10px] text-gray-600">+{selectedGroups.length - 8} more…</div>}
                        </div>
                    </div>
                </div>
                {error && (
                    <div className="px-4 pb-3 text-xs text-red-400 bg-red-900/20 border-t border-red-900/40 py-2">
                        ❌ {error}
                    </div>
                )}
                <div className="p-4 bg-gray-50 dark:bg-[#0d1117] flex justify-end gap-2 border-t border-gray-200 dark:border-[#30363d]">
                    <button onClick={onClose} className="px-4 py-2 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white font-semibold transition rounded-lg hover:bg-gray-100 dark:hover:bg-[#21262d]">Cancel</button>
                    <button onClick={submit} disabled={!name.trim() || saving}
                        className="px-5 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-200 dark:disabled:bg-[#21262d] disabled:text-gray-400 dark:disabled:text-gray-600 text-white rounded-lg text-xs font-bold uppercase tracking-widest transition flex items-center gap-2">
                        {saving ? <RefreshCw size={12} className="animate-spin" /> : <Save size={12} />} Save Folder
                    </button>
                </div>
            </div>
        </div>
    );
}

// ---------------------------------------------------------------------------
// STOP WORKER CONFIRMATION MODAL
// ---------------------------------------------------------------------------
function StopWorkerModal({ onConfirm, onClose, workerActive }) {
    return (
        <div className="fixed inset-0 bg-black/85 backdrop-blur-sm z-[200] flex items-center justify-center p-4">
            <div className="bg-white dark:bg-[#161b22] border border-red-900/50 w-full max-w-md rounded-xl shadow-2xl overflow-hidden">
                <div className="p-4 border-b border-red-900/40 bg-red-900/20 flex items-center gap-3">
                    <StopCircle size={20} className="text-red-400 shrink-0" />
                    <div>
                        <h2 className="text-gray-900 dark:text-white font-bold text-sm">Send Stop Signal</h2>
                        <p className="text-[10px] text-red-400 mt-0.5">Worker will halt after current operation</p>
                    </div>
                </div>
                <div className="p-5 space-y-3">
                    <div className="bg-gray-50 dark:bg-[#0d1117] border border-gray-200 dark:border-[#30363d] rounded-lg p-3 text-xs text-gray-400 space-y-2">
                        <p>• The extension will <span className="text-gray-900 dark:text-white font-bold">not pick up new jobs</span> for 10 minutes</p>
                        <p>• Any task <span className="text-yellow-400 font-bold">currently PROCESSING</span> will still complete</p>
                        <p>• Use <span className="text-green-400 font-bold">"Resume Worker"</span> to restore normal operation</p>
                        <p>• To stop immediately — also <span className="text-orange-400 font-bold">Cancel All Pending</span> tasks</p>
                    </div>
                    {workerActive && (
                        <div className="flex items-center gap-2 px-3 py-2 bg-yellow-900/20 border-yellow-800/40 rounded-lg">
                            <AlertTriangle size={12} className="text-yellow-400 shrink-0" />
                            <span className="text-xs text-yellow-400">Worker is currently ACTIVE — a post may be mid-execution</span>
                        </div>
                    )}
                </div>
                <div className="p-4 flex justify-end gap-2 border-t border-gray-200 dark:border-[#30363d] bg-gray-50 dark:bg-[#0d1117]">
                    <button onClick={onClose} className="px-4 py-2 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white font-semibold transition rounded-lg hover:bg-gray-100 dark:hover:bg-[#21262d]">Cancel</button>
                    <button onClick={onConfirm}
                        className="px-5 py-2 bg-red-700 hover:bg-red-600 text-white rounded-lg text-xs font-bold uppercase tracking-widest transition flex items-center gap-2">
                        <StopCircle size={12} /> Send Stop Signal
                    </button>
                </div>
            </div>
        </div>
    );
}

// ---------------------------------------------------------------------------
// SAVE POST TEMPLATE MODAL
// ---------------------------------------------------------------------------
function SavePostTemplateModal({ content, mediaUrl, onSave, onClose }) {
    const [name, setName] = useState('');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

    const submit = async () => {
        if (!name.trim()) return;
        setSaving(true);
        setError('');
        try {
            await onSave(name.trim(), content, mediaUrl);
        } catch (e) {
            setError(e.message || 'Save failed');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[200] flex items-center justify-center p-4">
            <div className="bg-white dark:bg-[#161b22] border border-gray-200 dark:border-[#30363d] w-full max-w-sm rounded-xl shadow-2xl overflow-hidden">
                <div className="p-4 border-b border-gray-200 dark:border-[#30363d] flex justify-between items-center bg-gray-50 dark:bg-[#1c2128]">
                    <h2 className="text-gray-900 dark:text-white font-bold text-sm flex items-center gap-2">
                        <Save size={16} className="text-amber-400" /> Save as Template
                    </h2>
                    <button onClick={onClose} aria-label="סגור" className="text-gray-400 hover:text-gray-900 dark:hover:text-white transition"><X size={18} /></button>
                </div>
                <div className="p-4 space-y-4">
                    <div>
                        <label className="text-xs font-bold text-gray-500 uppercase tracking-widest block mb-1.5">Template Name</label>
                        <input autoFocus
                            className="w-full bg-gray-50 dark:bg-[#0d1117] border border-gray-200 dark:border-[#30363d] rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-white focus:ring-2 focus:ring-amber-500 focus:ring-offset-1 outline-none"
                            placeholder='e.g. "Apartment for Rent"'
                            value={name} onChange={e => setName(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && submit()} />
                    </div>
                </div>
                {error && (
                    <div className="px-4 pb-3 text-xs text-red-400 bg-red-900/20 border-t border-red-900/40 py-2">
                        ❌ {error}
                    </div>
                )}
                <div className="p-4 bg-gray-50 dark:bg-[#0d1117] flex justify-end gap-2 border-t border-gray-200 dark:border-[#30363d]">
                    <button onClick={onClose} className="px-4 py-2 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white font-semibold transition rounded-lg hover:bg-gray-100 dark:hover:bg-[#21262d]">Cancel</button>
                    <button onClick={submit} disabled={!name.trim() || saving}
                        className="px-5 py-2 bg-amber-600 hover:bg-amber-500 disabled:bg-gray-200 dark:disabled:bg-[#21262d] disabled:text-gray-400 dark:disabled:text-gray-600 text-white rounded-lg text-xs font-bold uppercase tracking-widest transition flex items-center gap-2">
                        {saving ? <RefreshCw size={12} className="animate-spin" /> : <Save size={12} />} Save Template
                    </button>
                </div>
            </div>
        </div>
    );
}

// ---------------------------------------------------------------------------
// AI POST ASSISTANT MODAL
// ---------------------------------------------------------------------------
function AiPostAssistantModal({ onInsert, onClose }) {
    const [input, setInput] = useState('');
    const [messages, setMessages] = useState([]);
    const [generating, setGenerating] = useState(false);
    const chatEndRef = React.useRef(null);
    const inputRef = React.useRef(null);

    React.useEffect(() => {
        chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    const sendMessage = async () => {
        if (!input.trim() || generating) return;
        const userMsg = input.trim();
        setInput('');
        setMessages(prev => [...prev, { role: 'user', text: userMsg }]);
        setGenerating(true);
        try {
            const history = messages.map(m => ({ role: m.role, content: m.text }));
            const result = await ApiService.generateAiContent(userMsg, history);
            if (result.success && result.text) {
                setMessages(prev => [...prev, { role: 'ai', text: result.text }]);
            } else {
                setMessages(prev => [...prev, { role: 'error', text: result.message || 'שגיאה, נסה שנית.' }]);
            }
        } catch (e) {
            setMessages(prev => [...prev, { role: 'error', text: 'שגיאת רשת, נסה שנית.' }]);
        } finally {
            setGenerating(false);
            setTimeout(() => inputRef.current?.focus(), 50);
        }
    };

    return (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[200] flex items-center justify-center p-4">
            <div className="bg-white dark:bg-[#161b22] border border-gray-200 dark:border-[#30363d] w-full max-w-xl rounded-xl shadow-2xl flex flex-col" style={{ height: '600px' }}>

                {/* Header */}
                <div className="p-4 border-b border-gray-200 dark:border-[#30363d] flex justify-between items-center bg-gray-50 dark:bg-[#1c2128] shrink-0">
                    <h2 className="text-gray-900 dark:text-white font-bold text-sm flex items-center gap-2">
                        <Sparkles size={16} className="text-purple-400" /> AI Content Generator
                    </h2>
                    <button onClick={onClose} aria-label="סגור" className="text-gray-400 hover:text-gray-900 dark:hover:text-white transition"><X size={18} /></button>
                </div>

                {/* Chat History */}
                <div className="flex-1 overflow-y-auto p-4 space-y-3">
                    {messages.length === 0 && (
                        <div className="flex flex-col items-center justify-center h-full text-center gap-3 opacity-40">
                            <Sparkles size={32} className="text-purple-400" />
                            <p className="text-gray-400 text-sm">שאל את ה-AI לכתוב פוסט,<br />לשנות טון, להוסיף אמוג׳ים ועוד!</p>
                        </div>
                    )}
                    {messages.map((msg, i) => (
                        <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                            {msg.role === 'error' ? (
                                <div className="text-xs text-red-400 bg-red-900/20 border border-red-900/40 rounded-lg px-3 py-2 max-w-[85%]">
                                    ❌ {msg.text}
                                </div>
                            ) : (
                                <div className={`max-w-[85%] rounded-xl px-3 py-2 text-sm ${msg.role === 'user' ? 'bg-purple-700 text-white rounded-br-sm' : 'bg-gray-100 dark:bg-[#21262d] text-gray-700 dark:text-gray-200 rounded-bl-sm'}`}>
                                    <p className="whitespace-pre-wrap leading-relaxed">{msg.text}</p>
                                    {msg.role === 'ai' && (
                                        <button onClick={() => onInsert(msg.text)}
                                            className="mt-2 text-[10px] font-bold uppercase tracking-widest text-purple-400 hover:text-purple-300 flex items-center gap-1 transition">
                                            <CheckCircle size={11} /> השתמש בטקסט זה
                                        </button>
                                    )}
                                </div>
                            )}
                        </div>
                    ))}
                    {generating && (
                        <div className="flex justify-start">
                            <div className="bg-gray-100 dark:bg-[#21262d] rounded-xl rounded-bl-sm px-4 py-3 flex items-center gap-2">
                                <div className="flex gap-1">
                                    <span className="w-1.5 h-1.5 bg-purple-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                                    <span className="w-1.5 h-1.5 bg-purple-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                                    <span className="w-1.5 h-1.5 bg-purple-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                                </div>
                            </div>
                        </div>
                    )}
                    <div ref={chatEndRef} />
                </div>

                {/* Input Bar */}
                <div className="p-3 border-t border-gray-200 dark:border-[#30363d] bg-gray-50 dark:bg-[#0d1117] shrink-0">
                    <div className="flex gap-2 items-end">
                        <textarea ref={inputRef} autoFocus rows={2}
                            className="flex-1 bg-white dark:bg-[#161b22] border border-gray-200 dark:border-[#30363d] rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-white focus:ring-2 focus:ring-purple-500 focus:ring-offset-1 outline-none transition resize-none"
                            placeholder='כתוב פוסט על פיצרייה חדשה... שנה טון... הוסף אמוג׳ים...'
                            value={input} onChange={e => setInput(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } }} />
                        <button onClick={sendMessage} disabled={!input.trim() || generating}
                            className="p-2.5 bg-purple-600 hover:bg-purple-500 disabled:bg-gray-200 dark:disabled:bg-[#21262d] disabled:text-gray-400 dark:disabled:text-gray-600 text-white rounded-lg transition shrink-0">
                            {generating ? <RefreshCw size={16} className="animate-spin" /> : <Send size={16} />}
                        </button>
                    </div>
                    <p className="text-[10px] text-gray-600 mt-1.5">Enter לשליחה • Shift+Enter לשורה חדשה</p>
                </div>
            </div>
        </div>
    );
}

// ---------------------------------------------------------------------------
// ANALYTICS PANEL
// ---------------------------------------------------------------------------
function AnalyticsPanel({ data, onClose }) {
    const { summary, byDay, topGroups, problemGroups, activeGroups = [], topErrors = [] } = data;
    const maxDay = Math.max(...byDay.map(d => d.total), 1);
    const failRate    = summary.total > 0 ? Math.round((summary.failed    / summary.total) * 100) : 0;
    const cancelRate  = summary.total > 0 ? Math.round((summary.cancelled / summary.total) * 100) : 0;

    const dayLabel = (dateStr) => new Date(dateStr + 'T12:00:00').toLocaleDateString('he-IL', { weekday: 'short' });

    // Semi-circle gauge SVG
    const Gauge = ({ pct, color, size = 54 }) => {
        const r = size * 0.36, cx = size / 2, cy = size * 0.62;
        const circ = 2 * Math.PI * r, half = circ / 2;
        const filled = (Math.min(Math.max(pct, 0), 100) / 100) * half;
        return (
            <svg width={size} height={Math.round(size * 0.66)} viewBox={`0 0 ${size} ${Math.round(size * 0.66)}`}>
                <circle cx={cx} cy={cy} r={r} fill="none" stroke="#1f2937" strokeWidth="5"
                    strokeDasharray={`${half} ${circ}`} strokeLinecap="round"
                    transform={`rotate(180 ${cx} ${cy})`} />
                {pct > 0 && <circle cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth="5"
                    strokeDasharray={`${filled} ${circ}`} strokeLinecap="round"
                    transform={`rotate(180 ${cx} ${cy})`} />}
                <text x={cx} y={cy - 1} textAnchor="middle" dominantBaseline="middle"
                    fontSize="9" fontWeight="800" fill={color}>{pct}%</text>
            </svg>
        );
    };

    // Donut chart
    const DonutChart = () => {
        const r = 28, cx = 38, cy = 38, circ = 2 * Math.PI * r;
        const segs = [
            { val: summary.success,   color: '#10b981', label: 'הצלחה' },
            { val: summary.failed,    color: '#ef4444', label: 'כישלון' },
            { val: summary.cancelled, color: '#4b5563', label: 'בוטל'  },
        ].filter(s => s.val > 0);
        const tot = segs.reduce((s, x) => s + x.val, 0) || 1;
        let offset = 0;
        return (
            <div className="flex items-center gap-3">
                <svg width="76" height="76" viewBox="0 0 76 76">
                    <circle cx={cx} cy={cy} r={r} fill="none" stroke="#1f2937" strokeWidth="10" />
                    {segs.map((seg, i) => {
                        const dash = (seg.val / tot) * circ;
                        const el = (
                            <circle key={i} cx={cx} cy={cy} r={r} fill="none"
                                stroke={seg.color} strokeWidth="10"
                                strokeDasharray={`${dash} ${circ}`}
                                strokeDashoffset={-offset}
                                transform="rotate(-90 38 38)" />
                        );
                        offset += dash;
                        return el;
                    })}
                    <text x={cx} y={cy - 4} textAnchor="middle" fontSize="11" fontWeight="800" fill="white">{summary.total}</text>
                    <text x={cx} y={cy + 7} textAnchor="middle" fontSize="5" fill="#6b7280">סה״כ</text>
                </svg>
                <div className="space-y-1.5">
                    {[
                        { label: 'הצלחה',   val: summary.success,   c: '#10b981' },
                        { label: 'כישלון',  val: summary.failed,    c: '#ef4444' },
                        { label: 'בוטל',    val: summary.cancelled, c: '#4b5563' },
                    ].map(({ label, val, c }) => (
                        <div key={label} className="flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-full shrink-0" style={{ background: c }} />
                            <span className="text-[10px] text-gray-400">{label}</span>
                            <span className="text-[10px] font-black text-gray-200 tabular-nums ml-1">{val}</span>
                        </div>
                    ))}
                </div>
            </div>
        );
    };

    return (
        <div className="bg-white dark:bg-[#161b22] border border-gray-200 dark:border-[#30363d] rounded-xl overflow-hidden shadow-sm mb-4">

            {/* Header */}
            <div className="px-4 py-2.5 border-b border-gray-200 dark:border-[#30363d] flex items-center justify-between bg-gray-50 dark:bg-[#1c2128]">
                <span className="text-[10px] font-black text-gray-500 uppercase tracking-widest">📊 Analytics Dashboard</span>
                <button onClick={onClose} aria-label="סגור אנליטיקה" className="text-gray-500 hover:text-white transition"><X size={14} /></button>
            </div>

            <div className="p-4 space-y-3">

                {/* ROW 1: KPI 2×2 grid + 7-day bar chart */}
                <div className="grid gap-3" style={{ gridTemplateColumns: '1fr 2fr' }}>

                    {/* KPI cards */}
                    <div className="grid grid-cols-2 gap-2">

                        {/* Total */}
                        <div className="dark:bg-[#1c2128] bg-gray-50 rounded-xl p-3 flex flex-col gap-1">
                            <span className="text-2xl font-black text-gray-100 leading-none tabular-nums">{summary.total}</span>
                            <span className="text-[10px] text-gray-500">סה״כ פוסטים</span>
                            <div className="flex items-end gap-0.5 mt-auto" style={{ height: '22px' }}>
                                {byDay.slice(-5).map((d, i) => {
                                    const h = Math.max(d.total > 0 ? Math.round((d.total / maxDay) * 18) : 2, 2);
                                    return <div key={i} className="flex-1 rounded-sm bg-blue-500/50" style={{ height: `${h}px`, alignSelf: 'flex-end' }} />;
                                })}
                            </div>
                        </div>

                        {/* Success */}
                        <div className="dark:bg-[#1c2128] bg-gray-50 rounded-xl p-2 flex flex-col items-center justify-center">
                            <Gauge pct={summary.successRate} color="#10b981" size={54} />
                            <span className="text-base font-black text-emerald-400 leading-none tabular-nums">{summary.success}</span>
                            <span className="text-[10px] text-gray-500 mt-0.5">הצלחות</span>
                        </div>

                        {/* Failed */}
                        <div className="dark:bg-[#1c2128] bg-gray-50 rounded-xl p-2 flex flex-col items-center justify-center">
                            <Gauge pct={failRate} color="#ef4444" size={54} />
                            <span className="text-base font-black text-red-400 leading-none tabular-nums">{summary.failed}</span>
                            <span className="text-[10px] text-gray-500 mt-0.5">כישלונות</span>
                        </div>

                        {/* Pending + Cancelled */}
                        <div className="dark:bg-[#1c2128] bg-gray-50 rounded-xl p-3 flex flex-col gap-2">
                            <div>
                                <span className="text-xl font-black text-amber-400 leading-none tabular-nums">{summary.pending ?? 0}</span>
                                <span className="text-[10px] text-gray-500 block">ממתינים</span>
                            </div>
                            <div className="w-full h-px bg-gray-800" />
                            <div>
                                <span className="text-xl font-black text-gray-500 leading-none tabular-nums">{summary.cancelled}</span>
                                <span className="text-[10px] text-gray-500 block">בוטלו</span>
                            </div>
                        </div>

                    </div>

                    {/* 7-day stacked bar chart */}
                    <div className="dark:bg-[#1c2128] bg-gray-50 rounded-xl p-3">
                        <div className="text-[10px] font-black text-gray-500 mb-1">דוח 7 ימים אחרונים</div>
                        <svg viewBox="0 0 210 80" style={{ width: '100%', height: 'auto', display: 'block' }}>
                            {[0, 0.5, 1].map(f => (
                                <line key={f} x1="20" y1={6 + (1 - f) * 54} x2="207" y2={6 + (1 - f) * 54}
                                    stroke="#1f2937" strokeWidth="0.5" strokeDasharray={f === 0 ? 'none' : '2,3'} />
                            ))}
                            {[0, Math.round(maxDay / 2), maxDay].map((v, i) => (
                                <text key={i} x="18" y={6 + (1 - v / maxDay) * 54} textAnchor="end"
                                    dominantBaseline="middle" fontSize="5" fill="#6b7280">{v}</text>
                            ))}
                            <line x1="20" y1="6" x2="20" y2="60" stroke="#374151" strokeWidth="0.5" />
                            {byDay.map((d, i) => {
                                const bw = 18, gap = 187 / byDay.length;
                                const bx = 20 + gap * i + (gap - bw) / 2;
                                const totalH = d.total > 0 ? Math.max((d.total / maxDay) * 54, 2) : 0;
                                const succH  = d.total > 0 ? (d.success / d.total) * totalH : 0;
                                const failH  = totalH - succH;
                                const base   = 60;
                                return (
                                    <g key={d.date}>
                                        {failH > 0 && <rect x={bx} y={base - totalH} width={bw} height={failH} fill="#ef444455" rx="1.5" />}
                                        {succH > 0 && <rect x={bx} y={base - succH}  width={bw} height={succH} fill="#10b981"   rx="1.5" />}
                                        {totalH > 0 && <rect x={bx} y={base - totalH} width={bw} height="3" rx="1.5"
                                            fill={succH >= totalH ? '#34d399' : '#f87171'} />}
                                        {d.total > 0 && <text x={bx + bw / 2} y={base - totalH - 3} textAnchor="middle" fontSize="4.5" fill="#9ca3af">{d.total}</text>}
                                        <text x={bx + bw / 2} y={base + 6} textAnchor="middle" fontSize="5" fill="#6b7280">{dayLabel(d.date)}</text>
                                    </g>
                                );
                            })}
                        </svg>
                    </div>
                </div>

                {/* ROW 2: Donut breakdown + Top groups + Errors */}
                <div className="grid grid-cols-3 gap-3">

                    {/* Donut */}
                    <div className="dark:bg-[#1c2128] bg-gray-50 rounded-xl p-3">
                        <div className="text-[10px] font-black text-gray-500 mb-2">פילוח תוצאות</div>
                        <DonutChart />
                    </div>

                    {/* Top 5 groups */}
                    <div className="dark:bg-[#1c2128] bg-gray-50 rounded-xl p-3">
                        <div className="text-[10px] font-black text-gray-500 mb-2">🏆 Top קבוצות</div>
                        <ol className="space-y-1.5 list-none">
                            {topGroups.slice(0, 5).map((g, i) => {
                                const pct = g.total > 0 ? Math.round((g.success / g.total) * 100) : 0;
                                return (
                                    <li key={i} className="flex items-center gap-2 min-w-0">
                                        <span className="w-4 h-4 rounded-full bg-emerald-500/20 text-emerald-400 text-[8px] font-black flex items-center justify-center shrink-0">{i + 1}</span>
                                        {g.url
                                            ? <a href={g.url} target="_blank" rel="noreferrer" dir="rtl"
                                                className="text-[10px] text-gray-300 hover:text-emerald-300 hover:underline truncate flex-1 transition-colors">{g.name}</a>
                                            : <span className="text-[10px] text-gray-400 truncate flex-1" dir="rtl">{g.name}</span>
                                        }
                                        <span className="text-[9px] font-black bg-emerald-500/20 text-emerald-400 rounded px-1.5 py-0.5 shrink-0 tabular-nums">{pct}%</span>
                                    </li>
                                );
                            })}
                        </ol>
                    </div>

                    {/* Top errors */}
                    <div className="dark:bg-[#1c2128] bg-gray-50 rounded-xl p-3">
                        <div className="text-[10px] font-black text-gray-500 mb-2">🔴 שגיאות נפוצות</div>
                        {topErrors.length === 0
                            ? <div className="flex items-center gap-1.5 mt-2"><span>✅</span><span className="text-[10px] text-emerald-400 font-semibold">אין שגיאות</span></div>
                            : <ol className="space-y-1.5 list-none">
                                {topErrors.slice(0, 5).map(({ message, count }, i) => (
                                    <li key={i} className="flex items-start gap-1.5 min-w-0">
                                        <span className="text-[9px] font-black bg-red-500/20 text-red-400 rounded px-1 py-0.5 shrink-0 tabular-nums">{count}×</span>
                                        <span className="text-[10px] text-gray-400 leading-tight min-w-0"
                                            style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                                            {message}
                                        </span>
                                    </li>
                                ))}
                            </ol>
                        }
                    </div>

                </div>

                {/* ROW 3: Active groups by volume */}
                <div className="dark:bg-[#1c2128] bg-gray-50 rounded-xl p-3">
                    <div className="text-[10px] font-black text-gray-500 mb-2">📊 פעילות קבוצות לפי נפח</div>
                    {activeGroups.length === 0
                        ? <span className="text-xs text-gray-600">אין נתונים</span>
                        : (() => {
                            const maxVol = activeGroups[0]?.total || 1;
                            return (
                                <div className="grid grid-cols-2 gap-x-6 gap-y-1">
                                    {activeGroups.map((g, i) => {
                                        const barPct = Math.round((g.total / maxVol) * 100);
                                        const sPct   = g.total > 0 ? Math.round((g.success / g.total) * 100) : 0;
                                        const sC     = sPct >= 75 ? 'text-emerald-400' : sPct >= 50 ? 'text-amber-400' : 'text-red-400';
                                        return (
                                            <div key={i} className="flex items-center gap-1.5 min-w-0">
                                                <span className="text-[9px] text-gray-600 w-3 shrink-0 tabular-nums">{i + 1}.</span>
                                                <span className="text-[10px] font-black text-blue-400 tabular-nums shrink-0 w-5 text-right">{g.total}</span>
                                                {g.url
                                                    ? <a href={g.url} target="_blank" rel="noreferrer"
                                                        className="text-[10px] text-gray-300 hover:text-blue-300 hover:underline truncate flex-1 transition-colors"
                                                        dir="rtl" title={g.name}>{g.name}</a>
                                                    : <span className="text-[10px] text-gray-400 truncate flex-1" dir="rtl" title={g.name}>{g.name}</span>
                                                }
                                                <div className="w-10 h-1 bg-gray-800 rounded-full overflow-hidden shrink-0">
                                                    <div className="h-full bg-blue-500 rounded-full" style={{ width: `${barPct}%` }} />
                                                </div>
                                                <span className={`text-[10px] font-bold tabular-nums shrink-0 w-7 text-right ${sC}`}>{sPct}%</span>
                                            </div>
                                        );
                                    })}
                                </div>
                            );
                        })()
                    }
                </div>

            </div>
        </div>
    );
}

// ---------------------------------------------------------------------------
// MAIN APP
// ---------------------------------------------------------------------------
export default function App() {
    // Core state
    const [groups, setGroups]           = useState([]);
    const [queue, setQueue]             = useState([]);
    const [serverStatus, setServerStatus] = useState(false);
    const [workerStatus, setWorkerStatus] = useState({ status: 'OFFLINE', message: 'Initializing...' });
    const [integrity, setIntegrity]     = useState({ version: 'UNKNOWN', status: 'UNKNOWN' });
    const [loading, setLoading]         = useState(false);
    const [theme, setTheme]             = useState(localStorage.getItem('theme') || 'dark');
    const [workerStopped, setWorkerStopped] = useState(false);

    useEffect(() => {
        document.documentElement.classList.toggle('dark', theme === 'dark');
        localStorage.setItem('theme', theme);
    }, [theme]);

    // Selection & processing
    const [selectedTaskIds, setSelectedTaskIds] = useState([]);
    const [processingIds, setProcessingIds]     = useState(new Set());

    // Launchpad form
    const [selectedGroups, setSelectedGroups] = useState([]);
    const [postContent, setPostContent]       = useState('');
    const [scheduleTime, setScheduleTime]     = useState('');
    const [isSubmitting, setIsSubmitting]     = useState(false);
    const [selectedFile, setSelectedFile]     = useState(null);
    const [mediaPreview, setMediaPreview]     = useState(null);
    const [useAiSpin, setUseAiSpin]           = useState(true);

    // Modals
    const [editingTask, setEditingTask]         = useState(null);
    const [showFolderModal, setShowFolderModal] = useState(false);
    const [showStopModal, setShowStopModal]     = useState(false);
    const [showAiModal, setShowAiModal]         = useState(false);

    // View
    const [isCompact, setIsCompact] = useState(localStorage.getItem('isCompact') === 'true');
    const toggleCompact = () => setIsCompact(p => { localStorage.setItem('isCompact', !p); return !p; });
    const [queueFilter, setQueueFilter] = useState('all');

    // Group management
    const [groupSearch, setGroupSearch]             = useState('');
    const [groupSets, setGroupSets]                 = useState([]);
    const [showFoldersPanel, setShowFoldersPanel]   = useState(false);
    const [postTemplates, setPostTemplates]         = useState([]);
    const [showTemplateModal, setShowTemplateModal] = useState(false);
    const [showLibraryPanel, setShowLibraryPanel]   = useState(false);

    // Analytics
    const [showAnalytics, setShowAnalytics]         = useState(false);
    const [analyticsData, setAnalyticsData]         = useState(null);
    const [analyticsLoading, setAnalyticsLoading]   = useState(false);

    // Content editing toolbar
    const [contentEditLoading, setContentEditLoading] = useState(null);

    // Group ordering & drag
    const [sortSelectedFirst, setSortSelectedFirst] = useState(false);
    const [customGroupOrder, setCustomGroupOrder]   = useState(() => {
        try { return JSON.parse(localStorage.getItem('safepost_groupOrder') || '[]'); } catch { return []; }
    });
    const [draggingGroupId, setDraggingGroupId]     = useState(null);
    const [dragOverGroupId, setDragOverGroupId]     = useState(null);

    // Action loading states
    const [isCancelling, setIsCancelling]         = useState(false);
    const [isStoppingWorker, setIsStoppingWorker] = useState(false);
    const [isSyncingGroups, setIsSyncingGroups]   = useState(false);
    const [extensionId, setExtensionId]           = useState(null);

    // Status timeline: { [taskId]: { [status]: "HH:MM:SS" } }
    const [statusTimestamps, setStatusTimestamps] = useState({});

    // Content Edit Actions
    const CONTENT_EDIT_ACTIONS = [
        { id: 'emojis',   icon: <Smile size={11} />,      label: "אמוג'ים",   prompt: t => `הוסף אמוג'ים רלוונטיים לטקסט הזה, אל תשנה את התוכן עצמו:\n\n${t}` },
        { id: 'shorten',  icon: <Scissors size={11} />,   label: 'קצר',       prompt: t => `קצר את הטקסט הזה בכ-30%, שמור על המסר המרכזי:\n\n${t}` },
        { id: 'expand',   icon: <AlignLeft size={11} />,  label: 'הרחב',      prompt: t => `הרחב את הטקסט הזה עם פרטים ומשיכה שיווקית, שמור על אותו טון:\n\n${t}` },
        { id: 'formal',   icon: <Megaphone size={11} />,  label: 'פורמלי',    prompt: t => `תכתוב מחדש את הטקסט הזה בסגנון פורמלי ומקצועי:\n\n${t}` },
        { id: 'hashtags', icon: <Hash size={11} />,       label: 'האשטאגים',  prompt: t => `הוסף 3-5 האשטאגים רלוונטיים בסוף הטקסט הזה:\n\n${t}` },
        { id: 'hebrew',   icon: <Languages size={11} />,  label: 'לעברית',    prompt: t => `תרגם את הטקסט הזה לעברית שוטפת ומדויקת:\n\n${t}` },
    ];

    // --- DATA FETCHING ---
    const fetchAllData = useCallback(async (silent = false) => {
        if (!silent) setLoading(true);
        try {
            const [gData, qData, sData, gsData, tData] = await Promise.all([
                ApiService.getGroups(),
                ApiService.getQueue(),
                ApiService.getSystemStatus(),
                ApiService.getGroupSets(),
                ApiService.getTemplates()
            ]);
            setGroups(gData.groups);
            setQueue(qData.queue);
            setStatusTimestamps(prev => {
                const updated = { ...prev };
                (qData.queue || []).forEach(task => {
                    if (!updated[task.id]) updated[task.id] = {};
                    const fmt = iso => iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : null;
                    if (task.created_at && !updated[task.id].PENDING)
                        updated[task.id].PENDING = fmt(task.created_at);
                    if (task.ended_at) {
                        const endStatus = task.status === 'SUCCESS' || task.status === 'FAILED' ? task.status : null;
                        if (endStatus && !updated[task.id][endStatus])
                            updated[task.id][endStatus] = fmt(task.ended_at);
                    }
                });
                return updated;
            });
            setServerStatus(true);
            setGroupSets(gsData.sets || []);
            setWorkerStatus({
                status: sData.worker_status || 'OFFLINE',
                message: sData.worker_message || 'No Signal',
                last_checkin: sData.last_worker_checkin
            });
            setIntegrity({
                version: sData.worker_version || 'UNKNOWN',
                status: sData.worker_version === '2.1.0' ? 'OK' : 'MISMATCH',
                origin: sData.worker_origin || 'UNKNOWN'
            });
            if (sData.worker_extension_id) setExtensionId(sData.worker_extension_id);
            setPostTemplates(tData.templates || []);
        } catch (e) {
            console.error("Data fetch error:", e);
            setServerStatus(false);
        } finally {
            if (!silent) setLoading(false);
        }
    }, []);

    const handleSaveTemplate = async (name, content, mediaUrl) => {
        try {
            await ApiService.saveTemplate({ name, content, media_url: mediaUrl });
            await fetchAllData(true);
            setShowTemplateModal(false);
        } catch (e) {
            console.error("Save Template Error:", e);
            throw e;
        }
    };

    const handleLoadTemplate = (template) => {
        setPostContent(template.content || '');
        if (template.media_url) {
            setSelectedFile({ name: template.media_url.split('/').pop(), isTemplate: true });
            setMediaPreview({ url: template.media_url, type: template.media_url.match(/\.(mp4|webm)$/i) ? 'video' : 'image' });
        } else {
            setSelectedFile(null);
            setMediaPreview(null);
        }
        setShowLibraryPanel(false);
    };

    const handleDeleteTemplate = async (id, e) => {
        e.stopPropagation();
        if (!confirm('Are you sure you want to delete this template?')) return;
        try {
            await ApiService.deleteTemplate(id);
            await fetchAllData(true);
        } catch (e) {
            console.error("Delete Template Error:", e);
        }
    };

    const handleInsertAiContent = (text) => {
        setPostContent(text);
        setShowAiModal(false);
    };

    const handleToggleAnalytics = async () => {
        if (!showAnalytics && !analyticsData) {
            setAnalyticsLoading(true);
            try {
                const data = await ApiService.getAnalytics();
                setAnalyticsData(data);
            } catch (e) { console.error('Analytics error:', e); }
            finally { setAnalyticsLoading(false); }
        }
        setShowAnalytics(p => !p);
    };

    const handleContentEdit = async (action) => {
        if (!postContent.trim() || contentEditLoading) return;
        setContentEditLoading(action.id);
        try {
            const result = await ApiService.generateAiContent(action.prompt(postContent));
            if (result.success && result.text) setPostContent(result.text);
        } catch (e) { console.error('Content edit error:', e); }
        finally { setContentEditLoading(null); }
    };

    useEffect(() => {
        fetchAllData();
        const iv = setInterval(() => fetchAllData(true), 5000);
        return () => clearInterval(iv);
    }, [fetchAllData]);

    // --- SOCKET LISTENERS ---
    useEffect(() => {
        const refresh = () => fetchAllData(true);
        socket.on('status_update', ({ taskId, status }) => {
            const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
            setStatusTimestamps(prev => ({
                ...prev,
                [taskId]: { ...(prev[taskId] || {}), [status]: now }
            }));
            setQueue(prev => prev.map(q => q.id === taskId ? { ...q, status } : q));
        });
        socket.on('queue_updated', refresh);
        socket.on('data_updated', refresh);
        socket.on('groups_updated', () => { setIsSyncingGroups(false); refresh(); });
        socket.on('groups_sync_failed', ({ error }) => { setIsSyncingGroups(false); alert(`❌ סנכרון נכשל: ${error}`); });
        socket.on('worker_stop_signal', () => { setWorkerStopped(true); refresh(); });
        socket.on('worker_resumed',      () => { setWorkerStopped(false); refresh(); });
        return () => {
            socket.off('status_update');
            socket.off('queue_updated', refresh);
            socket.off('data_updated', refresh);
            socket.off('groups_updated');
            socket.off('groups_sync_failed');
            socket.off('worker_stop_signal');
            socket.off('worker_resumed');
        };
    }, [fetchAllData]);

    // --- SELECTION ---
    const toggleSingle = id =>
        setSelectedTaskIds(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id]);
    const toggleAll = () =>
        setSelectedTaskIds(p => p.length === queue.length ? [] : queue.map(q => q.id));

    // --- FOLDER HANDLERS ---
    const handleSaveFolder  = async name => { await ApiService.saveGroupSet(name, selectedGroups); setShowFolderModal(false); fetchAllData(true); };
    const handleLoadFolder  = set => { setSelectedGroups(set.group_ids); setShowFoldersPanel(false); };
    const handleDeleteFolder = async id => { await ApiService.deleteGroupSet(id); fetchAllData(true); };

    // --- GROUP ORDERING ---
    const orderedGroups = React.useMemo(() => {
        if (!customGroupOrder.length) return groups;
        const orderMap = new Map(customGroupOrder.map((id, i) => [id, i]));
        return [...groups].sort((a, b) => {
            const aO = orderMap.has(a.id) ? orderMap.get(a.id) : 99999;
            const bO = orderMap.has(b.id) ? orderMap.get(b.id) : 99999;
            return aO - bO;
        });
    }, [groups, customGroupOrder]);

    const handleGroupDragStart = (e, id) => {
        setDraggingGroupId(id);
        e.dataTransfer.effectAllowed = 'move';
    };
    const handleGroupDragOver = (e, id) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (id !== dragOverGroupId) setDragOverGroupId(id);
    };
    const handleGroupDrop = (e, targetId) => {
        e.preventDefault();
        if (!draggingGroupId || draggingGroupId === targetId) return;
        const ids = filteredGroups.map(g => g.id);
        const from = ids.indexOf(draggingGroupId), to = ids.indexOf(targetId);
        if (from === -1 || to === -1) return;
        const newOrder = [...ids];
        newOrder.splice(from, 1);
        newOrder.splice(to, 0, draggingGroupId);
        setCustomGroupOrder(newOrder);
        localStorage.setItem('safepost_groupOrder', JSON.stringify(newOrder));
        setDraggingGroupId(null);
        setDragOverGroupId(null);
    };
    const handleGroupDragEnd = () => {
        setDraggingGroupId(null);
        setDragOverGroupId(null);
    };
    const resetGroupOrder = () => {
        setCustomGroupOrder([]);
        localStorage.removeItem('safepost_groupOrder');
    };

    // --- MISSION HANDLERS ---
    const handleLaunchPosts = async () => {
        if (!selectedGroups.length || (!postContent && !selectedFile))
            return alert('⚠️ Select groups and enter content or attach media.');
        setIsSubmitting(true);
        try {
            let mediaUrl = null;
            if (selectedFile) {
                const up = await ApiService.uploadFile(selectedFile);
                if (!up.success) throw new Error('File upload failed');
                mediaUrl = up.file_path;
            }
            const data = await ApiService.createPosts({
                group_ids: selectedGroups,
                content: postContent,
                schedule: scheduleTime ? new Date(scheduleTime).toISOString() : undefined,
                media_url: mediaUrl,
                ai_spin: useAiSpin
            });
            alert(`🚀 Success! Queued ${data.count} posts.`);
            setPostContent(''); setSelectedGroups([]); setScheduleTime('');
            setSelectedFile(null); setMediaPreview(null);
            fetchAllData();
        } catch (e) { alert(`❌ Error: ${e.message}`); }
        finally { setIsSubmitting(false); }
    };

    const handleDelete = async id => {
        const task = queue.find(q => q.id === id);
        const msg = task?.status === 'PROCESSING'
            ? '⚠️ This task is PROCESSING by the worker.\n\nDeleting will NOT stop the extension mid-post. The post may still go through.\n\nDelete record anyway?'
            : 'Delete this task?';
        if (!confirm(msg)) return;
        const orig = [...queue];
        setQueue(p => p.filter(q => q.id !== id));
        setProcessingIds(p => new Set(p).add(id));
        try { await ApiService.deleteTask(id); }
        catch (e) { setQueue(orig); alert(`❌ ${e.message}`); }
        finally { setProcessingIds(p => { const n = new Set(p); n.delete(id); return n; }); }
    };

    const handleAbortTask = async id => {
        setQueue(p => p.map(q => q.id === id ? { ...q, status: 'CANCELLED' } : q));
        try { await ApiService.cancelTask(id); }
        catch (e) { fetchAllData(true); alert(`❌ ${e.message}`); }
    };

    const handleBulkDelete = async () => {
        if (!confirm(`Delete ${selectedTaskIds.length} selected tasks?`)) return;
        const orig = [...queue];
        setQueue(p => p.filter(q => !selectedTaskIds.includes(q.id)));
        setLoading(true);
        try { await ApiService.bulkDelete(selectedTaskIds); setSelectedTaskIds([]); }
        catch (e) { setQueue(orig); alert(`❌ ${e.message}`); }
        finally { setLoading(false); }
    };

    const handleCancelAll = async () => {
        const count = queue.filter(q => q.status === 'PENDING').length;
        if (count === 0) return alert('No PENDING tasks to cancel.');
        if (!confirm(`Cancel all ${count} pending operations? Their status will be set to CANCELLED.`)) return;
        setIsCancelling(true);
        try { await ApiService.cancelAllPending(); fetchAllData(true); }
        catch (e) { alert(`❌ ${e.message}`); }
        finally { setIsCancelling(false); }
    };

    const handleStopWorker = async () => {
        setShowStopModal(false);
        setIsStoppingWorker(true);
        try { await ApiService.stopWorker(); setWorkerStopped(true); }
        catch (e) { alert(`❌ ${e.message}`); }
        finally { setTimeout(() => setIsStoppingWorker(false), 2000); }
    };

    const handleResumeWorker = async () => {
        try { await ApiService.resumeWorker(); setWorkerStopped(false); }
        catch (e) { alert(`❌ ${e.message}`); }
    };

    const handleSyncGroups = async () => {
        setIsSyncingGroups(true);
        const safetyTimer = setTimeout(() => {
            setIsSyncingGroups(false);
            alert('⏱️ הסנכרון לקח יותר מדי זמן. בדוק שה-extension פועל ופייסבוק פתוח.');
        }, 90000);
        try {
            const res = await fetch(`${API_BASE}/groups/request-sync`, { method: 'POST' });
            const data = await res.json();
            if (!res.ok || !data.success) {
                clearTimeout(safetyTimer);
                throw new Error(data.error || 'שגיאת שרת');
            }
        } catch (e) {
            clearTimeout(safetyTimer);
            alert(`❌ שגיאה: ${e.message}`);
            setIsSyncingGroups(false);
        }
    };

    const handleUpdate = async (id, data) => {
        setProcessingIds(p => new Set(p).add(id));
        try { await ApiService.updateTask(id, data); setEditingTask(null); fetchAllData(true); }
        catch (e) { alert(`❌ Update failed: ${e.message}`); }
        finally { setProcessingIds(p => { const n = new Set(p); n.delete(id); return n; }); }
    };

    const handleTableClick = e => {
        const btn = e.target.closest('[data-action]');
        if (!btn) return;
        const id   = parseInt(btn.dataset.taskId);
        const act  = btn.dataset.action;
        if (act === 'delete') handleDelete(id);
        if (act === 'abort')  handleAbortTask(id);
        if (act === 'edit')   setEditingTask(queue.find(q => q.id === id));
    };

    const handleFileSelect = e => {
        const file = e.target.files[0];
        if (!file) return;
        setSelectedFile(file);
        setMediaPreview({ url: URL.createObjectURL(file), type: file.type });
    };
    const clearMedia = () => { setSelectedFile(null); setMediaPreview(null); };

    // --- DERIVED ---
    const stats = {
        total:      queue.length,
        pending:    queue.filter(q => ['PENDING', 'SENT'].includes(q.status)).length,
        processing: queue.filter(q => q.status === 'PROCESSING').length,
        completed:  queue.filter(q => q.status === 'COMPLETED' || q.status === 'SUCCESS').length,
        failed:     queue.filter(q => q.status === 'FAILED').length,
        cancelled:  queue.filter(q => q.status === 'CANCELLED').length,
    };
    const filteredQueue = queue.filter(q => {
        if (queueFilter === 'active') return ['PENDING', 'SENT', 'PROCESSING'].includes(q.status);
        if (queueFilter === 'done')   return ['SUCCESS', 'COMPLETED'].includes(q.status);
        if (queueFilter === 'failed') return ['FAILED', 'CANCELLED'].includes(q.status);
        return true;
    });

    const filteredGroups = React.useMemo(() => {
        let base = orderedGroups;
        if (groupSearch) {
            const terms = groupSearch.toLowerCase().split(/\s+/).filter(Boolean);
            base = base.filter(g => {
                const name = g.name.toLowerCase();
                return terms.every(term => name.includes(term));
            });
        }
        if (sortSelectedFirst) {
            const sel = new Set(selectedGroups);
            return [...base].sort((a, b) => {
                const aS = sel.has(a.id) ? 0 : 1;
                const bS = sel.has(b.id) ? 0 : 1;
                return aS - bS;
            });
        }
        return base;
    }, [orderedGroups, groupSearch, sortSelectedFirst, selectedGroups]);

    const handleBulkSelectFiltered = (count) => {
        const toAdd = count === 'all'
            ? filteredGroups.map(g => g.id)
            : filteredGroups.slice(0, count).map(g => g.id);
        setSelectedGroups(prev => {
            const next = new Set(prev);
            toAdd.forEach(id => next.add(id));
            return Array.from(next);
        });
    };

    const handleClearFiltered = () => {
        const filteredIds = new Set(filteredGroups.map(g => g.id));
        setSelectedGroups(prev => prev.filter(id => !filteredIds.has(id)));
    };

    // -----------------------------------------------------------------------
    // RENDER
    // -----------------------------------------------------------------------
    return (
        <div className="flex h-screen bg-slate-50 dark:bg-[#0f1115] text-slate-900 dark:text-gray-300 font-sans overflow-hidden transition-colors duration-300">
            <style>{`
                @keyframes pulse-blue {
                    0%   { box-shadow: 0 0 0 0   rgba(59,130,246,.4); }
                    70%  { box-shadow: 0 0 0 10px rgba(59,130,246,0); }
                    100% { box-shadow: 0 0 0 0   rgba(59,130,246,0); }
                }
                .status-pulse { animation: pulse-blue 2s infinite; }
                .custom-scrollbar::-webkit-scrollbar { width: 4px; }
                .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
                .custom-scrollbar::-webkit-scrollbar-thumb {
                    background: ${theme === 'dark' ? '#30363d' : '#cbd5e1'};
                    border-radius: 10px;
                }
            `}</style>

            {/* ── HEADER ── */}
            <header className="fixed top-0 w-full h-16 bg-white dark:bg-[#161b22] border-b border-gray-200 dark:border-[#30363d] flex items-center justify-between px-6 z-50 transition-colors duration-300">
                <div className="flex items-center gap-3">
                    <div className="bg-blue-600 p-2 rounded-lg shadow-sm"><Shield size={20} className="text-white" /></div>
                    <div>
                        <h1 className="text-slate-900 dark:text-white font-bold text-lg">
                            SafePost <span className="text-blue-500 dark:text-blue-400 text-xs px-1 border border-blue-200 dark:border-blue-400/30 rounded">OS 5.1</span>
                        </h1>
                        <p className="text-[10px] text-slate-500 dark:text-gray-500 uppercase tracking-widest">Enterprise Shield Refactored</p>
                    </div>
                </div>
                <div className="flex items-center gap-3">
                    {workerStopped ? (
                        <button onClick={handleResumeWorker}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-green-900/20 border border-green-700/50 text-green-400 rounded-lg text-[10px] font-bold uppercase tracking-widest hover:bg-green-900/40 transition">
                            <Zap size={12} /> Resume Worker
                        </button>
                    ) : (
                        <button onClick={() => setShowStopModal(true)} disabled={isStoppingWorker}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-red-900/10 border border-red-800/40 text-red-400 rounded-lg text-[10px] font-bold uppercase tracking-widest hover:bg-red-900/25 transition disabled:opacity-50">
                            {isStoppingWorker ? <RefreshCw size={10} className="animate-spin" /> : <StopCircle size={12} />}
                            Stop Worker
                        </button>
                    )}
                    <button onClick={() => setTheme(p => p === 'dark' ? 'light' : 'dark')}
                        aria-label="החלף ערכת נושא"
                        className="p-2 hover:bg-gray-200 dark:hover:bg-[#242c38] rounded-full transition text-slate-500 dark:text-gray-400">
                        {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
                    </button>
                    <button onClick={() => fetchAllData()}
                        aria-label="רענן"
                        className="p-2 hover:bg-gray-200 dark:hover:bg-[#242c38] rounded-full transition text-slate-500 dark:text-gray-400">
                        <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
                    </button>
                    <div className={`px-3 py-1 rounded-full text-xs font-bold border flex items-center gap-2 ${serverStatus
                        ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800 text-green-700 dark:text-green-400'
                        : 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-red-700 dark:text-red-400'}`}>
                        <div className={`w-2 h-2 rounded-full ${serverStatus ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`} />
                        {serverStatus ? 'MOTHERSHIP ONLINE' : 'OFFLINE'}
                    </div>
                </div>
            </header>

            <main className="flex w-full pt-16 h-full transition-colors duration-300">

                {/* ── LEFT: COMMAND CENTER ── */}
                <div className="w-[480px] flex flex-col border-r border-gray-200 dark:border-[#30363d] bg-gray-50 dark:bg-[#0d1117] overflow-hidden transition-colors duration-300">
                    <div className="flex-1 overflow-y-auto p-5 space-y-4 custom-scrollbar">

                        <div className="flex items-center gap-2 text-slate-800 dark:text-white font-bold pb-2 border-b border-gray-200 dark:border-[#30363d]">
                            <Send size={16} className="text-blue-500" />
                            <span>Campaign Launchpad</span>
                        </div>

                        {/* CONTENT */}
                        <div className="bg-white dark:bg-[#161b22] border border-gray-200 dark:border-[#30363d] rounded-xl p-4 shadow-sm space-y-3">
                            <div className="flex justify-between items-center">
                                <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest flex items-center gap-2">
                                    <span className="w-1 h-1 bg-blue-500 rounded-full" /> Content Architecture
                                </label>
                                <div className="flex items-center gap-2">
                                    <button
                                        onClick={() => setShowAiModal(true)}
                                        className="text-[10px] font-bold uppercase flex items-center gap-1 px-2 py-0.5 rounded border transition text-purple-400 border-purple-800/50 hover:bg-purple-900/20">
                                        <Sparkles size={11} /> AI Assistant
                                    </button>
                                    <button
                                        onClick={() => setShowLibraryPanel(p => !p)}
                                        className={`text-[10px] font-bold uppercase flex items-center gap-1 px-2 py-0.5 rounded border transition ${showLibraryPanel ? 'bg-amber-600 text-white border-amber-600' : 'text-amber-400 border-amber-800/50 hover:bg-amber-900/20'}`}>
                                        <Layers size={11} /> Library {postTemplates.length > 0 && `(${postTemplates.length})`}
                                    </button>
                                </div>
                            </div>

                            {/* Template Library Panel */}
                            {showLibraryPanel && (
                                <div className="bg-gray-50 dark:bg-[#0d1117] border border-gray-200 dark:border-[#30363d] rounded-lg p-2 space-y-1">
                                    {postTemplates.length === 0
                                        ? <p className="text-[10px] text-gray-500 text-center py-2">No saved templates yet.</p>
                                        : postTemplates.map(t => (
                                            <div key={t.id} className="flex items-center justify-between px-2 py-1.5 rounded hover:bg-white/5 group">
                                                <button onClick={() => handleLoadTemplate(t)} className="flex items-center gap-2 flex-1 text-left overflow-hidden">
                                                    <Layers size={12} className="text-amber-400 shrink-0" />
                                                    <span className="text-xs text-gray-300 font-medium truncate">{t.name}</span>
                                                </button>
                                                <button onClick={(e) => handleDeleteTemplate(t.id, e)}
                                                    aria-label="מחק תבנית"
                                                    className="opacity-0 group-hover:opacity-100 p-1 text-red-500 hover:bg-red-500/10 rounded transition">
                                                    <Trash2 size={11} />
                                                </button>
                                            </div>
                                        ))
                                    }
                                </div>
                            )}

                            <textarea
                                className="w-full h-28 bg-gray-50 dark:bg-[#0d1117] border border-gray-200 dark:border-[#30363d] rounded-lg p-3 text-sm text-slate-800 dark:text-white focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 outline-none transition resize-none"
                                placeholder="Construct post content..."
                                value={postContent} onChange={e => setPostContent(e.target.value)} />

                            {/* Content Editing Toolbar */}
                            {postContent.trim() && (
                                <div className="flex flex-wrap gap-1.5 pt-1">
                                    {CONTENT_EDIT_ACTIONS.map(action => (
                                        <button key={action.id}
                                            onClick={() => handleContentEdit(action)}
                                            disabled={!!contentEditLoading}
                                            className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg border text-[10px] font-bold uppercase tracking-wider transition ${
                                                contentEditLoading === action.id
                                                    ? 'bg-indigo-600 text-white border-indigo-600'
                                                    : 'bg-transparent text-indigo-400 border-indigo-800/40 hover:bg-indigo-900/20 disabled:opacity-40'
                                            }`}>
                                            {contentEditLoading === action.id
                                                ? <RefreshCw size={10} className="animate-spin" />
                                                : action.icon}
                                            {action.label}
                                        </button>
                                    ))}
                                </div>
                            )}

                            {/* AI SMART SPIN TOGGLE */}
                            <div className="flex items-center justify-between pt-2 border-t border-gray-100 dark:border-gray-800/50">
                                <div className="flex items-center gap-2 group cursor-help">
                                    <Sparkles size={14} className={useAiSpin ? "text-amber-500" : "text-gray-400"} />
                                    <span className={`text-xs font-bold uppercase tracking-wider ${useAiSpin ? "text-amber-500" : "text-gray-500"}`}>
                                        AI Smart Spin
                                    </span>
                                    <div className="absolute ml-28 opacity-0 group-hover:opacity-100 transition-opacity bg-slate-800 text-[10px] text-white p-2 rounded shadow-xl w-48 pointer-events-none z-[60]">
                                        Uses Spintax &#123;a|b&#125; and Hebrew synonyms to make each post unique.
                                    </div>
                                </div>
                                <button
                                    onClick={() => setUseAiSpin(!useAiSpin)}
                                    aria-label={useAiSpin ? 'כבה AI Smart Spin' : 'הפעל AI Smart Spin'}
                                    aria-pressed={useAiSpin}
                                    className={`relative inline-flex h-5 w-10 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-amber-400 focus:ring-offset-1 ${useAiSpin ? 'bg-amber-500' : 'bg-gray-300 dark:bg-gray-700'}`}
                                >
                                    <span className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${useAiSpin ? 'translate-x-6' : 'translate-x-1'}`} />
                                </button>
                            </div>
                        </div>

                        {/* MEDIA */}
                        <div className="bg-white dark:bg-[#161b22] border border-gray-200 dark:border-[#30363d] rounded-xl p-4 shadow-sm space-y-3">
                            <div className="flex justify-between items-center">
                                <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest flex items-center gap-2">
                                    <span className="w-1 h-1 bg-blue-500 rounded-full" /> Media Attachment
                                </label>
                                {selectedFile && (
                                    <button onClick={clearMedia} className="text-[10px] text-red-500 hover:text-red-400 font-bold uppercase flex items-center gap-1 transition">
                                        <X size={12} /> Remove
                                    </button>
                                )}
                            </div>
                            {!selectedFile ? (
                                <label className="cursor-pointer flex items-center gap-2 px-3 py-2.5 bg-gray-50 dark:bg-[#0d1117] border border-dashed border-gray-200 dark:border-[#30363d] rounded-lg hover:border-blue-400 dark:hover:border-blue-500 transition group w-full">
                                    <Paperclip size={16} className="text-gray-400 group-hover:text-blue-500 transition" />
                                    <span className="text-xs text-gray-500 group-hover:text-blue-500 transition font-medium">
                                        Attach Image or Video…
                                    </span>
                                    <input type="file" className="hidden" accept="image/*,video/*" onChange={handleFileSelect} />
                                </label>
                            ) : (
                                <div className="relative bg-gray-50 dark:bg-[#0d1117] rounded-lg overflow-hidden border border-gray-200 dark:border-[#30363d]">
                                    {mediaPreview?.type?.startsWith('video') ? (
                                        <video src={mediaPreview.url} className="w-full h-24 object-cover opacity-90" controls />
                                    ) : (
                                        <img src={mediaPreview.url} alt="Preview" className="w-full h-24 object-cover opacity-90" />
                                    )}
                                    <div className="absolute bottom-2 right-2 bg-black/60 text-white text-[9px] px-2 py-0.5 rounded font-mono border border-white/10 flex items-center gap-1">
                                        {mediaPreview?.type.startsWith('video') ? '🎬' : '🖼'} {(selectedFile.size / 1024 / 1024).toFixed(2)} MB
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* GROUPS */}
                        <div className="bg-white dark:bg-[#161b22] border border-gray-200 dark:border-[#30363d] rounded-xl p-4 shadow-sm flex flex-col space-y-3">
                            <div className="flex justify-between items-center">
                                <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest flex items-center gap-2">
                                    <span className="w-1 h-1 bg-blue-500 rounded-full" /> Target Nodes ({selectedGroups.length})
                                </label>
                                <div className="flex items-center gap-1.5">
                                    <button
                                        onClick={() => setSortSelectedFirst(p => !p)}
                                        title="הצג נבחרות ראשונות"
                                        className={`text-[9px] font-black uppercase px-2 py-0.5 rounded border transition ${sortSelectedFirst ? 'bg-blue-600 text-white border-blue-600' : 'text-blue-400 border-blue-800/50 hover:bg-blue-900/20'}`}>
                                        ↑ נבחרות
                                    </button>
                                    {customGroupOrder.length > 0 && (
                                        <button onClick={resetGroupOrder}
                                            title="אפס סדר ידני"
                                            className="text-[9px] font-black uppercase px-2 py-0.5 rounded border text-gray-400 border-gray-700 hover:bg-gray-800 transition">
                                            ↺ סדר
                                        </button>
                                    )}
                                    <button
                                        onClick={handleSyncGroups}
                                        disabled={isSyncingGroups}
                                        title="סנכרן קבוצות מפייסבוק"
                                        className="text-[9px] font-black uppercase flex items-center gap-1 px-2 py-0.5 rounded border transition text-green-400 border-green-800/50 hover:bg-green-900/20 disabled:opacity-50">
                                        <RefreshCw size={10} className={isSyncingGroups ? 'animate-spin' : ''} />
                                        {isSyncingGroups ? 'מסנכרן...' : 'FB'}
                                    </button>
                                    <button
                                        onClick={() => setShowFoldersPanel(p => !p)}
                                        className={`text-[9px] font-black uppercase flex items-center gap-1 px-2 py-0.5 rounded border transition ${showFoldersPanel ? 'bg-blue-600 text-white border-blue-600' : 'text-blue-400 border-blue-800/50 hover:bg-blue-900/20'}`}>
                                        <Folder size={10} /> {groupSets.length > 0 && `(${groupSets.length})`}
                                    </button>
                                    <button
                                        onClick={() => selectedGroups.length === groups.length ? setSelectedGroups([]) : setSelectedGroups(groups.map(g => g.id))}
                                        className="text-[9px] text-blue-400 font-black hover:underline uppercase transition">
                                        {selectedGroups.length === groups.length ? 'Wipe' : 'All'}
                                    </button>
                                </div>
                            </div>

                            {/* Folders Panel */}
                            {showFoldersPanel && (
                                <div className="bg-gray-50 dark:bg-[#0d1117] border border-gray-200 dark:border-[#30363d] rounded-lg p-2 space-y-1">
                                    {groupSets.length === 0
                                        ? <p className="text-[10px] text-gray-500 text-center py-2">No saved folders yet.</p>
                                        : groupSets.map(set => (
                                            <div key={set.id} className="flex items-center justify-between px-2 py-1.5 rounded hover:bg-white/5 group">
                                                <button onClick={() => handleLoadFolder(set)} className="flex items-center gap-2 flex-1 text-left">
                                                    <Folder size={12} className="text-blue-400 shrink-0" />
                                                    <span className="text-xs text-gray-300 font-medium truncate">{set.name}</span>
                                                    <span className="text-[10px] text-gray-500 shrink-0">{set.group_ids?.length || 0}</span>
                                                </button>
                                                <button onClick={() => handleDeleteFolder(set.id)}
                                                    aria-label="מחק תיקייה"
                                                    className="opacity-0 group-hover:opacity-100 p-1 text-red-500 hover:bg-red-500/10 rounded transition">
                                                    <Trash2 size={11} />
                                                </button>
                                            </div>
                                        ))
                                    }
                                </div>
                            )}

                            {/* Selected Groups Chips Bar */}
                            {selectedGroups.length > 0 && (
                                <div className="bg-blue-950/30 border border-blue-500/20 rounded-lg p-2">
                                    <div className="flex items-center justify-between mb-1.5">
                                        <span className="text-[9px] font-black text-blue-400 uppercase tracking-widest">{selectedGroups.length} נבחרו</span>
                                        <button onClick={() => setSelectedGroups([])} className="text-[9px] text-red-400 hover:text-red-300 font-bold uppercase transition">נקה הכל</button>
                                    </div>
                                    <div className="flex flex-wrap gap-1 max-h-20 overflow-y-auto custom-scrollbar">
                                        {selectedGroups.map(id => {
                                            const g = groups.find(x => x.id === id);
                                            if (!g) return null;
                                            return (
                                                <span key={id} className="inline-flex items-center gap-1 bg-blue-600/20 border border-blue-500/30 text-blue-200 text-[10px] px-2 py-0.5 rounded-full max-w-[140px]">
                                                    <span className="truncate" dir="rtl" title={g.name}>{g.name}</span>
                                                    <button onClick={() => setSelectedGroups(p => p.filter(x => x !== id))}
                                                        aria-label="הסר קבוצה"
                                                        className="shrink-0 text-blue-400 hover:text-red-400 transition">
                                                        <X size={9} />
                                                    </button>
                                                </span>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}

                            {/* Search & Smart Filters */}
                            <div className="space-y-2">
                                <div className="relative">
                                    <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                                    <input type="text" placeholder="Filter groups…"
                                        value={groupSearch} onChange={e => setGroupSearch(e.target.value)}
                                        className="w-full pl-7 pr-7 py-2 bg-gray-50 dark:bg-[#0d1117] border border-gray-200 dark:border-[#30363d] rounded-lg text-xs text-slate-700 dark:text-gray-300 placeholder-gray-400 focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 outline-none transition" />
                                    {groupSearch && (
                                        <button onClick={() => setGroupSearch('')} aria-label="נקה חיפוש" className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-300 transition">
                                            <X size={11} />
                                        </button>
                                    )}
                                </div>

                                {groupSearch && (
                                    <div className="flex flex-wrap gap-1.5 animate-in fade-in slide-in-from-top-1 duration-200">
                                        <button onClick={() => handleBulkSelectFiltered('all')} className="text-[9px] font-black uppercase px-2 py-1 bg-blue-600/10 text-blue-400 border border-blue-500/30 rounded hover:bg-blue-600/20 transition">Select All ({filteredGroups.length})</button>
                                        <button onClick={() => handleBulkSelectFiltered(5)} className="text-[9px] font-black uppercase px-2 py-1 bg-white/5 text-gray-400 border border-white/10 rounded hover:bg-white/10 transition">Top 5</button>
                                        <button onClick={() => handleBulkSelectFiltered(10)} className="text-[9px] font-black uppercase px-2 py-1 bg-white/5 text-gray-400 border border-white/10 rounded hover:bg-white/10 transition">Top 10</button>
                                        <button onClick={() => handleBulkSelectFiltered(20)} className="text-[9px] font-black uppercase px-2 py-1 bg-white/5 text-gray-400 border border-white/10 rounded hover:bg-white/10 transition">Top 20</button>
                                        <button onClick={handleClearFiltered} className="text-[9px] font-black uppercase px-2 py-1 bg-red-900/10 text-red-400 border border-red-900/30 rounded hover:bg-red-900/20 transition ml-auto">Clear</button>
                                    </div>
                                )}
                            </div>

                            {/* Group List with Drag-and-Drop */}
                            <div className="max-h-48 overflow-y-auto pr-1 custom-scrollbar">
                                {filteredGroups.length === 0
                                    ? <p className="text-[10px] text-gray-500 text-center py-4">{groupSearch ? `No match for "${groupSearch}"` : 'No groups loaded.'}</p>
                                    : filteredGroups.map(g => (
                                        <div key={g.id}
                                            draggable
                                            onDragStart={e => handleGroupDragStart(e, g.id)}
                                            onDragOver={e => handleGroupDragOver(e, g.id)}
                                            onDrop={e => handleGroupDrop(e, g.id)}
                                            onDragEnd={handleGroupDragEnd}
                                            onClick={() => setSelectedGroups(p => p.includes(g.id) ? p.filter(x => x !== g.id) : [...p, g.id])}
                                            className={`group/item flex items-center gap-2 px-2.5 py-2.5 rounded-xl cursor-pointer select-none transition-all duration-150 border mb-1.5 ${
                                                draggingGroupId === g.id
                                                    ? 'opacity-40 scale-95'
                                                    : dragOverGroupId === g.id && draggingGroupId !== g.id
                                                    ? 'border-blue-400 bg-blue-900/20'
                                                    : selectedGroups.includes(g.id)
                                                    ? 'bg-blue-600/10 border-blue-500/40 shadow-sm shadow-blue-900/10'
                                                    : 'bg-white/5 border-transparent hover:border-white/10 hover:bg-white/[0.08]'
                                            }`}>
                                            {/* Drag Handle */}
                                            <div className="shrink-0 cursor-grab active:cursor-grabbing text-gray-700 hover:text-gray-400 transition-colors"
                                                onClick={e => e.stopPropagation()}>
                                                <GripVertical size={15} />
                                            </div>
                                            {/* Selection dot */}
                                            <div className={`w-2 h-2 rounded-full shrink-0 ${selectedGroups.includes(g.id) ? 'bg-blue-500 animate-pulse' : 'bg-gray-700'}`} />
                                            {/* Name */}
                                            <div className="flex-1 min-w-0" dir="rtl">
                                                <span className={`text-[13px] leading-snug font-semibold truncate block transition-colors ${selectedGroups.includes(g.id) ? 'text-blue-100' : 'text-slate-800 dark:text-gray-100 group-hover/item:text-white'}`}
                                                    title={g.name}>{g.name}</span>
                                            </div>
                                            {/* Checkbox */}
                                            <div className="ml-1 shrink-0">
                                                {selectedGroups.includes(g.id)
                                                    ? <div className="bg-blue-600 rounded p-0.5"><CheckSquare size={14} className="text-white" /></div>
                                                    : <div className="border border-gray-600 rounded p-0.5 group-hover/item:border-gray-500"><Square size={14} className="text-transparent" /></div>}
                                            </div>
                                        </div>
                                    ))
                                }
                            </div>

                            {/* Save as Folder */}
                            {selectedGroups.length >= 2 && (
                                <button onClick={() => setShowFolderModal(true)}
                                    className="w-full flex items-center justify-center gap-1.5 py-1.5 text-[10px] font-bold uppercase tracking-widest text-blue-400 border border-blue-800/40 rounded-lg hover:bg-blue-900/20 transition">
                                    <FolderPlus size={12} /> Save {selectedGroups.length} Groups as Folder
                                </button>
                            )}
                        </div>

                        {/* CALENDAR */}
                        <div className="bg-white dark:bg-[#161b22] border border-gray-200 dark:border-[#30363d] rounded-xl p-4 shadow-sm">
                            <Calendar value={scheduleTime} onChange={e => setScheduleTime(e.target.value)} compact={true} />
                        </div>
                    </div>

                    <div className="p-5 pt-0 bg-gray-50 dark:bg-[#0d1117] border-t border-gray-200 dark:border-[#30363d]">
                            <div className="flex gap-2 p-2">
                                <button
                                    onClick={() => { setPostContent(''); setSelectedFile(null); setMediaPreview(null); }}
                                    className="flex-1 py-3 border border-gray-200 dark:border-[#30363d] text-slate-500 dark:text-gray-400 rounded-xl text-[10px] font-bold uppercase tracking-widest hover:bg-gray-100 dark:hover:bg-[#242c38] transition">
                                    Clear
                                </button>
                                <button
                                    onClick={() => setShowTemplateModal(true)}
                                    disabled={!postContent.trim()}
                                    className="flex-1 py-3 border border-amber-500/30 text-amber-500 rounded-xl text-[10px] font-bold uppercase tracking-widest hover:bg-amber-500/10 transition disabled:opacity-30">
                                    Save Template
                                </button>
                                <button
                                    onClick={handleLaunchPosts}
                                    disabled={selectedGroups.length === 0 || !postContent.trim() || isSubmitting}
                                    className="flex-[2] py-3 bg-blue-600 hover:bg-blue-500 status-pulse text-white rounded-xl text-[10px] font-black uppercase tracking-widest transition-all disabled:opacity-50 disabled:animate-none flex items-center justify-center gap-2">
                                    {isSubmitting ? <RefreshCw size={14} className="animate-spin" /> : <Send size={14} />}
                                    Deploy Campaign
                                </button>
                            </div>
                    </div>
                </div>

                {/* ── RIGHT: MONITOR ── */}
                <div className="flex-1 bg-slate-50 dark:bg-[#0d1117] p-8 overflow-y-auto">

                    {/* Worker Stop Banner */}
                    {workerStopped && (
                        <div className="mb-4 flex items-center justify-between px-4 py-2.5 bg-red-900/20 border border-red-800/50 rounded-xl text-xs">
                            <div className="flex items-center gap-2 text-red-400 font-bold">
                                <StopCircle size={14} />
                                <span>⛔ WORKER STOP SIGNAL ACTIVE — Extension will not pick up new jobs</span>
                            </div>
                            <button onClick={handleResumeWorker}
                                className="px-3 py-1 bg-green-900/30 border border-green-700/50 text-green-400 rounded font-bold text-[10px] uppercase hover:bg-green-900/50 transition flex items-center gap-1">
                                <Zap size={10} /> Resume
                            </button>
                        </div>
                    )}

                    {/* Stats */}
                    <div className="grid grid-cols-5 gap-4 mb-4">
                        <StatBox label="Total"            value={stats.total}      icon={<Layers      className="text-blue-500" />} />
                        <StatBox label="Pending"          value={stats.pending}    icon={<Clock       className="text-yellow-500" />} />
                        <StatBox label="Processing"       value={stats.processing} icon={<Zap         className="text-blue-400" />} />
                        <StatBox label="Successful"       value={stats.completed}  icon={<CheckCircle className="text-green-500" />} />
                        <StatBox label="Failed/Abort"     value={stats.failed + stats.cancelled} icon={<XCircle className="text-red-500" />} />
                    </div>

                    {/* Analytics Toggle Button */}
                    <div className="flex justify-end mb-4">
                        <button onClick={handleToggleAnalytics} disabled={analyticsLoading}
                            className={`flex items-center gap-2 px-4 py-2 rounded-lg border text-xs font-bold uppercase tracking-widest transition ${
                                showAnalytics
                                    ? 'bg-emerald-600 text-white border-emerald-600'
                                    : 'text-emerald-400 border-emerald-800/50 hover:bg-emerald-900/20'
                            } disabled:opacity-50`}>
                            {analyticsLoading ? <RefreshCw size={13} className="animate-spin" /> : <Info size={13} />}
                            {showAnalytics ? 'Hide Analytics' : '📊 Show Analytics'}
                        </button>
                    </div>

                    {/* Analytics Panel */}
                    {showAnalytics && analyticsData && (
                        <AnalyticsPanel data={analyticsData} onClose={() => setShowAnalytics(false)} />
                    )}

                    {/* Operation Feed */}
                    <div className="bg-white dark:bg-[#161b22] border border-gray-200 dark:border-[#30363d] rounded-xl overflow-hidden shadow-sm">
                        <div className="p-4 border-b border-gray-200 dark:border-[#30363d] flex justify-between items-center bg-gray-50 dark:bg-[#1c2128]">
                            <div className="flex items-center gap-3">
                                <h3 className="font-bold text-slate-800 dark:text-white text-sm flex items-center gap-2">
                                    <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" /> Live Operation Feed
                                </h3>
                                <CountdownTimer queue={queue} fetchAllData={fetchAllData} />
                            </div>
                            <div className="flex items-center gap-2 flex-wrap">
                                {[
                                    { key: 'all',    label: `All (${queue.length})` },
                                    { key: 'active', label: `Active (${stats.pending + stats.processing})` },
                                    { key: 'done',   label: `Done (${stats.completed})` },
                                    { key: 'failed', label: `Failed (${stats.failed + stats.cancelled})` },
                                ].map(({ key, label }) => (
                                    <button key={key} onClick={() => setQueueFilter(key)}
                                        className={`text-[10px] font-bold px-3 py-1 rounded border transition ${queueFilter === key ? 'bg-blue-600 text-white border-blue-600' : 'bg-transparent text-slate-500 border-gray-300 dark:border-gray-600 dark:text-gray-400 hover:border-blue-400 hover:text-blue-400'}`}>
                                        {label}
                                    </button>
                                ))}
                                <div className="w-px h-4 bg-gray-300 dark:bg-gray-700 mx-1" />
                                {stats.pending > 0 && (
                                    <button onClick={handleCancelAll} disabled={isCancelling}
                                        className="flex items-center gap-1.5 bg-orange-500/10 border border-orange-500/30 text-orange-400 px-3 py-1 rounded text-[10px] font-bold hover:bg-orange-500 hover:text-white transition disabled:opacity-50">
                                        {isCancelling ? <RefreshCw size={10} className="animate-spin" /> : <Ban size={10} />}
                                        ABORT {stats.pending} PENDING
                                    </button>
                                )}
                                <button onClick={toggleCompact}
                                    className={`text-[10px] font-bold px-3 py-1 rounded border transition ${isCompact ? 'bg-blue-600 text-white border-blue-600' : 'bg-transparent text-slate-500 border-gray-300 dark:border-gray-600 dark:text-gray-400'}`}>
                                    COMPACT VIEW
                                </button>
                                {selectedTaskIds.length > 0 && (
                                    <button onClick={handleBulkDelete}
                                        className="bg-red-500/10 border border-red-500/30 text-red-500 px-3 py-1 rounded text-[10px] font-bold hover:bg-red-500 hover:text-white transition">
                                        DELETE {selectedTaskIds.length}
                                    </button>
                                )}
                            </div>
                        </div>

                        <div className="overflow-x-auto">
                            <table className="w-full text-left">
                                <thead className={`bg-gray-50 dark:bg-[#0d1117] text-gray-500 dark:text-gray-400 uppercase font-semibold border-b border-gray-100 dark:border-[#30363d] ${isCompact ? 'text-[9px]' : 'text-xs'}`}>
                                    <tr>
                                        <th className={`${isCompact ? 'p-2' : 'p-4'} w-10`}>
                                            <button onClick={toggleAll} className="p-1 hover:bg-gray-200 dark:hover:bg-gray-800 rounded transition">
                                                {selectedTaskIds.length > 0 && selectedTaskIds.length === filteredQueue.length
                                                    ? <CheckSquare size={14} className="text-blue-500" /> : <Square size={14} />}
                                            </button>
                                        </th>
                                        <th className={`${isCompact ? 'p-2' : 'p-4'} w-20`}>ID</th>
                                        <th className={`${isCompact ? 'p-2' : 'p-4'} w-56`}>Destination Node</th>
                                        <th className={`${isCompact ? 'p-2' : 'p-4'}`}>Payload Preview</th>
                                        <th className={`${isCompact ? 'p-2' : 'p-4'} w-36`}>T-Minus / ETA</th>
                                        <th className={`${isCompact ? 'p-2' : 'p-4'} w-28 text-center`}>Status</th>
                                        <th className={`${isCompact ? 'p-2' : 'p-4'} w-32 text-center`}>Actions</th>
                                    </tr>
                                </thead>
                                <tbody className={`divide-y divide-gray-100 dark:divide-[#30363d] text-xs`} onClick={handleTableClick}>
                                    {filteredQueue.length === 0
                                        ? <tr><td colSpan="7" className="p-12 text-center text-gray-500 dark:text-gray-600">{queue.length === 0 ? 'No tasks found.' : 'No tasks match this filter.'}</td></tr>
                                        : filteredQueue.map(row => (
                                            <tr key={row.id} className={`hover:bg-gray-50 dark:hover:bg-[#1f242c] transition group ${processingIds.has(row.id) ? 'opacity-50 pointer-events-none' : ''} ${row.status === 'CANCELLED' ? 'opacity-40' : ''}`}>
                                                <td className={`${isCompact ? 'p-2' : 'p-4'}`}>
                                                    <button onClick={e => { e.stopPropagation(); toggleSingle(row.id); }} className="p-1">
                                                        {selectedTaskIds.includes(row.id)
                                                            ? <CheckSquare size={14} className="text-blue-500" /> : <Square size={14} />}
                                                    </button>
                                                </td>
                                                <td className={`${isCompact ? 'p-2' : 'p-4'} font-mono text-gray-500`}>#{row.id}</td>
                                                <td className={`${isCompact ? 'p-2' : 'p-4'} font-medium text-slate-800 dark:text-white max-w-[180px]`}>
                                                    <div className="truncate" title={row.group_name}>{row.group_name || 'Unknown'}</div>
                                                    <div className="text-[10px] text-gray-600 font-mono truncate">{row.group_id}</div>
                                                </td>
                                                <td className={`${isCompact ? 'p-2' : 'p-4'} text-gray-400 max-w-xs`}>
                                                    <div className="truncate" title={row.content}>"{row.content}"</div>
                                                </td>
                                                <td className={`${isCompact ? 'p-2' : 'p-4'} text-gray-500 font-mono text-[10px]`}>
                                                    <div className="flex flex-col gap-0.5">
                                                        <TaskTimer
                                                            targetTime={row.scheduled_time || row.scheduled_at}
                                                            status={row.status}
                                                            onComplete={() => fetchAllData(true)}
                                                        />
                                                        <span className={row.status === 'PENDING' ? 'opacity-50 text-[9px]' : ''}>
                                                            {new Date(row.scheduled_time || row.scheduled_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                                        </span>
                                                    </div>
                                                </td>
                                                <td className={`${isCompact ? 'p-2' : 'p-4'} text-center`}>
                                                    <span className={`px-2 py-1 rounded text-[10px] font-bold border inline-flex w-24 justify-center ${getStatusBadge(row.status)}`}>
                                                        {row.status}
                                                    </span>
                                                    {row.failure_reason && (
                                                        <div className="mt-1 text-[9px] text-rose-400 font-medium max-w-[140px] truncate flex items-center gap-1" title={row.failure_reason}>
                                                            <AlertTriangle size={9} className="flex-shrink-0" />
                                                            {row.failure_reason}
                                                        </div>
                                                    )}
                                                    {!isCompact && statusTimestamps[row.id] && (() => {
                                                        const ORDER = ['PENDING', 'SENT', 'PROCESSING', 'SUCCESS', 'FAILED', 'CANCELLED'];
                                                        const entries = ORDER.filter(s => statusTimestamps[row.id]?.[s]);
                                                        if (entries.length === 0) return null;
                                                        return (
                                                            <div className="mt-1.5 space-y-0.5 text-left">
                                                                {entries.map((s, i) => (
                                                                    <div key={s} className={`flex items-center gap-1 text-[9px] font-mono ${s === row.status ? 'text-blue-300 font-bold' : 'text-gray-600'}`}>
                                                                        <span className={`w-1 h-1 rounded-full flex-shrink-0 ${s === row.status ? 'bg-blue-400' : 'bg-gray-700'}`} />
                                                                        <span>{statusTimestamps[row.id][s]}</span>
                                                                        <span className={`text-[8px] ${s === row.status ? 'text-blue-400/70' : 'text-gray-700'}`}>{s}</span>
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        );
                                                    })()}
                                                </td>
                                                <td className={`${isCompact ? 'p-2' : 'p-4'} text-center`}>
                                                    <div className="flex items-center justify-center gap-1.5 opacity-0 group-hover:opacity-100 transition">
                                                        {row.status === 'PENDING' && (<>
                                                            <button data-action="edit" data-task-id={row.id}
                                                                aria-label="ערוך משימה"
                                                                className="p-1.5 hover:bg-blue-500/20 text-blue-400 rounded transition" title="Edit payload">
                                                                <Edit3 size={13} />
                                                            </button>
                                                            <button data-action="abort" data-task-id={row.id}
                                                                aria-label="בטל משימה"
                                                                className="p-1.5 hover:bg-orange-500/20 text-orange-400 rounded transition" title="Cancel this task">
                                                                <Ban size={13} />
                                                            </button>
                                                        </>)}
                                                        {row.status === 'PROCESSING' && (
                                                            <span className="text-[9px] text-yellow-500 font-bold px-1">LIVE</span>
                                                        )}
                                                        <button data-action="delete" data-task-id={row.id}
                                                            aria-label="מחק משימה"
                                                            className="p-1.5 hover:bg-red-500/20 text-red-500 rounded transition" title="Delete record">
                                                            <Trash2 size={13} />
                                                        </button>
                                                    </div>
                                                </td>
                                            </tr>
                                        ))
                                    }
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            </main>

            {/* ── EDIT MODAL ── */}
            {editingTask && (
                <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
                    <div className="bg-white dark:bg-[#161b22] border border-gray-200 dark:border-[#30363d] w-full max-w-lg rounded-xl shadow-2xl overflow-hidden">
                        <div className="p-6 border-b border-gray-200 dark:border-[#30363d] flex justify-between items-center bg-gray-50 dark:bg-[#1c2128]">
                            <h2 className="text-slate-900 dark:text-white font-bold flex items-center gap-2">
                                <Edit3 size={18} className="text-blue-500" /> Patch Task #{editingTask.id}
                            </h2>
                            <button onClick={() => setEditingTask(null)} aria-label="סגור" className="text-gray-500 hover:text-white transition"><X size={20} /></button>
                        </div>
                        <div className="p-6 space-y-4">
                            <div className="space-y-1">
                                <label className="text-[10px] font-bold text-gray-500 uppercase">Payload Content</label>
                                <textarea className="w-full h-32 bg-gray-50 dark:bg-[#0d1117] border border-gray-200 dark:border-[#30363d] rounded-lg p-3 text-sm text-slate-800 dark:text-white focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 transition resize-none outline-none"
                                    defaultValue={editingTask.content} id="edit-content" />
                            </div>
                            <div className="space-y-1">
                                <label className="text-[10px] font-bold text-gray-500 uppercase">New T-Minus Schedule</label>
                                <div className="bg-white dark:bg-white border border-gray-300 rounded-lg px-3 py-2 flex items-center">
                                    <CalendarIcon size={16} className="text-gray-800 mr-2" />
                                    <input type="datetime-local" className="bg-transparent text-black text-xs w-full outline-none font-medium"
                                        defaultValue={(() => { const d = new Date(editingTask.scheduled_time); const pad = n => String(n).padStart(2, "0"); return d.getFullYear() + "-" + pad(d.getMonth()+1) + "-" + pad(d.getDate()) + "T" + pad(d.getHours()) + ":" + pad(d.getMinutes()); })()} id="edit-time" style={{ colorScheme: 'light' }} />
                                </div>
                            </div>
                        </div>
                        <div className="p-6 bg-gray-50 dark:bg-[#0d1117] flex justify-end gap-3 border-t border-gray-100 dark:border-transparent">
                            <button onClick={() => setEditingTask(null)} className="px-4 py-2 text-xs font-bold uppercase text-gray-400 hover:text-white transition">Cancel</button>
                            <button onClick={() => {
                                const content = document.getElementById('edit-content').value;
                                const time    = document.getElementById('edit-time').value;
                                handleUpdate(editingTask.id, { content, scheduled_time: new Date(time).toISOString() });
                            }} className="px-6 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-bold uppercase tracking-widest transition flex items-center gap-2">
                                <Save size={14} /> Update Protocol
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ── SAVE FOLDER MODAL ── */}
            {showFolderModal && (
                <SaveFolderModal
                    selectedGroups={selectedGroups} groups={groups}
                    onSave={handleSaveFolder} onClose={() => setShowFolderModal(false)} />
            )}

            {/* ── STOP WORKER MODAL ── */}
            {showStopModal && (
                <StopWorkerModal
                    workerActive={workerStatus.status === 'ACTIVE'}
                    onConfirm={handleStopWorker}
                    onClose={() => setShowStopModal(false)} />
            )}

            {/* ── SAVE POST TEMPLATE MODAL ── */}
            {showTemplateModal && (
                <SavePostTemplateModal
                    content={postContent}
                    mediaUrl={mediaPreview}
                    onSave={handleSaveTemplate}
                    onClose={() => setShowTemplateModal(false)} />
            )}

            {/* ── AI POST ASSISTANT MODAL ── */}
            {showAiModal && (
                <AiPostAssistantModal
                    onInsert={handleInsertAiContent}
                    onClose={() => setShowAiModal(false)} />
            )}

            {/* ── FOOTER ── */}
            <footer className="fixed bottom-0 w-full h-8 bg-white dark:bg-[#0d1117] border-t border-gray-200 dark:border-[#30363d] flex items-center justify-between px-6 text-[10px] text-slate-500 dark:text-gray-500 uppercase tracking-wider z-50 transition-colors duration-300">
                <div className="flex items-center gap-4">
                    <span className="flex items-center gap-1">
                        <div className={`w-1.5 h-1.5 rounded-full ${serverStatus ? 'bg-green-500' : 'bg-red-500'}`} />
                        API Core: <span className={serverStatus ? 'text-green-400' : 'text-red-400'}>{serverStatus ? 'Online' : 'Disconnected'}</span>
                    </span>
                    <span className="flex items-center gap-1">
                        <div className={`w-1.5 h-1.5 rounded-full ${workerStatus.status === 'ACTIVE' ? 'bg-green-500' : 'bg-red-500 animate-pulse'}`} />
                        Worker: {workerStopped ? <span className="text-red-400 font-bold">STOPPED</span> : (workerStatus.status === 'ACTIVE' ? <span className="text-green-400">ACTIVE</span> : workerStatus.message)}
                    </span>
                </div>
                <span className={`${integrity.status === 'MISMATCH' ? 'text-red-500 font-bold' : 'text-gray-600'}`}>
                    v{integrity.version}
                    <span className="text-[9px] bg-gray-100 dark:bg-[#21262d] px-1 rounded ml-1 border border-gray-200 dark:border-[#30363d]">PROD</span>
                </span>
            </footer>
        </div>
    );
}

function StatBox({ label, value, icon }) {
    return (
        <div className="bg-white dark:bg-[#161b22] border border-gray-200 dark:border-[#30363d] p-5 rounded-lg flex items-center justify-between shadow-sm transition-colors duration-300">
            <div>
                <div className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">{label}</div>
                <div className="text-2xl font-bold text-slate-900 dark:text-white mt-1">{value}</div>
            </div>
            <div className="p-2 bg-gray-100 dark:bg-[#0d1117] rounded-lg border border-gray-200 dark:border-[#30363d]">{icon}</div>
        </div>
    );
}

function getStatusBadge(status) {
    if (status === 'COMPLETED' || status === 'SUCCESS')
        return 'bg-green-100 dark:bg-green-900/20 border-green-200 dark:border-green-800 text-green-700 dark:text-green-400';
    if (status === 'FAILED')
        return 'bg-red-100 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-red-700 dark:text-red-400';
    if (status === 'SENT')
        return 'bg-sky-100 dark:bg-sky-900/20 border-sky-200 dark:border-sky-800 text-sky-700 dark:text-sky-400 animate-pulse';
    if (status === 'PROCESSING')
        return 'bg-blue-100 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-400 status-pulse';
    if (status === 'CANCELLED')
        return 'bg-gray-100 dark:bg-gray-800/40 border-gray-300 dark:border-gray-700 text-gray-500 dark:text-gray-500 line-through';
    if (status === 'PENDING_APPROVAL')
        return 'bg-yellow-50 dark:bg-yellow-900/10 border-yellow-200 dark:border-yellow-700 text-yellow-700 dark:text-yellow-500';
    return 'bg-yellow-100 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800 text-yellow-700 dark:text-yellow-400';
}
