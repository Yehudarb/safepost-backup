import { useMemo, useState } from "react";
import {
  X,
  Download,
  CheckCircle2,
  XCircle,
  Clock,
  Users,
  Sparkles,
  BarChart3,
  Activity,
  Info,
} from "lucide-react";

const L = {
  title: "\u05e0\u05d9\u05ea\u05d5\u05d7 \u05d0\u05e0\u05dc\u05d9\u05d8\u05d9",
  subtitle: "\u05ea\u05de\u05d5\u05e0\u05ea \u05de\u05e6\u05d1 \u05de\u05d4\u05d9\u05e8\u05d4 \u05d5\u05e7\u05d5\u05de\u05e4\u05e7\u05d8\u05d9\u05ea",
  periodPosts: "\u05e4\u05d5\u05e1\u05d8\u05d9\u05dd \u05d1\u05d8\u05d5\u05d5\u05d7 \u05d4\u05e0\u05d1\u05d7\u05e8",
  success: "\u05d4\u05e6\u05dc\u05d7\u05d4",
  failed: "\u05e0\u05db\u05e9\u05dc",
  pending: "\u05d1\u05d4\u05de\u05ea\u05e0\u05d4",
  successRate: "\u05e9\u05d9\u05e2\u05d5\u05e8 \u05d4\u05e6\u05dc\u05d7\u05d4",
  activity: "\u05e4\u05e2\u05d9\u05dc\u05d5\u05ea",
  compactRange: "\u05de\u05d1\u05d8 \u05d9\u05d5\u05de\u05d9 \u05de\u05e7\u05d5\u05e6\u05e8",
  noActivity: "\u05d0\u05d9\u05df \u05e2\u05d3\u05d9\u05d9\u05df \u05e0\u05ea\u05d5\u05e0\u05d9 \u05e4\u05e2\u05d9\u05dc\u05d5\u05ea \u05dc\u05d8\u05d5\u05d5\u05d7 \u05d4\u05e0\u05d1\u05d7\u05e8.",
  groupsStats: "\u05e1\u05d8\u05d8\u05d9\u05e1\u05d8\u05d9\u05e7\u05d5\u05ea \u05e7\u05d1\u05d5\u05e6\u05d5\u05ea",
  groupsSubtitle: "\u05de\u05d9\u05d5\u05df \u05dc\u05e4\u05d9 \u05d4\u05e7\u05d1\u05d5\u05e6\u05d5\u05ea \u05d4\u05e4\u05e2\u05d9\u05dc\u05d5\u05ea \u05d1\u05d9\u05d5\u05ea\u05e8",
  all: "\u05d4\u05db\u05dc",
  noGroups: "\u05d0\u05d9\u05df \u05e2\u05d3\u05d9\u05d9\u05df \u05e0\u05ea\u05d5\u05e0\u05d9 \u05e7\u05d1\u05d5\u05e6\u05d5\u05ea",
  noGroupsSub: "\u05db\u05e9\u05d9\u05d4\u05d9\u05d5 \u05e4\u05d5\u05e1\u05d8\u05d9\u05dd \u05d1\u05d8\u05d5\u05d5\u05d7 \u05d4\u05e0\u05d1\u05d7\u05e8, \u05d4\u05d4\u05ea\u05e4\u05dc\u05d2\u05d5\u05ea \u05dc\u05e4\u05d9 \u05e7\u05d1\u05d5\u05e6\u05d4 \u05ea\u05d5\u05e6\u05d2 \u05db\u05d0\u05df.",
  itemsTotal: "\u05d0\u05d9\u05e8\u05d5\u05e2\u05d9\u05dd \u05d1\u05e1\u05da \u05d4\u05db\u05dc",
  total: "\u05e1\u05da \u05d4\u05db\u05dc",
  topGroup: "\u05d4\u05e7\u05d1\u05d5\u05e6\u05d4 \u05d4\u05e2\u05de\u05d5\u05e1\u05d4 \u05d1\u05d9\u05d5\u05ea\u05e8",
  posts: "\u05e4\u05d5\u05e1\u05d8\u05d9\u05dd",
  share: "\u05d7\u05dc\u05e7",
};

const T = {
  bg: "#f5f7fb",
  surface: "#ffffff",
  surfaceElev: "#f9fafc",
  border: "#e8ebf1",
  text: "#1a2032",
  sub: "#5b6577",
  muted: "#9ba5b6",
  accent: "#6366f1",
  accentGlow: "rgba(99,102,241,.2)",
  accentSoft: "#eef1fe",
  cyan: "#06b6d4",
  ok: "#10b981",
  okSoft: "#e8faf1",
  warn: "#f59e0b",
  warnSoft: "#fef7e0",
  err: "#ef4444",
  errSoft: "#fdecec",
};

function getTaskDate(task) {
  const raw = task?.created_at || task?.scheduled_time || task?.sent_at;
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

function toDayKey(date) {
  return date.toISOString().slice(0, 10);
}

function filterQueueByRange(queue, range) {
  if (!Array.isArray(queue) || queue.length === 0 || range === "all") return queue || [];

  const days = range === "30d" ? 30 : 7;
  const from = new Date();
  from.setHours(0, 0, 0, 0);
  from.setDate(from.getDate() - (days - 1));

  return queue.filter((task) => {
    const date = getTaskDate(task);
    return date && date >= from;
  });
}

function buildDailySeries(queue, range) {
  const span = range === "30d" ? 30 : 7;
  const days = [];
  const dayMap = new Map();
  const start = new Date();
  start.setHours(0, 0, 0, 0);

  for (let i = span - 1; i >= 0; i -= 1) {
    const d = new Date(start);
    d.setDate(start.getDate() - i);
    const key = toDayKey(d);
    const item = {
      key,
      label: d.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      success: 0,
      failed: 0,
      pending: 0,
    };
    days.push(item);
    dayMap.set(key, item);
  }

  (queue || []).forEach((task) => {
    const date = getTaskDate(task);
    if (!date) return;
    const key = toDayKey(date);
    const bucket = dayMap.get(key);
    if (!bucket) return;

    if (task.status === "SUCCESS") bucket.success += 1;
    else if (task.status === "FAILED" || task.status === "CANCELLED") bucket.failed += 1;
    else if (["PENDING", "SENT", "PROCESSING"].includes(task.status)) bucket.pending += 1;
  });

  return range === "30d"
    ? days.filter((_, idx) => idx % 4 === 0 || idx === days.length - 1)
    : days;
}

function buildGroupStats(queue) {
  const stats = new Map();

  (queue || []).forEach((task) => {
    const key = task.group_id || task.group_name || "unknown";
    if (!stats.has(key)) {
      stats.set(key, {
        id: key,
        name: task.group_name || task.group_id || "Unknown group",
        success: 0,
        failed: 0,
        pending: 0,
      });
    }

    const bucket = stats.get(key);
    if (task.status === "SUCCESS") bucket.success += 1;
    else if (task.status === "FAILED" || task.status === "CANCELLED") bucket.failed += 1;
    else if (["PENDING", "SENT", "PROCESSING"].includes(task.status)) bucket.pending += 1;
  });

  return Array.from(stats.values()).sort((a, b) => {
    const totalA = a.success + a.failed + a.pending;
    const totalB = b.success + b.failed + b.pending;
    return totalB - totalA;
  });
}

function StatPill({ icon, color, label, value }) {
  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      gap: 6,
      padding: "4px 8px",
      borderRadius: 999,
      background: `${color}14`,
      color,
      whiteSpace: "nowrap",
    }}>
      {icon}
      <span style={{ fontSize: 11, color: T.sub }}>{label}</span>
      <strong dir="ltr" style={{ fontSize: 11, fontFamily: "'JetBrains Mono', monospace" }}>{value}</strong>
    </div>
  );
}

function MetricTile({ label, value, tone = "neutral" }) {
  const toneMap = {
    neutral: { bg: T.surfaceElev, color: T.text },
    ok: { bg: T.okSoft, color: T.ok },
    warn: { bg: T.warnSoft, color: T.warn },
    err: { bg: T.errSoft, color: T.err },
  };
  const toneStyle = toneMap[tone] || toneMap.neutral;

  return (
    <div style={{
      padding: "8px 10px",
      borderRadius: 10,
      background: toneStyle.bg,
      display: "grid",
      gap: 2,
      minWidth: 0,
    }}>
      <span style={{ fontSize: 10, color: T.sub, fontWeight: 600 }}>{label}</span>
      <strong dir="ltr" style={{
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 16,
        lineHeight: 1.1,
        color: toneStyle.color,
      }}>
        {value}
      </strong>
    </div>
  );
}

function SummaryCard({ total, success, failed, pending, rate, topGroup }) {
  const ring = Math.max(0, Math.min(100, rate));
  const circumference = 2 * Math.PI * 28;
  const dash = circumference * (ring / 100);

  return (
    <div style={{
      background: T.surface,
      border: `1px solid ${T.border}`,
      borderRadius: 14,
      padding: 12,
      display: "grid",
      gap: 12,
    }}>
      <div style={{
        display: "grid",
        gridTemplateColumns: "84px minmax(0, 1fr)",
        gap: 12,
        alignItems: "center",
      }}>
        <div style={{ position: "relative", width: 72, height: 72, marginInline: "auto" }}>
          <svg width="72" height="72" style={{ transform: "rotate(-90deg)" }}>
            <circle cx="36" cy="36" r="28" fill="none" stroke={T.border} strokeWidth="6" />
            <circle
              cx="36"
              cy="36"
              r="28"
              fill="none"
              stroke={rate > 0 ? T.ok : T.muted}
              strokeWidth="6"
              strokeLinecap="round"
              strokeDasharray={`${dash} ${circumference}`}
            />
          </svg>
          <div style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
          }}>
            <div dir="ltr" style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 16,
              fontWeight: 700,
              color: T.text,
              lineHeight: 1,
            }}>
              {ring}%
            </div>
            <div style={{ fontSize: 7, fontWeight: 700, letterSpacing: "0.08em", color: T.muted, marginTop: 2 }}>
              {L.successRate}
            </div>
          </div>
        </div>

        <div style={{ minWidth: 0, display: "grid", gap: 8 }}>
          <div>
            <div style={{ fontSize: 11, color: T.sub, fontWeight: 600 }}>{L.periodPosts}</div>
            <div dir="ltr" style={{
              fontSize: 28,
              lineHeight: 1,
              fontWeight: 700,
              color: T.text,
              fontFamily: "'JetBrains Mono', monospace",
              letterSpacing: "-0.03em",
              marginTop: 4,
            }}>
              {total}
            </div>
          </div>

          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
            gap: 8,
          }}>
            <MetricTile label={L.success} value={success} tone="ok" />
            <MetricTile label={L.failed} value={failed} tone="err" />
            <MetricTile label={L.pending} value={pending} tone="warn" />
            <MetricTile label={L.total} value={total} />
          </div>
        </div>
      </div>

      {topGroup ? (
        <div style={{
          borderTop: `1px solid ${T.border}`,
          paddingTop: 10,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          flexWrap: "wrap",
        }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 10, color: T.muted, fontWeight: 600 }}>{L.topGroup}</div>
            <div style={{
              fontSize: 12,
              color: T.text,
              fontWeight: 700,
              marginTop: 2,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              maxWidth: 240,
            }}>
              {topGroup.name}
            </div>
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            <StatPill icon={<Activity size={11} />} color={T.accent} label={L.posts} value={topGroup.total} />
            <StatPill icon={<Users size={11} />} color={T.cyan} label={L.share} value={`${topGroup.share}%`} />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ActivityCard({ data }) {
  const hasData = data.some((d) => d.success + d.failed + d.pending > 0);
  const maxVal = Math.max(1, ...data.map((d) => d.success + d.failed + d.pending));

  return (
    <div style={{
      background: T.surface,
      border: `1px solid ${T.border}`,
      borderRadius: 14,
      padding: 12,
      display: "grid",
      gap: 10,
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <div>
          <div style={{ fontSize: 11, color: T.text, fontWeight: 700 }}>{L.activity}</div>
          <div style={{ fontSize: 9, color: T.muted, marginTop: 2 }}>{L.compactRange}</div>
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
          <span style={{ fontSize: 9, color: T.sub, display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ width: 6, height: 6, borderRadius: 2, background: T.ok }} />
            {L.success}
          </span>
          <span style={{ fontSize: 9, color: T.sub, display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ width: 6, height: 6, borderRadius: 2, background: T.warn }} />
            {L.pending}
          </span>
          <span style={{ fontSize: 9, color: T.sub, display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ width: 6, height: 6, borderRadius: 2, background: T.err }} />
            {L.failed}
          </span>
        </div>
      </div>

      {!hasData ? (
        <div style={{
          background: T.accentSoft,
          border: `1px solid ${T.border}`,
          borderRadius: 10,
          padding: "10px 12px",
          display: "flex",
          alignItems: "center",
          gap: 8,
          fontSize: 10.5,
          color: T.sub,
        }}>
          <Info size={13} color={T.accent} />
          {L.noActivity}
        </div>
      ) : (
        <div style={{ height: 104, position: "relative", paddingBottom: 18 }}>
          <div style={{
            position: "absolute",
            inset: "0 0 18px 0",
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            pointerEvents: "none",
          }}>
            {[0, 1, 2, 3].map((idx) => (
              <div key={idx} style={{ borderTop: `1px dashed ${T.border}`, height: 0 }} />
            ))}
          </div>

          <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: "100%", position: "relative", zIndex: 1 }}>
            {data.map((day) => {
              const total = day.success + day.failed + day.pending;
              const barHeight = total > 0 ? Math.max(6, Math.round((total / maxVal) * 68)) : 6;
              return (
                <div key={day.key} style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end" }}>
                  <div dir="ltr" style={{
                    fontSize: 8,
                    color: T.text,
                    fontWeight: 700,
                    fontFamily: "'JetBrains Mono', monospace",
                    marginBottom: 4,
                    minHeight: 10,
                  }}>
                    {total > 0 ? total : ""}
                  </div>
                  <div style={{
                    width: "100%",
                    maxWidth: 24,
                    height: barHeight,
                    borderRadius: "5px 5px 2px 2px",
                    overflow: "hidden",
                    border: total > 0 ? "none" : `1px dashed ${T.border}`,
                    background: total === 0 ? T.surfaceElev : "transparent",
                    display: "flex",
                    flexDirection: "column-reverse",
                  }}>
                    {day.success > 0 && <div style={{ height: `${(day.success / total) * 100}%`, background: T.ok }} />}
                    {day.pending > 0 && <div style={{ height: `${(day.pending / total) * 100}%`, background: T.warn }} />}
                    {day.failed > 0 && <div style={{ height: `${(day.failed / total) * 100}%`, background: T.err }} />}
                  </div>
                  <div style={{ fontSize: 8, color: T.muted, marginTop: 5, lineHeight: 1.1, textAlign: "center" }}>
                    {day.label}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function MiniStat({ color, value, icon }) {
  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      gap: 3,
      padding: "2px 5px",
      borderRadius: 999,
      background: `${color}16`,
      color,
    }}>
      {icon}
      <span dir="ltr" style={{ fontSize: 8, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace" }}>{value}</span>
    </div>
  );
}

function GroupList({ filter, groups }) {
  const filtered = groups.filter((g) => {
    if (filter === "all") return true;
    if (filter === "success") return g.success > 0;
    if (filter === "failed") return g.failed > 0;
    if (filter === "pending") return g.pending > 0;
    return true;
  });

  if (filtered.length === 0) {
    return (
      <div style={{
        padding: "24px 16px",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        textAlign: "center",
      }}>
        <div style={{
          width: 42,
          height: 42,
          borderRadius: "50%",
          background: T.accentSoft,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}>
          <Sparkles size={18} color={T.accent} />
        </div>
        <div style={{ fontSize: 12.5, fontWeight: 700, color: T.text }}>{L.noGroups}</div>
        <div style={{ fontSize: 10.5, color: T.muted, maxWidth: 280, lineHeight: 1.5 }}>
          {L.noGroupsSub}
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      {filtered.map((group, index) => {
        const total = group.success + group.failed + group.pending;
        const successRate = total > 0 ? Math.round((group.success / total) * 100) : 0;
        return (
          <div
            key={`${group.id || group.name || index}`}
            style={{
              padding: "8px 10px",
              borderBottom: index < filtered.length - 1 ? `1px solid ${T.border}` : "none",
              display: "grid",
              gridTemplateColumns: "minmax(0, 1fr) auto",
              gap: 8,
              alignItems: "center",
            }}
          >
            <div style={{ minWidth: 0 }}>
              <div style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 8,
                minWidth: 0,
              }}>
                <div style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: T.text,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}>
                  {group.name}
                </div>
                <div dir="ltr" style={{
                  fontSize: 9,
                  color: T.muted,
                  fontFamily: "'JetBrains Mono', monospace",
                  whiteSpace: "nowrap",
                }}>
                  {total} / {successRate}%
                </div>
              </div>

              <div style={{
                marginTop: 4,
                height: 4,
                background: T.border,
                borderRadius: 999,
                overflow: "hidden",
                display: "flex",
              }}>
                {total === 0 ? (
                  <div style={{ width: "100%", background: T.surfaceElev }} />
                ) : (
                  <>
                    {group.success > 0 && <div style={{ width: `${(group.success / total) * 100}%`, background: T.ok }} />}
                    {group.pending > 0 && <div style={{ width: `${(group.pending / total) * 100}%`, background: T.warn }} />}
                    {group.failed > 0 && <div style={{ width: `${(group.failed / total) * 100}%`, background: T.err }} />}
                  </>
                )}
              </div>
            </div>

            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              {group.success > 0 && <MiniStat color={T.ok} value={group.success} icon={<CheckCircle2 size={9} />} />}
              {group.failed > 0 && <MiniStat color={T.err} value={group.failed} icon={<XCircle size={9} />} />}
              {group.pending > 0 && <MiniStat color={T.warn} value={group.pending} icon={<Clock size={9} />} />}
              {total === 0 && <span style={{ fontSize: 9, color: T.muted }}>0</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function iconBtn() {
  return {
    width: 30,
    height: 30,
    borderRadius: 8,
    border: `1px solid ${T.border}`,
    background: T.surface,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
    color: T.sub,
    transition: "all 0.2s",
    flex: "0 0 auto",
  };
}

export default function StitchDashboard({ queue = [], groups = [], onClose = null }) {
  const [filter, setFilter] = useState("all");
  const [range, setRange] = useState("7d");

  const filteredQueue = useMemo(() => filterQueueByRange(queue, range), [queue, range]);
  const groupList = useMemo(() => buildGroupStats(filteredQueue), [filteredQueue]);
  const dailySeries = useMemo(() => buildDailySeries(filteredQueue, range), [filteredQueue, range]);

  const total = groupList.reduce((sum, g) => sum + g.success + g.failed + g.pending, 0);
  const success = groupList.reduce((sum, g) => sum + g.success, 0);
  const failed = groupList.reduce((sum, g) => sum + g.failed, 0);
  const pending = groupList.reduce((sum, g) => sum + g.pending, 0);
  const rate = total > 0 ? Math.round((success / total) * 100) : 0;
  const topGroup = groupList[0]
    ? {
        ...groupList[0],
        total: groupList[0].success + groupList[0].failed + groupList[0].pending,
        share: total > 0 ? Math.round(((groupList[0].success + groupList[0].failed + groupList[0].pending) / total) * 100) : 0,
      }
    : null;

  const tabs = [
    { key: "all", label: L.all, count: groupList.length },
    { key: "success", label: L.success, count: groupList.filter((g) => g.success > 0).length },
    { key: "failed", label: L.failed, count: groupList.filter((g) => g.failed > 0).length },
    { key: "pending", label: L.pending, count: groupList.filter((g) => g.pending > 0).length },
  ];

  return (
    <div dir="rtl" style={{
      fontFamily: "'Space Grotesk', system-ui, sans-serif",
      background: T.bg,
      minHeight: "100%",
      color: T.text,
      padding: 10,
    }}>
      <div style={{
        width: "100%",
        margin: "0 auto",
        maxWidth: 960,
        maxHeight: "min(760px, calc(100vh - 20px))",
        background: T.surface,
        borderRadius: 16,
        overflow: "hidden",
        border: `1px solid ${T.border}`,
        boxShadow: "0 8px 40px rgba(15,23,42,.08)",
        display: "flex",
        flexDirection: "column",
      }}>
        <header style={{
          padding: "8px 12px",
          borderBottom: `1px solid ${T.border}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
            <div style={{
              width: 34,
              height: 34,
              borderRadius: 10,
              background: `linear-gradient(135deg, ${T.accent}, ${T.cyan})`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: `0 4px 16px ${T.accentGlow}`,
              flex: "0 0 auto",
            }}>
              <BarChart3 size={18} color="#fff" />
            </div>

            <div style={{ minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                <span style={{
                  fontSize: 13,
                  fontWeight: 700,
                  color: T.text,
                  letterSpacing: "-0.01em",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}>
                  {L.title}
                </span>
              </div>
              <div style={{ fontSize: 9, color: T.muted, marginTop: 2 }}>{L.subtitle}</div>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
            <div style={{
              display: "flex",
              background: T.surfaceElev,
              borderRadius: 6,
              padding: 1,
              border: `1px solid ${T.border}`,
            }}>
              {[
                { key: "all", label: "All" },
                { key: "30d", label: "30d" },
                { key: "7d", label: "7d" },
              ].map((item) => (
                <button
                  key={item.key}
                  onClick={() => setRange(item.key)}
                  style={{
                    fontSize: 8,
                    fontWeight: 600,
                    padding: "3px 7px",
                    borderRadius: 4,
                    border: "none",
                    cursor: "pointer",
                    background: range === item.key ? T.surface : "transparent",
                    color: range === item.key ? T.text : T.muted,
                    boxShadow: range === item.key ? "0 1px 2px rgba(0,0,0,.04)" : "none",
                    fontFamily: "'Space Grotesk', sans-serif",
                  }}
                >
                  {item.label}
                </button>
              ))}
            </div>

            <button style={iconBtn()} title="Download">
              <Download size={12} />
            </button>
            <button onClick={onClose} style={iconBtn()} title="Close">
              <X size={12} />
            </button>
          </div>
        </header>

        <div style={{
          padding: 10,
          display: "flex",
          flexDirection: "column",
          gap: 8,
          overflowY: "auto",
          minHeight: 0,
        }}>
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
            gap: 8,
            alignItems: "start",
          }}>
            <SummaryCard total={total} success={success} failed={failed} pending={pending} rate={rate} topGroup={topGroup} />
            <ActivityCard data={dailySeries} />
          </div>

          <div style={{
            background: T.surface,
            border: `1px solid ${T.border}`,
            borderRadius: 14,
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
            minHeight: 0,
          }}>
            <div style={{
              padding: "8px 12px",
              borderBottom: `1px solid ${T.border}`,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 8,
              flexWrap: "wrap",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <Users size={12} color={T.accent} />
                <div style={{ display: "grid", gap: 1 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: T.text }}>{L.groupsStats}</span>
                  <span style={{ fontSize: 9, color: T.muted }}>{L.groupsSubtitle}</span>
                </div>
              </div>

              <div style={{ display: "flex", gap: 3, flexWrap: "wrap", justifyContent: "flex-end" }}>
                {tabs.map((tab) => (
                  <button
                    key={tab.key}
                    onClick={() => setFilter(tab.key)}
                    style={{
                      fontSize: 8,
                      fontWeight: 600,
                      padding: "3px 7px",
                      borderRadius: 4,
                      cursor: "pointer",
                      border: `1px solid ${filter === tab.key ? T.accent : T.border}`,
                      background: filter === tab.key ? T.accentSoft : T.surface,
                      color: filter === tab.key ? T.accent : T.sub,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {tab.label} {tab.count}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ maxHeight: 180, overflowY: "auto" }}>
              <GroupList filter={filter} groups={groupList} />
            </div>
          </div>
        </div>

        <div style={{
          padding: "5px 12px",
          borderTop: `1px solid ${T.border}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          fontSize: 8,
          color: T.muted,
          background: T.surfaceElev,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <div style={{ width: 4, height: 4, borderRadius: "50%", background: T.ok }} />
            <span>Supabase</span>
          </div>
          <div dir="ltr" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
            {total} {L.itemsTotal}
          </div>
        </div>
      </div>
    </div>
  );
}
