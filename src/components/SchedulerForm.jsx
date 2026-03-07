import React, { useState } from 'react';
import { Calendar, Send, Users, Zap } from 'lucide-react';

const SchedulerForm = ({ groups, onSubmit, disabled }) => {
    const [content, setContent] = useState('');
    const [selectedGroup, setSelectedGroup] = useState('');
    const [scheduledAt, setScheduledAt] = useState('');

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
            schedule: isoScheduledAt // Using 'schedule' to match server/index.cjs expectations
        });

        // Reset form (optional, maybe keep content for multiple posts)
        setContent('');
        setScheduledAt('');
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
