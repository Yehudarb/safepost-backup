import React from 'react';
import TaskTimer from './TaskTimer';
import { Trash2, RefreshCw, Clock, CheckCircle, XCircle, AlertCircle, Share2, ExternalLink } from 'lucide-react';
import { useLanguage } from '@/lib/i18n';

const StatusBadge = ({ status }) => {
    const styles = {
        PENDING: "bg-amber-50 text-amber-700 border-amber-200",
        SENT: "bg-blue-50 text-blue-700 border-blue-200",
        PENDING_APPROVAL: "bg-orange-50 text-orange-700 border-orange-200",
        PROCESSING: "bg-primary-fixed text-primary border-primary-fixed-dim",
        SUCCESS: "bg-emerald-50 text-emerald-700 border-emerald-200",
        FAILED: "bg-error-container text-error border-error/20",
        NEEDS_USER_ACTION: "bg-orange-50 text-orange-700 border-orange-300",
        CANCELLED: "bg-gray-100 text-gray-500 border-gray-200",
        EXPIRED: "bg-gray-100 text-gray-500 border-gray-200",
    };

    const icons = {
        PENDING: Clock,
        SENT: Clock,
        PENDING_APPROVAL: Clock,
        PROCESSING: RefreshCw,
        SUCCESS: CheckCircle,
        FAILED: XCircle,
        NEEDS_USER_ACTION: AlertCircle,
        CANCELLED: XCircle,
        EXPIRED: Clock,
    };

    const Icon = icons[status] || AlertCircle;
    const style = styles[status] || styles.PENDING;

    return (
        <span className={`inline-flex items-center gap-sm px-md py-xs rounded-full text-caption font-bold uppercase tracking-wider border ${style}`}>
            <Icon className={`w-3.5 h-3.5 ${status === 'PROCESSING' ? 'animate-spin' : ''}`} />
            {status}
        </span>
    );
};

const QueueTable = ({ jobs, onDelete, onBulkDelete, selectedIds, setSelectedIds, onRefresh }) => {
    const { t } = useLanguage();
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
        <div className="relative overflow-hidden rounded-lg border border-outline-variant bg-surface-container-lowest shadow-sm transition-all duration-300">
            {/* Table Header */}
            <div className="px-lg py-md flex justify-between items-center border-b border-outline-variant bg-surface-container-lowest">
                <div className="flex items-center gap-md">
                    <div className="p-sm bg-primary-fixed rounded-lg border border-primary-fixed-dim">
                        <Share2 className="w-5 h-5 text-primary" />
                    </div>
                    <div>
                        <h3 className="text-h3 font-bold text-on-surface tracking-tight">Automation Queue</h3>
                        <p className="text-caption text-on-surface-variant">Live task monitoring and management</p>
                    </div>
                </div>

                <div className="flex items-center gap-md">
                    {selectedIds.length > 0 && (
                        <button
                            onClick={onBulkDelete}
                            className="flex items-center gap-sm px-md py-sm bg-error hover:opacity-90 text-on-error rounded-lg text-caption font-bold transition-all active:scale-95 shadow-sm"
                        >
                            <Trash2 className="w-4 h-4" />
                            Purge {selectedIds.length} Tasks
                        </button>
                    )}
                    <button
                        onClick={onRefresh}
                        className="group p-sm hover:bg-surface-container rounded-lg text-on-surface-variant hover:text-on-surface transition-all duration-300 active:scale-95 border border-transparent hover:border-outline-variant"
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
                        <tr className="text-on-surface-variant text-caption uppercase tracking-wider font-bold border-b border-outline-variant bg-surface-container">
                            <th className="px-lg py-md w-10">
                                <input
                                    type="checkbox"
                                    checked={isAllSelected}
                                    onChange={handleSelectAll}
                                    className="w-4 h-4 rounded border-outline-variant bg-transparent text-primary focus:ring-primary cursor-pointer"
                                />
                            </th>
                            <th className="px-lg py-md font-bold">ID</th>
                            <th className="px-lg py-md font-bold">Group Destination</th>
                            <th className="px-lg py-md font-bold w-1/3">Content Snippet</th>
                            <th className="px-lg py-md font-bold">Scheduled</th>
                            <th className="px-lg py-md font-bold">Status</th>
                            <th className="px-lg py-md font-bold text-right">Action</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-outline-variant">
                        {jobs.length === 0 ? (
                            <tr>
                                <td colSpan="7" className="px-lg py-xl text-center">
                                    <div className="flex flex-col items-center gap-md py-2xl">
                                        <div className="p-lg bg-primary/5 rounded-full">
                                            <Clock className="w-10 h-10 text-primary opacity-40" />
                                        </div>
                                        <div className="flex flex-col gap-sm max-w-sm">
                                            <p className="text-body-lg font-bold text-on-surface">Queue is empty</p>
                                            <p className="text-body-sm text-on-surface-variant">No automation tasks scheduled. Start by creating a campaign or uploading content to populate the queue.</p>
                                        </div>
                                    </div>
                                </td>
                            </tr>
                        ) : (
                            jobs.map((job) => (
                                <tr key={job.id} className={`group hover:bg-primary/5 transition-all duration-300 ${selectedIds.includes(job.id) ? 'bg-primary/10' : ''}`}>
                                    <td className="px-lg py-md">
                                        <input
                                            type="checkbox"
                                            checked={selectedIds.includes(job.id)}
                                            onChange={() => handleSelectRow(job.id)}
                                            className="w-4 h-4 rounded border-outline-variant bg-transparent text-primary focus:ring-primary cursor-pointer"
                                        />
                                    </td>
                                    <td className="px-lg py-md">
                                        <span className="text-caption font-mono font-bold text-on-surface-variant group-hover:text-primary transition-colors">
                                            #{String(job.id).padStart(4, '0')}
                                        </span>
                                    </td>
                                    <td className="px-lg py-md">
                                         <div className="flex flex-col">
                                            <div className="flex items-center gap-sm">
                                                <span className="text-body-md font-bold text-on-surface group-hover:text-primary transition-colors">
                                                    {job.group_name || 'Generic Group'}
                                                </span>
                                                {(job.external_post_url || job.proof_url) && (
                                                    <a
                                                        href={job.external_post_url || job.proof_url}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className="p-xs rounded-full bg-primary-fixed text-primary hover:bg-primary hover:text-on-primary transition-all duration-300 transform hover:scale-110"
                                                        title={t('queueTableViewPublishedPost')}
                                                    >
                                                        <ExternalLink className="w-3 h-3" />
                                                    </a>
                                                )}
                                            </div>
                                            <span className="text-caption text-on-surface-variant truncate max-w-[120px]">
                                                {job.group_id}
                                            </span>
                                        </div>
                                    </td>
                                    <td className="px-lg py-md">
                                        <p className="text-body-md text-on-surface-variant line-clamp-1 italic opacity-75 group-hover:opacity-100 transition-opacity" title={job.content}>
                                            "{job.content}"
                                        </p>
                                    </td>
                                    <td className="px-lg py-md">
                                        <div className="flex flex-col gap-xs">
                                            <TaskTimer
                                                targetTime={job.scheduled_time}
                                                status={job.status}
                                                onComplete={onRefresh}
                                            />
                                            <span className={`text-caption text-on-surface font-medium ${job.status === 'PENDING' ? 'opacity-60' : ''}`}>
                                                {job.scheduled_time ? new Date(job.scheduled_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Immediate'}
                                            </span>
                                            <span className="text-caption text-on-surface-variant">
                                                {job.scheduled_time ? new Date(job.scheduled_time).toLocaleDateString() : 'ASAP Queue'}
                                            </span>
                                        </div>
                                    </td>
                                    <td className="px-lg py-md">
                                        <StatusBadge status={job.status} />
                                        {job.attempt_count > 1 && (
                                            <div className="text-caption text-on-surface-variant mt-xs flex items-center gap-xs" title={job.error_code || ''}>
                                                <RefreshCw className="w-2.5 h-2.5" />
                                                Attempt {job.attempt_count}{job.max_attempts ? `/${job.max_attempts}` : ''}
                                                {job.next_attempt_at && new Date(job.next_attempt_at) > new Date() && (
                                                    <span> · retry {new Date(job.next_attempt_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                                                )}
                                            </div>
                                        )}
                                        {job.failure_reason && (
                                            <div className="text-caption text-error mt-sm max-w-[150px] truncate font-medium flex items-center gap-xs" title={job.failure_reason}>
                                                <AlertCircle className="w-2.5 h-2.5" />
                                                {job.failure_reason}
                                            </div>
                                        )}
                                    </td>
                                    <td className="px-lg py-md text-right">
                                        <button
                                            onClick={() => onDelete(job.id)}
                                            className="p-sm text-on-surface-variant hover:text-error hover:bg-error/10 rounded-lg transition-all active:scale-90"
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
            <div className="px-lg py-sm bg-surface-container text-caption text-on-surface-variant flex justify-between items-center border-t border-outline-variant">
                <span>Total Tasks: {jobs.length} | Selected: {selectedIds.length}</span>
                <span className="flex items-center gap-xs uppercase tracking-wider font-bold">
                    <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse"></span>
                    Live Sync Active
                </span>
            </div>
        </div>
    );
};

export default QueueTable;
