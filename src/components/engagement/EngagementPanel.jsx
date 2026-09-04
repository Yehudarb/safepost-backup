// Engagement / Opportunities — Phase 1D.
//
// Read-only surface over the proven scanner. It can start ONE manual scan of
// ONE group and show what happened. It deliberately cannot: schedule, publish,
// comment, reply, react, or reach another workspace. There is no code path here
// that writes to Facebook.
//
// Mounted as a sibling of the publishing UI and only when the server says the
// feature exists for this workspace, so with the flag off the dashboard is
// behaviourally identical to before.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { EngagementAPI, EngagementUnavailableError } from '@/lib/engagementApi';

const STATE_STYLE = {
    COMPLETED: 'rounded-full bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/30 text-emerald-700 dark:text-emerald-400 font-bold',
    RUNNING:   'rounded-full bg-blue-50 dark:bg-blue-500/10 border-blue-200 dark:border-blue-500/30 text-blue-600 dark:text-blue-400 font-bold status-pulse',
    QUEUED:    'rounded-full bg-amber-50 dark:bg-amber-500/10 border-amber-200 dark:border-amber-500/30 text-amber-600 dark:text-amber-400 font-bold',
    BLOCKED:   'rounded-full bg-orange-50 dark:bg-orange-500/10 border-orange-200 dark:border-orange-500/30 text-orange-700 dark:text-orange-400 font-bold',
    FAILED:    'rounded-full bg-rose-50 dark:bg-rose-500/10 border-rose-200 dark:border-rose-500/30 text-rose-600 dark:text-rose-400 font-bold',
    NONE:      'rounded-full bg-gray-100 dark:bg-gray-500/10 border-gray-200 dark:border-gray-500/30 text-gray-500 dark:text-gray-400 font-bold',
};

const STATE_LABEL = {
    COMPLETED: 'Completed',
    RUNNING: 'Running',
    QUEUED: 'Queued',
    BLOCKED: 'Blocked — identity unverified',
    FAILED: 'Failed',
    NONE: 'No scans yet',
};

function StateBadge({ state }) {
    const key = STATE_LABEL[state] ? state : 'NONE';
    return (
        <span
            data-testid="engagement-state-badge"
            data-state={key}
            className={`inline-flex items-center px-3 py-1 text-xs border ${STATE_STYLE[key]}`}
        >
            {STATE_LABEL[key]}
        </span>
    );
}

function formatTime(value) {
    if (!value) return '—';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString();
}

export default function EngagementPanel({ groups = [] }) {
    const [available, setAvailable] = useState(null); // null = still deciding
    const [status, setStatus] = useState(null);
    const [scans, setScans] = useState([]);
    const [groupId, setGroupId] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);
    const [notice, setNotice] = useState(null);

    const enabled = Boolean(status?.enabled);

    const refresh = useCallback(async () => {
        try {
            const next = await EngagementAPI.getStatus();
            setStatus(next);
            setAvailable(true);
            if (next.enabled) {
                const listed = await EngagementAPI.listScans();
                setScans(listed.summaries || []);
            } else {
                setScans([]);
            }
            setError(null);
        } catch (err) {
            if (err instanceof EngagementUnavailableError) {
                setAvailable(false);
                setStatus(null);
                setScans([]);
                return;
            }
            setError(err.message || 'Could not load Engagement.');
        }
    }, []);

    useEffect(() => { refresh(); }, [refresh]);

    // Poll only while something is actually in flight.
    useEffect(() => {
        if (!enabled) return undefined;
        const inFlight = status?.active_scan;
        if (!inFlight) return undefined;
        const timer = setInterval(refresh, 5000);
        return () => clearInterval(timer);
    }, [enabled, status?.active_scan, refresh]);

    const sortedGroups = useMemo(
        () => [...groups].sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''))),
        [groups],
    );

    const startScan = async () => {
        // Belt and braces: the button is already hidden when the feature is off,
        // and the server 404s regardless, but nothing here should ever attempt a
        // scan for a workspace that has Engagement switched off.
        if (!enabled || !groupId || busy) return;
        setBusy(true);
        setError(null);
        setNotice(null);
        try {
            const group = sortedGroups.find(item => String(item.id) === String(groupId));
            await EngagementAPI.startScan({
                name: `Manual scan — ${group?.name || groupId}`,
                groupId,
                maxPosts: 10,
            });
            setNotice('Scan queued. The browser extension will pick it up shortly.');
            await refresh();
        } catch (err) {
            setError(err instanceof EngagementUnavailableError
                ? 'Engagement is not enabled for this workspace.'
                : (err.message || 'Could not start the scan.'));
        } finally {
            setBusy(false);
        }
    };

    if (available === null || available === false) return null;

    const latest = status?.latest_scan || null;

    return (
        <section
            data-testid="engagement-panel"
            className="rounded-2xl border border-gray-200 dark:border-white/10 bg-white dark:bg-white/5 p-5 space-y-4"
            aria-labelledby="engagement-heading"
        >
            <header className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h2 id="engagement-heading" className="text-lg font-bold text-gray-900 dark:text-white">
                        Engagement — Opportunities
                    </h2>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                        Reads posts from one group you have selected. It never posts, comments or reacts.
                    </p>
                </div>
                <span
                    data-testid="engagement-enabled-state"
                    data-enabled={enabled ? 'true' : 'false'}
                    className={`inline-flex items-center px-3 py-1 text-xs border ${
                        enabled
                            ? 'rounded-full bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/30 text-emerald-700 dark:text-emerald-400 font-bold'
                            : 'rounded-full bg-gray-100 dark:bg-gray-500/10 border-gray-200 dark:border-gray-500/30 text-gray-500 dark:text-gray-400 font-bold'
                    }`}
                >
                    {enabled ? 'Enabled for this workspace' : 'Disabled for this workspace'}
                </span>
            </header>

            {!enabled && (
                <p data-testid="engagement-disabled-note" className="text-sm text-gray-500 dark:text-gray-400">
                    Engagement is switched off for this workspace. Scanning is unavailable.
                </p>
            )}

            {enabled && (
                <>
                    <div className="grid gap-3 sm:grid-cols-3">
                        <div className="rounded-xl border border-gray-200 dark:border-white/10 p-3">
                            <div className="text-xs text-gray-500 dark:text-gray-400">Latest scan</div>
                            <div className="mt-1"><StateBadge state={latest?.ui_state || 'NONE'} /></div>
                        </div>
                        <div className="rounded-xl border border-gray-200 dark:border-white/10 p-3">
                            <div className="text-xs text-gray-500 dark:text-gray-400">Last run</div>
                            <div data-testid="engagement-latest-time" className="mt-1 text-sm font-semibold text-gray-900 dark:text-white">
                                {formatTime(latest?.completed_at || latest?.started_at || latest?.created_at)}
                            </div>
                        </div>
                        <div className="rounded-xl border border-gray-200 dark:border-white/10 p-3">
                            <div className="text-xs text-gray-500 dark:text-gray-400">Discovered posts</div>
                            <div data-testid="engagement-discovered-count" className="mt-1 text-sm font-semibold text-gray-900 dark:text-white">
                                {status?.discovered_count ?? 0}
                            </div>
                        </div>
                    </div>

                    {latest?.reason_summary && (
                        <p
                            data-testid="engagement-reason"
                            className="text-sm rounded-xl border border-orange-200 dark:border-orange-500/30 bg-orange-50 dark:bg-orange-500/10 text-orange-800 dark:text-orange-300 p-3"
                        >
                            {latest.reason_summary}
                        </p>
                    )}

                    <div className="flex flex-wrap items-end gap-3">
                        <label className="flex-1 min-w-[12rem]">
                            <span className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Group to scan</span>
                            <select
                                data-testid="engagement-group-select"
                                value={groupId}
                                onChange={event => setGroupId(event.target.value)}
                                className="w-full rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-white/5 px-3 py-2 text-sm text-gray-900 dark:text-white"
                            >
                                <option value="">Select a group…</option>
                                {sortedGroups.map(group => (
                                    <option key={group.id} value={group.id}>{group.name || group.id}</option>
                                ))}
                            </select>
                        </label>
                        <button
                            type="button"
                            data-testid="engagement-scan-now"
                            onClick={startScan}
                            disabled={!groupId || busy || status?.active_scan}
                            className="rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed px-4 py-2 text-sm font-bold text-white"
                        >
                            {busy ? 'Starting…' : 'Scan now'}
                        </button>
                    </div>

                    {status?.active_scan && (
                        <p data-testid="engagement-active-note" className="text-xs text-gray-500 dark:text-gray-400">
                            A scan is already queued or running. Only one runs at a time.
                        </p>
                    )}

                    {scans.length > 0 && (
                        <div className="overflow-x-auto">
                            <table data-testid="engagement-scan-table" className="w-full text-sm">
                                <thead>
                                    <tr className="text-left text-xs text-gray-500 dark:text-gray-400">
                                        <th className="py-2 pr-3 font-medium">Scan</th>
                                        <th className="py-2 pr-3 font-medium">State</th>
                                        <th className="py-2 pr-3 font-medium">Posts</th>
                                        <th className="py-2 pr-3 font-medium">When</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {scans.slice(0, 10).map(scan => (
                                        <tr key={scan.id} data-testid="engagement-scan-row" className="border-t border-gray-100 dark:border-white/5">
                                            <td className="py-2 pr-3 text-gray-900 dark:text-white">{scan.group_name || scan.name}</td>
                                            <td className="py-2 pr-3"><StateBadge state={scan.ui_state} /></td>
                                            <td className="py-2 pr-3 text-gray-700 dark:text-gray-300">{scan.posts_discovered}</td>
                                            <td className="py-2 pr-3 text-gray-500 dark:text-gray-400">{formatTime(scan.created_at)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </>
            )}

            {notice && <p data-testid="engagement-notice" className="text-sm text-emerald-600 dark:text-emerald-400">{notice}</p>}
            {error && <p data-testid="engagement-error" className="text-sm text-rose-600 dark:text-rose-400">{error}</p>}
        </section>
    );
}
