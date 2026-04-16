import React from 'react';
import { X } from 'lucide-react';

function AnalyticsPanel({ data, onClose }) {
    const { summary, byDay, topGroups, problemGroups, activeGroups = [], topErrors = [] } = data;
    const maxDay = Math.max(...byDay.map(d => d.total), 1);
    const failRate    = summary.total > 0 ? Math.round((summary.failed    / summary.total) * 100) : 0;
    const cancelRate  = summary.total > 0 ? Math.round((summary.cancelled / summary.total) * 100) : 0;

    const dayLabel = (dateStr) => new Date(dateStr + 'T12:00:00').toLocaleDateString('he-IL', { weekday: 'short' });

    // Semi-circle gauge SVG
    const Gauge = ({ pct, color, size = 54 }) => {
        const r = size * 0.36, cx = size / 2, cy = size * 0.62;
        const circ = 2 * Math.PI * r, half = circ / 2;
        const filled = (Math.min(Math.max(pct, 0), 100) / 100) * half;
        return (
            <svg width={size} height={Math.round(size * 0.66)} viewBox={`0 0 ${size} ${Math.round(size * 0.66)}`}>
                <circle cx={cx} cy={cy} r={r} fill="none" stroke="#1f2937" strokeWidth="5"
                    strokeDasharray={`${half} ${circ}`} strokeLinecap="round"
                    transform={`rotate(180 ${cx} ${cy})`} />
                {pct > 0 && <circle cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth="5"
                    strokeDasharray={`${filled} ${circ}`} strokeLinecap="round"
                    transform={`rotate(180 ${cx} ${cy})`} />}
                <text x={cx} y={cy - 1} textAnchor="middle" dominantBaseline="middle"
                    fontSize="9" fontWeight="800" fill={color}>{pct}%</text>
            </svg>
        );
    };

    // Donut chart
    const DonutChart = () => {
        const r = 28, cx = 38, cy = 38, circ = 2 * Math.PI * r;
        const segs = [
            { val: summary.success,   color: '#10b981', label: 'הצלחה' },
            { val: summary.failed,    color: '#ef4444', label: 'כישלון' },
            { val: summary.cancelled, color: '#4b5563', label: 'בוטל'  },
        ].filter(s => s.val > 0);
        const tot = segs.reduce((s, x) => s + x.val, 0) || 1;
        let offset = 0;
        return (
            <div className="flex items-center gap-3">
                <svg width="76" height="76" viewBox="0 0 76 76">
                    <circle cx={cx} cy={cy} r={r} fill="none" stroke="#1f2937" strokeWidth="10" />
                    {segs.map((seg, i) => {
                        const dash = (seg.val / tot) * circ;
                        const el = (
                            <circle key={i} cx={cx} cy={cy} r={r} fill="none"
                                stroke={seg.color} strokeWidth="10"
                                strokeDasharray={`${dash} ${circ}`}
                                strokeDashoffset={-offset}
                                transform="rotate(-90 38 38)" />
                        );
                        offset += dash;
                        return el;
                    })}
                    <text x={cx} y={cy - 4} textAnchor="middle" fontSize="11" fontWeight="800" fill="white">{summary.total}</text>
                    <text x={cx} y={cy + 7} textAnchor="middle" fontSize="5" fill="#6b7280">סה״כ</text>
                </svg>
                <div className="space-y-1.5">
                    {[
                        { label: 'הצלחה',   val: summary.success,   c: '#10b981' },
                        { label: 'כישלון',  val: summary.failed,    c: '#ef4444' },
                        { label: 'בוטל',    val: summary.cancelled, c: '#4b5563' },
                    ].map(({ label, val, c }) => (
                        <div key={label} className="flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-full shrink-0" style={{ background: c }} />
                            <span className="text-[10px] text-gray-400">{label}</span>
                            <span className="text-[10px] font-black text-gray-200 tabular-nums ml-1">{val}</span>
                        </div>
                    ))}
                </div>
            </div>
        );
    };

    return (
        <div className="bg-white dark:bg-[#161b22] border border-gray-200 dark:border-[#30363d] rounded-xl overflow-hidden shadow-sm mb-4">

            {/* Header */}
            <div className="px-4 py-2.5 border-b border-gray-200 dark:border-[#30363d] flex items-center justify-between bg-gray-50 dark:bg-[#1c2128]">
                <span className="text-[10px] font-black text-gray-500 uppercase tracking-widest">📊 Analytics Dashboard</span>
                <button onClick={onClose} aria-label="סגור אנליטיקה" className="text-gray-500 hover:text-white transition"><X size={14} /></button>
            </div>

            <div className="p-4 space-y-3">

                {/* ROW 1: KPI 2×2 grid + 7-day bar chart */}
                <div className="grid gap-3 grid-cols-1 md:grid-cols-[1fr_2fr]">

                    {/* KPI cards */}
                    <div className="grid grid-cols-2 gap-2">

                        {/* Total */}
                        <div className="dark:bg-[#1c2128] bg-gray-50 rounded-xl p-3 flex flex-col gap-1">
                            <span className="text-2xl font-black text-gray-100 leading-none tabular-nums">{summary.total}</span>
                            <span className="text-[10px] text-gray-500">סה״כ פוסטים</span>
                            <div className="flex items-end gap-0.5 mt-auto" style={{ height: '22px' }}>
                                {byDay.slice(-5).map((d, i) => {
                                    const h = Math.max(d.total > 0 ? Math.round((d.total / maxDay) * 18) : 2, 2);
                                    return <div key={i} className="flex-1 rounded-sm bg-blue-500/50" style={{ height: `${h}px`, alignSelf: 'flex-end' }} />;
                                })}
                            </div>
                        </div>

                        {/* Success */}
                        <div className="dark:bg-[#1c2128] bg-gray-50 rounded-xl p-2 flex flex-col items-center justify-center">
                            <Gauge pct={summary.successRate} color="#10b981" size={54} />
                            <span className="text-base font-black text-emerald-400 leading-none tabular-nums">{summary.success}</span>
                            <span className="text-[10px] text-gray-500 mt-0.5">הצלחות</span>
                        </div>

                        {/* Failed */}
                        <div className="dark:bg-[#1c2128] bg-gray-50 rounded-xl p-2 flex flex-col items-center justify-center">
                            <Gauge pct={failRate} color="#ef4444" size={54} />
                            <span className="text-base font-black text-red-400 leading-none tabular-nums">{summary.failed}</span>
                            <span className="text-[10px] text-gray-500 mt-0.5">כישלונות</span>
                        </div>

                        {/* Pending + Cancelled */}
                        <div className="dark:bg-[#1c2128] bg-gray-50 rounded-xl p-3 flex flex-col gap-2">
                            <div>
                                <span className="text-xl font-black text-amber-400 leading-none tabular-nums">{summary.pending ?? 0}</span>
                                <span className="text-[10px] text-gray-500 block">ממתינים</span>
                            </div>
                            <div className="w-full h-px bg-gray-800" />
                            <div>
                                <span className="text-xl font-black text-gray-500 leading-none tabular-nums">{summary.cancelled}</span>
                                <span className="text-[10px] text-gray-500 block">בוטלו</span>
                            </div>
                        </div>

                    </div>

                    {/* 7-day stacked bar chart */}
                    <div className="dark:bg-[#1c2128] bg-gray-50 rounded-xl p-3">
                        <div className="text-[10px] font-black text-gray-500 mb-1">דוח 7 ימים אחרונים</div>
                        <svg viewBox="0 0 210 80" style={{ width: '100%', height: 'auto', display: 'block' }}>
                            {[0, 0.5, 1].map(f => (
                                <line key={f} x1="20" y1={6 + (1 - f) * 54} x2="207" y2={6 + (1 - f) * 54}
                                    stroke="#1f2937" strokeWidth="0.5" strokeDasharray={f === 0 ? 'none' : '2,3'} />
                            ))}
                            {[0, Math.round(maxDay / 2), maxDay].map((v, i) => (
                                <text key={i} x="18" y={6 + (1 - v / maxDay) * 54} textAnchor="end"
                                    dominantBaseline="middle" fontSize="5" fill="#6b7280">{v}</text>
                            ))}
                            <line x1="20" y1="6" x2="20" y2="60" stroke="#374151" strokeWidth="0.5" />
                            {byDay.map((d, i) => {
                                const bw = 18, gap = 187 / byDay.length;
                                const bx = 20 + gap * i + (gap - bw) / 2;
                                const totalH = d.total > 0 ? Math.max((d.total / maxDay) * 54, 2) : 0;
                                const succH  = d.total > 0 ? (d.success / d.total) * totalH : 0;
                                const failH  = totalH - succH;
                                const base   = 60;
                                return (
                                    <g key={d.date}>
                                        {failH > 0 && <rect x={bx} y={base - totalH} width={bw} height={failH} fill="#ef444455" rx="1.5" />}
                                        {succH > 0 && <rect x={bx} y={base - succH}  width={bw} height={succH} fill="#10b981"   rx="1.5" />}
                                        {totalH > 0 && <rect x={bx} y={base - totalH} width={bw} height="3" rx="1.5"
                                            fill={succH >= totalH ? '#34d399' : '#f87171'} />}
                                        {d.total > 0 && <text x={bx + bw / 2} y={base - totalH - 3} textAnchor="middle" fontSize="4.5" fill="#9ca3af">{d.total}</text>}
                                        <text x={bx + bw / 2} y={base + 6} textAnchor="middle" fontSize="5" fill="#6b7280">{dayLabel(d.date)}</text>
                                    </g>
                                );
                            })}
                        </svg>
                    </div>
                </div>

                {/* ROW 2: Donut breakdown + Top groups + Errors */}
                <div className="grid grid-cols-3 gap-3">

                    {/* Donut */}
                    <div className="dark:bg-[#1c2128] bg-gray-50 rounded-xl p-3">
                        <div className="text-[10px] font-black text-gray-500 mb-2">פילוח תוצאות</div>
                        <DonutChart />
                    </div>

                    {/* Top 5 groups */}
                    <div className="dark:bg-[#1c2128] bg-gray-50 rounded-xl p-3">
                        <div className="text-[10px] font-black text-gray-500 mb-2">🏆 Top קבוצות</div>
                        <ol className="space-y-1.5 list-none">
                            {topGroups.slice(0, 5).map((g, i) => {
                                const pct = g.total > 0 ? Math.round((g.success / g.total) * 100) : 0;
                                return (
                                    <li key={i} className="flex items-center gap-2 min-w-0">
                                        <span className="w-4 h-4 rounded-full bg-emerald-500/20 text-emerald-400 text-[8px] font-black flex items-center justify-center shrink-0">{i + 1}</span>
                                        {g.url
                                            ? <a href={g.url} target="_blank" rel="noreferrer" dir="rtl"
                                                className="text-[10px] text-gray-300 hover:text-emerald-300 hover:underline truncate flex-1 transition-colors">{g.name}</a>
                                            : <span className="text-[10px] text-gray-400 truncate flex-1" dir="rtl">{g.name}</span>
                                        }
                                        <span className="text-[9px] font-black bg-emerald-500/20 text-emerald-400 rounded px-1.5 py-0.5 shrink-0 tabular-nums">{pct}%</span>
                                    </li>
                                );
                            })}
                        </ol>
                    </div>

                    {/* Top errors */}
                    <div className="dark:bg-[#1c2128] bg-gray-50 rounded-xl p-3">
                        <div className="text-[10px] font-black text-gray-500 mb-2">🔴 שגיאות נפוצות</div>
                        {topErrors.length === 0
                            ? <div className="flex items-center gap-1.5 mt-2"><span>✅</span><span className="text-[10px] text-emerald-400 font-semibold">אין שגיאות</span></div>
                            : <ol className="space-y-1.5 list-none">
                                {topErrors.slice(0, 5).map(({ message, count }, i) => (
                                    <li key={i} className="flex items-start gap-1.5 min-w-0">
                                        <span className="text-[9px] font-black bg-red-500/20 text-red-400 rounded px-1 py-0.5 shrink-0 tabular-nums">{count}×</span>
                                        <span className="text-[10px] text-gray-400 leading-tight min-w-0 line-clamp-2">
                                            {message}
                                        </span>
                                    </li>
                                ))}
                            </ol>
                        }
                    </div>

                </div>

                {/* ROW 3: Active groups by volume */}
                <div className="dark:bg-[#1c2128] bg-gray-50 rounded-xl p-3">
                    <div className="text-[10px] font-black text-gray-500 mb-2">📊 פעילות קבוצות לפי נפח</div>
                    {activeGroups.length === 0
                        ? <span className="text-xs text-gray-600">אין נתונים</span>
                        : (() => {
                            const maxVol = activeGroups[0]?.total || 1;
                            return (
                                <div className="grid grid-cols-2 gap-x-6 gap-y-1">
                                    {activeGroups.map((g, i) => {
                                        const barPct = Math.round((g.total / maxVol) * 100);
                                        const sPct   = g.total > 0 ? Math.round((g.success / g.total) * 100) : 0;
                                        const sC     = sPct >= 75 ? 'text-emerald-400' : sPct >= 50 ? 'text-amber-400' : 'text-red-400';
                                        return (
                                            <div key={i} className="flex items-center gap-1.5 min-w-0">
                                                <span className="text-[9px] text-gray-600 w-3 shrink-0 tabular-nums">{i + 1}.</span>
                                                <span className="text-[10px] font-black text-blue-400 tabular-nums shrink-0 w-5 text-right">{g.total}</span>
                                                {g.url
                                                    ? <a href={g.url} target="_blank" rel="noreferrer"
                                                        className="text-[10px] text-gray-300 hover:text-blue-300 hover:underline truncate flex-1 transition-colors"
                                                        dir="rtl" title={g.name}>{g.name}</a>
                                                    : <span className="text-[10px] text-gray-400 truncate flex-1" dir="rtl" title={g.name}>{g.name}</span>
                                                }
                                                <div className="w-10 h-1 bg-gray-800 rounded-full overflow-hidden shrink-0">
                                                    <div className="h-full bg-blue-500 rounded-full" style={{ width: `${barPct}%` }} />
                                                </div>
                                                <span className={`text-[10px] font-bold tabular-nums shrink-0 w-7 text-right ${sC}`}>{sPct}%</span>
                                            </div>
                                        );
                                    })}
                                </div>
                            );
                        })()
                    }
                </div>

            </div>
        </div>
    );
}

export default AnalyticsPanel;
