import React from 'react';
import {
    BarChart3, CheckCircle2, AlertCircle, Clock, X, TrendingUp
} from 'lucide-react';

const AnalyticsPanel = ({ data, onClose }) => {
    const summary = data?.summary || {
        total: 0,
        success: 0,
        failed: 0,
        pending: 0,
        successRate: 0,
    };

    const byDay = data?.byDay || [];
    const topGroups = data?.topGroups || [];

    const successRate = summary.total > 0
        ? Math.round((summary.success / summary.total) * 100)
        : 0;

    return (
        <div className="fixed inset-0 z-[150] bg-black/80 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-300">
            <div className="bg-[#161b22] border border-[#30363d] w-full max-w-5xl max-h-[90vh] rounded-2xl shadow-2xl flex flex-col overflow-hidden rtl">

                {/* HEADER */}
                <div className="p-6 border-b border-[#30363d] flex justify-between items-center bg-[#1c2128]">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-blue-500/10 rounded-lg border border-blue-500/20">
                            <BarChart3 className="w-5 h-5 text-blue-400" />
                        </div>
                        <div>
                            <h2 className="text-xl font-bold text-white">נתוני ביצועים (Stitch Dashboard)</h2>
                            <p className="text-[10px] text-gray-500 uppercase tracking-widest font-black">30 הימים האחרונים • SafePost Backup</p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        aria-label="סגור"
                        className="p-2 rounded-full hover:bg-[#21262d] text-gray-400 hover:text-white transition-colors"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* CONTENT GRID */}
                <div className="p-6 overflow-y-auto grid grid-cols-1 md:grid-cols-4 gap-4 bg-[#0d1117]">

                    {/* Bar Chart (3 columns) */}
                    <div className="md:col-span-3 bg-[#161b22] border border-[#30363d] rounded-2xl p-6 min-h-[300px] flex flex-col">
                        <div className="flex justify-between items-start mb-4">
                            <h3 className="text-sm font-medium text-gray-400">נתוני פעילות פוסטים (7 ימים)</h3>
                            <TrendingUp className="w-4 h-4 text-emerald-400 opacity-50" />
                        </div>

                        <div className="flex-1 flex items-end justify-between gap-2 mt-4">
                            {byDay.length > 0 ? (
                                byDay.map((day, i) => {
                                    const maxCount = Math.max(...byDay.map(d => d.total), 1);
                                    const height = (day.total / maxCount) * 100;
                                    return (
                                        <div
                                            key={i}
                                            className="w-full bg-blue-500/10 rounded-t-md transition-all duration-300 hover:bg-blue-500/20 cursor-pointer group relative"
                                            style={{ minHeight: '200px' }}
                                        >
                                            <div
                                                className="w-full bg-blue-600/40 rounded-t-md transition-all duration-300 group-hover:bg-blue-500 group-hover:shadow-lg group-hover:shadow-blue-500/20"
                                                style={{ height: `${height}%` }}
                                            />
                                            <span className="absolute -bottom-6 left-1/2 -translate-x-1/2 text-[10px] text-gray-500 whitespace-nowrap">
                                                {new Date(day.date).toLocaleDateString('he-IL', { month: 'short', day: 'numeric' })}
                                            </span>
                                        </div>
                                    );
                                })
                            ) : (
                                [40, 70, 45, 90, 65, 80, 50].map((h, i) => (
                                    <div key={i} className="w-full bg-blue-500/10 rounded-t-md flex items-end" style={{ minHeight: '200px' }}>
                                        <div className="w-full bg-blue-600/40 rounded-t-md" style={{ height: `${h}%` }} />
                                    </div>
                                ))
                            )}
                        </div>

                        <div className="mt-8 flex justify-between text-[10px] text-gray-500 font-mono tracking-tighter">
                            <span>אופק 7 ימים</span>
                            <span className="text-blue-400 uppercase">LIVE</span>
                        </div>
                    </div>

                    {/* Donut Chart (Success Rate) */}
                    <div className="bg-[#1c2128] border border-[#30363d] rounded-2xl p-6 flex flex-col items-center justify-center">
                        <h3 className="text-[10px] font-black uppercase tracking-widest text-gray-500 mb-4">אחוזי הצלחה</h3>
                        <div className="relative w-28 h-28 flex items-center justify-center">
                            <svg className="w-full h-full transform -rotate-90">
                                <circle
                                    cx="56" cy="56" r="48"
                                    stroke="currentColor"
                                    strokeWidth="8"
                                    fill="transparent"
                                    className="text-[#0d1117]"
                                />
                                <circle
                                    cx="56" cy="56" r="48"
                                    stroke="currentColor"
                                    strokeWidth="8"
                                    fill="transparent"
                                    strokeDasharray={301.6}
                                    strokeDashoffset={301.6 - (301.6 * successRate) / 100}
                                    className="text-emerald-500 transition-all duration-1000 ease-out"
                                    strokeLinecap="round"
                                />
                            </svg>
                            <div className="absolute flex flex-col items-center">
                                <span className="text-2xl font-black text-white">{successRate}%</span>
                                <span className="text-[8px] text-emerald-500 font-bold uppercase tracking-tighter">Success</span>
                            </div>
                        </div>
                    </div>

                    {/* KPI: Success */}
                    <div className="bg-[#161b22] border border-[#30363d] rounded-2xl p-4 flex items-center gap-4 border-l-4 border-l-emerald-500">
                        <div className="p-3 bg-emerald-500/10 rounded-xl">
                            <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                        </div>
                        <div>
                            <p className="text-[10px] text-gray-500 font-bold uppercase">הצלחות</p>
                            <p className="text-xl font-bold text-white">{summary.success}</p>
                        </div>
                    </div>

                    {/* KPI: Failed */}
                    <div className="bg-[#161b22] border border-[#30363d] rounded-2xl p-4 flex items-center gap-4 border-l-4 border-l-rose-500">
                        <div className="p-3 bg-rose-500/10 rounded-xl">
                            <AlertCircle className="w-5 h-5 text-rose-500" />
                        </div>
                        <div>
                            <p className="text-[10px] text-gray-500 font-bold uppercase">כשלונות</p>
                            <p className="text-xl font-bold text-white">{summary.failed}</p>
                        </div>
                    </div>

                    {/* KPI: Pending */}
                    <div className="bg-[#161b22] border border-[#30363d] rounded-2xl p-4 flex items-center gap-4 border-l-4 border-l-amber-500">
                        <div className="p-3 bg-amber-500/10 rounded-xl">
                            <Clock className="w-5 h-5 text-amber-500" />
                        </div>
                        <div>
                            <p className="text-[10px] text-gray-500 font-bold uppercase">ממתינים</p>
                            <p className="text-xl font-bold text-white">{summary.pending}</p>
                        </div>
                    </div>

                    {/* KPI: Total */}
                    <div className="bg-blue-600 rounded-2xl p-4 flex flex-col justify-between group cursor-pointer overflow-hidden relative shadow-lg shadow-blue-900/20 transition-all hover:-translate-y-1">
                        <div className="z-10 text-white/70 text-[10px] font-black uppercase tracking-widest">סה"כ פוסטים</div>
                        <div className="z-10 text-white text-3xl font-black">{summary.total}</div>
                    </div>

                    {/* Top Groups Table (full width) */}
                    {topGroups.length > 0 && (
                        <div className="md:col-span-4 bg-[#161b22] border border-[#30363d] rounded-2xl p-4">
                            <h3 className="text-[10px] font-black uppercase tracking-widest text-gray-500 mb-3">קבוצות מובילות</h3>
                            <div className="space-y-2">
                                {topGroups.slice(0, 5).map((group, i) => (
                                    <div key={i} className="flex justify-between items-center p-2 bg-[#1c2128] rounded-lg hover:bg-[#21262d] transition">
                                        {group.url ? (
                                            <a href={group.url} target="_blank" rel="noreferrer" className="text-sm text-blue-400 hover:text-blue-300 hover:underline transition" dir="rtl">{group.name}</a>
                                        ) : (
                                            <span className="text-sm text-white" dir="rtl">{group.name}</span>
                                        )}
                                        <span className="text-xs text-gray-500">{group.total} posts • {group.success} success</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                </div>

                {/* FOOTER */}
                <div className="p-4 bg-[#1c2128] border-t border-[#30363d] text-center">
                    <p className="text-[10px] text-gray-500 font-medium tracking-tight">
                        נתונים מבוצעים Supabase Cloud • App Source: SafePost_Backup_v2.2
                    </p>
                </div>

            </div>
        </div>
    );
};

export default AnalyticsPanel;
