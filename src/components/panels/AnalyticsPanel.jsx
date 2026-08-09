import React, { useState } from 'react';
import {
    BarChart3, CheckCircle2, AlertCircle, Clock, X, TrendingUp, Download
} from 'lucide-react';
import { API_BASE } from '@/lib/apiConfig';

const AnalyticsPanel = ({ data, onClose }) => {
    const [filterTab, setFilterTab] = useState('success');
    const [reportLoading, setReportLoading] = useState(false);

    const downloadReport = async (format = 'csv') => {
        setReportLoading(true);
        try {
            const res = await fetch(`${API_BASE}/report/tasks`);
            const report = await res.json();

            if (format === 'csv') {
                // Generate CSV
                let csv = 'דוח הצלחות וכשלונות\n\n';
                csv += `יום ${new Date().toLocaleDateString('he-IL')}\n\n`;
                csv += `סה"כ: ${report.summary.total}, הצלחות: ${report.summary.successes}, כשלונות: ${report.summary.failures}, שיעור הצלחה: ${report.summary.successRate}%\n\n`;

                csv += '=== כשלונות ===\n';
                csv += 'ID,קבוצה,סיבה,תאריך\n';
                report.failures.forEach(f => {
                    csv += `${f.id},"${f.group}","${f.reason}","${new Date(f.timestamp).toLocaleString('he-IL')}"\n`;
                });

                csv += '\n=== סיכום שגיאות ===\n';
                csv += 'סיבה,כמות\n';
                report.errorSummary.forEach(e => {
                    csv += `"${e.reason}",${e.count}\n`;
                });

                csv += '\n=== הצלחות ===\n';
                csv += 'ID,קבוצה,תאריך\n';
                report.successes.forEach(s => {
                    csv += `${s.id},"${s.group}","${new Date(s.timestamp).toLocaleString('he-IL')}"\n`;
                });

                const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
                const link = document.createElement('a');
                link.href = URL.createObjectURL(blob);
                link.download = `report-${new Date().toISOString().slice(0, 10)}.csv`;
                link.click();
            } else {
                // Download JSON
                const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
                const link = document.createElement('a');
                link.href = URL.createObjectURL(blob);
                link.download = `report-${new Date().toISOString().slice(0, 10)}.json`;
                link.click();
            }
        } catch (err) {
            console.error('Report download failed:', err);
        } finally {
            setReportLoading(false);
        }
    };

    const summary = data?.summary || {
        total: 0,
        success: 0,
        failed: 0,
        pending: 0,
        successRate: 0,
    };

    const byDay = data?.byDay || [];
    const topGroups = data?.topGroups || [];
    const problemGroups = data?.problemGroups || [];
    const pendingGroups = data?.pendingGroups || [];
    const topErrors = data?.topErrors || [];
    const timing = data?.timing || null;
    const throttleSuggestion = data?.throttleSuggestion || null;
    const variantStats = data?.variantStats || [];

    const healthBadgeClass = (score) =>
        score >= 70 ? 'bg-emerald-500/10 text-emerald-400'
        : score >= 40 ? 'bg-amber-500/10 text-amber-400'
        : 'bg-rose-500/10 text-rose-400';

    // Calculate task counts from group data
    const totalSuccessTasks = topGroups.reduce((sum, g) => sum + (g.success || 0), 0);
    const totalFailedTasks = problemGroups.reduce((sum, g) => sum + (g.failed || 0), 0);
    const totalPendingTasks = pendingGroups.reduce((sum, g) => sum + (g.pending || 0), 0);

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
                    <div className="flex items-center gap-2">
                        <div className="relative group">
                            <button
                                onClick={() => downloadReport('csv')}
                                disabled={reportLoading}
                                className="p-2 rounded-full hover:bg-[#21262d] text-gray-400 hover:text-emerald-400 transition-colors disabled:opacity-50"
                                title="Download CSV Report"
                            >
                                <Download className="w-5 h-5" />
                            </button>
                            <div className="absolute top-full mt-2 right-0 hidden group-hover:block bg-[#1c2128] border border-[#30363d] rounded text-[10px] text-gray-400 px-2 py-1 whitespace-nowrap z-10">
                                הורד דוח CSV
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

                    {/* Timing — queue-to-completion, not pure post-execution time (see note) */}
                    {timing && timing.sampleSize > 0 && (
                        <div className="bg-[#161b22] border border-[#30363d] rounded-2xl p-4 flex items-center gap-4 border-l-4 border-l-violet-500" title={timing.note}>
                            <div className="p-3 bg-violet-500/10 rounded-xl">
                                <Clock className="w-5 h-5 text-violet-400" />
                            </div>
                            <div>
                                <p className="text-[10px] text-gray-500 font-bold uppercase">זמן ממוצע לתור→סיום</p>
                                <p className="text-xl font-bold text-white">{Math.round(timing.avgQueueToCompletionSeconds / 60)} דק'</p>
                            </div>
                        </div>
                    )}

                    {/* Top Errors */}
                    {topErrors.length > 0 && (
                        <div className="md:col-span-2 bg-[#161b22] border border-[#30363d] rounded-2xl p-4">
                            <h3 className="text-[10px] font-black uppercase tracking-widest text-gray-500 mb-3">שגיאות נפוצות</h3>
                            <div className="space-y-1.5">
                                {topErrors.map((e, i) => (
                                    <div key={i} className="flex items-center gap-2">
                                        <span className="text-[10px] text-gray-300 flex-1 truncate" dir="rtl" title={e.message}>{e.message}</span>
                                        <span className="text-[10px] text-rose-400 font-bold shrink-0">{e.count} ({e.percent}%)</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Throttle Suggestion — heuristic on your own history, nothing auto-applied */}
                    {throttleSuggestion && (
                        <div className="md:col-span-2 bg-[#161b22] border border-[#30363d] rounded-2xl p-4">
                            <h3 className="text-[10px] font-black uppercase tracking-widest text-gray-500 mb-2">המלצת תזמון</h3>
                            {throttleSuggestion.suggestion === 'increase_spacing' ? (
                                <p className="text-xs text-amber-400 leading-relaxed">
                                    ⚠️ {throttleSuggestion.moderationRate + throttleSuggestion.handshakeTimeoutRate}% מהפוסטים נכשלו (מודרציה/handshake).
                                    שקול להגדיל את המרווח בין פוסטים ל-{throttleSuggestion.suggestedSpacingSeconds.min}-{throttleSuggestion.suggestedSpacingSeconds.max} שניות
                                    (כרגע {throttleSuggestion.currentSpacingSeconds.min}-{throttleSuggestion.currentSpacingSeconds.max}).
                                </p>
                            ) : (
                                <p className="text-xs text-emerald-400 leading-relaxed">✓ קצב הפרסום הנוכחי ({throttleSuggestion.currentSpacingSeconds.min}-{throttleSuggestion.currentSpacingSeconds.max}s) נראה תקין.</p>
                            )}
                            {throttleSuggestion.groupsWithFailureStreaks.length > 0 && (
                                <p className="text-[10px] text-gray-500 mt-2">
                                    {throttleSuggestion.groupsWithFailureStreaks.length} קבוצות עם רצף כשלונות: {throttleSuggestion.groupsWithFailureStreaks.slice(0, 3).map(g => g.name).join(', ')}
                                    {throttleSuggestion.groupsWithFailureStreaks.length > 3 ? ` +${throttleSuggestion.groupsWithFailureStreaks.length - 3}` : ''}
                                </p>
                            )}
                            <p className="text-[9px] text-gray-600 mt-2">{throttleSuggestion.note}</p>
                        </div>
                    )}

                    {/* A-B Variant Breakdown — only appears once migration 0009 lands and at least one campaign used content_variants */}
                    {variantStats.length > 0 && (
                        <div className="md:col-span-4 bg-[#161b22] border border-[#30363d] rounded-2xl p-4">
                            <h3 className="text-[10px] font-black uppercase tracking-widest text-gray-500 mb-3">פילוח גרסאות A/B</h3>
                            <div className="space-y-2">
                                {variantStats.map((v, i) => {
                                    const vRate = v.total > 0 ? Math.round(v.success / v.total * 100) : 0;
                                    return (
                                        <div key={i} className="flex items-center gap-3 p-2 bg-[#1c2128] rounded-lg">
                                            <span className="text-[10px] font-black uppercase text-sky-400 w-16 shrink-0">{v.label}</span>
                                            <div className="flex-1 h-2 bg-[#0d1117] rounded-full overflow-hidden">
                                                <div className="h-full bg-sky-500" style={{ width: `${vRate}%` }} />
                                            </div>
                                            <span className="text-[10px] text-gray-400 shrink-0 w-32 text-left" dir="ltr">{v.success}/{v.total} ({vRate}%)</span>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    {/* Groups List with Tabs (full width) */}
                    <div className="md:col-span-4 bg-[#161b22] border border-[#30363d] rounded-2xl p-4">
                        {/* Tabs - Show Task Counts */}
                        <div className="flex gap-2 mb-4 border-b border-[#30363d] pb-3">
                            <button
                                onClick={() => setFilterTab('success')}
                                className={`px-3 py-1 text-xs font-bold uppercase tracking-widest rounded transition ${
                                    filterTab === 'success'
                                        ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                                        : 'text-gray-500 hover:text-gray-300'
                                }`}
                            >
                                הצלחות ({totalSuccessTasks})
                            </button>
                            <button
                                onClick={() => setFilterTab('failed')}
                                className={`px-3 py-1 text-xs font-bold uppercase tracking-widest rounded transition ${
                                    filterTab === 'failed'
                                        ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                                        : 'text-gray-500 hover:text-gray-300'
                                }`}
                            >
                                כשלונות ({totalFailedTasks})
                            </button>
                            <button
                                onClick={() => setFilterTab('pending')}
                                className={`px-3 py-1 text-xs font-bold uppercase tracking-widest rounded transition ${
                                    filterTab === 'pending'
                                        ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                                        : 'text-gray-500 hover:text-gray-300'
                                }`}
                            >
                                ממתינים ({totalPendingTasks})
                            </button>
                        </div>

                        {/* Tab Content */}
                        <div className="space-y-2">
                            {filterTab === 'success' && topGroups.map((group, i) => (
                                <div key={i} className="flex justify-between items-center p-2 bg-[#1c2128] rounded-lg hover:bg-[#21262d] transition">
                                    <div className="flex items-center gap-2 min-w-0">
                                        {group.url ? (
                                            <a href={group.url} target="_blank" rel="noreferrer" className="text-sm text-blue-400 hover:text-blue-300 hover:underline transition truncate" dir="rtl">{group.name}</a>
                                        ) : (
                                            <span className="text-sm text-white truncate" dir="rtl">{group.name}</span>
                                        )}
                                        {typeof group.health_score === 'number' && (
                                            <span className={`shrink-0 text-[9px] font-black px-1.5 py-0.5 rounded ${healthBadgeClass(group.health_score)}`} title="ציון בריאות">{group.health_score}</span>
                                        )}
                                    </div>
                                    <span className="text-xs text-emerald-500 font-bold shrink-0">{group.success} הצלחות</span>
                                </div>
                            ))}

                            {filterTab === 'failed' && problemGroups.map((group, i) => (
                                <div key={i} className="flex justify-between items-center p-2 bg-[#1c2128] rounded-lg hover:bg-[#21262d] transition">
                                    <div className="flex items-center gap-2 min-w-0">
                                        {group.url ? (
                                            <a href={group.url} target="_blank" rel="noreferrer" className="text-sm text-blue-400 hover:text-blue-300 hover:underline transition truncate" dir="rtl">{group.name}</a>
                                        ) : (
                                            <span className="text-sm text-white truncate" dir="rtl">{group.name}</span>
                                        )}
                                        {typeof group.health_score === 'number' && (
                                            <span className={`shrink-0 text-[9px] font-black px-1.5 py-0.5 rounded ${healthBadgeClass(group.health_score)}`} title="ציון בריאות">{group.health_score}</span>
                                        )}
                                    </div>
                                    <span className="text-xs text-rose-500 font-bold shrink-0">{group.failed} כשלונות</span>
                                </div>
                            ))}

                            {filterTab === 'pending' && pendingGroups.map((group, i) => (
                                <div key={i} className="flex justify-between items-center p-2 bg-[#1c2128] rounded-lg hover:bg-[#21262d] transition">
                                    {group.url ? (
                                        <a href={group.url} target="_blank" rel="noreferrer" className="text-sm text-blue-400 hover:text-blue-300 hover:underline transition" dir="rtl">{group.name}</a>
                                    ) : (
                                        <span className="text-sm text-white" dir="rtl">{group.name}</span>
                                    )}
                                    <span className="text-xs text-amber-500 font-bold">{group.pending} ממתינים</span>
                                </div>
                            ))}

                            {((filterTab === 'success' && topGroups.length === 0) ||
                              (filterTab === 'failed' && problemGroups.length === 0) ||
                              (filterTab === 'pending' && pendingGroups.length === 0)) && (
                                <div className="text-center py-6 text-gray-500 text-xs">
                                    אין נתונים להצגה
                                </div>
                            )}
                        </div>
                    </div>

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
