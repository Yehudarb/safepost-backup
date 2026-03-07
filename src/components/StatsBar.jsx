import React from 'react';
import { LayoutDashboard, Clock, CheckCircle, XCircle } from 'lucide-react';

const StatsCard = ({ title, value, icon: Icon, color }) => (
    <div className="bg-[var(--panel-bg)] rounded-2xl p-5 flex items-center shadow-[var(--card-shadow)] border border-[var(--panel-border)] backdrop-blur-xl transition-all duration-300">
        <div className={`p-3.5 rounded-xl mr-4 ${color} bg-opacity-10 border border-current`}>
            <Icon className={`w-6 h-6 ${color.replace('bg-', 'text-')}`} />
        </div>
        <div>
            <p className="text-[var(--text-secondary)] text-[10px] font-black uppercase tracking-[0.15em] mb-1">{title}</p>
            <p className="text-2xl font-black text-[var(--text-primary)] tracking-tight">{value}</p>
        </div>
    </div>
);

const StatsBar = ({ stats }) => {
    if (!stats) return null;

    return (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            <StatsCard
                title="Total Tasks"
                value={stats.TOTAL || 0}
                icon={LayoutDashboard}
                color="bg-blue-500 text-blue-500"
            />
            <StatsCard
                title="Pending"
                value={stats.PENDING || 0}
                icon={Clock}
                color="bg-yellow-500 text-yellow-500"
            />
            <StatsCard
                title="Completed"
                value={stats.SUCCESS || 0}
                icon={CheckCircle}
                color="bg-green-500 text-green-500"
            />
            <StatsCard
                title="Failed"
                value={stats.FAILED || 0}
                icon={XCircle}
                color="bg-red-500 text-red-500"
            />
        </div>
    );
};

export default StatsBar;
