// Matched post opportunities — Phase 2A.
//
// Relevance is shown as one of three bands, never a percentage. "87.3% relevant"
// would imply a calibration the matcher does not have; the bands map exactly to
// what it returns, and each one is accompanied by the reason it gave.
//
// There is no source-type filter. Phase 2A matches top-level posts only, so a
// filter with one option would be furniture.
import React from 'react';

const RELEVANCE = {
    exact: {
        label: 'Exact',
        className: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300',
    },
    strong: {
        label: 'Strong',
        className: 'bg-blue-100 text-blue-800 dark:bg-blue-500/15 dark:text-blue-300',
    },
    possible: {
        label: 'Possible',
        className: 'bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-300',
    },
};

function discoveredLabel(value) {
    if (!value) return null;
    const then = new Date(value);
    if (Number.isNaN(then.getTime())) return null;
    const minutes = Math.round((Date.now() - then.getTime()) / 60000);
    if (minutes < 60) return `${Math.max(1, minutes)}m ago`;
    const hours = Math.round(minutes / 60);
    return hours < 24 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`;
}

export default function OpportunityList({
    opportunities = [],
    watches = [],
    filters = {},
    loading = false,
    onFilterChange,
}) {
    const select = 'rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-[#161b22] px-2 py-1 text-xs text-gray-900 dark:text-white';

    return (
        <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
                <label className="flex items-center gap-1.5">
                    <span className="text-xs text-gray-500 dark:text-gray-400">Search</span>
                    <select
                        data-testid="opportunity-filter-watch"
                        value={filters.watchId || ''}
                        onChange={e => onFilterChange?.({ ...filters, watchId: e.target.value || null })}
                        className={select}
                    >
                        <option value="">All searches</option>
                        {watches.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                    </select>
                </label>

                <label className="flex items-center gap-1.5">
                    <span className="text-xs text-gray-500 dark:text-gray-400">Relevance</span>
                    <select
                        data-testid="opportunity-filter-relevance"
                        value={filters.relevance || ''}
                        onChange={e => onFilterChange?.({ ...filters, relevance: e.target.value || null })}
                        className={select}
                    >
                        <option value="">Any</option>
                        <option value="exact">Exact</option>
                        <option value="strong">Strong</option>
                        <option value="possible">Possible</option>
                    </select>
                </label>
            </div>

            {loading && (
                <p data-testid="opportunities-loading" aria-live="polite" className="text-sm text-gray-500 dark:text-gray-400">
                    Checking results…
                </p>
            )}

            {!loading && !opportunities.length && (
                // Deliberately not styled as an error: nothing has gone wrong.
                <p data-testid="opportunities-empty" className="text-sm text-gray-600 dark:text-gray-300">
                    No matching posts yet. Run a scan on the groups this search covers, then check back.
                </p>
            )}

            {!loading && opportunities.length > 0 && (
                <ul data-testid="opportunity-list" className="space-y-2">
                    {opportunities.map(item => {
                        const band = RELEVANCE[item.relevance] || RELEVANCE.possible;
                        const terms = Array.isArray(item.matched_terms) ? item.matched_terms : [];
                        return (
                            <li
                                key={item.id}
                                data-testid="opportunity-row"
                                className="rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#161b22] p-3"
                            >
                                <div className="flex flex-wrap items-center gap-2">
                                    <span
                                        data-testid="opportunity-relevance"
                                        className={`rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${band.className}`}
                                    >
                                        {band.label}
                                    </span>
                                    <span className="rounded-md bg-gray-100 dark:bg-white/5 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-gray-600 dark:text-gray-300">
                                        Post
                                    </span>
                                    <span className="min-w-0 truncate text-xs text-gray-500 dark:text-gray-400">
                                        {item.facebook_group_id}
                                    </span>
                                    {/* Same gray pair as its siblings, not the inverted
                                        gray-400/gray-500, which picked the lightest value
                                        in BOTH themes: measured 2.54:1 on light and
                                        3.58:1 on dark, under the 4.5:1 AA floor for
                                        12px text. */}
                                    {discoveredLabel(item.discovered_at) && (
                                        <span className="text-xs text-gray-500 dark:text-gray-400">
                                            {discoveredLabel(item.discovered_at)}
                                        </span>
                                    )}
                                </div>

                                <p dir="auto" className="mt-2 text-sm text-gray-900 dark:text-white">
                                    {item.excerpt}
                                </p>

                                {item.author_name && (
                                    <p className="mt-1 text-xs text-gray-500 dark:text-gray-400" dir="auto">
                                        — {item.author_name}
                                    </p>
                                )}

                                <p data-testid="opportunity-reason" className="mt-2 text-xs text-gray-600 dark:text-gray-300">
                                    <span className="font-semibold">Why: </span>
                                    <span dir="auto">{item.match_reason}</span>
                                </p>

                                {terms.length > 0 && (
                                    <div data-testid="opportunity-terms" className="mt-1.5 flex flex-wrap gap-1">
                                        {terms.map(term => (
                                            <span
                                                key={term}
                                                dir="auto"
                                                className="rounded bg-gray-100 dark:bg-white/5 px-1.5 py-0.5 text-[11px] text-gray-700 dark:text-gray-200"
                                            >
                                                {term}
                                            </span>
                                        ))}
                                    </div>
                                )}

                                {/* Only rendered when a URL exists — a dead "Open" is worse
                                    than no button, and dedup can produce rows without one. */}
                                {item.source_url && (
                                    <a
                                        data-testid="opportunity-open"
                                        href={item.source_url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="mt-2 inline-block text-xs font-semibold text-blue-700 dark:text-blue-300 underline underline-offset-2"
                                    >
                                        Open on Facebook
                                    </a>
                                )}
                            </li>
                        );
                    })}
                </ul>
            )}
        </div>
    );
}
