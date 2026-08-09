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
            group_ids: [selectedGroup],
            group_name: group ? group.name : 'Unknown Group',
            schedule: isoScheduledAt // Using 'schedule' to match server/index.cjs expectations
        });

        // Reset form (optional, maybe keep content for multiple posts)
        setContent('');
        setScheduledAt('');
    };

    return (
        <div className="bg-surface-container-lowest rounded-lg shadow-sm border border-outline-variant p-lg transition-all duration-300">
            <h2 className="text-h2 font-bold text-on-surface mb-lg flex items-center gap-md tracking-tight">
                <Send className="w-5 h-5 text-primary" />
                Launch Campaign
            </h2>

            <form onSubmit={handleSubmit} className="space-y-md">
                {/* Content Input */}
                <div>
                    <label className="block text-caption text-on-surface-variant uppercase tracking-wider mb-sm px-sm">Deep Content Analysis</label>
                    <textarea
                        className="w-full bg-surface-container border border-outline-variant rounded-lg p-md text-on-surface placeholder:text-on-surface-variant/50 focus:ring-2 focus:ring-primary focus:border-primary transition-all h-36 resize-none outline-none text-body-md leading-relaxed"
                        placeholder="Define your broadcast parameters..."
                        value={content}
                        onChange={(e) => setContent(e.target.value)}
                        required
                    />
                </div>

                <div className="grid grid-cols-1 gap-md">
                    {/* Group Selector */}
                    <div>
                        <label className="text-caption text-on-surface-variant uppercase tracking-wider mb-sm px-sm flex items-center gap-sm">
                            <Users className="w-3.5 h-3.5" />
                            Secure Node Selection
                        </label>
                        <select
                            className="w-full bg-surface-container border border-outline-variant rounded-lg p-md text-on-surface focus:ring-2 focus:ring-primary outline-none text-body-md font-medium appearance-none cursor-pointer"
                            value={selectedGroup}
                            onChange={(e) => setSelectedGroup(e.target.value)}
                            required
                        >
                            <option value="">Select Target Network...</option>
                            {groups.map(group => (
                                <option key={group.id} value={group.id}>
                                    {group.name}
                                </option>
                            ))}
                        </select>
                    </div>

                    {/* Date Picker */}
                    <div>
                        <label className="text-caption text-on-surface-variant uppercase tracking-wider mb-sm px-sm flex items-center gap-sm">
                            <Calendar className="w-3.5 h-3.5" />
                            Temporal scheduling
                        </label>
                        <input
                            type="datetime-local"
                            className="w-full bg-surface-container border border-outline-variant rounded-lg p-md text-on-surface focus:ring-2 focus:ring-primary outline-none text-body-md font-medium"
                            value={scheduledAt}
                            onChange={(e) => setScheduledAt(e.target.value)}
                        />
                    </div>
                </div>

                {/* Submit Button */}
                <button
                    type="submit"
                    disabled={disabled || !content || !selectedGroup}
                    className={`w-full py-md px-lg rounded-lg font-bold uppercase tracking-wider text-label-sm flex items-center justify-center gap-md transition-all duration-300 shadow-sm active:scale-95
            ${disabled || !content || !selectedGroup
                            ? 'border border-outline-variant text-on-surface-variant/40 cursor-not-allowed opacity-50'
                            : 'bg-primary hover:opacity-90 text-on-primary'
                        }`}
                >
                    <Zap className={`w-4 h-4 ${!disabled && content && selectedGroup ? 'fill-current' : ''}`} />
                    {scheduledAt ? 'Queue for Temporal Broadcast' : 'Execute Instant Broadcast'}
                </button>
            </form>
        </div>
    );
};

export default SchedulerForm;
