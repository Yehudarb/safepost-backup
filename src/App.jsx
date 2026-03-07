import React, { useState, useEffect, useCallback } from 'react';
import {
    Layers, Calendar as CalendarIcon, Shield, CheckCircle,
    AlertTriangle, RefreshCw, Send, CheckSquare, Square, XCircle,
    Edit3, Trash2, Save, X, Sun, Moon, Paperclip, Clock,
    FolderPlus, Folder, Search, Ban, Zap, StopCircle
} from 'lucide-react';
import { Calendar } from '@/components/ui/calendar-bento';
import { io } from 'socket.io-client';
import TaskTimer from '@/components/TaskTimer';

const API_BASE = "http://localhost:3001/api";
const socket = io("http://localhost:3001");

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
    static async uploadFile(file) {
        const formData = new FormData();
        formData.append('file', file);
        const res = await fetch(`${API_BASE}/upload`, { method: 'POST', body: formData });
        if (!res.ok) throw new Error(`Upload Failed: ${res.status}`);
        return await res.json();
    }
}

// ---------------------------------------------------------------------------
// COUNTDOWN TIMER
// ---------------------------------------------------------------------------
function CountdownTimer({ queue, fetchAllData }) {
    const [timeLeft, setTimeLeft] = useState(null);
    const [activeTask, setActiveTask] = useState(null);

    useEffect(() => {
        // Find the "Critical Path" task: Either SENT, PROCESSING, or the next earliest PENDING
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

        const tick = () => {
            const diff = new Date(activeTask.scheduled_time) - new Date();
            setTimeLeft(Math.max(0, diff));
            if (diff <= 0) fetchAllData(true);
        };

        tick();
        const iv = setInterval(tick, 1000);
        return () => clearInterval(iv);
    }, [activeTask, fetchAllData]);

    if (!activeTask) return null;

    // Rendering logic based on state
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
            <div className="bg-[#161b22] border border-[#30363d] w-full max-w-sm rounded-xl shadow-2xl overflow-hidden">
                <div className="p-4 border-b border-[#30363d] flex justify-between items-center bg-[#1c2128]">
                    <h2 className="text-white font-bold text-sm flex items-center gap-2">
                        <FolderPlus size={16} className="text-blue-400" /> Save as Folder
                    </h2>
                    <button onClick={onClose} className="text-gray-500 hover:text-white transition"><X size={18} /></button>
                </div>
                <div className="p-4 space-y-4">
                    <div>
                        <label className="text-[10px] font-bold text-gray-500 uppercase tracking-widest block mb-1.5">Folder Name</label>
                        <input autoFocus
                            className="w-full bg-[#0d1117] border border-[#30363d] rounded-lg px-3 py-2 text-sm text-white focus:ring-1 focus:ring-blue-500 outline-none"
                            placeholder='e.g. "Real Estate Groups"'
                            value={name} onChange={e => setName(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && submit()} />
                    </div>
                    <div className="bg-[#0d1117] border border-[#30363d] rounded-lg p-3">
                        <p className="text-[10px] text-gray-500 uppercase tracking-widest mb-2">Saving {selectedGroups.length} groups</p>
                        <div className="space-y-1 max-h-32 overflow-y-auto">
                            {selectedGroups.slice(0, 8).map(id => {
                                const g = groups.find(x => x.id === id);
                                return g ? <div key={id} className="text-[11px] text-gray-400 truncate" dir="rtl">{g.name}</div> : null;
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
                <div className="p-4 bg-[#0d1117] flex justify-end gap-2 border-t border-[#30363d]">
                    <button onClick={onClose} className="px-4 py-2 text-xs text-gray-400 hover:text-white font-bold uppercase transition">Cancel</button>
                    <button onClick={submit} disabled={!name.trim() || saving}
                        className="px-5 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-[#21262d] disabled:text-gray-600 text-white rounded-lg text-xs font-bold uppercase tracking-widest transition flex items-center gap-2">
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
            <div className="bg-[#161b22] border border-red-900/50 w-full max-w-md rounded-xl shadow-2xl overflow-hidden">
                <div className="p-4 border-b border-red-900/40 bg-red-900/20 flex items-center gap-3">
                    <StopCircle size={20} className="text-red-400 shrink-0" />
                    <div>
                        <h2 className="text-white font-bold text-sm">Send Stop Signal</h2>
                        <p className="text-[10px] text-red-400 mt-0.5">Worker will halt after current operation</p>
                    </div>
                </div>
                <div className="p-5 space-y-3">
                    <div className="bg-[#0d1117] border border-[#30363d] rounded-lg p-3 text-xs text-gray-400 space-y-2">
                        <p>• The extension will <span className="text-white font-bold">not pick up new jobs</span> for 10 minutes</p>
                        <p>• Any task <span className="text-yellow-400 font-bold">currently PROCESSING</span> will still complete</p>
                        <p>• Use <span className="text-green-400 font-bold">"Resume Worker"</span> to restore normal operation</p>
                        <p>• To stop immediately — also <span className="text-orange-400 font-bold">Cancel All Pending</span> tasks</p>
                    </div>
                    {workerActive && (
                        <div className="flex items-center gap-2 px-3 py-2 bg-yellow-900/20 border border-yellow-800/40 rounded-lg">
                            <AlertTriangle size={12} className="text-yellow-400 shrink-0" />
                            <span className="text-[11px] text-yellow-400">Worker is currently ACTIVE — a post may be mid-execution</span>
                        </div>
                    )}
                </div>
                <div className="p-4 flex justify-end gap-2 border-t border-[#30363d] bg-[#0d1117]">
                    <button onClick={onClose} className="px-4 py-2 text-xs text-gray-400 hover:text-white font-bold uppercase transition">Cancel</button>
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

    // Modals
    const [editingTask, setEditingTask]         = useState(null);
    const [showFolderModal, setShowFolderModal] = useState(false);
    const [showStopModal, setShowStopModal]     = useState(false);

    // View
    const [isCompact, setIsCompact] = useState(localStorage.getItem('isCompact') === 'true');
    const toggleCompact = () => setIsCompact(p => { localStorage.setItem('isCompact', !p); return !p; });

    // Group management
    const [groupSearch, setGroupSearch]         = useState('');
    const [groupSets, setGroupSets]             = useState([]);
    const [showFoldersPanel, setShowFoldersPanel] = useState(false);

    // Action loading states
    const [isCancelling, setIsCancelling]   = useState(false);
    const [isStoppingWorker, setIsStoppingWorker] = useState(false);
    const [isSyncingGroups, setIsSyncingGroups] = useState(false);
    const [extensionId, setExtensionId] = useState(null);

    // Status timeline: { [taskId]: { [status]: "HH:MM:SS" } }
    const [statusTimestamps, setStatusTimestamps] = useState({});

    // --- DATA FETCHING ---
    const fetchAllData = useCallback(async (silent = false) => {
        if (!silent) setLoading(true);
        try {
            const [gData, qData, sData, gsData] = await Promise.all([
                ApiService.getGroups(),
                ApiService.getQueue(),
                ApiService.getSystemStatus(),
                ApiService.getGroupSets().catch(() => ({ sets: [] }))
            ]);
            setGroups(gData.groups || []);
            setQueue(qData.queue || []);
            // Seed timestamps from DB fields (non-destructive — won't overwrite live-tracked times)
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
        } catch {
            setServerStatus(false);
        } finally {
            if (!silent) setLoading(false);
        }
    }, []);

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

    // --- MISSION HANDLERS ---
    const handleLaunch = async () => {
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
            const data = await ApiService.createPosts({ group_ids: selectedGroups, content: postContent, schedule: scheduleTime, media_url: mediaUrl });
            alert(`🚀 Success! Queued ${data.count} posts.`);
            setPostContent(''); setSelectedGroups([]); setScheduleTime('');
            setSelectedFile(null); setMediaPreview(null);
            fetchAllData();
        } catch (e) { alert(`❌ Error: ${e.message}`); }
        finally { setIsSubmitting(false); }
    };

    // Delete task — warns if PROCESSING
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

    // Abort a PENDING task → sets to CANCELLED (keeps the record)
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
        // Safety: auto-clear spinner after 90s if no socket event arrives
        const safetyTimer = setTimeout(() => {
            setIsSyncingGroups(false);
            alert('⏱️ הסנכרון לקח יותר מדי זמן. בדוק שה-extension פועל ופייסבוק פתוח.');
        }, 90000);
        try {
            // Push sync command — extension gets it instantly via SSE, fallback via heartbeat
            const res = await fetch(`${API_BASE}/groups/request-sync`, { method: 'POST' });
            const data = await res.json();
            if (!res.ok || !data.success) {
                clearTimeout(safetyTimer);
                throw new Error(data.error || 'שגיאת שרת');
            }
            // Spinner cleared by socket 'groups_updated' or 'groups_sync_failed'
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
        total:     queue.length,
        pending:   queue.filter(q => q.status === 'PENDING').length,
        processing: queue.filter(q => q.status === 'PROCESSING').length,
        completed: queue.filter(q => q.status === 'COMPLETED' || q.status === 'SUCCESS').length,
        failed:    queue.filter(q => q.status === 'FAILED').length,
        cancelled: queue.filter(q => q.status === 'CANCELLED').length,
    };
    const filteredGroups = groupSearch
        ? groups.filter(g => g.name.toLowerCase().includes(groupSearch.toLowerCase()))
        : groups;

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
                    {/* Stop / Resume Worker */}
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
                        className="p-2 hover:bg-gray-200 dark:hover:bg-[#242c38] rounded-full transition text-slate-500 dark:text-gray-400">
                        {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
                    </button>
                    <button onClick={() => fetchAllData()}
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
                            <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest flex items-center gap-2">
                                <span className="w-1 h-1 bg-blue-500 rounded-full" /> Content Architecture
                            </label>
                            <textarea
                                className="w-full h-28 bg-gray-50 dark:bg-[#0d1117] border border-gray-200 dark:border-[#30363d] rounded-lg p-3 text-sm text-slate-800 dark:text-white focus:ring-1 focus:ring-blue-500 outline-none transition resize-none"
                                placeholder="Construct post content..."
                                value={postContent} onChange={e => setPostContent(e.target.value)} />
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
                                <div className="relative bg-[#0d1117] rounded-lg overflow-hidden border border-[#30363d]">
                                    {mediaPreview?.type.startsWith('video') ? (
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
                                <div className="flex items-center gap-2">
                                    <button
                                        onClick={handleSyncGroups}
                                        disabled={isSyncingGroups}
                                        title="סנכרן קבוצות מפייסבוק של המשתמש המחובר"
                                        className="text-[10px] font-bold uppercase flex items-center gap-1 px-2 py-0.5 rounded border transition text-green-400 border-green-800/50 hover:bg-green-900/20 disabled:opacity-50">
                                        <RefreshCw size={11} className={isSyncingGroups ? 'animate-spin' : ''} />
                                        {isSyncingGroups ? 'מסנכרן...' : 'סנכרן FB'}
                                    </button>
                                    <button
                                        onClick={() => setShowFoldersPanel(p => !p)}
                                        className={`text-[10px] font-bold uppercase flex items-center gap-1 px-2 py-0.5 rounded border transition ${showFoldersPanel ? 'bg-blue-600 text-white border-blue-600' : 'text-blue-400 border-blue-800/50 hover:bg-blue-900/20'}`}>
                                        <Folder size={11} /> Folders {groupSets.length > 0 && `(${groupSets.length})`}
                                    </button>
                                    <button
                                        onClick={() => selectedGroups.length === groups.length ? setSelectedGroups([]) : setSelectedGroups(groups.map(g => g.id))}
                                        className="text-[10px] text-blue-400 font-bold hover:underline uppercase transition">
                                        {selectedGroups.length === groups.length ? 'Wipe' : 'All'}
                                    </button>
                                </div>
                            </div>

                            {/* Folders Panel */}
                            {showFoldersPanel && (
                                <div className="bg-[#0d1117] border border-[#30363d] rounded-lg p-2 space-y-1">
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
                                                    className="opacity-0 group-hover:opacity-100 p-1 text-red-500 hover:bg-red-500/10 rounded transition">
                                                    <Trash2 size={11} />
                                                </button>
                                            </div>
                                        ))
                                    }
                                </div>
                            )}

                            {/* Search */}
                            <div className="relative">
                                <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                                <input type="text" placeholder="Filter groups…"
                                    value={groupSearch} onChange={e => setGroupSearch(e.target.value)}
                                    className="w-full pl-7 pr-7 py-1.5 bg-gray-50 dark:bg-[#0d1117] border border-gray-200 dark:border-[#30363d] rounded-lg text-xs text-slate-700 dark:text-gray-300 placeholder-gray-400 focus:ring-1 focus:ring-blue-500 outline-none transition" />
                                {groupSearch && (
                                    <button onClick={() => setGroupSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-300 transition">
                                        <X size={11} />
                                    </button>
                                )}
                            </div>

                            {/* List */}
                            <div className="max-h-48 overflow-y-auto pr-1 custom-scrollbar">
                                {filteredGroups.length === 0
                                    ? <p className="text-[10px] text-gray-500 text-center py-4">{groupSearch ? `No match for "${groupSearch}"` : 'No groups loaded.'}</p>
                                    : filteredGroups.map(g => (
                                        <div key={g.id}
                                            onClick={() => setSelectedGroups(p => p.includes(g.id) ? p.filter(x => x !== g.id) : [...p, g.id])}
                                            className={`flex items-center justify-between p-2 px-3 rounded-lg cursor-pointer transition border mb-1 ${selectedGroups.includes(g.id) ? 'bg-blue-50/50 dark:bg-blue-900/10 border-blue-100 dark:border-blue-800/50' : 'border-transparent hover:bg-gray-50 dark:hover:bg-white/5'}`}>
                                            <span className={`text-xs truncate flex-1 text-right ${selectedGroups.includes(g.id) ? 'text-blue-300 font-bold' : 'text-gray-400 font-medium'}`} dir="rtl">{g.name}</span>
                                            <div className="ml-3 shrink-0">
                                                {selectedGroups.includes(g.id)
                                                    ? <CheckSquare size={16} className="text-blue-500" />
                                                    : <Square size={16} className="text-gray-600" />}
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
                        <button onClick={handleLaunch} disabled={isSubmitting || !selectedGroups.length}
                            className={`w-full py-4 rounded-xl font-bold text-xs uppercase tracking-widest flex items-center justify-center gap-2 transition ${isSubmitting || !selectedGroups.length ? 'bg-[#21262d] text-gray-600' : 'bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-900/40 status-pulse'}`}>
                            {isSubmitting ? <RefreshCw size={14} className="animate-spin" /> : <Send size={14} />}
                            {isSubmitting ? 'Transmitting…' : 'Initiate Sequence'}
                        </button>
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
                    <div className="grid grid-cols-5 gap-4 mb-8">
                        <StatBox label="Total"            value={stats.total}      icon={<Layers      className="text-blue-500" />} />
                        <StatBox label="Pending"          value={stats.pending}    icon={<Clock       className="text-yellow-500" />} />
                        <StatBox label="Processing"       value={stats.processing} icon={<Zap         className="text-blue-400" />} />
                        <StatBox label="Successful"       value={stats.completed}  icon={<CheckCircle className="text-green-500" />} />
                        <StatBox label="Failed/Abort"     value={stats.failed + stats.cancelled} icon={<XCircle className="text-red-500" />} />
                    </div>

                    {/* Operation Feed */}
                    <div className="bg-white dark:bg-[#161b22] border border-gray-200 dark:border-[#30363d] rounded-xl overflow-hidden shadow-sm">
                        <div className="p-4 border-b border-gray-200 dark:border-[#30363d] flex justify-between items-center bg-gray-50 dark:bg-[#1c2128]">
                            <div className="flex items-center gap-3">
                                <h3 className="font-bold text-slate-800 dark:text-white text-sm flex items-center gap-2">
                                    <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" /> Live Operation Feed
                                </h3>
                                <CountdownTimer queue={queue} fetchAllData={fetchAllData} />
                            </div>
                            <div className="flex items-center gap-2">
                                {/* Cancel All Pending */}
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
                                                {selectedTaskIds.length > 0 && selectedTaskIds.length === queue.length
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
                                <tbody className={`divide-y divide-gray-100 dark:divide-[#30363d] ${isCompact ? 'text-[11px]' : 'text-xs'}`} onClick={handleTableClick}>
                                    {queue.length === 0
                                        ? <tr><td colSpan="7" className="p-12 text-center text-gray-500 dark:text-gray-600">No active operations in this sector.</td></tr>
                                        : queue.map(row => (
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
                                                    {/* Status Timeline */}
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
                                                                className="p-1.5 hover:bg-blue-500/20 text-blue-400 rounded transition" title="Edit payload">
                                                                <Edit3 size={13} />
                                                            </button>
                                                            <button data-action="abort" data-task-id={row.id}
                                                                className="p-1.5 hover:bg-orange-500/20 text-orange-400 rounded transition" title="Cancel this task">
                                                                <Ban size={13} />
                                                            </button>
                                                        </>)}
                                                        {row.status === 'PROCESSING' && (
                                                            <span className="text-[9px] text-yellow-500 font-bold px-1">LIVE</span>
                                                        )}
                                                        <button data-action="delete" data-task-id={row.id}
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
                            <button onClick={() => setEditingTask(null)} className="text-gray-500 hover:text-white transition"><X size={20} /></button>
                        </div>
                        <div className="p-6 space-y-4">
                            <div className="space-y-1">
                                <label className="text-[10px] font-bold text-gray-500 uppercase">Payload Content</label>
                                <textarea className="w-full h-32 bg-gray-50 dark:bg-[#0d1117] border border-gray-200 dark:border-[#30363d] rounded-lg p-3 text-sm text-slate-800 dark:text-white focus:ring-1 focus:ring-blue-500 transition resize-none outline-none"
                                    defaultValue={editingTask.content} id="edit-content" />
                            </div>
                            <div className="space-y-1">
                                <label className="text-[10px] font-bold text-gray-500 uppercase">New T-Minus Schedule</label>
                                <div className="bg-white dark:bg-white border border-gray-300 rounded-lg px-3 py-2 flex items-center">
                                    <CalendarIcon size={16} className="text-gray-800 mr-2" />
                                    <input type="datetime-local" className="bg-transparent text-black text-xs w-full outline-none font-medium"
                                        defaultValue={new Date(editingTask.scheduled_time).toISOString().slice(0, 16)} id="edit-time" style={{ colorScheme: 'light' }} />
                                </div>
                            </div>
                        </div>
                        <div className="p-6 bg-gray-50 dark:bg-[#0d1117] flex justify-end gap-3 border-t border-gray-100 dark:border-transparent">
                            <button onClick={() => setEditingTask(null)} className="px-4 py-2 text-xs font-bold uppercase text-gray-400 hover:text-white transition">Cancel</button>
                            <button onClick={() => {
                                const content = document.getElementById('edit-content').value;
                                const time    = document.getElementById('edit-time').value;
                                handleUpdate(editingTask.id, { content, scheduled_time: time });
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
