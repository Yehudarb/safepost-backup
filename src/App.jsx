import React, { useState, useEffect, useCallback } from 'react';
import {
    Layers, Calendar as CalendarIcon, Shield, CheckCircle,
    AlertTriangle, RefreshCw, Send, CheckSquare, Square, XCircle,
    Edit3, Trash2, Save, X, Sun, Moon, Paperclip, Clock,
    FolderPlus, Folder, Search, Ban, Zap, StopCircle,
    Sparkles, Info, Smile, Scissors, AlignLeft, Languages, Hash, Megaphone,
    GripVertical, BarChart3, RotateCcw, MonitorSmartphone,
    Plus, Rocket, Radio, Terminal, ChevronLeft, Facebook, ChevronDown
} from 'lucide-react';
import { Calendar } from '@/components/ui/calendar-bento';
import { io } from 'socket.io-client';
import { getAuthHeaders, getAccessToken, getActiveWorkspaceId } from '@/lib/session';
import TaskTimer from '@/components/TaskTimer';
import Toast from '@/components/Toast';
import SaveFolderModal from '@/components/modals/SaveFolderModal';
import StopWorkerModal from '@/components/modals/StopWorkerModal';
import SavePostTemplateModal from '@/components/modals/SavePostTemplateModal';
import AiPostAssistantModal from '@/components/modals/AiPostAssistantModal';
import ErrorBoundary from '@/components/ErrorBoundary';
import StitchAnalytics from '@/components/StitchAnalytics';
import LiveClock from '@/components/LiveClock';
import Footer from '@/components/Footer';
import ConsentBanner, { hasAcceptedTos } from '@/components/ConsentBanner';
import Legal from '@/pages/Legal';
import AccessibilityWidget from '@/components/AccessibilityWidget/vee/AccessibilityWidget';
import { API_BASE, BACKEND_URL } from '@/lib/apiConfig';
import { useLanguage } from '@/lib/i18n';

// Socket connection: in dev use localhost:3001, in prod use the backend URL
const SOCKET_URL = BACKEND_URL || 'http://localhost:3001';
let socket = null;

// Initialize socket.io only when needed (lazy initialization)
function initSocket() {
    if (socket) return socket;
    socket = io(SOCKET_URL, {
        reconnection: true,
        reconnectionDelay: 2000,
        reconnectionDelayMax: 30000,
        reconnectionAttempts: Infinity,
        transports: ['websocket', 'polling'],
        // Auth handshake: re-evaluated on every (re)connect so the current access
        // token + active workspace are sent once the user signs in.
        auth: (cb) => {
            getAccessToken()
                .then((token) => cb({ token: token || null, workspaceId: getActiveWorkspaceId() }))
                .catch(() => cb({ token: null, workspaceId: getActiveWorkspaceId() }));
        },
    });
    // Reconnect with fresh auth when the session changes (login/logout).
    window.addEventListener('safepost:auth-changed', () => {
        try { socket.disconnect(); socket.connect(); } catch { /* noop */ }
    });
    return socket;
}

// --- SSRF GUARD ---
const PRIVATE_IP_PATTERNS = [
    /^127\./,
    /^10\./,
    /^172\.(1[6-9]|2\d|3[01])\./,
    /^192\.168\./,
    /^169\.254\./,         // cloud metadata (AWS/GCP/Azure)
    /^::1$/,               // IPv6 loopback
    /^fd[0-9a-f]{2}:/i,    // IPv6 private (fd00::/8)
];
function isSafeUrl(urlStr) {
    // Allow relative URLs (proxy routes like /api/*)
    if (urlStr.startsWith('/')) return true;
    try {
        const { hostname, protocol } = new URL(urlStr);
        if (!['http:', 'https:'].includes(protocol)) return false;
        // Allow local development hosts and the current LAN host.
        if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '0.0.0.0') return true;
        if (typeof window !== 'undefined' && hostname === window.location.hostname) return true;
        if (PRIVATE_IP_PATTERNS.some(p => p.test(hostname))) return false;
        return true;
    } catch { return false; }
}

// --- API SERVICE LAYER ---
class ApiService {
    static async getHealth() {
        const res = await fetch(`${BACKEND_URL}/api/health`, { credentials: 'omit' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.json();
    }

    static async request(endpoint, options = {}) {
        const url = `${API_BASE}${endpoint}`;
        if (!url.startsWith(API_BASE) || !isSafeUrl(url))
            throw new Error('Blocked: request URL is not allowed');
        const headers = { 'Content-Type': 'application/json', ...(await getAuthHeaders()), ...options.headers };
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
    static getCurrentProfile()               { return this.request('/profile/current'); }
    static getQueue()                        { return this.request('/queue'); }
    static getSystemStatus()                 { return this.request('/system/status'); }
    static getGroupSets()                    { return this.request('/group-sets'); }
    static createPosts(data)                 { return this.request('/posts', { method: 'POST', body: JSON.stringify(data) }); }
    static setGroupTimezone(id, facebook_user, timezone) { return this.request(`/groups/${encodeURIComponent(id)}/timezone`, { method: 'PATCH', body: JSON.stringify({ facebook_user, timezone }) }); }
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
        const res = await fetch(`${API_BASE}/upload`, { method: 'POST', headers: await getAuthHeaders(), body: formData });
        if (!res.ok) throw new Error(`Upload Failed: ${res.status}`);
        return await res.json();
    }
    static generateAiContent(prompt, history = []) { return this.request('/ai/generate', { method: 'POST', body: JSON.stringify({ prompt, history }) }); }
    static getAnalytics()                           { return this.request('/analytics'); }
    // --- Workers (extension pairing) ---
    static getWorkers()                             { return this.request('/workers'); }
    static createPairingCode()                      { return this.request('/workers/pairing-code', { method: 'POST' }); }
    static renameWorker(id, worker_name)            { return this.request(`/workers/${id}`, { method: 'PATCH', body: JSON.stringify({ worker_name }) }); }
    static revokeWorker(id)                         { return this.request(`/workers/${id}/revoke`, { method: 'POST' }); }
    static removeWorker(id)                         { return this.request(`/workers/${id}`, { method: 'DELETE' }); }
}

// ---------------------------------------------------------------------------
// 2026-07 "Mission Control" redesign ׳’ג‚¬ג€ presentational helpers
// ---------------------------------------------------------------------------

// Literal (non-computed) class-name maps so Tailwind's static scanner emits
// every variant used here ׳’ג‚¬ג€ building class strings at runtime (e.g. via
// `.replace('text-','bg-')`) is invisible to Tailwind's JIT and silently
// produces unstyled elements in the production build.
const LED_STYLES = {
    PENDING:    { dot: 'bg-amber-400',   ring: 'border-amber-400' },
    SENT:       { dot: 'bg-sky-400',     ring: 'border-sky-400' },
    PROCESSING: { dot: 'bg-blue-400',    ring: 'border-blue-400' },
    SUCCESS:    { dot: 'bg-emerald-400', ring: 'border-emerald-400' },
    COMPLETED:  { dot: 'bg-emerald-400', ring: 'border-emerald-400' },
    FAILED:     { dot: 'bg-rose-400',    ring: 'border-rose-400' },
    CANCELLED:  { dot: 'bg-gray-400',    ring: 'border-gray-400' },
};

function getStatusBadge(status) {
    // rounded-full tinted pill (soft bg + matching border + colored text)
    if (status === 'COMPLETED' || status === 'SUCCESS')
        return 'rounded-full bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/30 text-emerald-700 dark:text-emerald-400 font-bold';
    if (status === 'FAILED')
        return 'rounded-full bg-rose-50 dark:bg-rose-500/10 border-rose-200 dark:border-rose-500/30 text-rose-600 dark:text-rose-400 font-bold';
    if (status === 'SENT')
        return 'rounded-full bg-sky-50 dark:bg-sky-500/10 border-sky-200 dark:border-sky-500/30 text-sky-600 dark:text-sky-400 font-bold animate-pulse';
    if (status === 'PROCESSING')
        return 'rounded-full bg-blue-50 dark:bg-blue-500/10 border-blue-200 dark:border-blue-500/30 text-blue-600 dark:text-blue-400 font-bold status-pulse';
    if (status === 'CANCELLED')
        return 'rounded-full bg-gray-100 dark:bg-gray-500/10 border-gray-200 dark:border-gray-500/30 text-gray-500 dark:text-gray-400 font-bold line-through';
    if (status === 'PENDING_APPROVAL')
        return 'rounded-full bg-amber-50 dark:bg-amber-500/10 border-amber-200 dark:border-amber-500/30 text-amber-600 dark:text-amber-400 font-bold';
    return 'rounded-full bg-amber-50 dark:bg-amber-500/10 border-amber-200 dark:border-amber-500/30 text-amber-600 dark:text-amber-400 font-bold'; // default: PENDING
}

// ---------------------------------------------------------------------------
// HERO COUNTDOWN ׳’ג‚¬ג€ big digital clock + radar rings. Replaces the old
// header-embedded CountdownTimer; same underlying state machine (SENT
// handshake / PROCESSING publish / PENDING next-post), now the centerpiece
// of the hero band instead of a small pill.
// ---------------------------------------------------------------------------
function HeroCountdown({ queue }) {
    const [now, setNow] = useState(Date.now());
    useEffect(() => {
        const iv = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(iv);
    }, []);

    const activeTask = React.useMemo(() => {
        const current = queue.find(q => ['SENT', 'PROCESSING'].includes(q.status));
        const nextPending = [...queue]
            .filter(q => q.status === 'PENDING')
            .sort((a, b) => new Date(a.scheduled_time) - new Date(b.scheduled_time))[0];
        return current || nextPending || null;
    }, [queue]);

    let mm = '--', ss = '--', label = 'No active mission', colorClass = 'text-brand dark:text-brand-dark', sub = null;

    if (activeTask) {
        if (activeTask.status === 'SENT' || activeTask.status === 'PROCESSING') {
            const elapsed = Math.max(0, Math.floor((now - new Date(activeTask.created_at || now).getTime()) / 1000));
            const mins = Math.floor(elapsed / 60);
            // The MM:SS boxes only have room for 2 digits each. A task that's been
            // stuck for hours/days (e.g. no worker ever connected) used to overflow
            // "mm" into a raw, unformatted minute count instead of wrapping — freeze
            // the visible clock at 59:59 and say so in the label instead.
            const displayElapsed = Math.min(elapsed, 59 * 60 + 59);
            mm = String(Math.floor(displayElapsed / 60)).padStart(2, '0');
            ss = String(displayElapsed % 60).padStart(2, '0');
            if (activeTask.status === 'SENT') {
                label = mins > 5 ? 'Worker not responding' : 'Waiting for Worker...';
                colorClass = mins > 5 ? 'text-rose-500' : elapsed > 20 ? 'text-amber-500' : 'text-sky-500';
            } else {
                label = mins > 4 ? 'Task stalled' : mins > 2 ? 'Publishing (slow)' : 'Post in progress';
                colorClass = mins > 4 ? 'text-rose-500' : mins > 2 ? 'text-amber-500' : 'text-emerald-500';
            }
        } else {
            const diffMs = Math.max(0, new Date(activeTask.scheduled_time).getTime() - now);
            const s = Math.floor(diffMs / 1000);
            mm = String(Math.floor(s / 60)).padStart(2, '0');
            ss = String(s % 60).padStart(2, '0');
            label = 'Until next post';
            colorClass = s < 30 ? 'text-rose-500' : 'text-brand dark:text-brand-dark';
        }
        sub = `Task #${activeTask.id}${activeTask.group_name ? ' | ' + activeTask.group_name : ''}`;
    }

    return (
        <div className="relative flex w-full max-w-[360px] mx-auto flex-col items-center justify-center py-8 px-4 min-h-[200px]">
            <svg width={200} height={200} className="absolute pointer-events-none opacity-70" style={{ top: '50%', left: '50%', transform: 'translate(-50%,-50%)' }}>
                {[1, 2, 3].map(i => (
                    <circle key={i} cx={100} cy={100} r={36 + i * 22} fill="none"
                        className="stroke-brand dark:stroke-brand-dark" style={{ strokeOpacity: 0.15 - i * 0.03 }} strokeWidth={1} />
                ))}
                <circle cx={100} cy={100} r={40} fill="none" className="stroke-brand dark:stroke-brand-dark radar-sweep" strokeOpacity={0.5} strokeWidth={1.5}
                    strokeDasharray="4 8" style={{ transformOrigin: '100px 100px' }} />
            </svg>
            <div className="text-[10px] font-bold text-gray-500 dark:text-gray-400 tracking-[0.2em] mb-1 z-10 uppercase">{label}</div>
            <div dir="ltr" className={`font-mono text-6xl font-bold tracking-tight z-10 flex items-center gap-1 ${colorClass}`}>
                <span>{mm}</span><span className="blink-colon">:</span><span>{ss}</span>
            </div>
            {sub && <div className="text-[11px] font-medium text-gray-500 dark:text-gray-400 mt-1.5 z-10">{sub}</div>}
        </div>
    );
}

// ---------------------------------------------------------------------------
// STATUS RING ׳’ג‚¬ג€ donut chart summarizing the whole queue at a glance.
// ---------------------------------------------------------------------------
function StatusRing({ stats }) {
    const { t } = useLanguage();
    const segments = [
        { value: stats.pending,                    colorClass: 'text-amber-400' },
        { value: stats.processing,                 colorClass: 'text-blue-400' },
        { value: stats.completed,                  colorClass: 'text-emerald-400' },
        { value: stats.failed + stats.cancelled,   colorClass: 'text-rose-400' },
    ];
    const total = segments.reduce((a, s) => a + s.value, 0) || 1;
    const R = 52, C = 2 * Math.PI * R;
    let offset = 0;
    return (
        <div className="relative w-[150px] h-[150px] mx-auto">
            <svg width={150} height={150} className="-rotate-90">
                <circle cx={75} cy={75} r={R} fill="none" className="stroke-gray-100 dark:stroke-[#30363d]" strokeWidth={10} />
                {segments.map((s, i) => {
                    if (s.value === 0) return null;
                    const len = (s.value / total) * C;
                    const dashOffset = -offset;
                    offset += len;
                    return (
                        <circle key={i} cx={75} cy={75} r={R} fill="none" className={s.colorClass}
                            stroke="currentColor" strokeWidth={10}
                            strokeDasharray={`${len} ${C - len}`} strokeDashoffset={dashOffset}
                            style={{ transition: 'all .4s' }} />
                    );
                })}
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
                <div dir="ltr" className="font-mono text-3xl font-bold text-gray-900 dark:text-white leading-none">{total}</div>
                <div className="text-[9px] font-bold text-gray-500 dark:text-gray-400 tracking-widest mt-1">{t('statusRingTasksLabel')}</div>
            </div>
        </div>
    );
}

// ---------------------------------------------------------------------------
// MISSION CARD — replaces the old table row. Same fields/actions, card layout.
// ---------------------------------------------------------------------------
function MissionCard({ row, isCompact, selected, onToggleSelect, statusTimestamps, onEdit, onAbort, onRetry, onDelete, processing }) {
    const { t } = useLanguage();
    const led = LED_STYLES[row.status] || LED_STYLES.PENDING;
    const pulse = ['PENDING', 'SENT', 'PROCESSING'].includes(row.status);
    const timestampsForRow = statusTimestamps[row.id];
    const ORDER = ['PENDING', 'SENT', 'PROCESSING', 'SUCCESS', 'FAILED', 'CANCELLED'];
    const timelineEntries = timestampsForRow ? ORDER.filter(s => timestampsForRow[s]) : [];

    return (
        <div className={`group bg-white dark:bg-[#161b22] border border-gray-100 dark:border-[#30363d] rounded-xl grid grid-cols-[auto_1fr_auto_auto_auto] items-center gap-4 transition-all ${isCompact ? 'p-2.5' : 'p-3.5'} ${processing ? 'opacity-50 pointer-events-none' : ''} ${row.status === 'CANCELLED' ? 'opacity-60' : ''} hover:border-gray-200 dark:hover:border-[#3d444d] hover:shadow-sm`}>

            {/* select + LED */}
            <div className="flex items-center gap-2.5">
                <button onClick={() => onToggleSelect(row.id)} aria-label={t('selectTaskAria')} className="shrink-0">
                    {selected ? <CheckSquare size={14} className="text-brand" /> : <Square size={14} className="text-gray-300 dark:text-gray-400" />}
                </button>
                <div className="relative w-2.5 h-2.5 shrink-0">
                    <div className={`w-2.5 h-2.5 rounded-full ${led.dot}`} />
                    {pulse && <div className={`absolute inset-0 rounded-full border-2 ${led.ring} animate-ping`} />}
                </div>
                <span dir="ltr" className="font-mono text-[10px] text-gray-500 dark:text-gray-400 font-semibold">#{row.id}</span>
            </div>

            {/* details */}
            <div className="min-w-0">
                <div className={`font-semibold text-gray-900 dark:text-white truncate ${isCompact ? 'text-[12px]' : 'text-[13.5px]'} ${row.status === 'CANCELLED' ? 'line-through' : ''}`}>
                    {row.group_url ? (
                        <a href={row.group_url} target="_blank" rel="noreferrer" className="hover:text-brand transition" title={row.group_name}>{row.group_name || 'Unknown'}</a>
                    ) : (row.group_name || 'Unknown')}
                </div>
                <div className="flex items-center gap-2 flex-wrap mt-0.5">
                    <span className="text-[11px] text-gray-500 dark:text-gray-400 truncate max-w-[220px]" title={row.content}>"{row.content}"</span>
                    {row.failure_reason && (
                        <span className="text-[10px] text-rose-500 font-medium flex items-center gap-1 truncate max-w-[180px]" title={row.failure_reason}>
                            <AlertTriangle size={9} className="shrink-0" /> {row.failure_reason}
                        </span>
                    )}
                </div>
                {!isCompact && timelineEntries.length > 0 && (
                    <div className="flex items-center gap-2.5 mt-1 flex-wrap">
                        {timelineEntries.map(s => (
                            <span key={s} className={`text-[9px] font-mono flex items-center gap-1 ${s === row.status ? 'text-brand font-bold' : 'text-gray-500 dark:text-gray-400'}`}>
                                <span className={`w-1 h-1 rounded-full ${s === row.status ? 'bg-brand' : 'bg-gray-300 dark:bg-gray-700'}`} />
                                {timestampsForRow[s]} <span className="opacity-60">{s}</span>
                            </span>
                        ))}
                    </div>
                )}
            </div>

            {/* ETA */}
            <div className="text-center min-w-[76px]">
                <TaskTimer targetTime={row.scheduled_time || row.scheduled_at} status={row.status} onComplete={() => {}} />
                <div dir="ltr" className="text-[9px] text-gray-500 dark:text-gray-400 mt-0.5">
                    {new Date(row.scheduled_time || row.scheduled_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </div>
            </div>

            {/* status pill */}
            <span className={`px-2.5 py-1 text-[10px] font-bold border inline-flex min-w-[5.5rem] justify-center whitespace-nowrap ${getStatusBadge(row.status)}`}>{row.status}</span>

            {/* actions */}
            <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition">
                {row.status === 'PENDING' && (<>
                    <button onClick={() => onEdit(row)} aria-label={t('editTaskAria')} className="p-3 hover:bg-blue-500/10 text-blue-400 rounded-lg transition" title={t('editTitle')}><Edit3 size={13} /></button>
                    <button onClick={() => onAbort(row.id)} aria-label={t('cancelTaskAria')} className="p-3 hover:bg-orange-500/10 text-orange-400 rounded-lg transition" title={t('cancelTitle')}><Ban size={13} /></button>
                </>)}
                {row.status === 'PROCESSING' && <span className="text-[9px] text-blue-500 font-bold px-1">LIVE</span>}
                {row.status === 'FAILED' && (
                    <button onClick={() => onRetry(row)} aria-label={t('retryLabel')} className="p-3 hover:bg-blue-500/10 text-blue-400 rounded-lg transition" title={t('retryLabel')}><RotateCcw size={13} /></button>
                )}
                <button onClick={() => onDelete(row.id)} aria-label={t('deleteTaskAria')} className="p-3 hover:bg-red-500/10 text-red-500 rounded-lg transition" title={t('deleteTitle')}><Trash2 size={13} /></button>
            </div>
        </div>
    );
}

function MissionCardCompact({ row, isCompact, selected, onToggleSelect, statusTimestamps, onEdit, onAbort, onRetry, onDelete, processing }) {
    const { t } = useLanguage();
    const led = LED_STYLES[row.status] || LED_STYLES.PENDING;
    const pulse = ['PENDING', 'SENT', 'PROCESSING'].includes(row.status);
    const timestampsForRow = statusTimestamps[row.id];
    const ORDER = ['PENDING', 'SENT', 'PROCESSING', 'SUCCESS', 'FAILED', 'CANCELLED'];
    const timelineEntries = timestampsForRow ? ORDER.filter(s => timestampsForRow[s]) : [];

    return (
        <div className={`group bg-white dark:bg-[#161b22] border border-gray-100 dark:border-[#30363d] rounded-xl grid grid-cols-[auto_1fr_auto_auto_auto] items-center gap-3 transition-all ${isCompact ? 'p-2' : 'p-2.5'} ${processing ? 'opacity-50 pointer-events-none' : ''} ${row.status === 'CANCELLED' ? 'opacity-60' : ''} hover:border-gray-200 dark:hover:border-[#3d444d] hover:shadow-sm`}>
            <div className="flex items-center gap-2">
                <button onClick={() => onToggleSelect(row.id)} aria-label={t('selectTaskAria')} className="shrink-0">
                    {selected ? <CheckSquare size={13} className="text-brand" /> : <Square size={13} className="text-gray-300 dark:text-gray-400" />}
                </button>
                <div className="relative w-2 h-2 shrink-0">
                    <div className={`w-2 h-2 rounded-full ${led.dot}`} />
                    {pulse && <div className={`absolute inset-0 rounded-full border-2 ${led.ring} animate-ping`} />}
                </div>
                <span dir="ltr" className="font-mono text-[9px] text-gray-500 dark:text-gray-400 font-semibold">#{row.id}</span>
            </div>

            <div className="min-w-0">
                <div className={`font-semibold text-gray-900 dark:text-white truncate ${isCompact ? 'text-[11.5px]' : 'text-[12.5px]'} ${row.status === 'CANCELLED' ? 'line-through' : ''}`}>
                    {row.group_url ? (
                        <a href={row.group_url} target="_blank" rel="noreferrer" className="hover:text-brand transition" title={row.group_name}>{row.group_name || 'Unknown'}</a>
                    ) : (row.group_name || 'Unknown')}
                </div>
                <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
                    <span className="text-[10px] text-gray-500 dark:text-gray-400 truncate max-w-[180px] lg:max-w-[240px]" title={row.content}>"{row.content}"</span>
                    {row.failure_reason && (
                        <span className="text-[9px] text-rose-500 font-medium flex items-center gap-1 truncate max-w-[160px] lg:max-w-[220px]" title={row.failure_reason}>
                            <AlertTriangle size={8} className="shrink-0" /> {row.failure_reason}
                        </span>
                    )}
                </div>
                {!isCompact && timelineEntries.length > 0 && (
                    <div className="hidden lg:flex items-center gap-2 mt-1 flex-wrap">
                        {timelineEntries.map(s => (
                            <span key={s} className={`text-[8px] font-mono flex items-center gap-1 ${s === row.status ? 'text-brand font-bold' : 'text-gray-500 dark:text-gray-400'}`}>
                                <span className={`w-1 h-1 rounded-full ${s === row.status ? 'bg-brand' : 'bg-gray-300 dark:bg-gray-700'}`} />
                                {timestampsForRow[s]} <span className="opacity-60">{s}</span>
                            </span>
                        ))}
                    </div>
                )}
            </div>

            <div className="text-center min-w-[68px]">
                <TaskTimer targetTime={row.scheduled_time || row.scheduled_at} status={row.status} onComplete={() => {}} />
                <div dir="ltr" className="text-[8px] text-gray-500 dark:text-gray-400 mt-0.5">
                    {new Date(row.scheduled_time || row.scheduled_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </div>
            </div>

            <span className={`px-2 py-0.5 text-[9px] font-bold border inline-flex min-w-[4.75rem] justify-center whitespace-nowrap ${getStatusBadge(row.status)}`}>{row.status}</span>

            <div className={`flex items-center gap-1 ${isCompact ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'} transition`}>
                {row.status === 'PENDING' && (<>
                    <button onClick={() => onEdit(row)} aria-label={t('editTaskAria')} className="p-1 hover:bg-blue-500/10 text-blue-400 rounded-md transition" title={t('editTitle')}><Edit3 size={12} /></button>
                    <button onClick={() => onAbort(row.id)} aria-label={t('cancelTaskAria')} className="p-1 hover:bg-orange-500/10 text-orange-400 rounded-md transition" title={t('cancelTitle')}><Ban size={12} /></button>
                </>)}
                {row.status === 'PROCESSING' && <span className="text-[8px] text-blue-500 font-bold px-1">LIVE</span>}
                {row.status === 'FAILED' && (
                    <button onClick={() => onRetry(row)} aria-label={t('retryLabel')} className="p-1 hover:bg-blue-500/10 text-blue-400 rounded-md transition" title={t('retryLabel')}><RotateCcw size={12} /></button>
                )}
                <button onClick={() => onDelete(row.id)} aria-label={t('deleteTaskAria')} className="p-1 hover:bg-red-500/10 text-red-500 rounded-md transition" title={t('deleteTitle')}><Trash2 size={12} /></button>
            </div>
        </div>
    );
}

// ---------------------------------------------------------------------------
// TICKER — fixed bottom activity strip, fed by real socket events (App()
// pushes into `recentEvents`; no mock/fake data).
// ---------------------------------------------------------------------------
function Ticker({ events }) {
    const { t } = useLanguage();
    const items = events.length > 0 ? events : [t('noRecentActivity')];
    const loopItems = [...items, ...items];
    return (
        <div role="region" aria-label="Recent activity" className="fixed bottom-0 left-0 right-0 h-8 bg-white dark:bg-[#161b22] border-t border-gray-200 dark:border-[#30363d] flex items-center overflow-hidden text-[11px] z-40">
            <div className="flex items-center gap-1.5 px-3.5 h-full shrink-0 bg-brand-soft dark:bg-brand/10 text-brand dark:text-brand-dark font-bold border-l border-gray-200 dark:border-[#30363d]">
                <Radio size={11} /> LIVE
            </div>
            <div className="flex gap-10 whitespace-nowrap pr-10 ticker-track">
                {loopItems.map((e, i) => (
                    <span key={i} className="text-gray-500 dark:text-gray-400">
                        <span className="text-gray-300 dark:text-gray-400 ml-1.5">•</span> {e}
                    </span>
                ))}
            </div>
        </div>
    );
}

// ---------------------------------------------------------------------------
// FOCUS TRAP HELPERS — shared by the command palette and modal dialogs so
// Tab/Shift+Tab cycle within the open overlay instead of escaping to the page.
// ---------------------------------------------------------------------------
const FOCUSABLE_SELECTOR = 'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

function trapTabKey(e, container) {
    if (e.key !== 'Tab' || !container) return;
    const list = Array.from(container.querySelectorAll(FOCUSABLE_SELECTOR)).filter(el => el.offsetParent !== null);
    if (!list.length) return;
    const first = list[0];
    const last = list[list.length - 1];
    if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
    }
}

// ---------------------------------------------------------------------------
// COMMAND PALETTE — Ctrl/Cmd+K, wired to real handlers passed in via `items`.
// ---------------------------------------------------------------------------
function CommandPalette({ open, onClose, items }) {
    const { t } = useLanguage();
    const containerRef = React.useRef(null);

    useEffect(() => {
        if (!open) return;
        const el = containerRef.current;
        const focusable = el?.querySelector(FOCUSABLE_SELECTOR);
        focusable?.focus();
    }, [open]);

    if (!open) return null;

    const handleKeyDown = (e) => {
        if (e.key === 'Escape') { onClose(); return; }
        trapTabKey(e, containerRef.current);
    };

    return (
        <div onClick={onClose} className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[200] flex items-start justify-center pt-24 px-4">
            <div ref={containerRef} onClick={e => e.stopPropagation()} onKeyDown={handleKeyDown}
                role="dialog" aria-modal="true" aria-label={t('commandPaletteAria')}
                className="w-full max-w-lg bg-white dark:bg-[#161b22] rounded-2xl overflow-hidden border border-gray-200 dark:border-[#30363d] shadow-2xl">
                <div className="flex items-center gap-2.5 px-4 py-3.5 border-b border-gray-100 dark:border-[#30363d]">
                    <Search size={15} className="text-gray-400" />
                    <span className="flex-1 text-sm text-gray-400">{t('searchActionPlaceholder')}</span>
                    <span dir="ltr" className="text-[10px] font-mono text-gray-400 bg-gray-100 dark:bg-[#0d1117] px-1.5 py-0.5 rounded">ESC</span>
                </div>
                <div className="p-2">
                    {items.map((it, i) => (
                        <button key={i} type="button" onClick={() => { it.action?.(); onClose(); }}
                            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-right text-[13px] text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-[#1c2128] transition">
                            <span className="text-brand dark:text-brand-dark">{it.icon}</span>
                            <span className="flex-1">{it.label}</span>
                            {it.shortcut && <span dir="ltr" className="text-[10px] font-mono text-gray-400 bg-gray-100 dark:bg-[#0d1117] px-1.5 py-0.5 rounded">{it.shortcut}</span>}
                        </button>
                    ))}
                </div>
            </div>
        </div>
    );
}

// ---------------------------------------------------------------------------
// FACEBOOK ACCOUNT PILL — shows current connected FB account in header
// ---------------------------------------------------------------------------
function FacebookAccountPill({ accountName, accountStatus, onAccountChange }) {
    const { t } = useLanguage();
    if (accountStatus === undefined) accountStatus = t('connectedLabel');
    const [open, setOpen] = useState(false);
    const [editMode, setEditMode] = useState(false);
    const [newAccount, setNewAccount] = useState(accountName || '');
    const normalizedAccountName = typeof accountName === 'string' ? accountName.trim() : '';
    const hasConnectedAccount = normalizedAccountName && normalizedAccountName !== t('notConnectedLabel');

    const openFacebookProfile = () => {
        if (!hasConnectedAccount) return;

        const looksLikeUsername = /^[A-Za-z0-9._-]+$/.test(normalizedAccountName);
        const targetUrl = looksLikeUsername
            ? `https://www.facebook.com/${encodeURIComponent(normalizedAccountName)}`
            : `https://www.facebook.com/search/top/?q=${encodeURIComponent(normalizedAccountName)}`;

        window.open(targetUrl, '_blank', 'noopener,noreferrer');
        setOpen(false);
    };

    return (
        <div style={{ position: "relative" }}>
            <button
                type="button"
                onClick={() => setOpen(!open)}
                aria-haspopup="true"
                aria-expanded={open}
                aria-label={t('connectedFbAccountAria', { name: accountName })}
                style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "6px 12px",
                    borderRadius: 8,
                    border: `1px solid #e5e7eb`,
                    background: "#f3f4f6",
                    color: "#1f2937",
                    cursor: "pointer",
                    fontSize: 12,
                    fontWeight: 600,
                    fontFamily: "'Noto Sans', sans-serif",
                    transition: "all .15s",
                }}
                onMouseEnter={e => e.currentTarget.style.boxShadow = `0 2px 8px rgba(59, 130, 246, 0.1)`}
                onMouseLeave={e => e.currentTarget.style.boxShadow = "none"}
                className="dark:bg-[#0d1117] dark:border-[#30363d] dark:text-gray-200"
            >
                <Facebook size={13} />
                <span>{accountName}</span>
                <ChevronDown size={12} style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform .2s" }} />
            </button>

            {open && (
                <div
                    onClick={() => setOpen(false)}
                    style={{
                        position: "fixed",
                        inset: 0,
                        zIndex: 49,
                    }}
                />
            )}

            {open && (
                <div
                    style={{
                        position: "absolute",
                        top: "100%",
                        right: 0,
                        marginTop: 6,
                        width: 220,
                        background: "white",
                        border: `1px solid #e5e7eb`,
                        borderRadius: 10,
                        overflow: "hidden",
                        boxShadow: "0 4px 12px rgba(0,0,0,.1)",
                        zIndex: 50,
                    }}
                    className="dark:bg-[#161b22] dark:border-[#30363d]"
                >
                    <div style={{ padding: "8px 12px", borderBottom: `1px solid #e5e7eb` }} className="dark:border-[#30363d]">
                        <div style={{ fontSize: 10, fontWeight: 700, color: "#6b7280", letterSpacing: "0.1em" }} className="dark:text-gray-400">
                            Connected profile
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={openFacebookProfile}
                        disabled={!hasConnectedAccount}
                        title={hasConnectedAccount ? t('openInFacebook') : t('noProfileConnected')}
                        style={{
                            width: "100%",
                            padding: "10px 12px",
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            textAlign: "right",
                            border: "none",
                            background: "transparent",
                            cursor: hasConnectedAccount ? "pointer" : "default",
                            opacity: hasConnectedAccount ? 1 : 0.6,
                            transition: "background .15s ease",
                        }}
                        onMouseEnter={e => {
                            if (hasConnectedAccount) e.currentTarget.style.background = "#f8fafc";
                        }}
                        onMouseLeave={e => {
                            e.currentTarget.style.background = "transparent";
                        }}
                        className="dark:hover:bg-[#0d1117]"
                    >
                        <div style={{ width: 32, height: 32, borderRadius: "50%", background: "#f3f4f6", display: "flex", alignItems: "center", justifyContent: "center" }} className="dark:bg-[#0d1117]">
                            <Facebook size={16} color="#3b82f6" />
                        </div>
                        <div style={{ minWidth: 0, flex: 1 }}>
                            <div style={{ fontSize: 12, fontWeight: 600, color: "#1f2937" }} className="dark:text-white">
                                {accountName}
                            </div>
                            <div style={{ fontSize: 10, color: "#6b7280", marginTop: 1 }} className="dark:text-gray-400">
                                {accountStatus}
                            </div>
                        </div>
                        <div style={{ fontSize: 10, color: "#3b82f6", fontWeight: 700, whiteSpace: "nowrap" }}>
                            {t('openLabel')}
                        </div>
                    </button>
                </div>
            )}
        </div>
    );
}

// ---------------------------------------------------------------------------
// MAIN APP
// ---------------------------------------------------------------------------
export default function App() {
    const { lang, t, toggleLang } = useLanguage();

    // Core state
    const [groups, setGroups]           = useState([]);
    const [queue, setQueue]             = useState([]);
    const [serverStatus, setServerStatus] = useState(false);
    const consecutiveFailures = React.useRef(0);
    const [workerStatus, setWorkerStatus] = useState({ status: 'OFFLINE', message: 'Initializing...' });
    const [integrity, setIntegrity]     = useState({ version: 'UNKNOWN', status: 'UNKNOWN' });
    const [loading, setLoading]         = useState(false);
    const [theme, setTheme]             = useState(localStorage.getItem('theme') || 'dark');
    const [workerStopped, setWorkerStopped] = useState(false);

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
    // A-B content variants (Item 5) — when active, groups are round-robin
    // assigned onto these instead of the single postContent field. Requires
    // migration 0009 (posts.variant_label) applied server-side.
    const [useVariants, setUseVariants]       = useState(false);
    const [variants, setVariants]             = useState([{ label: 'A', content: '' }, { label: 'B', content: '' }]);

    // Facebook User Isolation
    const [currentUser, setCurrentUser]       = useState(
        localStorage.getItem('safepost_currentUser')
        || localStorage.getItem('safepost_detectedFacebookUser')
        || ''
    );
    const [currentUserId, setCurrentUserId]   = useState(
        localStorage.getItem('safepost_currentUserId') || ''
    );
    const [uniqueUsers, setUniqueUsers]       = useState([]);

    // Mission Control shell state (2026-07 redesign)
    const [showDrawer, setShowDrawer]     = useState(false);
    const [showPalette, setShowPalette]   = useState(false);
    const [recentEvents, setRecentEvents] = useState([]);
    const [isQueueCollapsed, setIsQueueCollapsed] = useState(localStorage.getItem('queueCollapsed') !== 'false');

    // Focus management: remember what triggered an overlay so focus can return
    // to it on close, and refs to the first field inside each overlay so focus
    // can move there the moment it opens.
    const drawerTriggerRef = React.useRef(null);
    const postContentRef = React.useRef(null);
    const editModalFirstFieldRef = React.useRef(null);
    const editModalPreviousFocusRef = React.useRef(null);
    const openDrawer = useCallback(() => {
        drawerTriggerRef.current = document.activeElement;
        setShowDrawer(true);
    }, []);
    const closeDrawer = useCallback(() => {
        setShowDrawer(false);
        // Return focus to whatever opened the drawer. The FAB button unmounts
        // while the drawer is open, so the original ref target is detached by
        // the time we close — fall back to the FAB's stable id in that case.
        // setTimeout, not requestAnimationFrame: rAF is paused entirely while
        // the tab isn't visible, which would silently drop the focus restore.
        setTimeout(() => {
            const trigger = drawerTriggerRef.current;
            const target = trigger?.isConnected ? trigger : document.getElementById('new-post-fab');
            target?.focus?.();
        }, 0);
    }, []);
    const paletteOpenerRef = React.useRef(null);

    // Legal / compliance
    const [tosAccepted, setTosAccepted] = useState(hasAcceptedTos());
    const [legalTab, setLegalTab] = useState(null);
    const [legalAgreed, setLegalAgreed] = useState(false);

    useEffect(() => {
        document.documentElement.classList.toggle('dark', theme === 'dark');
        localStorage.setItem('theme', theme);
    }, [theme]);

    useEffect(() => {
        if (currentUser) {
            localStorage.setItem('safepost_currentUser', currentUser);
            localStorage.setItem('safepost_detectedFacebookUser', currentUser);
        } else {
            localStorage.removeItem('safepost_currentUser');
            localStorage.removeItem('safepost_detectedFacebookUser');
        }
    }, [currentUser]);

    useEffect(() => {
        if (currentUserId) {
            localStorage.setItem('safepost_currentUserId', currentUserId);
        } else {
            localStorage.removeItem('safepost_currentUserId');
        }
    }, [currentUserId]);

    useEffect(() => {
        const handleBridgeResponse = (event) => {
            const detail = event?.detail || {};
            if (detail.action !== 'CHECK_CACHE') return;
            const bridgeUser = detail.response?.user || null;
            const bridgeUserId = detail.response?.userId || null;
            if (bridgeUser) {
                setCurrentUser(prev => prev === bridgeUser ? prev : bridgeUser);
            }
            if (bridgeUserId) {
                setCurrentUserId(prev => prev === bridgeUserId ? prev : bridgeUserId);
            }
        };

        window.addEventListener('SAFEPOST_RES', handleBridgeResponse);
        try {
            window.dispatchEvent(new CustomEvent('SAFEPOST_REQ', {
                detail: { action: 'CHECK_CACHE', payload: {} }
            }));
        } catch {
            // Bridge may not be injected on every page.
        }

        return () => window.removeEventListener('SAFEPOST_RES', handleBridgeResponse);
    }, []);

    // Keep the connected Facebook account in sync with the extension. It re-detects on
    // every account switch, so we poll the server (not just fetch once) to reflect the
    // change live in the header without a manual refresh.
    useEffect(() => {
        let active = true;
        const fetchCurrentUser = async () => {
            try {
                console.log('[App] Polling /api/profile/current...');
                const response = await ApiService.getCurrentProfile();
                if (!active) return;
                const serverUser = response.current_user;
                const serverUserId = response.current_user_id || '';
                console.log('[App] Server returned current_user:', serverUser);
                if (serverUser) {
                    setCurrentUser(prev => {
                        if (prev !== serverUser) {
                            console.log('[App] currentUser changed from', prev, 'to', serverUser);
                            return serverUser;
                        }
                        return prev;
                    });
                }
                if (serverUserId) {
                    setCurrentUserId(prev => prev === serverUserId ? prev : serverUserId);
                }
            } catch (err) {
                if (!active) return;
                const stored = localStorage.getItem('safepost_currentUser') || localStorage.getItem('safepost_detectedFacebookUser');
                const storedId = localStorage.getItem('safepost_currentUserId') || '';
                if (stored) {
                    setCurrentUser(prev => {
                        if (prev !== stored) return stored;
                        return prev;
                    });
                }
                if (storedId) {
                    setCurrentUserId(prev => prev === storedId ? prev : storedId);
                }
            }
        };

        fetchCurrentUser();
        const id = setInterval(fetchCurrentUser, 10000);
        return () => { active = false; clearInterval(id); };
    }, []);

    // Ctrl/Cmd+K command palette, Escape to close overlays
    useEffect(() => {
        const handler = (e) => {
            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setShowPalette(v => !v); }
            if (e.key === 'Escape') { setShowPalette(false); }
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, []);

    // Command palette focus management: remember the trigger on open, restore on close.
    useEffect(() => {
        if (showPalette) {
            paletteOpenerRef.current = document.activeElement;
        } else if (paletteOpenerRef.current) {
            paletteOpenerRef.current.focus?.();
        }
    }, [showPalette]);

    // Launch-post drawer: move focus into the content textarea when it opens.
    useEffect(() => {
        if (showDrawer) {
            const id = setTimeout(() => postContentRef.current?.focus(), 0);
            return () => clearTimeout(id);
        }
    }, [showDrawer]);

    // Modals
    const [editingTask, setEditingTask]         = useState(null);
    const [showFolderModal, setShowFolderModal] = useState(false);
    const [showStopModal, setShowStopModal]     = useState(false);
    const [showAiModal, setShowAiModal]         = useState(false);

    // Edit-task modal: trap focus inside, move it in on open, restore on close.
    useEffect(() => {
        if (editingTask) {
            editModalPreviousFocusRef.current = document.activeElement;
            const id = setTimeout(() => editModalFirstFieldRef.current?.focus(), 0);
            return () => clearTimeout(id);
        }
        editModalPreviousFocusRef.current?.focus?.();
    }, [editingTask]);

    // View
    const [isCompact, setIsCompact] = useState(localStorage.getItem('isCompact') !== 'false');
    const toggleCompact = () => setIsCompact(p => { localStorage.setItem('isCompact', !p); return !p; });
    const toggleQueueCollapsed = () => setIsQueueCollapsed(p => { localStorage.setItem('queueCollapsed', !p); return !p; });
    const [queueFilter, setQueueFilter] = useState('all');
    const [queueSearch, setQueueSearch] = useState('');

    // Group management
    const [groupSearch, setGroupSearch]             = useState('');
    const [groupSets, setGroupSets]                 = useState([]);
    const [showFoldersPanel, setShowFoldersPanel]   = useState(false);
    const [postTemplates, setPostTemplates]         = useState([]);
    const [showTemplateModal, setShowTemplateModal] = useState(false);
    const [showLibraryPanel, setShowLibraryPanel]   = useState(false);

    // Analytics
    const [showStitchAnalytics, setShowStitchAnalytics] = useState(false);

    // Content editing toolbar
    const [contentEditLoading, setContentEditLoading] = useState(null);

    // Group ordering & drag
    const [sortSelectedFirst, setSortSelectedFirst] = useState(false);
    const [customGroupOrder, setCustomGroupOrder]   = useState(() => {
        try { return JSON.parse(localStorage.getItem('safepost_groupOrder') || '[]'); } catch { return []; }
    });
    const [draggingGroupId, setDraggingGroupId]     = useState(null);
    const [dragOverGroupId, setDragOverGroupId]     = useState(null);
    // Manual per-group timezone tag (Item 6) — which group's inline editor is open, if any.
    const [tzEditorGroupId, setTzEditorGroupId]     = useState(null);
    const [tzInputValue, setTzInputValue]           = useState('');

    // Action loading states
    const [isCancelling, setIsCancelling]         = useState(false);
    const [isResettingStuck, setIsResettingStuck] = useState(false);
    const [isStoppingWorker, setIsStoppingWorker] = useState(false);
    const [isSyncingGroups, setIsSyncingGroups]   = useState(false);
    const [extensionId, setExtensionId]           = useState(null);

    // Status timeline: { [taskId]: { [status]: "HH:MM:SS" } }
    const [statusTimestamps, setStatusTimestamps] = useState({});

    // Toast & Confirmation Dialog
    const [toast, setToast] = useState({ visible: false, message: '', type: 'info' });
    const [confirmDialog, setConfirmDialog] = useState({ show: false, message: '', onConfirm: null });

    const showToast = useCallback((message, type = 'info') => {
        setToast({ visible: true, message, type });
    }, []);

    const showConfirm = useCallback((message, onConfirm) => {
        setConfirmDialog({ show: true, message, onConfirm });
    }, []);

    const pushEvent = useCallback((message) => {
        setRecentEvents(prev => [message, ...prev].slice(0, 20));
    }, []);

    // Content Edit Actions
    const CONTENT_EDIT_ACTIONS = [
        { id: 'emojis',   icon: <Smile size={11} />,      label: t('contentActionEmojis'),   prompt: t => `הוסף אמוג'ים רלוונטיים לטקסט הזה, אל תשנה את התוכן עצמו:\n\n${t}` },
        { id: 'shorten',  icon: <Scissors size={11} />,   label: t('contentActionShorten'),  prompt: t => `קצר את הטקסט הזה בכ-30%, שמור על המסר המרכזי:\n\n${t}` },
        { id: 'expand',   icon: <AlignLeft size={11} />,  label: t('contentActionExpand'),   prompt: t => `הרחב את הטקסט הזה עם פרטים ומשיכה שיווקית, שמור על אותו טון:\n\n${t}` },
        { id: 'formal',   icon: <Megaphone size={11} />,  label: t('contentActionFormal'),   prompt: t => `תכתוב מחדש את הטקסט הזה בסגנון פורמלי ומקצועי:\n\n${t}` },
        { id: 'hashtags', icon: <Hash size={11} />,       label: t('contentActionHashtags'), prompt: t => `הוסף 3-5 האשטאגים רלוונטיים בסוף הטקסט הזה:\n\n${t}` },
        { id: 'hebrew',   icon: <Languages size={11} />,  label: t('contentActionToHebrew'), prompt: t => `תרגם את הטקסט הזה לעברית שוטפת ומדויקת:\n\n${t}` },
    ];

    // --- DATA FETCHING ---
    const fetchAllData = useCallback(async (silent = false) => {
        if (!silent) setLoading(true);
        try {
            // Build groups URL with user filter if currentUser is set
            const groupsUrl = currentUser ? `/groups?user=${encodeURIComponent(currentUser)}` : '/groups';

            const [healthRes, groupsRes, queueRes, systemRes, groupSetsRes, templatesRes, profileRes] = await Promise.allSettled([
                ApiService.getHealth(),
                ApiService.request(groupsUrl),
                ApiService.getQueue(),
                ApiService.getSystemStatus(),
                ApiService.getGroupSets(),
                ApiService.getTemplates(),
                ApiService.getCurrentProfile()
            ]);

            const groupsData = groupsRes.status === 'fulfilled' ? (groupsRes.value || {}) : {};
            // Normalize UTF-8 encoding for group names and metadata
            const rawGroups = Array.isArray(groupsData.groups) ? groupsData.groups.map(g => ({
                ...g,
                name: g.name ? (typeof g.name === 'string' ? g.name : String(g.name)) : 'Unnamed Group'
            })) : [];
            // Collapse to one row per group id. Since migration 0008 a group is keyed
            // per (workspace, facebook_user, id), so /api/groups legitimately returns
            // the same id twice — once attributed to the current account and once
            // untagged. Rendering both produced duplicate React keys (which breaks
            // list reconciliation) and, worse, put the same id twice into
            // selectedGroups → duplicate posts queued for one group.
            // Prefer the row attributed to the active account over an untagged one.
            const byId = new Map();
            rawGroups.forEach(g => {
                const prev = byId.get(g.id);
                if (!prev || (!prev.facebook_user && g.facebook_user)) byId.set(g.id, g);
            });
            const normalizedGroups = [...byId.values()];
            setGroups(normalizedGroups);

            const profileData = profileRes.status === 'fulfilled' ? (profileRes.value || {}) : {};
            const apiCurrentUser = profileData.current_user || groupsData.current_user || null;
            const apiUsers = Array.isArray(groupsData.facebook_users) ? groupsData.facebook_users : [];
            // Always update currentUser from server if available
            if (apiCurrentUser) {
                setCurrentUser(apiCurrentUser);
            } else if (!currentUser && apiUsers.length === 1) {
                setCurrentUser(apiUsers[0]);
            }

            // Extract unique facebook_user values from ALL groups (not just filtered)
            if (!currentUser) {
                const users = [...new Set(apiUsers.length ? apiUsers : normalizedGroups
                    .map(g => g.facebook_user)
                    .filter(u => u))].sort();
                setUniqueUsers(users);
            }
            const queueData = queueRes.status === 'fulfilled' ? (queueRes.value || {}) : {};
            setQueue(queueData.queue || []);
            setStatusTimestamps(prev => {
                const updated = { ...prev };
                (queueData.queue || []).forEach(task => {
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
            if (healthRes.status === 'fulfilled' && healthRes.value?.status === 'ok') {
                consecutiveFailures.current = 0;
                setServerStatus(true);
            } else {
                consecutiveFailures.current += 1;
                if (consecutiveFailures.current >= 3) setServerStatus(false);
            }
            const groupSetsData = groupSetsRes.status === 'fulfilled' ? (groupSetsRes.value || {}) : {};
            setGroupSets(groupSetsData.sets || []);
            const systemData = systemRes.status === 'fulfilled' ? (systemRes.value || {}) : null;
            if (systemData) {
                setWorkerStatus({
                    status: systemData.worker_status || 'OFFLINE',
                    message: systemData.worker_message || 'No Signal',
                    last_checkin: systemData.last_worker_checkin
                });
                setIntegrity({
                    version: systemData.worker_version || 'UNKNOWN',
                    // Keep this as a connectivity signal, not a hard version pin.
                    status: systemData.worker_version && systemData.worker_version !== 'UNKNOWN' ? 'OK' : 'MISMATCH',
                    origin: systemData.worker_origin || 'UNKNOWN'
                });
                if (systemData.worker_extension_id) setExtensionId(systemData.worker_extension_id);
            }
            const templatesData = templatesRes.status === 'fulfilled' ? (templatesRes.value || {}) : {};
            setPostTemplates(templatesData.templates || []);
        } catch (e) {
            console.error("Data fetch error:", e);
            consecutiveFailures.current += 1;
            if (consecutiveFailures.current >= 3) setServerStatus(false);
        } finally {
            if (!silent) setLoading(false);
        }
    }, [currentUser]);

    const handleSaveTemplate = async (name, content, mediaUrl) => {
        try {
            await ApiService.saveTemplate({ name, content, media_url: mediaUrl?.url || null });
            await fetchAllData(true);
            setShowTemplateModal(false);
            showToast('Template saved.', 'success');
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
        showConfirm('Are you sure you want to delete this template?', async () => {
            try {
                await ApiService.deleteTemplate(id);
                await fetchAllData(true);
            } catch (e) {
                console.error("Delete Template Error:", e);
                showToast(`Error: ${e.message}`, 'error');
            }
        });
    };

    const handleInsertAiContent = (text) => {
        setPostContent(text);
        setShowAiModal(false);
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

    // --- SOCKET LISTENERS (Real-time updates) ---
    useEffect(() => {
        const s = initSocket();
        // Direct state update when task status changes
        s.on('status_update', ({ taskId, status, group_id }) => {
            const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
            const tid = Number(taskId);

            // Update timestamps
            setStatusTimestamps(prev => ({
                ...prev,
                [tid]: { ...(prev[tid] || {}), [status]: now }
            }));

            // Update queue
            setQueue(prev => prev.map(q => q.id === tid ? { ...q, status } : q));

            pushEvent(t('eventTaskStatus', { id: tid, status }));

            // Update groups stats (if group_id is provided)
            if (group_id) {
                setGroups(prev => prev.map(g => {
                    if (g.id !== group_id) return g;

                    // Decrement old status count
                    const oldTask = queue.find(q => q.id === tid);
                    if (oldTask) {
                        const oldStatus = oldTask.status.toLowerCase();
                        if (g[oldStatus] !== undefined) g[oldStatus] = Math.max(0, g[oldStatus] - 1);
                    }

                    // Increment new status count
                    const newStatus = status.toLowerCase();
                    if (g[newStatus] !== undefined) g[newStatus] = (g[newStatus] || 0) + 1;

                    return g;
                }));
            }
        });

        // Fallback refreshes (less frequent)
        const handleRefresh = () => fetchAllData(true);
        s.on('queue_updated', handleRefresh);
        s.on('data_updated', handleRefresh);
        s.on('groups_updated', () => { setIsSyncingGroups(false); pushEvent(t('eventGroupsSynced')); fetchAllData(true); });
        s.on('groups_sync_failed', ({ error }) => { setIsSyncingGroups(false); showToast(t('groupSyncFailed', { error }), 'error'); pushEvent(t('groupSyncFailed', { error })); });
        s.on('worker_stop_signal', () => { setWorkerStopped(true); pushEvent(t('eventWorkerStopped')); fetchAllData(true); });
        s.on('worker_resumed',      () => { setWorkerStopped(false); pushEvent(t('eventWorkerResumed')); fetchAllData(true); });

        return () => {
            s.off('status_update');
            s.off('queue_updated', handleRefresh);
            s.off('data_updated', handleRefresh);
            s.off('groups_updated');
            s.off('groups_sync_failed');
            s.off('worker_stop_signal');
            s.off('worker_resumed');
        };
    }, [fetchAllData, queue, pushEvent]);

    // --- SELECTION ---
    const toggleSingle = id =>
        setSelectedTaskIds(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id]);
    // Operates on what the user can actually SEE. Using the unfiltered `queue`
    // here meant that with any filter/search active "בחר הכל" silently selected
    // rows that were off-screen — so "מחק N" showed a count larger than the list
    // and deleted tasks the user never saw. It also never matched the label's
    // `=== filteredQueue.length` check, so it never flipped to "בטל בחירה".
    const toggleAll = () =>
        setSelectedTaskIds(p =>
            p.length === filteredQueue.length ? [] : filteredQueue.map(q => q.id));

    // --- FOLDER HANDLERS ---
    const handleSaveFolder  = async name => { await ApiService.saveGroupSet(name, selectedGroups); setShowFolderModal(false); fetchAllData(true); };
    const handleLoadFolder  = set => { setSelectedGroups(set.group_ids); setShowFoldersPanel(false); };
    const handleDeleteFolder = async id => { await ApiService.deleteGroupSet(id); fetchAllData(true); };

    // --- CLEAR ALL GROUPS ---
    const handleClearAllGroups = async () => {
        showConfirm(t('confirmClearAllGroups'), async () => {
            setLoading(true);
            try {
                // Delete all groups via direct API call
                const headers = await getAuthHeaders();
                const response = await fetch(`${API_BASE}/groups`, { method: 'DELETE', headers });
                if (!response.ok) throw new Error('Failed to delete groups');

                showToast(t('allGroupsDeletedToast'), 'success');
                setSelectedGroups([]);
                await fetchAllData(true);
            } catch (e) {
                showToast(t('errorWithMessage', { message: e.message }), 'error');
                console.error('Clear groups error:', e);
            } finally {
                setLoading(false);
            }
        });
    };

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
        // Variant mode only counts variants with actual content — an empty
        // textarea left in the list shouldn't block validation or get sent.
        const activeVariants = useVariants ? variants.filter(v => v.content.trim()) : [];
        const hasContent = useVariants ? activeVariants.length > 0 : !!postContent;
        if (!selectedGroups.length || (!hasContent && !selectedFile))
            return showToast('Select groups and enter content or attach media.', 'warning');
        setIsSubmitting(true);
        try {
            let mediaUrl = null;
            if (selectedFile) {
                const up = await ApiService.uploadFile(selectedFile);
                if (!up.success) throw new Error('File upload failed');
                mediaUrl = up.file_path;
            }
            const payload = {
                group_ids: selectedGroups,
                schedule: scheduleTime ? new Date(scheduleTime).toISOString() : undefined,
                media_url: mediaUrl,
                ai_spin: useAiSpin,
                facebook_user: currentUser || null
            };
            if (useVariants && activeVariants.length > 0) {
                payload.content_variants = activeVariants.map(v => ({ label: v.label, content: v.content }));
            } else {
                payload.content = postContent;
            }
            const data = await ApiService.createPosts(payload);
            showToast(`Success! Queued ${data.count} posts.`, 'success');
            pushEvent(t('postsQueuedEvent', { count: data.count }));
            setPostContent(''); setSelectedGroups([]); setScheduleTime('');
            setSelectedFile(null); setMediaPreview(null);
            setLegalAgreed(false);
            setUseVariants(false); setVariants([{ label: 'A', content: '' }, { label: 'B', content: '' }]);
            closeDrawer();
            fetchAllData();
        } catch (e) { showToast(`Error: ${e.message}`, 'error'); }
        finally { setIsSubmitting(false); }
    };

    // Manual per-group timezone tag (Item 6). Validated server-side against
    // Intl; empty input clears the tag. Requires migration 0009 applied.
    const handleSaveGroupTimezone = async (g) => {
        try {
            await ApiService.setGroupTimezone(g.id, g.facebook_user || null, tzInputValue.trim() || null);
            setTzEditorGroupId(null);
            fetchAllData(true);
        } catch (e) { showToast(`Error: ${e.message}`, 'error'); }
    };

    const handleDelete = async id => {
        const task = queue.find(q => q.id === id);
        const msg = task?.status === 'PROCESSING'
            ? 'This task is PROCESSING by the worker.\n\nDeleting will NOT stop the extension mid-post. The post may still go through.\n\nDelete record anyway?'
            : 'Delete this task?';
        showConfirm(msg, async () => {
            const orig = [...queue];
            setQueue(p => p.filter(q => q.id !== id));
            setProcessingIds(p => new Set(p).add(id));
            try { await ApiService.deleteTask(id); }
            catch (e) { setQueue(orig); showToast(`${e.message}`, 'error'); }
            finally { setProcessingIds(p => { const n = new Set(p); n.delete(id); return n; }); }
        });
    };

    const handleAbortTask = async id => {
        setQueue(p => p.map(q => q.id === id ? { ...q, status: 'CANCELLED' } : q));
        try { await ApiService.cancelTask(id); }
        catch (e) { fetchAllData(true); showToast(`${e.message}`, 'error'); }
    };

    const handleBulkDelete = async () => {
        showConfirm(`Delete ${selectedTaskIds.length} selected tasks?`, async () => {
            const orig = [...queue];
            setQueue(p => p.filter(q => !selectedTaskIds.includes(q.id)));
            setLoading(true);
            try { await ApiService.bulkDelete(selectedTaskIds); setSelectedTaskIds([]); }
            catch (e) { setQueue(orig); showToast(`${e.message}`, 'error'); }
            finally { setLoading(false); }
        });
    };

    const handleCancelAll = async () => {
        const count = queue.filter(q => q.status === 'PENDING').length;
        if (count === 0) { showToast('No PENDING tasks to cancel.', 'info'); return; }
        showConfirm(`Cancel all ${count} pending operations? Their status will be set to CANCELLED.`, async () => {
            setIsCancelling(true);
            try { await ApiService.cancelAllPending(); fetchAllData(true); }
            catch (e) { showToast(`${e.message}`, 'error'); }
            finally { setIsCancelling(false); }
        });
    };

    const handleResetStuckTasks = async () => {
        const stuckCount = queue.filter(q => q.status === 'PROCESSING' || q.status === 'SENT').length;
        if (stuckCount === 0) { showToast('No stuck tasks found (no PROCESSING/SENT tasks).', 'info'); return; }
        showConfirm(`Reset stuck tasks (PROCESSING/SENT >4min)?\nThey will return to PENDING with new schedule.`, async () => {
            setIsResettingStuck(true);
            try {
                const headers = await getAuthHeaders();
                const res = await fetch(`${API_BASE}/tasks/reset-stuck`, { method: 'POST', headers });
                const data = await res.json();
                if (!res.ok) throw new Error(data.error);
                showToast(`Reset ${data.reset_count} stuck task(s): ${data.task_ids.join(', ')}`, 'success');
                fetchAllData(true);
            }
            catch (e) { showToast(`${e.message}`, 'error'); }
            finally { setIsResettingStuck(false); }
        });
    };

    const handleStopWorker = async () => {
        setShowStopModal(false);
        setIsStoppingWorker(true);
        try { await ApiService.stopWorker(); setWorkerStopped(true); }
        catch (e) { showToast(`${e.message}`, 'error'); }
        finally { setTimeout(() => setIsStoppingWorker(false), 2000); }
    };

    const handleResumeWorker = async () => {
        try { await ApiService.resumeWorker(); setWorkerStopped(false); }
        catch (e) { showToast(`${e.message}`, 'error'); }
    };

    const handleFixStuckTasks = async () => {
        showConfirm(t('confirmFixStuckTasks'), async () => {
            try {
                const headers = await getAuthHeaders();
                const response = await fetch(`${API_BASE}/tasks/fix-stuck`, { method: 'POST', headers });
                if (!response.ok) throw new Error('Failed to fix stuck tasks');

                const data = await response.json();
                showToast(t('stuckTasksFixedToast', { count: data.fixed }), 'success');
                await fetchAllData(true);
            } catch (e) {
                showToast(t('errorWithMessage', { message: e.message }), 'error');
            }
        });
    };

    const handleSyncGroups = async () => {
        setIsSyncingGroups(true);
        const safetyTimer = setTimeout(() => {
            setIsSyncingGroups(false);
            showToast(t('syncTimeoutWarning'), 'warning');
        }, 90000);
        try {
            const headers = { 'Content-Type': 'application/json', ...(await getAuthHeaders()) };
            // Send the currently-selected Facebook user so the server can attribute
            // this sync's groups to the right account even when the extension's
            // scan tab fails to detect the logged-in user itself.
            const body = JSON.stringify({ facebook_user: currentUser || null });
            const res = await fetch(`${API_BASE}/groups/request-sync`, { method: 'POST', headers, body });
            const data = await res.json();
            if (!res.ok || !data.success) {
                clearTimeout(safetyTimer);
                throw new Error(data.error || t('syncFailedError'));
            }
        } catch (e) {
            clearTimeout(safetyTimer);
            showToast(t('errorWithMessage', { message: e.message }), 'error');
            setIsSyncingGroups(false);
        }
    };

    const handleUpdate = async (id, data) => {
        setProcessingIds(p => new Set(p).add(id));
        try { await ApiService.updateTask(id, data); setEditingTask(null); fetchAllData(true); }
        catch (e) { showToast(`Update failed: ${e.message}`, 'error'); }
        finally { setProcessingIds(p => { const n = new Set(p); n.delete(id); return n; }); }
    };

    const handleRetryTask = async (task) => {
        try {
            const mediaFiles = task.media_paths ? task.media_paths.map(p => ({ filePath: p })) : undefined;
            await ApiService.launchPosts({
                group_ids: [String(task.group_id)],
                content: task.content || '',
                media_url: task.media_url || null,
                media_files: mediaFiles,
                facebook_user: currentUser || null
            });
            showToast('Task queued for retry', 'success');
            fetchAllData(true);
        } catch (e) {
            showToast(`Retry failed: ${e.message}`, 'error');
        }
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
    // What "בטל" can actually cancel. `stats.pending` counts PENDING + SENT (the
    // right notion of "waiting" for the tiles), but /api/tasks/cancel-all-pending
    // only touches status='PENDING'. Labelling the button with stats.pending meant
    // that when every waiting task was SENT the button showed a count, then
    // handleCancelAll bailed with "No PENDING tasks" — a button that looked live
    // but did nothing.
    const cancellablePending = queue.filter(q => q.status === 'PENDING').length;
    const filteredQueue = queue.filter(q => {
        const haystack = [
            q.content,
            q.group_name,
            q.group_id,
            q.status,
            q.failure_reason
        ].filter(Boolean).join(' ').toLowerCase();

        if (queueSearch.trim()) {
            const terms = queueSearch.toLowerCase().split(/\s+/).filter(Boolean);
            if (!terms.every(term => haystack.includes(term))) return false;
        }
        if (queueFilter === 'active') return ['PENDING', 'SENT', 'PROCESSING'].includes(q.status);
        if (queueFilter === 'done')   return ['SUCCESS', 'COMPLETED'].includes(q.status);
        if (queueFilter === 'failed') return ['FAILED', 'CANCELLED'].includes(q.status);
        return true;
    }).sort((a, b) => new Date(b.created_at || b.scheduled_time || 0) - new Date(a.created_at || a.scheduled_time || 0));

    // Groups awaiting moderator approval in Facebook cannot receive new posts.
    // Filter them out from selection entirely — they're not usable until the
    // moderator acts or the group setting is disabled. This prevents accidentally
    // queuing tasks that will hang forever waiting for approval.
    const activeGroups = orderedGroups.filter(g => !g.requires_moderation);
    const blockedGroups = orderedGroups.filter(g => g.requires_moderation);

    const filteredGroups = React.useMemo(() => {
        let base = activeGroups;  // Use only non-blocked groups for selection
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
    }, [activeGroups, groupSearch, sortSelectedFirst, selectedGroups]);

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

    // Command palette actions (wired to the real handlers above)
    const paletteItems = [
        { icon: <Plus size={14} />, label: t('newTaskLabel'), shortcut: 'N', action: () => openDrawer() },
        { icon: <StopCircle size={14} />, label: workerStopped ? t('startWorkerLabel') : t('stopWorkerLabel'), shortcut: 'S', action: workerStopped ? handleResumeWorker : () => setShowStopModal(true) },
        { icon: <Zap size={14} />, label: t('fixStuckTasksLabel'), shortcut: 'F', action: handleFixStuckTasks },
        { icon: <RefreshCw size={14} />, label: t('refreshDataLabel'), shortcut: 'R', action: () => fetchAllData() },
        { icon: <BarChart3 size={14} />, label: showStitchAnalytics ? t('hideAnalyticsLabel') : t('analyticsLabel'), shortcut: 'A', action: () => setShowStitchAnalytics(p => !p) },
        { icon: <MonitorSmartphone size={14} />, label: t('connectedDevicesLabel'), shortcut: 'D', action: () => setShowWorkers(true) },
    ];

    // -----------------------------------------------------------------------
    // RENDER
    // -----------------------------------------------------------------------
    return (
        <div className="min-h-screen bg-slate-50 dark:bg-[#0f1115] text-slate-900 dark:text-gray-300 font-sans transition-colors duration-300 pb-24">
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
                @keyframes radar-spin { to { transform: rotate(360deg); } }
                @keyframes blink { 50% { opacity: .3; } }
                @keyframes ticker-scroll {
                    from { transform: translateX(0); }
                    to { transform: translateX(100%); }
                }
                *:focus-visible {
                    outline: 2px solid #4f6ef7;
                    outline-offset: 2px;
                }
                @media (prefers-reduced-motion: no-preference) {
                    .radar-sweep { animation: radar-spin 12s linear infinite; }
                    .blink-colon { animation: blink 1s infinite; }
                    .ticker-track { animation: ticker-scroll 40s linear infinite; }
                }
                @media (prefers-reduced-motion: reduce) {
                    .status-pulse, .animate-pulse {
                        animation: none !important;
                    }
                }
            `}</style>

            {/* ── HEADER ── */}
            <header className="fixed top-0 w-full h-16 bg-white dark:bg-[#161b22] border-b border-gray-200 dark:border-[#30363d] flex items-center justify-between px-6 z-50 transition-colors duration-300">
                <div className="flex items-center gap-3">
                    <div className="bg-gradient-to-br from-brand to-brand-dark p-2 rounded-lg shadow-sm shadow-brand/30"><Terminal size={20} className="text-white" /></div>
                    <div>
                        <h1 className="text-slate-900 dark:text-white font-bold text-lg">
                            SafePost <span className="text-brand dark:text-brand-dark text-[10px] font-bold px-1.5 py-0.5 rounded bg-brand-soft dark:bg-brand/10">OS 5.1</span>
                        </h1>
                        <p className="text-[10px] text-slate-500 dark:text-gray-400 uppercase tracking-widest">Mission Control</p>
                    </div>
                </div>
                <div className="flex items-center gap-2.5">
                    <button type="button" onClick={() => setShowPalette(true)}
                        aria-haspopup="dialog" aria-expanded={showPalette}
                        className="hidden md:flex items-center gap-2 text-[11px] font-semibold px-3 py-1.5 rounded-lg border border-gray-200 dark:border-[#30363d] bg-gray-50 dark:bg-[#0d1117] text-gray-500 dark:text-gray-400 hover:border-brand hover:text-brand transition">
                        <Search size={12} /> {t('searchActionButton')}
                        <span dir="ltr" className="text-[9px] font-mono bg-gray-200 dark:bg-[#30363d] px-1.5 py-0.5 rounded">K</span>
                    </button>

                    <div className="w-px h-6 bg-gray-200 dark:bg-[#30363d] mx-0.5" />

                    <FacebookAccountPill
                        accountName={currentUser || t('notConnectedLabel')}
                        accountStatus={currentUser ? (currentUserId ? `${t('connectedLabel')} • ID ${currentUserId}` : t('connectedLabel')) : t('notConnectedLabel')}
                    />

                    <div className="w-px h-6 bg-gray-200 dark:bg-[#30363d] mx-0.5" />

                    {workerStopped ? (
                        <button onClick={handleResumeWorker}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-green-900/30 border border-green-600/60 text-green-300 rounded-lg text-[10px] font-bold uppercase tracking-widest hover:bg-green-900/50 transition">
                            <Zap size={12} /> Resume Worker
                        </button>
                    ) : (
                        <>
                            <button onClick={() => setShowStopModal(true)} disabled={isStoppingWorker}
                                className="flex items-center gap-1.5 px-3 py-1.5 bg-red-900/10 border border-red-800/40 text-red-700 dark:text-red-400 rounded-lg text-[10px] font-bold uppercase tracking-widest hover:bg-red-900/25 transition disabled:opacity-50">
                                {isStoppingWorker ? <RefreshCw size={10} className="animate-spin" /> : <StopCircle size={12} />}
                                Stop Worker
                            </button>
                        </>
                    )}
                    <button onClick={toggleLang}
                        aria-label={t('toggleLanguage')}
                        dir="ltr"
                        className="flex items-center gap-1 px-2.5 py-1.5 rounded-full transition text-[11px] font-bold tracking-wide text-slate-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-[#242c38] border border-gray-200 dark:border-[#30363d]">
                        <Languages size={14} />
                        <span>{lang === 'he' ? 'EN' : 'עב'}</span>
                    </button>
                    <button onClick={() => setTheme(p => p === 'dark' ? 'light' : 'dark')}
                        aria-label={t('toggleTheme')}
                        className="p-3 hover:bg-gray-200 dark:hover:bg-[#242c38] rounded-full transition text-slate-500 dark:text-gray-400">
                        {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
                    </button>
                    <div aria-live="polite" className={`px-3 py-1 rounded-full text-xs font-bold border flex items-center gap-2 ${serverStatus
                        ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800 text-green-700 dark:text-green-400'
                        : 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-red-700 dark:text-red-400'}`}>
                        <div className={`w-2 h-2 rounded-full ${serverStatus ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`} />
                        {serverStatus ? 'MOTHERSHIP ONLINE' : 'OFFLINE'}
                    </div>
                </div>
            </header>

            <main className="pt-16 max-w-[1280px] mx-auto px-5 md:px-6">

                {/* Worker Stop Banner */}
                {workerStopped && (
                    <div role="alert" aria-live="assertive" className="mt-5 flex items-center justify-between px-4 py-2.5 bg-red-900/20 border border-red-800/50 rounded-xl text-xs">
                        <div className="flex items-center gap-2 text-red-400 font-bold">
                            <StopCircle size={14} />
                            <span>{t('workerStoppedBanner')}</span>
                        </div>
                        <button type="button" onClick={handleResumeWorker}
                            className="px-3 py-1 bg-green-900/30 border border-green-700/50 text-green-400 rounded font-bold text-[10px] uppercase hover:bg-green-900/50 transition flex items-center gap-1">
                            <Zap size={10} /> Resume
                        </button>
                    </div>
                )}

                {/* ── HERO BAND ── */}
                <div className="mt-4 bg-white dark:bg-[#161b22] border border-gray-100 dark:border-[#30363d] rounded-2xl p-3 shadow-sm shadow-black/5">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                        <div className="min-w-0">
                            <div className="flex items-center gap-2">
                                <div className="w-8 h-8 rounded-xl bg-brand/10 text-brand dark:text-brand-dark flex items-center justify-center border border-brand/20">
                                    <Sparkles size={14} />
                                </div>
                                <div className="min-w-0">
                                    <div className="text-sm font-bold text-slate-900 dark:text-white">{t('quickActionsTitle')}</div>
                                    <div className="text-[11px] text-gray-500 dark:text-gray-400">{t('quickActionsSubtitle')}</div>
                                </div>
                                <div className="inline-flex items-center gap-2 rounded-full border border-emerald-200 dark:border-emerald-500/25 bg-emerald-50/80 dark:bg-emerald-500/10 px-3 py-1.5">
                                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse shrink-0" />
                                    <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-700 dark:text-emerald-300">{t('connectedAccountLabel')}</span>
                                    <span
                                        dir="ltr"
                                        className="max-w-[220px] truncate text-[11px] font-semibold text-slate-800 dark:text-slate-100"
                                        title={currentUser || t('notConnectedLabel')}
                                    >
                                        {currentUser || t('notConnectedLabel')}
                                    </span>
                                </div>
                            </div>
                        </div>

                        <div className="flex flex-wrap gap-2 items-center">
                            <LiveClock />
                            <button
                                type="button"
                                onClick={() => setShowStitchAnalytics(p => !p)}
                                aria-expanded={showStitchAnalytics}
                                className={`inline-flex items-center gap-2 px-3.5 py-2.5 rounded-xl border text-[11px] font-semibold transition ${
                                    showStitchAnalytics
                                        ? 'bg-indigo-600 text-white border-indigo-600'
                                        : 'bg-white dark:bg-transparent text-gray-600 dark:text-gray-400 border-gray-200 dark:border-[#30363d] hover:border-indigo-400 hover:text-indigo-600'
                                }`}>
                                <BarChart3 size={14} />
                                {showStitchAnalytics ? t('hideAnalyticsLabel') : t('analyticsLabel')}
                            </button>

                            <button
                                onClick={handleFixStuckTasks}
                                className="inline-flex items-center gap-2 px-3.5 py-2.5 rounded-xl border border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-500 text-[11px] font-semibold hover:bg-amber-500/15 transition">
                                <Zap size={14} /> Fix stuck
                            </button>

                            <button
                                onClick={() => fetchAllData()}
                                className="inline-flex items-center gap-2 px-3.5 py-2.5 rounded-xl border border-gray-200 dark:border-[#30363d] bg-white dark:bg-transparent text-gray-600 dark:text-gray-400 text-[11px] font-semibold hover:border-brand hover:text-brand transition">
                                <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
                            </button>
                        </div>
                    </div>
                </div>

                <div className="fixed left-0 top-[102px] sm:top-[118px] lg:top-[128px] z-[85] flex flex-col gap-3">
                    <button
                        onClick={handleSyncGroups}
                        className="group flex items-center gap-3 rounded-r-3xl border border-emerald-300/30 bg-gradient-to-r from-emerald-500 via-emerald-500 to-emerald-600 text-white px-4 py-3.5 w-[230px] sm:w-[240px] shadow-xl shadow-emerald-500/25 hover:pr-5 transition-all animate-pulse hover:animate-none">
                        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 border border-white/20">
                            <Radio size={15} />
                        </span>
                        <span className="text-[12px] font-extrabold whitespace-nowrap tracking-wide">{t('syncGroupsButton')}</span>
                        <ChevronLeft size={15} className="opacity-90 group-hover:translate-x-0.5 transition-transform ml-auto" />
                    </button>

                    {!showDrawer && (
                        <button
                            id="new-post-fab"
                            type="button"
                            onClick={openDrawer}
                            className="group flex items-center gap-3 rounded-r-3xl border border-brand/25 bg-gradient-to-r from-brand via-brand to-brand-dark text-white px-4 py-3.5 w-[230px] sm:w-[240px] shadow-xl shadow-brand/35 hover:pr-5 transition-all animate-pulse hover:animate-none">
                            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 border border-white/20">
                                <Send size={15} />
                            </span>
                            <span className="text-[12px] font-extrabold whitespace-nowrap tracking-wide">{t('newPostButton')}</span>
                            <ChevronLeft size={15} className="opacity-90 group-hover:translate-x-0.5 transition-transform ml-auto" />
                        </button>
                    )}
                </div>

                <div className="mt-4">
                    <div className="grid grid-cols-1 lg:grid-cols-[minmax(320px,400px)_220px_auto] lg:justify-center bg-white dark:bg-[#161b22] border border-gray-100 dark:border-[#30363d] rounded-2xl overflow-hidden">
                        <HeroCountdown queue={queue} />

                        <div className="flex flex-col items-center justify-center py-4 border-y lg:border-y-0 lg:border-x border-gray-100 dark:border-[#30363d]">
                            <StatusRing stats={stats} />
                            <div className="grid grid-cols-2 gap-x-3 gap-y-1 mt-2 px-3 w-full">
                                {[
                                    { label: t('statusPending'),   value: stats.pending,               dot: 'bg-amber-400' },
                                    { label: t('statusProcessing'),   value: stats.processing,            dot: 'bg-blue-400' },
                                    { label: t('statusCompleted'),   value: stats.completed,             dot: 'bg-emerald-400' },
                                    { label: t('statusFailed'),    value: stats.failed + stats.cancelled, dot: 'bg-rose-400' },
                                ].map(s => (
                                    <div key={s.label} className="flex items-center gap-1.5">
                                        <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${s.dot}`} />
                                        <span className="text-[10px] text-gray-500 dark:text-gray-400 flex-1">{s.label}</span>
                                        <span dir="ltr" className="font-mono text-[10.5px] font-bold text-gray-800 dark:text-gray-200">{s.value}</span>
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div className="flex flex-col justify-center gap-0 p-2" aria-live="polite">
                            {[
                                { icon: <Radio size={11} />,   label: 'Mothership', val: serverStatus ? t('connectedLabel') : t('disconnectedLabel'), ok: serverStatus },
                                { icon: <Zap size={11} />,     label: 'Worker',     val: workerStopped ? t('stoppedLabel') : (workerStatus.status === 'ACTIVE' ? t('activeLabel') : workerStatus.message), ok: !workerStopped && workerStatus.status === 'ACTIVE' },
                                { icon: <Shield size={11} />,  label: 'Extension',  val: `v${integrity.version}`, ltr: true, ok: integrity.status !== 'MISMATCH' },
                            ].map(h => (
                                <div key={h.label} className="flex items-center gap-1.5 px-1.5 py-0 text-[9px]">
                                    <div className="text-brand dark:text-brand-dark shrink-0">{h.icon}</div>
                                    <div className="text-gray-500 dark:text-gray-400 flex-1 truncate">{h.label}</div>
                                    <div {...(h.ltr ? { dir: 'ltr' } : {})} className={`font-bold whitespace-nowrap ${h.ok ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-700 dark:text-rose-400'}`}>{h.val}</div>
                                    <div className={`w-1 h-1 rounded-full shrink-0 ${h.ok ? 'bg-emerald-500' : 'bg-rose-500'}`} />
                                </div>
                            ))}
                        </div>
                    </div>
                </div>

                {/* MISSION QUEUE */}
                <div className="mt-6 max-w-[980px] mx-auto">
                    <div className="mb-3 px-1">
                        <div className="flex items-start justify-between gap-3 flex-wrap">
                            <div className="flex items-center gap-2.5">
                                <Layers size={15} className="text-brand dark:text-brand-dark shrink-0 mt-0.5" />
                                <div>
                                    <div className="text-[14px] font-bold text-gray-900 dark:text-white leading-tight">{t('taskManagementHeading')}</div>
                                    <div className="text-[10px] text-gray-500 dark:text-gray-400" aria-live="polite">
                                        {t('queueCountSummary', { filtered: filteredQueue.length, total: queue.length })}
                                    </div>
                                </div>
                            </div>

                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 w-full sm:w-auto">
                                {[
                                    { label: 'Active', value: stats.pending + stats.processing, tone: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20' },
                                    { label: 'Done', value: stats.completed, tone: 'bg-sky-500/10 text-sky-700 dark:text-sky-400 border-sky-500/20' },
                                    { label: 'Failed', value: stats.failed + stats.cancelled, tone: 'bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-500/20' },
                                    { label: 'Total', value: queue.length, tone: 'bg-gray-500/10 text-gray-700 dark:text-gray-300 border-gray-500/20' },
                                ].map(item => (
                                    <div key={item.label} className={`rounded-lg border px-2 py-1 ${item.tone}`}>
                                        <div className="text-[9px] uppercase tracking-[0.18em] font-semibold">{item.label}</div>
                                        <div className="text-[13px] font-bold leading-tight">{item.value}</div>
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div className="mt-3 grid gap-2 xl:grid-cols-[1.2fr_auto] xl:items-center">
                            <div className="flex items-center gap-2 flex-wrap">
                                <div className="relative">
                                    <Search size={12} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                                    <input
                                        value={queueSearch}
                                        onChange={(e) => setQueueSearch(e.target.value)}
                                        aria-label={t('queueSearchAria')}
                                        placeholder={t('queueSearchPlaceholder')}
                                        className="w-full sm:w-[220px] xl:w-[240px] pl-3 pr-8 py-1.5 rounded-full border border-gray-200 dark:border-[#30363d] bg-white dark:bg-[#161b22] text-[11px] text-gray-700 dark:text-gray-300 placeholder:text-gray-400 outline-none focus:ring-2 focus:ring-brand"
                                    />
                                    {queueSearch && (
                                        <button
                                            type="button"
                                            onClick={() => setQueueSearch('')}
                                            aria-label={t('clearQueueSearchAria')}
                                            className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                                        >
                                            <X size={10} />
                                        </button>
                                    )}
                                </div>

                                {[
                                    { key: 'all',    label: t('filterAll', { count: queue.length }) },
                                    { key: 'active', label: t('filterActive', { count: stats.pending + stats.processing }) },
                                    { key: 'done',   label: t('filterDone', { count: stats.completed }) },
                                    { key: 'failed', label: t('filterFailed', { count: stats.failed + stats.cancelled }) },
                                ].map(({ key, label }) => (
                                    <button key={key} onClick={() => setQueueFilter(key)}
                                        className={`text-[10px] font-semibold px-2.5 py-1.5 rounded-full border transition ${queueFilter === key ? 'bg-brand text-white border-brand' : 'bg-white dark:bg-transparent text-gray-600 dark:text-gray-400 border-gray-200 dark:border-[#30363d] hover:border-brand hover:text-brand'}`}>
                                        {label}
                                    </button>
                                ))}
                            </div>

                            <div className="flex items-center gap-2 flex-wrap xl:justify-end">
                                {cancellablePending > 0 && (
                                    <button onClick={handleCancelAll} disabled={isCancelling}
                                        className="flex items-center gap-1.5 bg-orange-500/10 border border-orange-500/30 text-orange-500 px-2.5 py-1.5 rounded-full text-[10px] font-bold hover:bg-orange-500 hover:text-white transition disabled:opacity-50">
                                        {isCancelling ? <RefreshCw size={10} className="animate-spin" /> : <Ban size={10} />}
                                        {t('cancelCountButton', { count: cancellablePending })}
                                    </button>
                                )}
                                {stats.processing > 0 && (
                                    <button onClick={handleResetStuckTasks} disabled={isResettingStuck}
                                        className="flex items-center gap-1.5 bg-rose-500/10 border border-rose-500/30 text-rose-500 px-2.5 py-1.5 rounded-full text-[10px] font-bold hover:bg-rose-500 hover:text-white transition disabled:opacity-50">
                                        {isResettingStuck ? <RefreshCw size={10} className="animate-spin" /> : <AlertTriangle size={10} />}
                                        {t('releaseCountButton', { count: stats.processing })}
                                    </button>
                                )}
                                <button onClick={toggleAll}
                                    className="text-[10px] font-bold px-2.5 py-1.5 rounded-full border transition bg-transparent text-slate-500 border-gray-300 dark:border-gray-600 dark:text-gray-400 hover:border-brand hover:text-brand">
                                    {selectedTaskIds.length > 0 && selectedTaskIds.length === filteredQueue.length ? t('deselectAllButton') : t('selectAllButton')}
                                </button>
                                <button onClick={toggleCompact}
                                    className={`text-[10px] font-bold px-2.5 py-1.5 rounded-full border transition ${isCompact ? 'bg-brand text-white border-brand' : 'bg-transparent text-slate-500 border-gray-300 dark:border-gray-600 dark:text-gray-400'}`}>
                                    {isCompact ? t('fullViewButton') : t('compactViewButton')}
                                </button>
                                <button type="button" onClick={toggleQueueCollapsed}
                                    aria-expanded={!isQueueCollapsed}
                                    className={`text-[10px] font-bold px-2.5 py-1.5 rounded-full border transition ${isQueueCollapsed ? 'bg-slate-900 text-white border-slate-900 dark:bg-white dark:text-slate-900 dark:border-white' : 'bg-transparent text-slate-500 border-gray-300 dark:border-gray-600 dark:text-gray-400 hover:border-brand hover:text-brand'}`}>
                                    {isQueueCollapsed ? t('showQueueButton') : t('collapseQueueButton')}
                                </button>
                                {selectedTaskIds.length > 0 && (
                                    <button onClick={handleBulkDelete}
                                        className="bg-red-500/10 border border-red-500/30 text-red-500 px-2.5 py-1.5 rounded-full text-[10px] font-bold hover:bg-red-500 hover:text-white transition">
                                        {t('deleteCountButton', { count: selectedTaskIds.length })}
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>

                    <div className={`flex flex-col gap-2 ${isQueueCollapsed ? 'max-h-[56vh] overflow-y-auto pr-1 custom-scrollbar' : ''}`}>
                        {filteredQueue.length === 0 ? (
                            <div className="bg-white dark:bg-[#161b22] border border-gray-100 dark:border-[#30363d] rounded-xl p-8 text-center text-gray-400 text-sm w-full">
                                {queue.length === 0 ? 'No tasks found.' : 'No tasks match this filter.'}
                            </div>
                        ) : filteredQueue.map(row => (
                            <MissionCardCompact
                                key={row.id}
                                row={row}
                                isCompact={isCompact}
                                selected={selectedTaskIds.includes(row.id)}
                                onToggleSelect={toggleSingle}
                                statusTimestamps={statusTimestamps}
                                onEdit={setEditingTask}
                                onAbort={handleAbortTask}
                                onRetry={handleRetryTask}
                                onDelete={handleDelete}
                                processing={processingIds.has(row.id)}
                            />
                        ))}
                    </div>
                </div>
            </main>

            {/* CAMPAIGN DRAWER (slide-in, replaces the old always-visible sidebar) */}
            {showDrawer && (
                <div onClick={closeDrawer} className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[90]" />
            )}
            <div
                role="dialog"
                aria-modal={showDrawer}
                aria-hidden={!showDrawer}
                aria-label={t('newTaskLabel')}
                onKeyDown={(e) => {
                    if (!showDrawer) return;
                    if (e.key === 'Escape') { e.stopPropagation(); closeDrawer(); return; }
                    trapTabKey(e, e.currentTarget);
                }}
                className={`fixed top-0 bottom-0 left-0 z-[100] bg-white dark:bg-[#161b22] border-r border-gray-200 dark:border-[#30363d] shadow-2xl transition-all duration-300 overflow-hidden ${showDrawer ? 'w-full sm:w-[420px]' : 'w-0'}`}>
                <div className="w-full sm:w-[420px] h-full flex flex-col">
                    <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-[#30363d]">
                        <div className="flex items-center gap-2">
                            <Rocket size={16} className="text-brand dark:text-brand-dark" />
                            <span className="font-bold text-slate-900 dark:text-white text-[15px]">{t('newTaskLabel')}</span>
                        </div>
                        <button type="button" onClick={closeDrawer} aria-label={t('closeAria')} className="p-3 rounded-lg hover:bg-gray-100 dark:hover:bg-[#242c38] text-gray-400 transition">
                            <X size={16} />
                        </button>
                    </div>

                    <div className="flex-1 overflow-y-auto p-5 space-y-4 custom-scrollbar">

                        {/* CONTENT */}
                        <div className="bg-gray-50 dark:bg-[#0d1117] border border-gray-200 dark:border-[#30363d] rounded-2xl p-5 space-y-3">
                            <div className="flex justify-between items-center">
                                <label htmlFor="post-content-textarea" className="text-[10px] font-bold text-gray-700 dark:text-gray-400 uppercase tracking-widest flex items-center gap-2">
                                    <span className="w-1 h-1 bg-brand rounded-full" /> {t('postContentLabel')}
                                </label>
                                <div className="flex items-center gap-2">
                                    <button
                                        type="button"
                                        onClick={() => setUseVariants(p => !p)}
                                        aria-pressed={useVariants}
                                        title={t('variantsToggleTitle')}
                                        className={`text-[10px] font-bold uppercase flex items-center gap-1 px-2 py-0.5 rounded border transition ${useVariants ? 'bg-sky-600 text-white border-sky-600' : 'text-sky-400 border-sky-800/50 hover:bg-sky-900/20'}`}>
                                        A/B {useVariants && `(${variants.length})`}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setShowAiModal(true)}
                                        className="text-[10px] font-bold uppercase flex items-center gap-1 px-2 py-0.5 rounded border transition text-purple-400 border-purple-800/50 hover:bg-purple-900/20">
                                        <Sparkles size={11} /> AI Assistant
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setShowLibraryPanel(p => !p)}
                                        aria-label={t('savedTemplatesAria')}
                                        aria-expanded={showLibraryPanel}
                                        className={`text-[10px] font-bold uppercase flex items-center gap-1 px-2 py-0.5 rounded border transition ${showLibraryPanel ? 'bg-amber-600 text-white border-amber-600' : 'text-amber-400 border-amber-800/50 hover:bg-amber-900/20'}`}>
                                        <Layers size={11} /> Library {postTemplates.length > 0 && `(${postTemplates.length})`}
                                    </button>
                                </div>
                            </div>

                            {/* Template Library Panel */}
                            {showLibraryPanel && (
                                <div className="bg-white dark:bg-[#161b22] border border-gray-200 dark:border-[#30363d] rounded-lg p-2 space-y-1">
                                    {postTemplates.length === 0
                                        ? <p className="text-[10px] text-gray-700 dark:text-gray-400 text-center py-2">{t('noTemplatesSavedYet')}</p>
                                        : postTemplates.map(tpl => (
                                            <div key={tpl.id} className="flex items-center justify-between px-2 py-1.5 rounded hover:bg-gray-50 dark:hover:bg-white/5 group">
                                                <button type="button" onClick={() => handleLoadTemplate(tpl)} className="flex items-center gap-2 flex-1 text-left overflow-hidden">
                                                    <Layers size={12} className="text-amber-400 shrink-0" />
                                                    <span className="text-xs text-gray-700 dark:text-gray-300 font-medium truncate">{tpl.name}</span>
                                                </button>
                                                <button type="button" onClick={(e) => handleDeleteTemplate(tpl.id, e)}
                                                    aria-label={t('deleteTemplateAria', { name: tpl.name })}
                                                    className="opacity-0 group-hover:opacity-100 p-1 text-red-500 hover:bg-red-500/10 rounded transition">
                                                    <Trash2 size={11} />
                                                </button>
                                            </div>
                                        ))
                                    }
                                </div>
                            )}

                            {!useVariants ? (
                                <>
                                    <textarea
                                        id="post-content-textarea"
                                        ref={postContentRef}
                                        className="w-full h-28 bg-white dark:bg-[#161b22] border border-gray-200 dark:border-[#30363d] rounded-lg p-3 text-sm text-slate-800 dark:text-white focus:ring-2 focus:ring-brand focus:ring-offset-0 outline-none transition resize-none"
                                        placeholder="Construct post content..."
                                        value={postContent} onChange={e => setPostContent(e.target.value)} />

                                    {/* Placeholder tokens — resolved server-side in POST /api/posts (resolvePlaceholders) */}
                                    <p className="text-[9px] text-gray-400 dark:text-gray-500 -mt-1">
                                        {t('availableTagsLabel')} <code className="font-mono">{'{{GROUP_NAME}}'}</code>{' '}
                                        <code className="font-mono">{'{{GROUP_URL}}'}</code>{' '}
                                        <code className="font-mono">{'{{DATE}}'}</code>{' '}
                                        <code className="font-mono">{'{{FB_USER}}'}</code>
                                    </p>
                                </>
                            ) : (
                                <div className="space-y-2.5">
                                    <p className="text-[9px] text-gray-400 dark:text-gray-500">
                                        {t('variantsExplanation')}
                                    </p>
                                    {variants.map((v, i) => (
                                        <div key={i} className="bg-white dark:bg-[#161b22] border border-gray-200 dark:border-[#30363d] rounded-lg p-2.5 space-y-1.5">
                                            <div className="flex items-center justify-between gap-2">
                                                <input
                                                    type="text"
                                                    value={v.label}
                                                    onChange={e => setVariants(p => p.map((x, xi) => xi === i ? { ...x, label: e.target.value } : x))}
                                                    className="text-[10px] font-bold uppercase bg-transparent border-b border-gray-300 dark:border-gray-600 text-sky-500 dark:text-sky-400 w-20 outline-none focus:border-sky-500"
                                                    aria-label={t('variantNameAria', { n: i + 1 })} />
                                                {variants.length > 1 && (
                                                    <button type="button" onClick={() => setVariants(p => p.filter((_, xi) => xi !== i))}
                                                        aria-label={t('removeVariantAria', { label: v.label })}
                                                        className="text-gray-400 hover:text-red-500 transition">
                                                        <Trash2 size={12} />
                                                    </button>
                                                )}
                                            </div>
                                            <textarea
                                                className="w-full h-20 bg-gray-50 dark:bg-[#0d1117] border border-gray-200 dark:border-[#30363d] rounded-lg p-2.5 text-sm text-slate-800 dark:text-white focus:ring-2 focus:ring-sky-500 focus:ring-offset-0 outline-none transition resize-none"
                                                placeholder={t('variantContentPlaceholder', { label: v.label })}
                                                value={v.content}
                                                onChange={e => setVariants(p => p.map((x, xi) => xi === i ? { ...x, content: e.target.value } : x))} />
                                        </div>
                                    ))}
                                    <button type="button"
                                        onClick={() => setVariants(p => [...p, { label: String.fromCharCode(65 + p.length), content: '' }])}
                                        className="text-[10px] font-bold uppercase text-sky-500 dark:text-sky-400 hover:underline">
                                        {t('addVariantButton')}
                                    </button>
                                </div>
                            )}

                            {/* Content Editing Toolbar */}
                            {postContent.trim() && (
                                <div className="flex flex-wrap gap-1.5 pt-1">
                                    {CONTENT_EDIT_ACTIONS.map(action => (
                                        <button key={action.id}
                                            type="button"
                                            onClick={() => handleContentEdit(action)}
                                            disabled={!!contentEditLoading}
                                            className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg border text-[10px] font-bold uppercase tracking-wider transition ${
                                                contentEditLoading === action.id
                                                    ? 'bg-brand text-white border-brand'
                                                    : 'bg-transparent text-brand dark:text-brand-dark border-brand/30 hover:bg-brand-soft dark:hover:bg-brand/10 disabled:opacity-40'
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
                            <div className="flex items-center justify-between pt-2 border-t border-gray-200 dark:border-gray-800/50">
                                <div className="flex items-center gap-2 group cursor-help relative">
                                    <Sparkles size={14} className={useAiSpin ? "text-brand dark:text-brand-dark" : "text-gray-400"} />
                                    <span className={`text-xs font-bold uppercase tracking-wider ${useAiSpin ? "text-brand dark:text-brand-dark" : "text-gray-400"}`}>
                                        AI Smart Spin
                                    </span>
                                    <div className="absolute right-0 top-6 opacity-0 group-hover:opacity-100 transition-opacity bg-slate-800 text-[10px] text-white p-2 rounded shadow-xl w-48 pointer-events-none z-[60]">
                                        Uses Spintax &#123;a|b&#125; and Hebrew synonyms to make each post unique.
                                    </div>
                                </div>
                                <button
                                    onClick={() => setUseAiSpin(!useAiSpin)}
                                    aria-label={useAiSpin ? t('disableAiSpinAria') : t('enableAiSpinAria')}
                                    aria-pressed={useAiSpin}
                                    className={`relative inline-flex h-5 w-10 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-brand focus:ring-offset-0 ${useAiSpin ? 'bg-brand' : 'bg-gray-300 dark:bg-gray-700'}`}
                                >
                                    <span className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${useAiSpin ? 'translate-x-6' : 'translate-x-1'}`} />
                                </button>
                            </div>
                        </div>

                        {/* MEDIA */}
                        <div className="bg-gray-50 dark:bg-[#0d1117] border border-gray-200 dark:border-[#30363d] rounded-2xl p-5 space-y-3">
                            <div className="flex justify-between items-center">
                                <label className="text-[10px] font-bold text-gray-700 dark:text-gray-400 uppercase tracking-widest flex items-center gap-2">
                                    <span className="w-1 h-1 bg-brand rounded-full" /> {t('mediaFileLabel')}
                                </label>
                                {selectedFile && (
                                    <button onClick={clearMedia} className="text-[10px] text-red-500 hover:text-red-400 font-bold uppercase flex items-center gap-1 transition">
                                        <X size={12} /> {t('removeLabel')}
                                    </button>
                                )}
                            </div>
                            {!selectedFile ? (
                                <label className="cursor-pointer flex items-center gap-2 px-3 py-2.5 bg-white dark:bg-[#161b22] border border-dashed border-gray-300 dark:border-[#30363d] rounded-lg hover:border-brand transition group w-full">
                                    <Paperclip size={16} className="text-gray-400 group-hover:text-brand transition" />
                                    <span className="text-xs text-gray-500 group-hover:text-brand transition font-medium">
                                        {t('uploadMediaPrompt')}
                                    </span>
                                    <input type="file" className="hidden" accept="image/*,video/*" onChange={handleFileSelect} />
                                </label>
                            ) : (
                                <div className="relative bg-white dark:bg-[#161b22] rounded-lg overflow-hidden border border-gray-200 dark:border-[#30363d]">
                                    {mediaPreview?.type?.startsWith('video') ? (
                                        <video src={mediaPreview.url} className="w-full h-24 object-cover opacity-90" controls />
                                    ) : (
                                        <img src={mediaPreview.url} alt="Preview" className="w-full h-24 object-cover opacity-90" />
                                    )}
                                    <div className="absolute bottom-2 right-2 bg-black/60 text-white text-[9px] px-2 py-0.5 rounded font-mono border border-white/10 flex items-center gap-1">
                                        {mediaPreview?.type.startsWith('video') ? '??' : '??'} {(selectedFile.size / 1024 / 1024).toFixed(2)} MB
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* GROUPS */}
                        <div className="bg-gray-50 dark:bg-[#0d1117] border border-gray-200 dark:border-[#30363d] rounded-2xl p-5 flex flex-col space-y-3">
                            {/* Facebook User Selector */}
                            <div className="bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-800/40 rounded-lg p-3">
                                <label htmlFor="current-fb-user" className="text-[9px] font-bold text-amber-700 dark:text-amber-400 uppercase tracking-widest block mb-2">
                                    {t('fbAccountSelectorLabel')}
                                </label>
                                <input
                                    id="current-fb-user"
                                    type="text"
                                    value={currentUser}
                                    onChange={(e) => setCurrentUser(e.target.value)}
                                    placeholder={t('fbUsernamePlaceholder')}
                                    className="w-full px-3 py-2 rounded-lg text-[12px] border border-amber-300 dark:border-amber-800/50 bg-white dark:bg-[#161b22] text-gray-800 dark:text-gray-200 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-amber-500"
                                />
                                {currentUser && (
                                    <div className="mt-2 flex gap-2 flex-wrap">
                                        <button
                                            onClick={() => setCurrentUser('')}
                                            className="px-2 py-1 bg-red-500 text-white text-[9px] rounded hover:bg-red-600 transition"
                                        >
                                            {t('clearLabel')}
                                        </button>
                                    </div>
                                )}
                            </div>

                            {blockedGroups.length > 0 && (
                                <div className="bg-orange-50 dark:bg-orange-950/20 border border-orange-200 dark:border-orange-800 rounded-lg p-2.5 mb-2.5">
                                    <p className="text-[10px] text-orange-700 dark:text-orange-300 font-medium">
                                        ⏳ <strong>{blockedGroups.length} {blockedGroups.length > 1 ? t('groupWordPlural') : t('groupWordSingular')}</strong> {blockedGroups.length > 1 ? t('waitingPlural') : t('waitingSingular')} {t('forAdminApprovalOnFacebook')}
                                    </p>
                                    <p className="text-[9px] text-orange-600 dark:text-orange-400 mt-1">
                                        {blockedGroups.length === 1 ? `"${blockedGroups[0].name}"` : `${t('includingLabel')} ${blockedGroups.slice(0, 3).map(g => `"${g.name}"`).join(', ')}${blockedGroups.length > 3 ? ` ${t('andMoreCount', { count: blockedGroups.length - 3 })}` : ''}`}
                                    </p>
                                    <p className="text-[9px] text-orange-600 dark:text-orange-400 mt-1.5">
                                        {t('blockedGroupsExplanation')}
                                    </p>
                                </div>
                            )}

                            <div className="flex justify-between items-center flex-wrap gap-1.5">
                                <label className="text-[10px] font-bold text-gray-700 dark:text-gray-400 uppercase tracking-widest flex items-center gap-2">
                                    <span className="w-1 h-1 bg-brand rounded-full" /> {t('selectGroupsLabel', { count: selectedGroups.length })}
                                </label>
                                <div className="flex items-center gap-1.5 flex-wrap">
                                    <button
                                        onClick={() => setSortSelectedFirst(p => !p)}
                                        title={t('showSelectedFirstTitle')}
                                        className={`text-[9px] font-black uppercase px-2 py-0.5 rounded border transition ${sortSelectedFirst ? 'bg-brand text-white border-brand' : 'text-brand dark:text-brand-dark border-brand/30 hover:bg-brand-soft dark:hover:bg-brand/10'}`}>
                                        {t('selectedStarButton')}
                                    </button>
                                    {customGroupOrder.length > 0 && (
                                        <button onClick={resetGroupOrder}
                                            title={t('showSelectedFirstTitle')}
                                            className="text-[9px] font-black uppercase px-2 py-0.5 rounded border text-gray-500 border-gray-300 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800 transition">
                                        {t('resetOrderButton')}
                                        </button>
                                    )}
                                    <button
                                        onClick={handleSyncGroups}
                                        disabled={isSyncingGroups}
                                        title={t('showSelectedFirstTitle')}
                                        className="text-[9px] font-black uppercase flex items-center gap-1 px-2 py-0.5 rounded border transition text-green-600 dark:text-green-400 border-green-300 dark:border-green-800/50 hover:bg-green-50 dark:hover:bg-green-900/20 disabled:opacity-50">
                                        <RefreshCw size={10} className={isSyncingGroups ? 'animate-spin' : ''} />
                                        {isSyncingGroups ? t('syncingEllipsis') : 'FB'}
                                    </button>
                                    <button
                                        onClick={handleClearAllGroups}
                                        disabled={loading || groups.length === 0}
                                        title={t('deleteAllGroupsTitle')}
                                        className="text-[9px] font-black uppercase flex items-center gap-1 px-2 py-0.5 rounded border transition text-red-500 border-red-300 dark:border-red-800/50 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50">
                                        <Trash2 size={10} />
                                        {t('deleteAllButton')}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setShowFoldersPanel(p => !p)}
                                        aria-label={t('savedFoldersAria')}
                                        aria-expanded={showFoldersPanel}
                                        className={`text-[9px] font-black uppercase flex items-center gap-1 px-2 py-0.5 rounded border transition ${showFoldersPanel ? 'bg-brand text-white border-brand' : 'text-brand dark:text-brand-dark border-brand/30 hover:bg-brand-soft dark:hover:bg-brand/10'}`}>
                                        <Folder size={10} /> {groupSets.length > 0 && `(${groupSets.length})`}
                                    </button>
                                    <button
                                        onClick={() => selectedGroups.length === groups.length ? setSelectedGroups([]) : setSelectedGroups(groups.map(g => g.id))}
                                        className="text-[9px] text-brand dark:text-brand-dark font-black hover:underline uppercase transition">
                                        {selectedGroups.length === groups.length ? t('clearLabel') : t('allLabel')}
                                    </button>
                                </div>
                            </div>

                            {/* Folders Panel */}
                            {showFoldersPanel && (
                                <div className="bg-white dark:bg-[#161b22] border border-gray-200 dark:border-[#30363d] rounded-lg p-2 space-y-1">
                                    {groupSets.length === 0
                                        ? <p className="text-[10px] text-gray-700 dark:text-gray-400 text-center py-2">{t('noFoldersSavedYet')}</p>
                                        : groupSets.map(set => (
                                            <div key={set.id} className="flex items-center justify-between px-2 py-1.5 rounded hover:bg-gray-50 dark:hover:bg-white/5 group">
                                                <button onClick={() => handleLoadFolder(set)} className="flex items-center gap-2 flex-1 text-left">
                                                    <Folder size={12} className="text-brand dark:text-brand-dark shrink-0" />
                                                    <span className="text-xs text-gray-700 dark:text-gray-300 font-medium truncate">{set.name}</span>
                                                    <span className="text-[10px] text-gray-400 shrink-0">{set.group_ids?.length || 0}</span>
                                                </button>
                                                <button type="button" onClick={() => handleDeleteFolder(set.id)}
                                                    aria-label={t('deleteFolderAria', { name: set.name })}
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
                                <div className="bg-brand-soft dark:bg-brand/10 border border-brand/20 rounded-lg p-2">
                                    <div className="flex items-center justify-between mb-1.5">
                                        <span className="text-[9px] font-black text-brand dark:text-brand-dark uppercase tracking-widest">{t('selectedCountLabel', { count: selectedGroups.length })}</span>
                                        <button onClick={() => setSelectedGroups([])} className="text-[9px] text-red-500 hover:text-red-400 font-bold uppercase transition">{t('clearAllButton')}</button>
                                    </div>
                                    <div className="flex flex-wrap gap-1 max-h-20 overflow-y-auto custom-scrollbar">
                                        {selectedGroups.map(id => {
                                            const g = groups.find(x => x.id === id);
                                            if (!g) return null;
                                            return (
                                                <span key={id} className="inline-flex items-center gap-1 bg-brand/10 border border-brand/30 text-brand dark:text-brand-dark text-[10px] px-2 py-0.5 rounded-full max-w-[140px]">
                                                    <span className="truncate" dir="rtl" title={g.name}>{g.name}</span>
                                                    <button type="button" onClick={() => setSelectedGroups(p => p.filter(x => x !== id))}
                                                        aria-label={t('removeGroupAria', { name: g.name })}
                                                        className="shrink-0 hover:text-red-500 transition">
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
                                    <Search size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                                    <input type="text" placeholder={t('searchGroupsPlaceholder')} dir="rtl"
                                        aria-label={t('searchGroupsAria')}
                                        value={groupSearch} onChange={e => setGroupSearch(e.target.value)}
                                        className="w-full pr-7 pl-7 py-2 bg-white dark:bg-[#161b22] border border-gray-200 dark:border-[#30363d] rounded-lg text-xs text-slate-700 dark:text-gray-300 placeholder-gray-400 focus:ring-2 focus:ring-brand focus:ring-offset-0 outline-none transition" />
                                    {groupSearch && (
                                        <button onClick={() => setGroupSearch('')} aria-label={t('clearSearchAria')} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition">
                                            <X size={11} />
                                        </button>
                                    )}
                                </div>

                                {groupSearch && (
                                    <div className="flex flex-wrap gap-1.5 animate-in fade-in slide-in-from-top-1 duration-200">
                                        <button onClick={() => handleBulkSelectFiltered('all')} className="text-[9px] font-black uppercase px-2 py-1 bg-brand/10 text-brand dark:text-brand-dark border border-brand/30 rounded hover:bg-brand/20 transition">{t('selectAllFilteredButton', { count: filteredGroups.length })}</button>
                                        <button onClick={() => handleBulkSelectFiltered(5)} className="text-[9px] font-black uppercase px-2 py-1 bg-gray-100 dark:bg-white/5 text-gray-500 dark:text-gray-400 border border-gray-200 dark:border-white/10 rounded hover:bg-gray-200 dark:hover:bg-white/10 transition">Top 5</button>
                                        <button onClick={() => handleBulkSelectFiltered(10)} className="text-[9px] font-black uppercase px-2 py-1 bg-gray-100 dark:bg-white/5 text-gray-500 dark:text-gray-400 border border-gray-200 dark:border-white/10 rounded hover:bg-gray-200 dark:hover:bg-white/10 transition">Top 10</button>
                                        <button onClick={() => handleBulkSelectFiltered(20)} className="text-[9px] font-black uppercase px-2 py-1 bg-gray-100 dark:bg-white/5 text-gray-500 dark:text-gray-400 border border-gray-200 dark:border-white/10 rounded hover:bg-gray-200 dark:hover:bg-white/10 transition">Top 20</button>
                                        <button onClick={handleClearFiltered} className="text-[9px] font-black uppercase px-2 py-1 bg-red-50 dark:bg-red-900/10 text-red-500 dark:text-red-400 border border-red-200 dark:border-red-900/30 rounded hover:bg-red-100 dark:hover:bg-red-900/20 transition ml-auto">Clear</button>
                                    </div>
                                )}
                            </div>

                            {/* Group List with Drag-and-Drop */}
                            <div className="max-h-48 overflow-y-auto pr-1 custom-scrollbar">
                                {filteredGroups.length === 0
                                    ? <p className="text-[10px] text-gray-500 text-center py-4">{groupSearch ? t('noGroupsMatchSearch', { query: groupSearch }) : t('noGroupsAvailableYet')}</p>
                                    : filteredGroups.map(g => (
                                    <div key={g.id}>
                                        <button
                                            type="button"
                                            draggable
                                            onDragStart={e => handleGroupDragStart(e, g.id)}
                                            onDragOver={e => handleGroupDragOver(e, g.id)}
                                            onDrop={e => handleGroupDrop(e, g.id)}
                                            onDragEnd={handleGroupDragEnd}
                                            onClick={() => setSelectedGroups(p => p.includes(g.id) ? p.filter(x => x !== g.id) : [...p, g.id])}
                                            aria-pressed={selectedGroups.includes(g.id)}
                                            aria-label={g.name}
                                            title={g.requires_moderation ? t('groupPendingApprovalTitle') : undefined}
                                            className={`group/item w-full flex items-center gap-2 px-2.5 py-2.5 rounded-xl cursor-pointer select-none transition-all duration-150 border mb-1.5 text-right ${
                                                draggingGroupId === g.id
                                                    ? 'opacity-40 scale-95'
                                                    : dragOverGroupId === g.id && draggingGroupId !== g.id
                                                    ? 'border-brand bg-brand-soft dark:bg-brand/10'
                                                    : selectedGroups.includes(g.id)
                                                    ? 'bg-brand/5 border-brand/40 shadow-sm'
                                                    : g.requires_moderation
                                                    ? 'bg-orange-50 dark:bg-orange-950/20 border-orange-300 dark:border-orange-700 hover:border-orange-400'
                                                    : 'bg-white dark:bg-white/5 border-transparent hover:border-gray-200 dark:hover:border-white/10 hover:bg-gray-50 dark:hover:bg-white/[0.08]'
                                            }`}>
                                            {/* Drag Handle */}
                                            <span className="shrink-0 cursor-grab active:cursor-grabbing text-gray-400 hover:text-gray-600 transition-colors"
                                                onClick={e => e.stopPropagation()}>
                                                <GripVertical size={15} />
                                            </span>
                                            {/* Selection dot */}
                                            <span className={`w-2 h-2 rounded-full shrink-0 ${selectedGroups.includes(g.id) ? 'bg-brand animate-pulse' : g.requires_moderation ? 'bg-orange-400' : 'bg-gray-300 dark:bg-gray-700'}`} />
                                            {/* Name */}
                                            <span className="flex-1 min-w-0" dir="rtl">
                                                <span className={`text-[13px] leading-snug font-semibold truncate block transition-colors ${selectedGroups.includes(g.id) ? 'text-brand dark:text-brand-dark' : g.requires_moderation ? 'text-orange-700 dark:text-orange-300' : 'text-slate-800 dark:text-gray-100 group-hover/item:text-slate-900 dark:group-hover/item:text-white'}`}
                                                    title={g.name}>{g.name}</span>
                                                {g.requires_moderation && <span className="text-[9px] text-orange-600 dark:text-orange-400 font-medium">{t('pendingApprovalBadge')}</span>}
                                            </span>
                                            {/* Health score — derived from posts history server-side (server/index.cjs computeGroupHealth); null = no history yet, badge hidden */}
                                            {typeof g.health_score === 'number' && (
                                                <span
                                                    onClick={e => e.stopPropagation()}
                                                    title={t('healthScoreTitle', { score: g.health_score })}
                                                    className={`shrink-0 text-[9px] font-black px-1.5 py-0.5 rounded ${
                                                        g.health_score >= 70 ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                                                        : g.health_score >= 40 ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                                                        : 'bg-rose-500/10 text-rose-600 dark:text-rose-400'
                                                    }`}>
                                                    {g.health_score}
                                                </span>
                                            )}
                                            {/* Timezone tag trigger (Item 6) — manual, not auto-detected. Clock lights up when a tag is set. */}
                                            <span
                                                role="button"
                                                tabIndex={0}
                                                onClick={e => { e.stopPropagation(); setTzInputValue(g.timezone || ''); setTzEditorGroupId(p => p === g.id ? null : g.id); }}
                                                title={g.timezone ? t('timezoneTagTitle', { tz: g.timezone }) : t('tagTimezoneManual')}
                                                className={`shrink-0 p-1 rounded transition ${g.timezone ? 'text-sky-500 dark:text-sky-400' : 'text-gray-300 dark:text-gray-600 hover:text-gray-500'}`}>
                                                <Clock size={12} />
                                            </span>
                                            {/* Checkbox */}
                                            <span className="ml-1 shrink-0">
                                                {selectedGroups.includes(g.id)
                                                    ? <span className="inline-block bg-brand rounded p-0.5"><CheckSquare size={14} className="text-white" /></span>
                                                    : <span className="inline-block border border-gray-300 dark:border-gray-600 rounded p-0.5 group-hover/item:border-gray-400 dark:group-hover/item:border-gray-500"><Square size={14} className="text-transparent" /></span>}
                                            </span>
                                        </button>
                                        {tzEditorGroupId === g.id && (
                                            <div className="flex items-center gap-1.5 px-2.5 py-1.5 -mt-1 mb-1.5 bg-sky-50 dark:bg-sky-950/20 border border-sky-200 dark:border-sky-800 rounded-lg" onClick={e => e.stopPropagation()}>
                                                <input
                                                    type="text"
                                                    value={tzInputValue}
                                                    onChange={e => setTzInputValue(e.target.value)}
                                                    onKeyDown={e => e.key === 'Enter' && handleSaveGroupTimezone(g)}
                                                    placeholder={t('timezoneExamplePlaceholder')}
                                                    dir="ltr"
                                                    className="flex-1 text-[11px] bg-white dark:bg-[#161b22] border border-sky-300 dark:border-sky-700 rounded px-2 py-1 outline-none focus:ring-1 focus:ring-sky-500" />
                                                <button type="button" onClick={() => handleSaveGroupTimezone(g)}
                                                    className="text-[10px] font-bold text-sky-600 dark:text-sky-400 hover:underline shrink-0">{t('saveLabel')}</button>
                                                <button type="button" onClick={() => setTzEditorGroupId(null)}
                                                    className="text-[10px] text-gray-400 hover:text-gray-600 shrink-0">{t('cancelTitle')}</button>
                                            </div>
                                        )}
                                    </div>
                                    ))
                                }
                            </div>

                            {/* Save as Folder */}
                            {selectedGroups.length >= 2 && (
                                <button onClick={() => setShowFolderModal(true)}
                                    className="w-full flex items-center justify-center gap-1.5 py-1.5 text-[10px] font-bold uppercase tracking-widest text-brand dark:text-brand-dark border border-brand/30 rounded-lg hover:bg-brand-soft dark:hover:bg-brand/10 transition">
                                    <FolderPlus size={12} /> Save {selectedGroups.length} Groups as Folder
                                </button>
                            )}
                        </div>

                        {/* CALENDAR */}
                        <div className="bg-gray-50 dark:bg-[#0d1117] border border-gray-200 dark:border-[#30363d] rounded-2xl p-5">
                            <Calendar value={scheduleTime} onChange={e => setScheduleTime(e.target.value)} compact={true} />
                        </div>
                    </div>

                    <div className="p-5 pt-0 bg-white dark:bg-[#161b22] border-t border-gray-100 dark:border-[#30363d]">
                        <label className="flex items-start gap-2 px-2 pb-3 text-[11px] text-slate-500 dark:text-gray-400 leading-snug cursor-pointer">
                            <input
                                type="checkbox"
                                checked={legalAgreed}
                                onChange={e => setLegalAgreed(e.target.checked)}
                                className="mt-0.5 shrink-0"
                            />
                            <span>I confirm this content complies with Facebook's Community Standards and I accept responsibility for this post.</span>
                        </label>
                        <div className="flex gap-2 p-2 pt-0">
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
                                disabled={selectedGroups.length === 0 || !postContent.trim() || !legalAgreed || isSubmitting}
                                className="flex-[2] py-3 bg-gradient-to-br from-brand to-brand-dark shadow-lg shadow-brand/30 hover:shadow-brand/50 text-white rounded-xl text-[10px] font-black uppercase tracking-widest transition-all disabled:opacity-50 disabled:shadow-none flex items-center justify-center gap-2">
                                {isSubmitting ? <RefreshCw size={14} className="animate-spin" /> : <Send size={14} />}
                                Launch Posts
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            <CommandPalette open={showPalette} onClose={() => setShowPalette(false)} items={paletteItems} />
            <Ticker events={recentEvents} />

            {/* ── EDIT MODAL ── */}
            {editingTask && (
                <div
                    className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[100] flex items-center justify-center p-4"
                    role="dialog"
                    aria-modal="true"
                    aria-label={`Patch Task #${editingTask.id}`}
                    onKeyDown={(e) => {
                        if (e.key === 'Escape') { setEditingTask(null); return; }
                        trapTabKey(e, e.currentTarget);
                    }}>
                    <div className="bg-white dark:bg-[#161b22] border border-gray-200 dark:border-[#30363d] w-full max-w-lg rounded-xl shadow-2xl overflow-hidden">
                        <div className="p-6 border-b border-gray-200 dark:border-[#30363d] flex justify-between items-center bg-gray-50 dark:bg-[#1c2128]">
                            <h2 className="text-slate-900 dark:text-white font-bold flex items-center gap-2">
                                <Edit3 size={18} className="text-brand" /> Patch Task #{editingTask.id}
                            </h2>
                            <button type="button" onClick={() => setEditingTask(null)} aria-label="Close" className="p-2.5 -m-2.5 text-gray-400 hover:text-gray-700 dark:hover:text-white transition"><X size={20} /></button>
                        </div>
                        <div className="p-6 space-y-4">
                            <div className="space-y-1">
                                <label htmlFor="edit-content" className="text-[10px] font-bold text-gray-500 uppercase">Post Content</label>
                                <textarea className="w-full h-32 bg-gray-50 dark:bg-[#0d1117] border border-gray-200 dark:border-[#30363d] rounded-lg p-3 text-sm text-slate-800 dark:text-white focus:ring-2 focus:ring-brand focus:ring-offset-0 transition resize-none outline-none"
                                    defaultValue={editingTask.content} id="edit-content" ref={editModalFirstFieldRef} />
                            </div>
                            <div className="space-y-1">
                                <label htmlFor="edit-time" className="text-[10px] font-bold text-gray-500 uppercase">New Schedule</label>
                                <div className="bg-white dark:bg-[#1c2128] border border-gray-300 dark:border-[#30363d] rounded-lg px-3 py-2 flex items-center">
                                    <CalendarIcon size={16} className="text-gray-500 dark:text-gray-300 mr-2" />
                                    <input type="datetime-local" className="bg-transparent text-black dark:text-white text-xs w-full outline-none font-medium"
                                        defaultValue={(() => { const d = new Date(editingTask.scheduled_time); const pad = n => String(n).padStart(2, "0"); return d.getFullYear() + "-" + pad(d.getMonth()+1) + "-" + pad(d.getDate()) + "T" + pad(d.getHours()) + ":" + pad(d.getMinutes()); })()} id="edit-time" />
                                </div>
                            </div>
                        </div>
                        <div className="p-6 bg-gray-50 dark:bg-[#0d1117] flex justify-end gap-3 border-t border-gray-100 dark:border-transparent" dir="ltr">
                            <button type="button" onClick={() => setEditingTask(null)} className="px-4 py-2 text-xs font-bold uppercase text-gray-500 hover:text-gray-800 dark:hover:text-white transition">Cancel</button>
                            <button type="button" onClick={() => {
                                const content = document.getElementById('edit-content').value;
                                const time    = document.getElementById('edit-time').value;
                                handleUpdate(editingTask.id, { content, scheduled_time: new Date(time).toISOString() });
                            }} className="px-6 py-2 bg-brand hover:opacity-90 text-white rounded-lg text-xs font-bold uppercase tracking-widest transition flex items-center gap-2">
                                <Save size={14} /> Update Protocol
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* SAVE FOLDER MODAL */}
            {showFolderModal && (
                <SaveFolderModal
                    selectedGroups={selectedGroups} groups={groups}
                    onSave={handleSaveFolder} onClose={() => setShowFolderModal(false)} />
            )}

            {/* STOP WORKER MODAL */}
            {showStopModal && (
                <StopWorkerModal
                    workerActive={workerStatus.status === 'ACTIVE'}
                    onConfirm={handleStopWorker}
                    onClose={() => setShowStopModal(false)} />
            )}

            {/* SAVE POST TEMPLATE MODAL */}
            {showTemplateModal && (
                <SavePostTemplateModal
                    content={postContent}
                    mediaUrl={mediaPreview}
                    onSave={handleSaveTemplate}
                    onClose={() => setShowTemplateModal(false)} />
            )}

            {/* AI POST ASSISTANT MODAL */}
            {showAiModal && (
                <AiPostAssistantModal
                    onInsert={handleInsertAiContent}
                    onGenerate={ApiService.generateAiContent.bind(ApiService)}
                    onClose={() => setShowAiModal(false)} />
            )}

            {/* STITCH ANALYTICS MODAL */}
            {showStitchAnalytics && (
                <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[150] flex items-center justify-center overflow-y-auto p-2">
                    <div className="w-full max-w-xl">
                        <StitchAnalytics queue={queue} groups={groups} onClose={() => setShowStitchAnalytics(false)} />
                    </div>
                </div>
            )}

            {/* ── TOAST NOTIFICATION ── */}
            {toast.visible && (
                <Toast
                    message={toast.message}
                    type={toast.type}
                    onClose={() => setToast(t => ({ ...t, visible: false }))}
                />
            )}

            {/* ── CONFIRMATION DIALOG ── */}
            {confirmDialog.show && (
                <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[300] flex items-center justify-center p-4">
                    <div className="bg-white dark:bg-[#161b22] border border-gray-200 dark:border-[#30363d] rounded-2xl p-6 max-w-sm w-full shadow-2xl">
                        <p className="text-slate-900 dark:text-white text-sm mb-6 leading-relaxed whitespace-pre-wrap">{confirmDialog.message}</p>
                        <div className="flex gap-3 justify-end">
                            <button
                                onClick={() => setConfirmDialog({ show: false, message: '', onConfirm: null })}
                                className="px-4 py-2 rounded-xl text-sm text-gray-500 hover:bg-gray-100 dark:hover:bg-[#21262d] transition-colors">
                                Cancel
                            </button>
                            <button
                                onClick={() => {
                                    confirmDialog.onConfirm?.();
                                    setConfirmDialog({ show: false, message: '', onConfirm: null });
                                }}
                                className="px-4 py-2 rounded-xl text-sm bg-rose-600 hover:bg-rose-500 text-white transition-colors font-bold">
                                Confirm
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ── LEGAL PAGE ── */}
            {legalTab && (
                <Legal initialTab={legalTab} onClose={() => setLegalTab(null)} />
            )}

            {/* ── FIRST-TIME CONSENT BANNER ── */}
            {!tosAccepted && (
                <ConsentBanner
                    onAccept={() => setTosAccepted(true)}
                    onReadTerms={() => setLegalTab('terms')}
                />
            )}

            <Footer onOpenLegal={tab => setLegalTab(tab)} />
            <AccessibilityWidget />
        </div>
    );
}
