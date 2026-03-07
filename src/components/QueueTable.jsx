import React from 'react';
import TaskTimer from './TaskTimer';
import { Trash2, RefreshCw, Clock, CheckCircle, XCircle, AlertCircle, Share2 } from 'lucide-react';

const StatusBadge = ({ status }) => {
    const styles = {
        PENDING: "bg-amber-400/10 text-amber-400 border-amber-400/20 shadow-[0_0_10px_rgba(251,191,36,0.05)]",
        PENDING_APPROVAL: "bg-orange-400/10 text-orange-400 border-orange-400/20 shadow-[0_0_10px_rgba(251,146,60,0.05)]",
        PROCESSING: "bg-sky-400/10 text-sky-400 border-sky-400/20 shadow-[0_0_10px_rgba(56,189,248,0.05)]",
        SUCCESS: "bg-emerald-400/10 text-emerald-400 border-emerald-400/20 shadow-[0_0_10px_rgba(52,211,153,0.05)]",
        FAILED: "bg-rose-400/10 text-rose-400 border-rose-400/20 shadow-[0_0_10px_rgba(248,113,113,0.05)]",
    };

    const icons = {
        PENDING: Clock,
        PENDING_APPROVAL: Clock,
        PROCESSING: RefreshCw,
        SUCCESS: CheckCircle,
        FAILED: XCircle,
    };

    const Icon = icons[status] || AlertCircle;
    const style = styles[status] || styles.PENDING;

    return (
        <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-bold uppercase tracking-wider border ${style} backdrop-blur-sm`}>
            <Icon className={`w-3.5 h-3.5 ${status === 'PROCESSING' ? 'animate-spin' : ''}`} />
            {status}
        </span>
    );
};

const QueueTable = ({ jobs, onDelete, onBulkDelete, selectedIds, setSelectedIds, onRefresh }) => {
    const isAllSelected = jobs.length > 0 && selectedIds.length === jobs.length;

    const handleSelectAll = () => {
        if (isAllSelected) {
            setSelectedIds([]);
        } else {
            setSelectedIds(jobs.map(j => j.id));
        }
    };

    const handleSelectRow = (id) => {
        setSelectedIds(prev =>
            prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
        );
    };

    return (
        <div className="relative overflow-hidden rounded-2xl border border-[var(--panel-border)] bg-[var(--panel-bg)] backdrop-blur-xl shadow-[var(--card-shadow)] transition-all duration-300">
            {/* Table Header */}
            <div className="px-6 py-5 flex justify-between items-center border-b border-[var(--panel-border)] bg-[var(--panel-bg)]">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-indigo-500/20 rounded-lg border border-indigo-500/30">
                        <Share2 className="w-5 h-5 text-indigo-400" />
                    </div>
                    <div>
                        <h3 className="text-lg font-bold text-[var(--text-primary)] tracking-tight">Automation Queue</h3>
                        <p className="text-xs text-[var(--text-secondary)]">Live task monitoring and management</p>
                    </div>
                </div>

                <div className="flex items-center gap-3">
                    {selectedIds.length > 0 && (
                        <button
                            onClick={onBulkDelete}
                            className="flex items-center gap-2 px-4 py-2 bg-rose-500 hover:bg-rose-600 text-white rounded-xl text-xs font-bold transition-all active:scale-95 shadow-lg shadow-rose-500/20"
                        >
                            <Trash2 className="w-4 h-4" />
                            Purge {selectedIds.length} Tasks
                        </button>
                    )}
                    <button
                        onClick={onRefresh}
                        className="group p-2.5 hover:border-[var(--panel-border)] rounded-xl text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-all duration-300 active:scale-95 border border-transparent hover:border-[var(--panel-border)]"
                        title="Refresh List"
                    >
                        <RefreshCw className="w-4 h-4 group-hover:rotate-180 transition-transform duration-500" />
                    </button>
                </div>
            </div>

            {/* Table Content */}
            <div className="overflow-x-auto">
                <table className="w-full text-left">
                    <thead>
                        <tr className="text-[var(--text-secondary)] text-[11px] uppercase tracking-[0.1em] font-black border-b border-[var(--panel-border)]">
                            <th className="px-6 py-4 w-10">
                                <input
                                    type="checkbox"
                                    checked={isAllSelected}
                                    onChange={handleSelectAll}
                                    className="w-4 h-4 rounded border-[var(--panel-border)] bg-transparent text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                                />
                            </th>
                            <th className="px-6 py-4 font-black">ID</th>
                            <th className="px-6 py-4 font-black">Group Destination</th>
                            <th className="px-6 py-4 font-black w-1/3">Content Snippet</th>
                            <th className="px-6 py-4 font-black">Scheduled</th>
                            <th className="px-6 py-4 font-black">Status</th>
                            <th className="px-6 py-4 font-black text-right">Action</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-var(--panel-border)">
                        {jobs.length === 0 ? (
                            <tr>
                                <td colSpan="7" className="px-6 py-12 text-center">
                                    <div className="flex flex-col items-center gap-3 opacity-40">
                                        <Clock className="w-10 h-10 text-[var(--text-secondary)]" />
                                        <p className="text-sm font-medium text-[var(--text-secondary)]">No active tasks found in the queue</p>
                                    </div>
                                </td>
                            </tr>
                        ) : (
                            jobs.map((job) => (
                                <tr key={job.id} className={`group hover:bg-indigo-500/5 transition-all duration-300 ${selectedIds.includes(job.id) ? 'bg-indigo-500/10' : ''}`}>
                                    <td className="px-6 py-4">
                                        <input
                                            type="checkbox"
                                            checked={selectedIds.includes(job.id)}
                                            onChange={() => handleSelectRow(job.id)}
                                            className="w-4 h-4 rounded border-[var(--panel-border)] bg-transparent text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                                        />
                                    </td>
                                    <td className="px-6 py-4">
                                        <span className="text-xs font-mono font-bold text-[var(--text-secondary)] group-hover:accent-color-[var(--accent-color)] transition-colors">
                                            #{String(job.id).padStart(4, '0')}
                                        </span>
                                    </td>
                                    <td className="px-6 py-4">
                                        <div className="flex flex-col">
                                            <span className="text-sm font-bold text-[var(--text-primary)] group-hover:accent-color-[var(--accent-color)] transition-colors">
                                                {job.group_name || 'Generic Group'}
                                            </span>
                                            <span className="text-[10px] text-[var(--text-secondary)] truncate max-w-[120px]">
                                                {job.group_id}
                                            </span>
                                        </div>
                                    </td>
                                    <td className="px-6 py-4">
                                        <p className="text-sm text-[var(--text-secondary)] line-clamp-1 italic opacity-80 group-hover:opacity-100 transition-opacity" title={job.content}>
                                            "{job.content}"
                                        </p>
                                    </td>
                                    <td className="px-6 py-4">
                                        <div className="flex flex-col gap-0.5">
                                            <TaskTimer 
                                                targetTime={job.scheduled_time} 
                                                status={job.status} 
                                                onComplete={onRefresh} 
                                            />
                                            <span className={`text-xs text-[var(--text-primary)] font-medium ${job.status === 'PENDING' ? 'opacity-50 text-[10px]' : ''}`}>
                                                {job.scheduled_time ? new Date(job.scheduled_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Immediate'}
                                            </span>
                                            <span className="text-[10px] text-[var(--text-secondary)]">
                                                {job.scheduled_time ? new Date(job.scheduled_time).toLocaleDateString() : 'ASAP Queue'}
                                            </span>
                                        </div>
                                    </td>
                                    <td className="px-6 py-4">
                                        <StatusBadge status={job.status} />
                                        {job.failure_reason && (
                                            <div className="text-[10px] text-rose-400 mt-1 max-w-[150px] truncate font-medium flex items-center gap-1" title={job.failure_reason}>
                                                <AlertCircle className="w-2.5 h-2.5" />
                                                {job.failure_reason}
                                            </div>
                                        )}
                                    </td>
                                    <td className="px-6 py-4 text-right">
                                        <button
                                            onClick={() => onDelete(job.id)}
                                            className="p-2 text-[var(--text-secondary)] hover:text-rose-400 hover:bg-rose-500/10 rounded-lg transition-all active:scale-90"
                                            title="Cancel Task"
                                        >
                                            <Trash2 className="w-4 h-4" />
                                        </button>
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>

            {/* Table Footer / Glass Overlay */}
            <div className="px-6 py-3 bg-[var(--panel-bg)] text-[10px] text-[var(--text-secondary)] flex justify-between items-center border-t border-[var(--panel-border)]">
                <span>Total Tasks: {jobs.length} | Selected: {selectedIds.length}</span>
                <span className="flex items-center gap-1 uppercase tracking-widest font-black">
                    <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse"></span>
                    Live Sync Active
                </span>
            </div>
        </div>
    );
};

export default QueueTable;
