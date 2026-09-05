// Engagement / Opportunities - Phase 1D.
//
// This is a read-only surface over the scanner. It may queue a controlled scan,
// but it has no path that writes to Facebook.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EngagementAPI, EngagementUnavailableError } from '@/lib/engagementApi';

const STATE_STYLE = {
    COMPLETED: 'rounded-full bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/30 text-emerald-700 dark:text-emerald-400 font-bold',
    RUNNING: 'rounded-full bg-blue-50 dark:bg-blue-500/10 border-blue-200 dark:border-blue-500/30 text-blue-600 dark:text-blue-400 font-bold status-pulse',
    QUEUED: 'rounded-full bg-amber-50 dark:bg-amber-500/10 border-amber-200 dark:border-amber-500/30 text-amber-700 dark:text-amber-400 font-bold',
    BLOCKED: 'rounded-full bg-orange-50 dark:bg-orange-500/10 border-orange-200 dark:border-orange-500/30 text-orange-700 dark:text-orange-400 font-bold',
    ABORTED: 'rounded-full bg-orange-50 dark:bg-orange-500/10 border-orange-200 dark:border-orange-500/30 text-orange-700 dark:text-orange-400 font-bold',
    CANCELLED: 'rounded-full bg-gray-100 dark:bg-gray-500/10 border-gray-200 dark:border-gray-500/30 text-gray-600 dark:text-gray-400 font-bold',
    FAILED: 'rounded-full bg-rose-50 dark:bg-rose-500/10 border-rose-200 dark:border-rose-500/30 text-rose-700 dark:text-rose-400 font-bold',
    NONE: 'rounded-full bg-gray-100 dark:bg-gray-500/10 border-gray-200 dark:border-gray-500/30 text-gray-500 dark:text-gray-400 font-bold',
};

const STATE_LABEL = {
    COMPLETED: 'Completed',
    RUNNING: 'Running',
    QUEUED: 'Queued',
    BLOCKED: 'Blocked - identity needs attention',
    ABORTED: 'Aborted',
    CANCELLED: 'Cancelled',
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
    if (!value) return '-';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '-' : date.toLocaleString();
}

function safeFacebookUrl(value) {
    if (typeof value !== 'string' || !value.trim()) return null;
    try {
        const url = new URL(value);
        const hostname = url.hostname.toLowerCase();
        if (url.protocol !== 'https:') return null;
        if (hostname !== 'facebook.com' && !hostname.endsWith('.facebook.com')) return null;
        return url.href;
    } catch {
        return null;
    }
}

function dedupeGroups(groups, workspaceId) {
    const byId = new Map();
    for (const group of Array.isArray(groups) ? groups : []) {
        if (!group || group.id === undefined || group.id === null) continue;
        if (workspaceId && group.workspace_id && group.workspace_id !== workspaceId) continue;
        const id = String(group.id);
        const previous = byId.get(id);
        if (!previous || (!previous.name && group.name)) byId.set(id, group);
    }
    return [...byId.values()].sort((a, b) =>
        String(a.name || '').localeCompare(String(b.name || '')));
}

export default function EngagementPanel({ groups = [], workspaceId = null }) {
    const [available, setAvailable] = useState(null);
    const [status, setStatus] = useState(null);
    const [statusWorkspaceId, setStatusWorkspaceId] = useState(null);
    const [scans, setScans] = useState([]);
    const [posts, setPosts] = useState([]);
    const [groupId, setGroupId] = useState('');
    const [instructions, setInstructions] = useState('');
    const [maxPosts, setMaxPosts] = useState('10');
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [cancelingScanId, setCancelingScanId] = useState(null);
    const [error, setError] = useState(null);
    const [notice, setNotice] = useState(null);
    const refreshVersion = useRef(0);
    const busyRef = useRef(false);
    const cancelingScanRef = useRef(null);
    const pollingRequestRef = useRef(null);
    const workspaceGenerationRef = useRef(0);

    const currentStatus = statusWorkspaceId === workspaceId ? status : null;
    const enabled = Boolean(currentStatus?.enabled);

    const refresh = useCallback(async ({ showLoading = false } = {}) => {
        const version = ++refreshVersion.current;
        if (showLoading) setLoading(true);
        try {
            const next = await EngagementAPI.getStatus();
            if (version !== refreshVersion.current) return;

            let nextScans = [];
            let nextPosts = [];
            if (next.enabled) {
                const [listed, discovered] = await Promise.all([
                    EngagementAPI.listScans(),
                    EngagementAPI.listDiscovered({ limit: 50 }),
                ]);
                if (version !== refreshVersion.current) return;
                nextScans = listed.summaries || listed.scans || [];
                nextPosts = discovered.posts || [];
            }

            setStatus(next);
            setStatusWorkspaceId(workspaceId);
            setScans(nextScans);
            setPosts(nextPosts);
            setAvailable(true);
            setError(null);
        } catch (err) {
            if (version !== refreshVersion.current) return;
            if (err instanceof EngagementUnavailableError) {
                setAvailable(false);
                setStatus(null);
                setStatusWorkspaceId(null);
                setScans([]);
                setPosts([]);
                return;
            }
            setAvailable(true);
            setStatus(null);
            setStatusWorkspaceId(null);
            setScans([]);
            setPosts([]);
            setError(err.message || 'Could not load Engagement.');
        } finally {
            if (version === refreshVersion.current) setLoading(false);
        }
    }, [workspaceId]);

    useEffect(() => {
        workspaceGenerationRef.current += 1;
        refreshVersion.current += 1;
        setAvailable(null);
        setStatus(null);
        setStatusWorkspaceId(null);
        setScans([]);
        setPosts([]);
        setGroupId('');
        setInstructions('');
        busyRef.current = false;
        cancelingScanRef.current = null;
        setBusy(false);
        setCancelingScanId(null);
        setError(null);
        setNotice(null);
        refresh({ showLoading: true });
        return () => {
            workspaceGenerationRef.current += 1;
            refreshVersion.current += 1;
        };
    }, [workspaceId, refresh]);

    const pollRefresh = useCallback(() => {
        if (pollingRequestRef.current) return pollingRequestRef.current;
        const request = refresh().finally(() => {
            if (pollingRequestRef.current === request) pollingRequestRef.current = null;
        });
        pollingRequestRef.current = request;
        return request;
    }, [refresh]);

    useEffect(() => {
        if (!enabled || !currentStatus?.active_scan) return undefined;
        const timer = setInterval(() => { void pollRefresh(); }, 5000);
        return () => clearInterval(timer);
    }, [enabled, currentStatus?.active_scan, pollRefresh]);

    const sortedGroups = useMemo(
        () => dedupeGroups(groups, workspaceId),
        [groups, workspaceId],
    );

    const startScan = async () => {
        if (!enabled || !groupId || busyRef.current || currentStatus?.active_scan) return;
        const parsedMaxPosts = Number(maxPosts);
        if (!Number.isInteger(parsedMaxPosts) || parsedMaxPosts < 1 || parsedMaxPosts > 10) {
            setError('Posts per group must be a whole number between 1 and 10.');
            return;
        }
        if (instructions.trim().length > 1000) {
            setError('Scan note must be at most 1000 characters.');
            return;
        }

        busyRef.current = true;
        setBusy(true);
        setError(null);
        setNotice(null);
        try {
            const group = sortedGroups.find(item => String(item.id) === String(groupId));
            await EngagementAPI.startScan({
                name: `Manual scan - ${group?.name || groupId}`,
                groupId,
                maxPosts: parsedMaxPosts,
                searchInstructions: instructions.trim(),
            });
            setNotice('Scan queued. Keep the paired browser extension online while it runs.');
            await refresh();
        } catch (err) {
            setError(err instanceof EngagementUnavailableError
                ? 'Engagement is not enabled for this workspace.'
                : (err.message || 'Could not start the scan.'));
        } finally {
            busyRef.current = false;
            setBusy(false);
        }
    };

    const cancelQueuedScan = async scan => {
        if (scan?.status !== 'QUEUED' || cancelingScanRef.current) return;
        const workspaceGeneration = workspaceGenerationRef.current;
        cancelingScanRef.current = scan.id;
        setCancelingScanId(scan.id);
        setError(null);
        setNotice(null);
        try {
            await EngagementAPI.cancelScan(scan.id);
            if (workspaceGeneration !== workspaceGenerationRef.current) return;
            setNotice('Queued scan cancelled.');
            await refresh();
        } catch {
            if (workspaceGeneration === workspaceGenerationRef.current) {
                setError('Could not cancel the queued scan. Refresh and try again.');
            }
        } finally {
            if (workspaceGeneration === workspaceGenerationRef.current && cancelingScanRef.current === scan.id) {
                cancelingScanRef.current = null;
                setCancelingScanId(null);
            }
        }
    };

    if (available === false) return null;

    if (available === null) {
        return loading ? (
            <section
                data-testid="engagement-loading"
                className="rounded-2xl border border-gray-200 dark:border-white/10 bg-white dark:bg-white/5 p-5"
                aria-live="polite"
            >
                <span className="text-sm text-gray-500 dark:text-gray-400">Loading Engagement...</span>
            </section>
        ) : null;
    }

    const latest = currentStatus?.latest_scan || null;
    const completedEmpty = latest?.ui_state === 'COMPLETED' && latest.posts_discovered === 0;

    return (
        <section
            data-testid="engagement-panel"
            className="rounded-2xl border border-gray-200 dark:border-white/10 bg-white dark:bg-white/5 p-4 sm:p-5 space-y-5"
            aria-labelledby="engagement-heading"
        >
            <header className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                    <h2 id="engagement-heading" className="text-lg font-bold text-gray-900 dark:text-white">
                        Engagement - Opportunities
                    </h2>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                        Reads top-level posts from one selected group. It never posts, comments or reacts.
                    </p>
                </div>
                {currentStatus && (
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
                )}
            </header>

            {!currentStatus && error && (
                <p data-testid="engagement-error" role="alert" className="text-sm text-rose-700 dark:text-rose-400">
                    {error}
                </p>
            )}

            {currentStatus && !enabled && (
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
                                {currentStatus?.discovered_count ?? 0}
                            </div>
                        </div>
                    </div>

                    {latest?.reason_summary && latest.error_code !== 'NO_POSTS_FOUND' && (
                        <p
                            data-testid="engagement-reason"
                            role="alert"
                            className="text-sm rounded-xl border border-orange-200 dark:border-orange-500/30 bg-orange-50 dark:bg-orange-500/10 text-orange-800 dark:text-orange-300 p-3"
                        >
                            {latest.reason_summary}
                        </p>
                    )}
                    {completedEmpty && (
                        <p data-testid="engagement-empty-result" className="text-sm text-gray-600 dark:text-gray-300">
                            The scan completed successfully, but no top-level posts were found.
                        </p>
                    )}

                    <div aria-labelledby="engagement-new-scan-heading" className="space-y-3">
                        <h3 id="engagement-new-scan-heading" className="text-sm font-bold text-gray-900 dark:text-white">New scan</h3>
                        <div className="grid gap-3 md:grid-cols-[minmax(0,2fr)_minmax(9rem,1fr)_auto] md:items-end">
                            <label className="min-w-0">
                                <span className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Group to scan</span>
                                <select
                                    data-testid="engagement-group-select"
                                    value={groupId}
                                    onChange={event => setGroupId(event.target.value)}
                                    className="w-full min-w-0 rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#161b22] px-3 py-2 text-sm text-gray-900 dark:text-white"
                                >
                                    <option value="">Select a group...</option>
                                    {sortedGroups.map(group => (
                                        <option key={group.id} value={group.id}>{group.name || group.id}</option>
                                    ))}
                                </select>
                            </label>
                            <label>
                                <span className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Posts to inspect (1-10)</span>
                                <input
                                    data-testid="engagement-max-posts"
                                    type="number"
                                    min="1"
                                    max="10"
                                    step="1"
                                    value={maxPosts}
                                    onChange={event => setMaxPosts(event.target.value)}
                                    className="w-full rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#161b22] px-3 py-2 text-sm text-gray-900 dark:text-white"
                                />
                            </label>
                            <button
                                type="button"
                                data-testid="engagement-scan-now"
                                onClick={startScan}
                                disabled={!groupId || busy || currentStatus?.active_scan}
                                className="w-full md:w-auto rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed px-4 py-2 text-sm font-bold text-white"
                            >
                                {busy ? 'Starting...' : 'Scan now'}
                            </button>
                        </div>
                        <label className="block">
                            <span className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Scan note (optional)</span>
                            <textarea
                                data-testid="engagement-instructions"
                                rows="2"
                                maxLength="1000"
                                value={instructions}
                                onChange={event => setInstructions(event.target.value)}
                                aria-describedby="engagement-instructions-help"
                                className="w-full resize-y rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#161b22] px-3 py-2 text-sm text-gray-900 dark:text-white"
                            />
                            <span id="engagement-instructions-help" className="mt-1 block text-xs text-gray-500 dark:text-gray-400">
                                Saved with the task for reference. Phase 1 does not rank or filter posts from this text.
                            </span>
                        </label>
                    </div>

                    {currentStatus?.active_scan && (
                        <p data-testid="engagement-active-note" className="text-xs text-gray-500 dark:text-gray-400">
                            A scan is queued or running. Keep the paired browser extension online; only one scan runs at a time.
                        </p>
                    )}

                    <div aria-labelledby="engagement-history-heading" className="space-y-2">
                        <h3 id="engagement-history-heading" className="text-sm font-bold text-gray-900 dark:text-white">Scan history</h3>
                        {scans.length === 0 ? (
                            <p data-testid="engagement-empty-scans" className="text-sm text-gray-500 dark:text-gray-400">No scans have been run in this workspace.</p>
                        ) : (
                            <div data-testid="engagement-scan-list" className="divide-y divide-gray-100 dark:divide-white/5 rounded-xl border border-gray-200 dark:border-white/10">
                                {scans.slice(0, 10).map(scan => (
                                    <article key={scan.id} data-testid="engagement-scan-row" className="grid gap-2 p-3 sm:grid-cols-[minmax(0,2fr)_auto_auto_auto_auto] sm:items-center">
                                        <div className="min-w-0">
                                            <div dir="auto" className="break-words text-sm font-medium text-gray-900 dark:text-white">{scan.group_name || scan.name}</div>
                                            {scan.search_instructions && <div dir="auto" className="mt-1 break-words text-xs text-gray-500 dark:text-gray-400">{scan.search_instructions}</div>}
                                            {scan.reason_summary && <div className="mt-1 text-xs text-orange-700 dark:text-orange-300">{scan.reason_summary}</div>}
                                        </div>
                                        <StateBadge state={scan.ui_state} />
                                        <span className="text-xs text-gray-700 dark:text-gray-300">{scan.posts_discovered} posts</span>
                                        <time className="text-xs text-gray-500 dark:text-gray-400">{formatTime(scan.created_at)}</time>
                                        {scan.status === 'QUEUED' && (
                                            <button
                                                type="button"
                                                data-testid="engagement-cancel-scan"
                                                onClick={() => cancelQueuedScan(scan)}
                                                disabled={cancelingScanId === scan.id}
                                                className="rounded-lg border border-gray-300 dark:border-white/15 px-3 py-1.5 text-xs font-semibold text-gray-700 dark:text-gray-200 disabled:cursor-not-allowed disabled:opacity-40"
                                            >
                                                {cancelingScanId === scan.id ? 'Cancelling...' : 'Cancel'}
                                            </button>
                                        )}
                                    </article>
                                ))}
                            </div>
                        )}
                    </div>

                    <div aria-labelledby="engagement-posts-heading" className="space-y-2">
                        <h3 id="engagement-posts-heading" className="text-sm font-bold text-gray-900 dark:text-white">Discovered posts</h3>
                        {posts.length === 0 ? (
                            <p data-testid="engagement-empty-posts" className="text-sm text-gray-500 dark:text-gray-400">No discovered posts to show yet.</p>
                        ) : (
                            <div data-testid="engagement-post-list" className="grid gap-3 lg:grid-cols-2">
                                {posts.map(post => {
                                    const postUrl = safeFacebookUrl(post.facebook_post_url);
                                    return (
                                        <article key={post.id} data-testid="engagement-post" className="min-w-0 rounded-xl border border-gray-200 dark:border-white/10 p-3">
                                            <div className="flex flex-wrap items-start justify-between gap-2">
                                                <div className="min-w-0">
                                                    <div dir="auto" className="break-words text-xs font-bold text-gray-900 dark:text-white">{post.facebook_group_name || 'Facebook group'}</div>
                                                    <div dir="auto" className="break-words text-xs text-gray-500 dark:text-gray-400">{post.author_name || 'Unknown author'}</div>
                                                </div>
                                                <time className="text-xs text-gray-500 dark:text-gray-400">{formatTime(post.posted_at || post.discovered_at)}</time>
                                            </div>
                                            <p dir="auto" className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-gray-800 dark:text-gray-200">
                                                {post.post_text || '(No text captured)'}
                                            </p>
                                            <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
                                                {post.is_truncated && <span data-testid="engagement-post-truncated" className="text-amber-700 dark:text-amber-300">Preview truncated</span>}
                                                {postUrl && (
                                                    <a
                                                        data-testid="engagement-post-link"
                                                        href={postUrl}
                                                        target="_blank"
                                                        rel="noreferrer"
                                                        dir="ltr"
                                                        className="text-blue-600 dark:text-blue-400 underline underline-offset-2"
                                                    >
                                                        Open on Facebook
                                                    </a>
                                                )}
                                            </div>
                                        </article>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                </>
            )}

            {notice && <p data-testid="engagement-notice" role="status" className="text-sm text-emerald-700 dark:text-emerald-400">{notice}</p>}
            {currentStatus && error && <p data-testid="engagement-error" role="alert" className="text-sm text-rose-700 dark:text-rose-400">{error}</p>}
        </section>
    );
}
