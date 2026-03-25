import React, { useState } from 'react';
import TaskTimer from './TaskTimer';
import { Trash2, RefreshCw, Clock, CheckCircle, XCircle, AlertCircle, Share2, ExternalLink, Image, Download, X } from 'lucide-react';

// Media Preview Modal
const MediaPreviewModal = ({ file, onClose }) => {
    if (!file) return null;

    const isImage = file.type?.startsWith('image/') || file.filePath?.match(/\.(jpg|jpeg|png|gif|webp)$/i);
    const isVideo = file.type?.startsWith('video/') || file.filePath?.match(/\.(mp4|webm|mov|avi)$/i);

    return (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-[var(--panel-bg)] rounded-2xl border border-[var(--panel-border)] shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col">
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--panel-border)]">
                    <div>
                        <h3 className="text-lg font-bold text-[var(--text-primary)]">Media Preview</h3>
                        <p className="text-xs text-[var(--text-secondary)] mt-1">{file.filePath?.split('/').pop()}</p>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 hover:bg-red-500/10 text-red-400 rounded-lg transition-all"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-auto flex items-center justify-center p-6 bg-black/30">
                    {isImage && (
                        <img
                            src={file.filePath}
                            alt="Preview"
                            className="max-w-full max-h-[70vh] rounded-xl object-contain"
                        />
                    )}
                    {isVideo && (
                        <video
                            src={file.filePath}
                            controls
                            className="max-w-full max-h-[70vh] rounded-xl"
                        />
                    )}
                    {!isImage && !isVideo && (
                        <div className="flex flex-col items-center gap-4 text-[var(--text-secondary)]">
                            <Image className="w-16 h-16 opacity-30" />
                            <p className="text-sm">Preview not available for this file type</p>
                            <a
                                href={file.filePath}
                                download
                                className="px-4 py-2 bg-indigo-500 text-white rounded-lg text-xs font-bold hover:bg-indigo-600 transition-all flex items-center gap-2"
                            >
                                <Download className="w-3.5 h-3.5" />
                                Download File
                            </a>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="px-6 py-4 border-t border-[var(--panel-border)] flex items-center justify-between bg-[var(--panel-bg)]">
                    <p className="text-xs text-[var(--text-secondary)]">
                        {file.size ? `${(file.size / 1024 / 1024).toFixed(2)} MB` : 'Size unknown'}
                    </p>
                    {isImage || isVideo ? (
                        <a
                            href={file.filePath}
                            download
                            className="px-4 py-2 bg-indigo-500 text-white rounded-lg text-xs font-bold hover:bg-indigo-600 transition-all flex items-center gap-2"
                        >
                            <Download className="w-3.5 h-3.5" />
                            Download
                        </a>
                    ) : null}
                </div>
            </div>
        </div>
    );
};

// Media Badge Component
const MediaBadge = ({ mediaPaths, onPreview }) => {
    if (!mediaPaths || mediaPaths.length === 0) {
        return <span className="text-xs text-[var(--text-secondary)] opacity-40">No media</span>;
    }

    return (
        <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5">
                {mediaPaths.slice(0, 3).map((path, idx) => {
                    const fileName = path.split('/').pop();
                    const isImage = path.match(/\.(jpg|jpeg|png|gif|webp)$/i);
                    const isVideo = path.match(/\.(mp4|webm|mov|avi)$/i);

                    return (
                        <button
                            key={idx}
                            onClick={() => onPreview({ filePath: path, type: isImage ? 'image' : isVideo ? 'video' : 'unknown' })}
                            className="group relative w-8 h-8 rounded-lg bg-indigo-500/20 border border-indigo-500/40 hover:border-indigo-500 transition-all overflow-hidden flex items-center justify-center"
                            title={fileName}
                        >
                            {isImage && (
                                <img
                                    src={path}
                                    alt="Thumbnail"
                                    className="w-full h-full object-cover opacity-70 group-hover:opacity-100"
                                />
                            )}
                            {isVideo && (
                                <div className="w-full h-full bg-purple-500/30 flex items-center justify-center">
                                    <div className="w-0 h-0 border-l-2 border-t-1 border-b-1 border-l-white border-t-transparent border-b-transparent ml-0.5"></div>
                                </div>
                            )}
                            {!isImage && !isVideo && (
                                <Image className="w-3 h-3 text-indigo-400" />
                            )}
                        </button>
                    );
                })}
            </div>

            {mediaPaths.length > 0 && (
                <span className="text-xs font-bold bg-indigo-500/20 text-indigo-400 px-2 py-1 rounded-full border border-indigo-500/40">
                    {mediaPaths.length}
                </span>
            )}
        </div>
    );
};

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
    const [previewFile, setPreviewFile] = useState(null);
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
                            <th className="px-6 py-4 font-black">Media</th>
                            <th className="px-6 py-4 font-black">Scheduled</th>
                            <th className="px-6 py-4 font-black">Status</th>
                            <th className="px-6 py-4 font-black text-right">Action</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-var(--panel-border)">
                        {jobs.length === 0 ? (
                            <tr>
                                <td colSpan="8" className="px-6 py-12 text-center">
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
                                            <div className="flex items-center gap-2">
                                                <span className="text-sm font-bold text-[var(--text-primary)] group-hover:accent-color-[var(--accent-color)] transition-colors">
                                                    {job.group_name || 'Generic Group'}
                                                </span>
                                                {job.proof_url && (
                                                    <a 
                                                        href={job.proof_url} 
                                                        target="_blank" 
                                                        rel="noopener noreferrer"
                                                        className="p-1 rounded-full bg-indigo-500/10 text-indigo-400 hover:bg-indigo-500 hover:text-white transition-all duration-300 transform hover:scale-110"
                                                        title="צפה בפוסט שפורסם"
                                                    >
                                                        <ExternalLink className="w-3 h-3" />
                                                    </a>
                                                )}
                                            </div>
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
                                        <MediaBadge
                                            mediaPaths={job.media_paths}
                                            onPreview={setPreviewFile}
                                        />
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

            {/* Media Preview Modal */}
            <MediaPreviewModal file={previewFile} onClose={() => setPreviewFile(null)} />
        </div>
    );
};

export default QueueTable;
