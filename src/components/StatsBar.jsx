import React from 'react';
import { LayoutDashboard, Clock, CheckCircle, XCircle } from 'lucide-react';

const StatsCard = ({ title, value, icon: Icon, bgColor, iconColor, textColor }) => (
    <div className="bg-surface-container-lowest rounded-lg p-lg flex items-center shadow-sm border border-outline-variant transition-all duration-300 hover:border-primary/20">
        <div className={`p-md rounded-lg mr-md ${bgColor}`}>
            <Icon className={`w-6 h-6 ${iconColor}`} />
        </div>
        <div>
            <p className="text-caption text-on-surface-variant uppercase tracking-wider mb-xs">{title}</p>
            <p className={`text-h2 font-bold tracking-tight ${textColor}`}>{value}</p>
        </div>
    </div>
);

const StatsBar = ({ stats }) => {
    if (!stats) return null;

    return (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-md mb-lg">
            <StatsCard
                title="Total Tasks"
                value={stats.TOTAL || 0}
                icon={LayoutDashboard}
                bgColor="bg-primary-fixed"
                iconColor="text-primary"
                textColor="text-primary"
            />
            <StatsCard
                title="Pending"
                value={stats.PENDING || 0}
                icon={Clock}
                bgColor="bg-amber-50"
                iconColor="text-amber-600"
                textColor="text-amber-700"
            />
            <StatsCard
                title="Completed"
                value={stats.SUCCESS || 0}
                icon={CheckCircle}
                bgColor="bg-emerald-50"
                iconColor="text-emerald-600"
                textColor="text-emerald-700"
            />
            <StatsCard
                title="Failed"
                value={stats.FAILED || 0}
                icon={XCircle}
                bgColor="bg-error-container"
                iconColor="text-error"
                textColor="text-error"
            />
        </div>
    );
};

export default StatsBar;
