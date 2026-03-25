import React, { useState } from 'react';
import { Calendar, Send, Users, Zap, Paperclip, X, AlertCircle, CheckCircle2, Upload } from 'lucide-react';
import { useMediaUpload } from '@/hooks/useMediaUpload';

const SchedulerForm = ({ groups, onSubmit, disabled }) => {
    const [content, setContent] = useState('');
    const [selectedGroup, setSelectedGroup] = useState('');
    const [scheduledAt, setScheduledAt] = useState('');
    const [mediaFiles, setMediaFiles] = useState([]);
    const { uploadFile, uploading, progress, error: uploadError, uploadedFile } = useMediaUpload();

    const handleFileSelect = async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;

        try {
            console.log('📎 [FORM] File selected:', file.name);
            const result = await uploadFile(file);
            setMediaFiles(prev => [...prev, result]);
            console.log('✅ [FORM] File added to form:', result.filePath);

            // Reset input
            e.target.value = '';
        } catch (err) {
            console.error('❌ [FORM] File upload failed:', err.message);
        }
    };

    const removeMediaFile = (index) => {
        setMediaFiles(prev => prev.filter((_, i) => i !== index));
    };

    const handleSubmit = (e) => {
        e.preventDefault();
        if (!content || !selectedGroup) return;

        // Find group name
        const group = groups.find(g => g.id === selectedGroup);

        // Critical Fix: specific timezone handling
        // Convert local datetime-local string to UTC ISO string for the backend
        let isoScheduledAt = null;
        if (scheduledAt) {
            isoScheduledAt = new Date(scheduledAt).toISOString();
        }

        onSubmit({
            content,
            group_id: selectedGroup,
            group_name: group ? group.name : 'Unknown Group',
            schedule: isoScheduledAt, // Using 'schedule' to match server/index.cjs expectations
            media_files: mediaFiles.length > 0 ? mediaFiles : null // Include uploaded media files
        });

        // Reset form
        setContent('');
        setScheduledAt('');
        setMediaFiles([]);
    };

    return (
        <div className="bg-[var(--panel-bg)] rounded-2xl shadow-[var(--card-shadow)] border border-[var(--panel-border)] p-6 backdrop-blur-xl transition-all duration-300">
            <h2 className="text-xl font-bold text-[var(--text-primary)] mb-6 flex items-center gap-2 tracking-tight">
                <Send className="w-5 h-5 text-indigo-500" />
                Launch Campaign
            </h2>

            <form onSubmit={handleSubmit} className="space-y-5">
                {/* Content Input */}
                <div>
                    <label className="block text-[var(--text-secondary)] text-[10px] font-black uppercase tracking-[0.2em] mb-2 px-1">Deep Content Analysis</label>
                    <textarea
                        className="w-full bg-black/5 dark:bg-black/20 border border-[var(--panel-border)] rounded-xl p-4 text-[var(--text-primary)] placeholder:text-[var(--text-secondary)]/40 focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500 transition-all h-36 resize-none outline-none text-sm leading-relaxed"
                        placeholder="Define your broadcast parameters..."
                        value={content}
                        onChange={(e) => setContent(e.target.value)}
                        required
                    />
                </div>

                <div className="grid grid-cols-1 gap-5">
                    {/* Group Selector */}
                    <div>
                        <label className="text-[var(--text-secondary)] text-[10px] font-black uppercase tracking-[0.2em] mb-2 px-1 flex items-center gap-2">
                            <Users className="w-3.5 h-3.5" />
                            Secure Node Selection
                        </label>
                        <select
                            className="w-full bg-black/5 dark:bg-black/20 border border-[var(--panel-border)] rounded-xl p-3.5 text-[var(--text-primary)] focus:ring-2 focus:ring-indigo-500/50 outline-none text-sm font-medium appearance-none cursor-pointer"
                            value={selectedGroup}
                            onChange={(e) => setSelectedGroup(e.target.value)}
                            required
                        >
                            <option value="" className="bg-[var(--bg-color)]">Select Target Network...</option>
                            {groups.map(group => (
                                <option key={group.id} value={group.id} className="bg-[var(--bg-color)]">
                                    {group.name}
                                </option>
                            ))}
                        </select>
                    </div>

                    {/* Date Picker */}
                    <div>
                        <label className="text-[var(--text-secondary)] text-[10px] font-black uppercase tracking-[0.2em] mb-2 px-1 flex items-center gap-2">
                            <Calendar className="w-3.5 h-3.5" />
                            Temporal scheduling
                        </label>
                        <input
                            type="datetime-local"
                            className="w-full bg-black/5 dark:bg-black/20 border border-[var(--panel-border)] rounded-xl p-3 text-[var(--text-primary)] focus:ring-2 focus:ring-indigo-500/50 outline-none text-sm font-medium"
                            value={scheduledAt}
                            onChange={(e) => setScheduledAt(e.target.value)}
                        />
                    </div>
                </div>

                {/* Media Upload Section */}
                <div className="border-t border-[var(--panel-border)] pt-5">
                    <div>
                        <label className="text-[var(--text-secondary)] text-[10px] font-black uppercase tracking-[0.2em] mb-3 px-1 flex items-center gap-2">
                            <Paperclip className="w-3.5 h-3.5" />
                            Media Attachment (Optional)
                        </label>

                        {/* Upload Input */}
                        <div className="relative">
                            <input
                                type="file"
                                id="media-upload"
                                accept="image/*,video/*"
                                onChange={handleFileSelect}
                                disabled={uploading || disabled}
                                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed"
                            />
                            <label
                                htmlFor="media-upload"
                                className={`flex items-center justify-center gap-2 w-full py-3 px-4 rounded-xl border-2 border-dashed transition-all ${
                                    uploading
                                        ? 'border-blue-500/50 bg-blue-500/5'
                                        : uploadError
                                        ? 'border-red-500/50 bg-red-500/5'
                                        : 'border-[var(--panel-border)] hover:border-indigo-500/50 hover:bg-indigo-500/5 cursor-pointer'
                                }`}
                            >
                                {uploading ? (
                                    <>
                                        <Upload className="w-4 h-4 text-blue-400 animate-pulse" />
                                        <span className="text-[10px] font-semibold text-blue-400">
                                            Uploading ({progress}%)
                                        </span>
                                    </>
                                ) : uploadError ? (
                                    <>
                                        <AlertCircle className="w-4 h-4 text-red-400" />
                                        <span className="text-[10px] font-semibold text-red-400">{uploadError}</span>
                                    </>
                                ) : (
                                    <>
                                        <Paperclip className="w-4 h-4 text-[var(--text-secondary)]" />
                                        <span className="text-[10px] font-semibold text-[var(--text-secondary)]">
                                            Click to upload media (JPG, PNG, MP4, etc.)
                                        </span>
                                    </>
                                )}
                            </label>
                        </div>

                        {/* Uploaded Files List */}
                        {mediaFiles.length > 0 && (
                            <div className="mt-3 space-y-2">
                                {mediaFiles.map((file, idx) => (
                                    <div
                                        key={idx}
                                        className="flex items-center justify-between p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-lg"
                                    >
                                        <div className="flex items-center gap-2 min-w-0">
                                            <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                                            <span className="text-[10px] font-semibold text-emerald-400 truncate">
                                                {file.filePath.split('/').pop()}
                                            </span>
                                            <span className="text-[10px] text-emerald-400/60 flex-shrink-0">
                                                ({(file.size / 1024 / 1024).toFixed(2)}MB)
                                            </span>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => removeMediaFile(idx)}
                                            className="text-emerald-400 hover:text-red-400 transition-colors flex-shrink-0"
                                        >
                                            <X className="w-4 h-4" />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>

                {/* Submit Button */}
                <button
                    type="submit"
                    disabled={disabled || !content || !selectedGroup}
                    className={`w-full py-4 px-5 rounded-xl font-black uppercase tracking-widest text-[11px] flex items-center justify-center gap-3 transition-all duration-300 shadow-lg active:scale-[0.98]
            ${disabled || !content || !selectedGroup
                            ? 'border-[var(--panel-border)] text-[var(--text-secondary)]/30 cursor-not-allowed grayscale'
                            : 'bg-gradient-to-r from-indigo-500 via-indigo-600 to-blue-600 hover:shadow-indigo-500/30 text-white'
                        }`}
                >
                    <Zap className={`w-4 h-4 ${!disabled && content && selectedGroup ? 'fill-white' : ''}`} />
                    {scheduledAt ? 'Queue for Temporal Broadcast' : 'Execute Instant Broadcast'}
                </button>
            </form>
        </div>
    );
};

export default SchedulerForm;
